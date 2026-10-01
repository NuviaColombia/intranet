"""
=====================================================================================================
  ⚠️  ORIGEN OFICIAL DE LOS DATOS DEL EQUIPO DE DISEÑO — VALIDAR CON ROSEMBER ANTES DE CAMBIAR  ⚠️
=====================================================================================================
Openings (Parámetros › Openings) es la base de datos de asignación de centros a los managers/equipos:
  * De Openings sale el desplegable Centro del Schedule (services_design.centros_de_equipo).
  * De Openings salen los centros de cada hoja de Pre-Approved N3 y N2 (pa_sync_openings, en este archivo):
    si en Openings cambia el Manager N3/N2 de un centro, su bloque (doctores y valores) pasa solo a la hoja
    del nuevo manager. Mover un centro a mano en Pre-Approved actualiza Openings (openings_asignar_por_pa).
Parámetros › Equipos es el origen de los equipos, managers y diseñadores del Schedule:
  * Cambiar el manager de un equipo cambia su nombre en Openings; desactivar un equipo deja sus centros
    sin manager en Openings (openings_por_cambio_de_equipo).

Cambiar estos puntos de origen (de dónde se leen o hacia dónde se escriben estos datos) puede dañar el
funcionamiento de la plataforma para el equipo de diseño. Valida con Rosember antes de modificarlos.
La prueba tests/test_design_origenes.py falla a propósito si cambian.
=====================================================================================================
"""
import json
import re
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .models import Empleado
from .models_design import (DesignArea, DesignTeam, DesignPreApprovedSheet, DesignPreApprovedCentro,
                            DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda)
from . import services_design as sd

# Columna de Openings con el manager de cada área. Pre-Approved solo existe para N3 y N2 (Face usa el de N2 y
# N6 el de N3), por eso la sincronización de Pre-Approved usa solo las dos primeras (1-oct-2026).
PA_OPENINGS_COL = {"N3 Prosthetic": "manager_n3", "N2 Demodenture": "manager_n2"}
OPENINGS_COL_EQUIPO = {"N3 Prosthetic": "manager_n3", "N2 Demodenture": "manager_n2",
                       "Face Design": "manager_face", "N6 Material Changes": "manager_n6"}
# Nombres de Pre-Approved que son el mismo centro de Openings con otra escritura.
PA_CENTRO_ALIAS = {"stlouis": "saintlouis", "vegas": "lasvegas", "wetsbury": "westbury"}
MARCA_AUTO = "pa_openings_auto"  # existe desde que se aplicó la primera sincronización: después es automática
SIN_MANAGER = {"", "n/a", "na", "-", "--"}


def _pal(t: str) -> set:
    """Palabras de un nombre sin iniciales ni puntos ("Julio E. Hernandez" = Julio Enrique Hernandez Florez)."""
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", sd._normalizar_texto(t)).split() if len(w) > 1}


def centro_clave(nombre: str) -> str:
    """'Fresno - Joshua Pinon' → 'fresno'; 'ST. Louis' → 'saintlouis'. Solo lo que va antes del guion."""
    base = (nombre or "").split("-", 1)[0]
    k = re.sub(r"[^a-z0-9]", "", sd._normalizar_texto(base))
    return PA_CENTRO_ALIAS.get(k, k)


def _doc_clave(nombre: str) -> str:
    t = sd._normalizar_texto(nombre)
    t = re.sub(r"^dra?\b\.?", "", t)
    return re.sub(r"[^a-z]", "", t)


def _crit_clave(criterio: str) -> str:
    return re.sub(r"[^a-z0-9]", "", sd._normalizar_texto(criterio))


def _crit_igual(criterio: str, existentes: dict):
    """El criterio de destino que es el mismo aunque esté escrito distinto ('icam / micron' = 'icam/micron',
    'arch roation' = 'arch rotation'). existentes = {clave: valor}. None si no hay."""
    import difflib
    k = _crit_clave(criterio)
    if k in existentes:
        return existentes[k]
    m = difflib.get_close_matches(k, list(existentes), n=1, cutoff=0.88)
    return existentes[m[0]] if m else None


def _sin_manager(texto: str) -> bool:
    return sd._normalizar_texto(texto) in SIN_MANAGER


def _filas_openings(db: Session) -> list:
    H, C, Fi = sd._openings_modelos()
    h = db.query(H).order_by(H.id).first()
    if not h:
        return []
    return db.query(Fi).filter(Fi.hoja_id == h.id).order_by(Fi.orden, Fi.id).all()


def auto_activa(db: Session) -> bool:
    from .models_design import DesignConexionRegla
    return db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                                DesignConexionRegla.clave == MARCA_AUTO).first() is not None


def _equipos_area(db: Session, area_id: int) -> list:
    return (db.query(DesignTeam).options(joinedload(DesignTeam.manager))
            .filter(DesignTeam.area_id == area_id, DesignTeam.activo == 1, DesignTeam.manager_id.isnot(None)).all())


def _equipo_de_texto(texto: str, teams: list) -> tuple:
    """Equipo cuyo manager es el nombre escrito en Openings → (team | None, motivo)."""
    p = _pal(texto)
    cands = [t for t in teams if p and p <= _pal(t.manager.nombre_completo)]
    if len(cands) == 1:
        return cands[0], ""
    return None, ("ambiguo" if cands else "desconocido")


def _hoja_de_equipo(team, hojas: list, reglas: dict):
    """Hoja de Pre-Approved del equipo: la asociada en Parámetros o la que lleva el nombre del manager."""
    h = next((s for s in hojas if reglas.get(s.id) == team.id), None)
    if h:
        return h
    pm = _pal(team.manager.nombre_completo)
    cands = [s for s in hojas if s.id not in reglas and _pal(sd._sin_prefijo_area(s.nombre))
             and _pal(sd._sin_prefijo_area(s.nombre)) <= pm]
    return cands[0] if len(cands) == 1 else None


def _equipo_de_hoja(sheet, teams: list, reglas: dict):
    if sheet.id in reglas:
        return next((t for t in teams if t.id == reglas[sheet.id]), None)
    p = _pal(sd._sin_prefijo_area(sheet.nombre))
    cands = [t for t in teams if p and p <= _pal(t.manager.nombre_completo)]
    return cands[0] if len(cands) == 1 else None


def _nombre_hoja_nueva(area_nombre: str, team) -> str:
    primero = (team.manager.nombre_completo or "").split()[0] if team.manager.nombre_completo else team.nombre
    return (f"N2 {primero}" if area_nombre == "N2 Demodenture" else primero).strip()


def _bloques(db: Session, sheet) -> list:
    """Bloques de la hoja en orden: {centro, clave, docs}. Doctores sobrantes (más que la suma de spans) quedan
    en un bloque 'suelto' al final que nunca se mueve."""
    docs = sd._pac_doctores_ordenados(db, sheet.id)
    out, i = [], 0
    for c in sd._pac_centros_ordenados(db, sheet.id):
        out.append({"centro": c, "nombre": c.nombre, "clave": centro_clave(c.nombre), "docs": docs[i:i + c.span],
                    "origen": sheet.id})
        i += c.span
    if i < len(docs):
        out.append({"centro": None, "nombre": "", "clave": "", "docs": docs[i:], "suelto": True, "origen": sheet.id})
    return out


def _idx(lista: list, b: dict) -> int:
    return next(i for i, x in enumerate(lista) if x is b)


def _al_final(lista: list, b: dict) -> None:
    pos = len(lista) - 1 if lista and lista[-1].get("suelto") else len(lista)
    lista.insert(pos, b)


def _nombres_docs(docs) -> str:
    n = [d.nombre.strip() for d in docs if (d.nombre or "").strip() not in ("", "Dr.", "Dr")]
    return ", ".join(n[:6]) + ("…" if len(n) > 6 else "")


def pa_sync_openings(db: Session, aplicar: bool = False, por: str = "Sistema") -> dict:
    """Ordena los centros de Pre-Approved N3 y N2 según Openings (Manager N3 / Manager N2).
    aplicar=False solo arma la vista previa. Lo que se quita va a la Papelera de Design."""
    reglas = sd.reglas_conexion(db)["pa_manager"]
    filas_op = [json.loads(f.datos or "{}") for f in _filas_openings(db)]
    areas = {a.nombre: a for a in db.query(DesignArea).all()}
    resultado = {"auto": auto_activa(db), "areas": [], "total": 0}

    # 1) hojas nuevas para managers de Openings con equipo pero sin hoja (ej. Zulys en N3)
    if aplicar:
        creadas = False
        for area_nombre, col in PA_OPENINGS_COL.items():
            area = areas.get(area_nombre)
            if not area:
                continue
            teams, hojas = _equipos_area(db, area.id), sd.preapproved_sheets(db, area.id)
            for t in {_equipo_de_texto(f.get(col, ""), teams)[0] for f in filas_op if not _sin_manager(f.get(col, ""))} - {None}:
                if not _hoja_de_equipo(t, hojas, reglas):
                    _crear_hoja(db, area, t, hojas, por)
                    hojas = sd.preapproved_sheets(db, area.id)
                    creadas = True
        if creadas:
            reglas = sd.reglas_conexion(db)["pa_manager"]

    papelera_hojas = []
    for area_nombre, col in PA_OPENINGS_COL.items():
        area = areas.get(area_nombre)
        if not area:
            continue
        teams, hojas = _equipos_area(db, area.id), sd.preapproved_sheets(db, area.id)
        nombre_hoja = {s.id: s.nombre for s in hojas}
        acciones, pendientes = [], []
        etq_col = "Manager N3" if col == "manager_n3" else "Manager N2"
        bloques = {s.id: _bloques(db, s) for s in hojas}
        final = {s.id: list(bloques[s.id]) for s in hojas}

        # destino de cada centro según Openings
        destino, nombre_op, vistos = {}, {}, set()
        hojas_nuevas = {}
        for f in filas_op:
            nombre = (f.get("centro") or "").strip()
            k = centro_clave(nombre)
            if not k:
                continue
            if k in vistos:
                pendientes.append(f"Openings tiene «{nombre}» más de una vez: se usa la primera.")
                continue
            vistos.add(k)
            nombre_op[k] = nombre
            mtxt = (f.get(col) or "").strip()
            if _sin_manager(mtxt):
                destino[k] = None
                continue
            t, motivo = _equipo_de_texto(mtxt, teams)
            if not t:
                pendientes.append(f"«{nombre}»: el {etq_col} de Openings es «{mtxt}», que {'coincide con varios managers' if motivo == 'ambiguo' else 'no es manager de un equipo activo'} "
                                  f"de {area_nombre}. No se mueve.")
                destino[k] = None
                continue
            h = _hoja_de_equipo(t, hojas, reglas)
            if not h:
                if t.id not in hojas_nuevas:
                    hojas_nuevas[t.id] = _nombre_hoja_nueva(area_nombre, t)
                    acciones.append(f"Crear la hoja «{hojas_nuevas[t.id]}» para {t.manager.nombre_completo} (con los mismos criterios de las demás hojas de {area_nombre}).")
                destino[k] = ("nueva", t.id)
            else:
                destino[k] = h.id

        def etiqueta(sid):
            return hojas_nuevas.get(sid[1]) if isinstance(sid, tuple) else nombre_hoja.get(sid, "?")

        for sid in {d for d in destino.values() if isinstance(d, tuple)}:
            final[sid] = []

        por_clave = {}
        for s in hojas:
            for b in bloques[s.id]:
                if b["clave"]:
                    por_clave.setdefault(b["clave"], []).append(b)

        fusiones, descartes = [], []  # (doctor que queda, doctor que se va) / (bloque, [doctores a la Papelera])
        for k, dst in destino.items():
            lst = por_clave.get(k, [])
            if dst is None:
                for b in lst:
                    pendientes.append(f"«{b['nombre']}» en {nombre_hoja[b['origen']]}: Openings no le da {etq_col}. No se toca.")
                continue
            if not lst:
                acciones.append(f"Crear «{nombre_op[k]}» vacío en {etiqueta(dst)}.")
                _al_final(final[dst], {"centro": None, "nombre": nombre_op[k], "clave": k, "docs": [], "origen": dst, "nuevo": True})
                continue
            propios = [b for b in lst if b["origen"] == dst]
            ajenos = [b for b in lst if b["origen"] != dst]
            base = propios[0] if propios else ajenos[0]
            docs, claves = [], {}

            def sumar(b):
                """Agrega los doctores del bloque; repetidos y vacíos (fuera del bloque base) van a la Papelera."""
                tirar = []
                for d in b["docs"]:
                    dk = _doc_clave(d.nombre)
                    if not dk:
                        if b is base:
                            docs.append(d)
                        else:
                            tirar.append(d)
                    elif dk in claves:
                        fusiones.append((claves[dk], d))
                        tirar.append(d)
                    else:
                        claves[dk] = d
                        docs.append(d)
                return tirar

            for b in propios:
                t = sumar(b)
                if t:
                    descartes.append((b, t))
            for b in ajenos:
                antes = len(docs)
                t = sumar(b)
                if t:
                    descartes.append((b, t))
                nuevos = docs[antes:]
                if propios:
                    acciones.append(f"«{b['nombre']}» de {nombre_hoja[b['origen']]} → Papelera ({etiqueta(dst)} ya tiene {nombre_op[k]})"
                                    + (f"; se suman a {etiqueta(dst)}: {_nombres_docs(nuevos)}" if _nombres_docs(nuevos) else "") + ".")
            if not propios:
                desde = ", ".join(dict.fromkeys(nombre_hoja[b["origen"]] for b in ajenos))
                acciones.append(f"Mover «{nombre_op[k]}» de {desde} a {etiqueta(dst)} ({len(docs)} doctor{'es' if len(docs) != 1 else ''}"
                                + (", en un solo bloque" if len(ajenos) > 1 else "") + ").")
            elif len(propios) > 1:
                acciones.append(f"Unir los {len(propios)} bloques de «{nombre_op[k]}» en {etiqueta(dst)} en uno solo ({len(docs)} doctores).")
            nuevo = {"centro": base["centro"], "nombre": nombre_op[k], "clave": k, "docs": docs, "origen": dst}
            if base["origen"] == dst:  # queda en el lugar de su primer bloque
                final[dst][_idx(final[dst], base)] = nuevo
            for b in lst:
                if b is not base or base["origen"] != dst:
                    del final[b["origen"]][_idx(final[b["origen"]], b)]
            if base["origen"] != dst:
                _al_final(final[dst], nuevo)
            if base["nombre"].strip() != nombre_op[k] and (propios or len(ajenos) == 1):
                acciones.append(f"Renombrar «{base['nombre'].strip()}» → «{nombre_op[k]}» en {etiqueta(dst)}.")

        # bloques que Openings no conoce o sin nombre: no se tocan
        for s in hojas:
            for b in bloques[s.id]:
                if b.get("suelto"):
                    continue
                if not b["clave"]:
                    pendientes.append(f"{s.nombre}: bloque sin nombre de centro ({_nombres_docs(b['docs']) or 'sin doctores'}). No se toca.")
                elif b["clave"] not in destino:
                    pendientes.append(f"«{b['nombre']}» en {s.nombre}: no está en Openings. No se toca.")

        # criterios que faltan en la hoja de destino para no perder valores
        criterios = {s.id: {_crit_clave(f.criterio): True for f in s.filas} for s in hojas}
        plantilla = _criterios_plantilla(hojas)
        faltan = {}
        for sid, lista in final.items():
            crit_dst = criterios.get(sid) if not isinstance(sid, tuple) else {_crit_clave(c): True for c in plantilla}
            for b in lista:
                for d in b["docs"]:
                    if d.sheet_id != sid:
                        for crit, _v in _celdas_txt(db, d.id).values():
                            if _v.strip() and not _crit_igual(crit, crit_dst):
                                faltan.setdefault(sid, {})[crit.strip()] = True
        for sid, cs in faltan.items():
            acciones.append(f"Agregar a {etiqueta(sid)} los criterios que traen los doctores movidos: {', '.join(cs)}.")

        # hojas que quedan sin centros y cuyo manager no está en Openings → Papelera
        destinos = {d for d in destino.values() if d is not None}
        for s in hojas:
            if s.id not in destinos and not [b for b in final[s.id] if not b.get("suelto")] and bloques[s.id]:
                acciones.append(f"La hoja «{s.nombre}» queda sin centros (su manager no tiene centros en Openings) → Papelera.")
                papelera_hojas.append(s.id)

        if aplicar and (acciones or fusiones or descartes):
            _escribir(db, final, fusiones, descartes, {d: hojas_nuevas.get(d[1]) for d in final if isinstance(d, tuple)}, por)
        resultado["areas"].append({"area": area_nombre, "acciones": acciones, "pendientes": pendientes})
        resultado["total"] += len(acciones)

    if aplicar:
        db.commit()
        for sid in papelera_hojas:
            sd.eliminar_preapproved_sheet(db, sid, f"{por} (sincronización con Openings)")
        _marcar_auto(db, por)
        resultado["auto"] = True
    resultado["sinManager"] = centros_sin_manager(db)
    return resultado


def _criterios_plantilla(hojas: list) -> list:
    """Criterios de la hoja con más filas del área (para una hoja nueva)."""
    mejor = max(hojas, key=lambda s: len(s.filas), default=None)
    return [f.criterio for f in mejor.filas] if mejor else []


def _crear_hoja(db: Session, area, team, hojas: list, por: str):
    modelo = max(hojas, key=lambda s: len(s.filas), default=None)
    orden = (max((s.orden or 0 for s in hojas), default=0)) + 1
    s = DesignPreApprovedSheet(area_id=area.id, nombre=_nombre_hoja_nueva(area.nombre, team), orden=orden)
    if modelo:
        s.titulo, s.changes_label = modelo.titulo, modelo.changes_label
    db.add(s)
    db.flush()
    for i, crit in enumerate(_criterios_plantilla(hojas), start=1):
        db.add(DesignPreApprovedFila(sheet_id=s.id, criterio=crit, orden=i))
    db.commit()
    sd._guardar_regla(db, "pa_manager", str(s.id), str(team.id), f"{por} (sincronización con Openings)")
    return s


def _fila_de(db: Session, sheet_id: int, criterio_txt: str, cache: dict):
    """Fila del criterio en la hoja de destino (el mismo aunque esté escrito distinto); si no existe, se crea al final."""
    if sheet_id not in cache:
        cache[sheet_id] = {_crit_clave(f.criterio): f for f in
                           db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).all()}
    m = cache[sheet_id]
    f = _crit_igual(criterio_txt, m)
    if f is None:
        orden = (db.query(func.max(DesignPreApprovedFila.orden)).filter(DesignPreApprovedFila.sheet_id == sheet_id).scalar() or 0) + 1
        f = DesignPreApprovedFila(sheet_id=sheet_id, criterio=criterio_txt.strip(), orden=orden)
        db.add(f)
        db.flush()
        m[_crit_clave(criterio_txt)] = f
    return f


def _escribir(db: Session, final: dict, fusiones: list, descartes: list, nombres_nuevas: dict, por: str) -> None:
    # hojas nuevas: ya se crearon antes de planear (aquí no debería quedar ninguna)
    final = {sid: l for sid, l in final.items() if not isinstance(sid, tuple)}
    # 1) Papelera: lo que se descarta, con sus valores (se puede restaurar en su hoja de origen)
    tirados = set()
    for b, docs in descartes:
        payload = {"sheet_id": b["origen"], "nombre": b["nombre"], "span": len(docs), "doctores": [
            {"nombre": d.nombre, "celdas": [{"fila_id": x.fila_id, "valor": x.valor} for x in
                                            db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id)]}
            for d in docs]}
        sd._trash_registrar(db, "pa-centro", f"Centro Pre-Approved: {b['nombre']} (sincronización con Openings)", payload,
                            f"{por} (sincronización con Openings)")
        tirados |= {d.id for d in docs}
    # 2) valores de los doctores repetidos: llenan las celdas vacías del que queda
    pend_fusion = [(keep, _celdas_txt(db, dup.id)) for keep, dup in fusiones]
    # 3) posiciones finales
    usados, cache = set(), {}
    for sid, lista in final.items():
        oc, od = 1, 1
        for b in lista:
            docs = [d for d in b["docs"] if d.id not in tirados]
            if b.get("suelto"):
                for d in docs:
                    _mover_doctor(db, d, sid, cache)
                    d.orden = od
                    od += 1
                continue
            c = b["centro"]
            if c is None or c.id in usados:
                c = DesignPreApprovedCentro(sheet_id=sid)
                db.add(c)
            if not docs:
                d = DesignPreApprovedDoctor(sheet_id=sid, nombre="Dr. ", orden=od)
                db.add(d)
                docs = [d]
            for d in docs:
                _mover_doctor(db, d, sid, cache)
                d.orden = od
                od += 1
            c.sheet_id, c.nombre, c.span, c.orden = sid, b["nombre"][:150], len(docs), oc
            db.flush()
            usados.add(c.id)
            oc += 1
    for keep, celdas in pend_fusion:
        for crit_txt, valor in celdas.values():
            if not valor.strip():
                continue
            fila = _fila_de(db, keep.sheet_id, crit_txt, cache)
            actual = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.fila_id == fila.id,
                                                             DesignPreApprovedCelda.doctor_id == keep.id).first()
            if not (actual and (actual.valor or "").strip()):
                sd.preapproved_guardar_celda(db, fila.id, keep.id, valor, commit=False)
    # 4) se borran los descartados y los encabezados que ya no se usan
    if tirados:
        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id.in_(tirados)).delete(synchronize_session=False)
        db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.id.in_(tirados)).delete(synchronize_session=False)
    for sid in final:
        for c in db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sid).all():
            if c.id not in usados:
                db.delete(c)
    db.flush()


def _celdas_txt(db: Session, doctor_id: int) -> dict:
    filas = (db.query(DesignPreApprovedCelda, DesignPreApprovedFila.criterio)
             .join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
             .filter(DesignPreApprovedCelda.doctor_id == doctor_id).all())
    return {sd._pac_normalizar(crit): (crit, c.valor or "") for c, crit in filas}


def _mover_doctor(db: Session, d, sheet_id: int, cache: dict) -> None:
    """Pasa el doctor a otra hoja con sus valores (alineados por nombre de criterio; si falta, se crea)."""
    if d.sheet_id == sheet_id:
        return
    for celda, crit in (db.query(DesignPreApprovedCelda, DesignPreApprovedFila.criterio)
                        .join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
                        .filter(DesignPreApprovedCelda.doctor_id == d.id).all()):
        if not (celda.valor or "").strip():
            db.delete(celda)
            continue
        fila = _fila_de(db, sheet_id, crit, cache)
        otra = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.fila_id == fila.id,
                                                       DesignPreApprovedCelda.doctor_id == d.id).first()
        if otra and otra is not celda:  # dos criterios escritos distinto que son el mismo: se juntan los textos
            if (celda.valor or "").strip() not in (otra.valor or ""):
                otra.valor = ((otra.valor or "").strip() + chr(10) + celda.valor.strip()).strip()
            db.delete(celda)
            continue
        celda.fila_id = fila.id
        db.flush()
    d.sheet_id = sheet_id


def _marcar_auto(db: Session, por: str) -> None:
    from .models_design import DesignConexionRegla
    if not auto_activa(db):
        try:
            db.add(DesignConexionRegla(tipo="sistema", clave=MARCA_AUTO, creado_por=por))
            db.commit()
        except Exception:
            db.rollback()


def centros_sin_manager(db: Session) -> list:
    """Centros de Openings con la columna de manager vacía (N/A no cuenta: es a propósito)."""
    out = []
    for f in _filas_openings(db):
        d = json.loads(f.datos or "{}")
        if not (d.get("centro") or "").strip():
            continue
        vacias = [area for area, col in OPENINGS_COL_EQUIPO.items() if not (d.get(col) or "").strip()]
        if vacias:
            out.append({"centro": d["centro"], "areas": vacias})
    return out


# ---------- Cambios que llegan de otros lados ----------

def tras_cambio_openings(db: Session, por: str) -> dict | None:
    """Después de editar Openings: si la sincronización ya está activa, Pre-Approved se reordena solo."""
    if not auto_activa(db):
        return None
    r = pa_sync_openings(db, aplicar=True, por=por)
    return r if r["total"] else None


def renombrar_centro_en_pa(db: Session, viejo: str, nuevo: str) -> int:
    """Openings cambió el nombre de un centro: sus bloques en Pre-Approved toman el nombre nuevo (antes de sincronizar,
    para que no parezcan un centro distinto)."""
    kv, kn = centro_clave(viejo), centro_clave(nuevo)
    if not kv or not kn or kv == kn or not auto_activa(db):
        return 0
    ids = [a.id for a in db.query(DesignArea).all() if a.nombre in PA_OPENINGS_COL]
    n = 0
    for c in (db.query(DesignPreApprovedCentro).join(DesignPreApprovedSheet, DesignPreApprovedCentro.sheet_id == DesignPreApprovedSheet.id)
              .filter(DesignPreApprovedSheet.area_id.in_(ids or [-1])).all()):
        if centro_clave(c.nombre) == kv:
            c.nombre = nuevo.strip()[:150]
            n += 1
    db.commit()
    return n


def _nombre_para_openings(team, col: str, filas: list) -> str:
    """Cómo se escribe el manager en Openings: como ya aparece en esa columna, o su nombre completo."""
    pm = _pal(team.manager.nombre_completo)
    usados = [d.get(col, "").strip() for d in filas if d.get(col, "").strip() and _pal(d.get(col, "")) and _pal(d.get(col, "")) <= pm]
    return max(set(usados), key=usados.count) if usados else team.manager.nombre_completo


def openings_asignar_por_pa(db: Session, area_id: int, centros: list) -> list:
    """Pre-Approved movió centros a mano: Openings toma el manager de la hoja donde quedaron.
    centros = [(nombre del centro, sheet_id de destino)]."""
    area = db.get(DesignArea, area_id)
    col = PA_OPENINGS_COL.get(area.nombre if area else "")
    if not col:
        return []
    teams, hojas = _equipos_area(db, area.id), sd.preapproved_sheets(db, area.id)
    reglas = sd.reglas_conexion(db)["pa_manager"]
    filas = _filas_openings(db)
    datos = [json.loads(f.datos or "{}") for f in filas]
    cambios = []
    for nombre, sheet_id in centros:
        sheet = next((s for s in hojas if s.id == sheet_id), None)
        team = _equipo_de_hoja(sheet, teams, reglas) if sheet else None
        k = centro_clave(nombre)
        if not team or not k:
            continue
        for f, d in zip(filas, datos):
            if centro_clave(d.get("centro", "")) == k:
                nuevo = _nombre_para_openings(team, col, datos)
                if d.get(col, "") != nuevo:
                    d[col] = nuevo
                    f.datos = json.dumps(d, ensure_ascii=False)
                    cambios.append(f"{d.get('centro')}: {nuevo}")
                break
    if cambios:
        sd._openings_tocar(db.get(sd._openings_modelos()[0], filas[0].hoja_id))
        db.commit()
    return cambios


def fijar_hoja_pa_de_equipo(db: Session, team, por: str) -> None:
    """Antes de cambiar el manager de un equipo: su hoja de Pre-Approved queda asociada al equipo (si no, al cambiar
    el nombre del manager la hoja dejaría de reconocerse y la sincronización la vaciaría)."""
    if not team.manager or team.area.nombre not in PA_OPENINGS_COL:
        return
    hojas = sd.preapproved_sheets(db, team.area_id)
    reglas = sd.reglas_conexion(db)["pa_manager"]
    h = _hoja_de_equipo(team, hojas, reglas)
    if h and h.id not in reglas:
        sd._guardar_regla(db, "pa_manager", str(h.id), str(team.id), por)


def openings_por_cambio_de_equipo(db: Session, team, manager_anterior: Empleado | None,
                                  manager_nuevo: Empleado | None) -> list:
    """Equipos → Openings: los centros del manager anterior (en la columna del área del equipo) pasan al nuevo;
    si no hay nuevo (o el equipo se desactivó), quedan sin manager. Devuelve los centros cambiados."""
    col = OPENINGS_COL_EQUIPO.get(team.area.nombre)
    if not col or not manager_anterior:
        return []
    pa = _pal(manager_anterior.nombre_completo)
    filas = _filas_openings(db)
    datos = [json.loads(f.datos or "{}") for f in filas]
    nuevo_txt = manager_nuevo.nombre_completo if manager_nuevo else ""
    cambiados = []
    for f, d in zip(filas, datos):
        v = (d.get(col) or "").strip()
        if v and _pal(v) and _pal(v) <= pa and v != nuevo_txt:
            d[col] = nuevo_txt
            f.datos = json.dumps(d, ensure_ascii=False)
            cambiados.append(d.get("centro") or "?")
    if cambiados:
        sd._openings_tocar(db.get(sd._openings_modelos()[0], filas[0].hoja_id))
        db.commit()
    return cambiados
