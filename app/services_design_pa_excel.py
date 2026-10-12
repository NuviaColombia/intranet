"""
Actualizar Pre-Approved N3 desde el Excel "Pre-Approved changes Design N3 Copy.xlsx" (pedido por Rosember el 12-oct-2026).

El Excel se convirtió a app/seed_data/design_preapproved_n3_excel_2026_10_12.json (+ fotos en seed_data/pa_fotos/).
Parámetros › "Pre-Approved desde el Excel" muestra la vista previa y un admin la aplica. Reglas acordadas con Rosember:
  * Openings manda: cada centro se actualiza en la hoja de su Manager N3 de Openings; no se mueven centros entre hojas.
    Si el centro está repetido en el Excel, vale la versión de la hoja de ese manager; si en Pre-Approved está también en
    otra hoja, esa copia se quita (Papelera).
  * Dentro del centro: los valores del Excel reemplazan los nuestros (un valor vacío en el Excel no borra nada), los
    doctores nuevos se agregan, los que no están en el Excel se quitan (Papelera) y los criterios que falten se crean.
  * No se tocan las hojas de Paula De la Torre, Dariana Ortega y Juliana Molinares (Rosember confirmó que están bien).
  * Las fotos del Excel quedan en su celda. Lo que se reemplaza o quita queda en la Papelera de Design.
No cambia de dónde salen los datos (Openings y Equipos siguen siendo el origen); solo usa services_design_origenes para leer.
"""
import json
import os
import re
from functools import lru_cache

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models_design import (DesignArea, DesignPreApprovedCentro, DesignPreApprovedDoctor, DesignPreApprovedFila,
                            DesignPreApprovedCelda, DesignConexionRegla)
from . import services_design as sd
from . import services_design_origenes as so

DIR = os.path.join(os.path.dirname(__file__), "seed_data")
ARCHIVO = os.path.join(DIR, "design_preapproved_n3_excel_2026_10_12.json")
FOTOS = os.path.join(DIR, "pa_fotos")
AREA = "N3 Prosthetic"
HOJAS_QUE_NO_SE_TOCAN = ["Paula De la Torre", "Dariana Ortega", "Juliana Molinares"]
MARCA = "pa_excel_n3_2026_10_12"
VACIOS = {"", "dr", "dra"}


@lru_cache(maxsize=1)
def _excel() -> dict:
    with open(ARCHIVO, encoding="utf-8") as f:
        return json.load(f)


def _t(v: str) -> str:
    return re.sub(r"\s+", " ", (v or "").replace("\r", "")).strip()


def _pal_doc(nombre: str) -> set:
    return so._pal(nombre) - {"dr", "dra"}


def _es_vacio(d) -> bool:
    return re.sub(r"[^a-z]", "", sd._normalizar_texto(d.nombre or "")) in VACIOS


def _manager_n3_por_centro(db: Session) -> dict:
    out = {}
    for f in so._filas_openings(db):
        d = json.loads(f.datos or "{}")
        k = so.centro_clave(d.get("centro") or "")
        if k and k not in out:
            out[k] = (d.get("manager_n3") or "").strip()
    return out


def _hoja_es_de(hoja_excel: str, manager: str) -> bool:
    """¿La hoja del Excel ("N3 Vanesa") es del manager de Openings ("Vanessa Reyes")? Admite letras de diferencia."""
    import difflib
    pm = list(so._pal(manager))
    ph = so._pal(re.sub(r"^N3\s+", "", hoja_excel))
    return bool(pm and ph) and all(difflib.get_close_matches(w, pm, n=1, cutoff=0.85) for w in ph)  # Vanesa = Vanessa; Paola ≠ Paula


def _buscar_doctor(nombre: str, docs: list, usados: set):
    k = so._doc_clave(nombre)
    for d in docs:
        if d.id not in usados and so._doc_clave(d.nombre) == k:
            return d
    p = _pal_doc(nombre)
    cands = [d for d in docs if d.id not in usados and not _es_vacio(d) and p and _pal_doc(d.nombre)
             and (p <= _pal_doc(d.nombre) or _pal_doc(d.nombre) <= p)]
    return cands[0] if len(cands) == 1 else None


def planear(db: Session) -> dict:
    """Compara el Excel con Pre-Approved N3 y arma lo que cambiaría (sin escribir nada)."""
    area = db.query(DesignArea).filter(DesignArea.nombre == AREA).first()
    res = {"centros": [], "pendientes": [], "excluidas": [], "total": 0, "ops": [],
           "aplicado": bool(db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                                                 DesignConexionRegla.clave == MARCA).first())}
    if not area:
        res["pendientes"].append("No existe el área N3 Prosthetic.")
        return res
    hojas = sd.preapproved_sheets(db, area.id)
    teams = so._equipos_area(db, area.id)
    reglas = sd.reglas_conexion(db)["pa_manager"]
    nombre_hoja = {s.id: s.nombre for s in hojas}

    excluidas = set()
    for s in hojas:
        t = so._equipo_de_hoja(s, teams, reglas)
        quien = so._pal(t.manager.nombre_completo) if t else so._pal(sd._sin_prefijo_area(s.nombre))
        for n in HOJAS_QUE_NO_SE_TOCAN:
            pn = so._pal(n)
            if quien and (pn <= quien or (not t and quien <= pn and len(quien) >= 2)):
                excluidas.add(s.id)
    res["excluidas"] = [nombre_hoja[i] for i in excluidas]

    bloques = {}  # clave → [(sheet, bloque)]
    for s in hojas:
        for b in so._bloques(db, s):
            if b["clave"] and not b.get("suelto"):
                bloques.setdefault(b["clave"], []).append((s, b))
    mgr = _manager_n3_por_centro(db)

    # Excel: el mismo centro puede estar en varias hojas → vale la de su manager N3 de Openings
    por_clave = {}
    for c in _excel()["centros"]:
        if so._pal(re.sub(r"^N3\s+", "", c["hojaExcel"])) in [so._pal(n) for n in HOJAS_QUE_NO_SE_TOCAN]:
            continue
        por_clave.setdefault(so.centro_clave(c["centro"]), []).append(c)

    for clave, versiones in por_clave.items():
        nombre_c = versiones[0]["centro"]
        mtxt = mgr.get(clave, "")
        team = so._equipo_de_texto(mtxt, teams)[0] if mtxt and not so._sin_manager(mtxt) else None
        hoja_op = so._hoja_de_equipo(team, hojas, reglas) if team else None
        if len(versiones) > 1:
            elegidas = [v for v in versiones if _hoja_es_de(v["hojaExcel"], mtxt)]
            if len(elegidas) != 1:
                res["pendientes"].append(f"«{nombre_c}» está en varias hojas del Excel ({', '.join(v['hojaExcel'] for v in versiones)}) "
                                         f"y Openings no dice cuál vale (Manager N3: «{mtxt or 'vacío'}»). No se toca.")
                continue
            version = elegidas[0]
        else:
            version = versiones[0]
        nuestros = bloques.get(clave, [])
        if hoja_op is not None and hoja_op.id in excluidas or any(s.id in excluidas for s, _ in nuestros if hoja_op is None):
            continue  # hojas que Rosember confirmó que están bien
        if hoja_op is not None:
            destino = next(((s, b) for s, b in nuestros if s.id == hoja_op.id), None)
        else:
            destino = nuestros[0] if len(nuestros) == 1 else None
        if not destino:
            if not nuestros:
                res["pendientes"].append(f"«{nombre_c}» no está en Pre-Approved N3"
                                         + (f" (Openings lo asigna a {hoja_op.nombre}; la sincronización con Openings crea su bloque)." if hoja_op else "."))
            else:
                res["pendientes"].append(f"«{nombre_c}» está en varias hojas de Pre-Approved y Openings no tiene su Manager N3. No se toca.")
            continue
        sheet, bloque = destino
        item = {"centro": bloque["nombre"] or nombre_c, "hoja": sheet.nombre, "excel": version["hojaExcel"], "acciones": []}
        # copias del centro en otras hojas: Openings no se las da → se quitan
        for s, b in nuestros:
            if (s, b) is destino or b is bloque or s.id in excluidas:
                continue
            item["acciones"].append(f"Quitar la copia del centro en la hoja {s.nombre} (Openings lo asigna a {sheet.nombre}).")
            res["ops"].append({"op": "quitar_centro", "centro_id": b["centro"].id})
        filas = {so._crit_clave(f.criterio): f for f in sheet.filas}
        docs = list(bloque["docs"])
        usados, finales = set(), []
        vacios = [d for d in docs if _es_vacio(d) and not so._celdas_txt(db, d.id)]
        for xd in version["doctores"]:
            if re.sub(r"[^a-z]", "", sd._normalizar_texto(xd["nombre"])) in VACIOS:  # "Dr." sin nombre en el Excel
                d = next((x for x in docs if _es_vacio(x) and x.id not in usados), None)
                if d in vacios:
                    vacios.remove(d)
            else:
                d = _buscar_doctor(xd["nombre"], [x for x in docs if not _es_vacio(x)], usados)
            nuevo = d is None
            if nuevo and vacios:
                d = vacios.pop(0)  # un doctor "Dr. " sin datos se usa para el nuevo
            if d is not None:
                usados.add(d.id)
            ref = d.id if d is not None else f"n{len(res['ops'])}"
            if nuevo:
                item["acciones"].append(f"Agregar a {xd['nombre']}.")
                res["ops"].append({"op": "doctor", "sheet_id": sheet.id, "doctor_id": d.id if d else None, "ref": ref,
                                   "nombre": xd["nombre"]})
            elif so._doc_clave(d.nombre) != so._doc_clave(xd["nombre"]) and not _pal_doc(xd["nombre"]) < _pal_doc(d.nombre):
                # otro nombre (si el nuestro es más completo, "Dr Terry Dingbaum" vs "Dr. Dingbaum", se deja el nuestro)
                item["acciones"].append(f"Nombre: «{d.nombre.strip()}» → «{xd['nombre']}».")
                res["ops"].append({"op": "renombrar", "doctor_id": d.id, "nombre": xd["nombre"]})
            finales.append(ref)
            actuales = {} if nuevo else {so._crit_clave(c): v for c, v in so._celdas_txt(db, d.id).values()}
            for crit, valor in xd["valores"].items():
                f = so._crit_igual(crit, filas)
                antes = "" if nuevo or f is None else _t(actuales.get(so._crit_clave(f.criterio), ""))
                if _t(valor) == antes:
                    continue
                if f is None and not any(o.get("op") == "fila" and o["sheet_id"] == sheet.id and so._crit_clave(o["criterio"]) == so._crit_clave(crit)
                                         for o in res["ops"]):
                    item["acciones"].append(f"Criterio nuevo en la hoja: «{crit}».")
                    res["ops"].append({"op": "fila", "sheet_id": sheet.id, "criterio": crit})
                if not nuevo:
                    item["acciones"].append(f"{xd['nombre']} · {f.criterio if f else crit}: «{antes or 'vacío'}» → «{_t(valor)}».")
                res["ops"].append({"op": "valor", "sheet_id": sheet.id, "ref": ref, "criterio": crit, "valor": valor})
            for crit, archivos in (xd.get("fotos") or {}).items():
                for a in archivos:
                    if not nuevo and _foto_ya_esta(db, d.id, a):
                        continue
                    item["acciones"].append(f"{xd['nombre']} · {crit}: foto del Excel.")
                    res["ops"].append({"op": "foto", "sheet_id": sheet.id, "ref": ref, "criterio": crit, "archivo": a})
        for d in docs:
            if d.id in usados:
                continue
            if _es_vacio(d) and not so._celdas_txt(db, d.id):
                finales.append(d.id)  # espacio vacío: se deja
                continue
            item["acciones"].append(f"Quitar a {d.nombre.strip()} (no está en el Excel para este centro).")
            res["ops"].append({"op": "quitar_doctor", "doctor_id": d.id})
        if [x for x in finales] != [d.id for d in docs]:
            res["ops"].append({"op": "orden", "sheet_id": sheet.id, "centro_id": bloque["centro"].id, "docs": finales})
        # las fotos ya cargadas no se repiten
        if item["acciones"]:
            res["centros"].append(item)
    res["total"] = sum(len(c["acciones"]) for c in res["centros"])
    return res


def _foto_ya_esta(db: Session, doctor_id: int, archivo: str) -> bool:
    import hashlib
    from .models_design import DesignPreApprovedFoto
    with open(os.path.join(FOTOS, archivo), "rb") as f:
        huella = hashlib.sha1(f.read()).hexdigest()
    return db.query(DesignPreApprovedFoto.id).filter(DesignPreApprovedFoto.doctor_id == doctor_id,
                                                     DesignPreApprovedFoto.huella == huella).first() is not None


def vista_previa(db: Session) -> dict:
    r = planear(db)
    r.pop("ops")
    return r


def aplicar(db: Session, por: str) -> dict:
    """Aplica el plan en una sola transacción. Lo reemplazado o quitado queda en la Papelera de Design."""
    plan = planear(db)
    ops, nuevos, cache, viejos = plan["ops"], {}, {}, []
    try:
        for o in ops:  # 1) doctores nuevos (o espacios vacíos reutilizados) y nombres
            if o["op"] == "doctor":
                if o["doctor_id"]:
                    d = db.get(DesignPreApprovedDoctor, o["doctor_id"])
                    d.nombre = o["nombre"]
                else:
                    d = DesignPreApprovedDoctor(sheet_id=o["sheet_id"], nombre=o["nombre"], orden=100000 + len(nuevos))
                    db.add(d)
                    db.flush()
                nuevos[o["ref"]] = d.id
            elif o["op"] == "renombrar":
                db.get(DesignPreApprovedDoctor, o["doctor_id"]).nombre = o["nombre"][:150]
        did = lambda ref: nuevos.get(ref, ref)
        for o in ops:  # 2) valores (los de antes van a la Papelera)
            if o["op"] != "valor":
                continue
            fila = so._fila_de(db, o["sheet_id"], o["criterio"], cache)
            d_id = did(o["ref"])
            c = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.fila_id == fila.id,
                                                        DesignPreApprovedCelda.doctor_id == d_id).first()
            if c and (c.valor or "").strip():
                viejos.append({"fila_id": fila.id, "doctor_id": d_id, "valor": c.valor})
            sd.preapproved_guardar_celda(db, fila.id, d_id, o["valor"], commit=False)
        for o in ops:  # 3) fotos
            if o["op"] == "foto":
                fila = so._fila_de(db, o["sheet_id"], o["criterio"], cache)
                with open(os.path.join(FOTOS, o["archivo"]), "rb") as f:
                    sd.preapproved_agregar_foto(db, fila.id, did(o["ref"]), o["archivo"], "image/png", f.read(), f"{por} (Excel)")
        quitados = {o["doctor_id"] for o in ops if o["op"] == "quitar_doctor"}
        cambios_hoja = {}  # 4) orden de los doctores: cada hoja se rearma de una vez, centro por centro
        for o in ops:
            if o["op"] == "orden":
                cambios_hoja.setdefault(o["sheet_id"], {})[o["centro_id"]] = [did(x) for x in o["docs"]]
        for sid, cambios in cambios_hoja.items():
            bl = so._bloques(db, db.get(sd.DesignPreApprovedSheet, sid))
            en_bloque = {x for l in cambios.values() for x in l}
            seq = []
            for b in bl:
                if b.get("suelto"):
                    continue
                lista = cambios.get(b["centro"].id) or [d.id for d in b["docs"] if d.id not in quitados and d.id not in en_bloque]
                b["centro"].span = max(1, len(lista))
                seq += lista
            seq += [d.id for b in bl if b.get("suelto") for d in b["docs"] if d.id not in quitados and d.id not in en_bloque]
            for k, x in enumerate(seq, start=1):
                db.get(DesignPreApprovedDoctor, x).orden = k
            db.flush()
        for o in ops:  # 5) doctores que ya no están (Papelera)
            if o["op"] != "quitar_doctor":
                continue
            d = db.get(DesignPreApprovedDoctor, o["doctor_id"])
            if not d:
                continue
            celdas = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id).all()
            sd._trash_registrar(db, "pa-doctor", f"Doctor Pre-Approved: {d.nombre} (actualización desde el Excel)",
                                {"sheet_id": d.sheet_id, "nombre": d.nombre, "celdas": [{"fila_id": c.fila_id, "valor": c.valor} for c in celdas]},
                                f"{por} (Excel)")
            for c in celdas:
                db.delete(c)
            db.delete(d)
        for o in ops:  # 6) copias de centros en hojas que Openings no les da (Papelera)
            if o["op"] != "quitar_centro":
                continue
            c = db.get(DesignPreApprovedCentro, o["centro_id"])
            if not c:
                continue
            docs = sd._pac_doctores_del_centro(db, c)
            sd._trash_registrar(db, "pa-centro", f"Centro Pre-Approved: {c.nombre} (actualización desde el Excel)", {
                "sheet_id": c.sheet_id, "nombre": c.nombre, "span": c.span, "doctores": [
                    {"nombre": d.nombre, "celdas": [{"fila_id": x.fila_id, "valor": x.valor} for x in
                                                    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id)]}
                    for d in docs]}, f"{por} (Excel)")
            for d in docs:
                db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id).delete()
                db.delete(d)
            db.delete(c)
        if viejos:
            sd._trash_registrar(db, "pa-valores", f"Valores de Pre-Approved N3 reemplazados por el Excel ({len(viejos)})",
                                {"celdas": viejos}, f"{por} (Excel)")
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == MARCA).first():
            db.add(DesignConexionRegla(tipo="sistema", clave=MARCA, creado_por=por))
        db.commit()
    except Exception:
        db.rollback()
        raise
    despues = vista_previa(db)
    despues["aplicadas"] = plan["total"]
    return despues
