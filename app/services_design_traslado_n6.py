"""
Traslado de N6 al formato nuevo (Rosember, 28-oct-2026). Las órdenes de N6 que pasan solas de un día del formato viejo
(hasta el 28-oct-2026) a uno del nuevo (desde el 29: cuatro tablas, un estado por etapa) llegan convertidas:
- Cirugías/Dummy: a Dummy o a Cirugías según el producto, con su estado y sus horas.
- Material Change (un solo estado para la etapa activa, en `etapa`):
  · Dr authorization sin Zirconia design empezada → Bite design en Dr authorization (Órdenes en espera). Si Bite no tenía
    Fin, el Fin es la hora del S.Hold (cuando la pusieron en Dr authorization) y se quita ese Hold abierto; el S.Hold que el
    formato viejo dejaba en Zirconia design se borra (esa etapa nunca empezó).
  · Ya iba en Zirconia design (Hold, Ready...) → Bite design queda Approved; su estado pasa a Zirconia design y el diseñador
    queda también en Zirconia design.
  · En Bite design (Hold, Ready...) → igual, en Bite design.
  · Over Ti-bar → a su tabla.
- Nightguards / TC con un producto de Material Change u Over Ti-bar (243200, 240534): se arma la orden completa con lo que se
  hizo en un día anterior (Bite design y Zirconia design, sin diseñador para que no cuenten otra vez) y lo trabajado en
  Nightguards / TC va a la etapa siguiente: «Zirconia» en Over Ti-bar, «Nightguard design» en Material Change.
- La nota general (columna Notas, que ya no se ve en esas tablas) se copia como nota de la etapa en curso.
Además, una vez, el traslado adelantado del 28 al 29 (pasar_ahora) con copia de seguridad para poder deshacerlo.
"""
import json
import uuid
from datetime import date, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .models_design import DesignArea, DesignOrden, DesignTeam, DesignTeamDesigner
from . import services_design as sd

ORIGEN = date(2026, 10, 28)
DESTINO = sd.N6_SEPARADO_DESDE
MARCA = "traslado_n6_2026_10_28"
_ESTADOS_PASAN = {"hold", "ready to design"}
_HORAS = ("hora_inicio", "s_hold", "f_hold", "hold_minutos", "hora_fin")

_CAMPOS = ["orden", "centro", "producto", "designer_id", "designer_prestado", "estado", "etapa", "qc", "qc_reporte",
           "hora_inicio", "s_hold", "f_hold", "hold_minutos", "hora_fin",
           "z_hora_inicio", "z_s_hold", "z_f_hold", "z_hold_minutos", "z_hora_fin", "z_qc", "z_qc_reporte", "notas"]
_NOMBRE_ETAPA = {"": "Bite design", "z_": "Zirconia design", "x_": "Zirconia", "n_": "Nightguard design"}


def _fila(o) -> dict:
    d = {"id": o.id, "fecha": o.fecha.isoformat(), "equipo": o.team.nombre if o.team else "", "area": o.team.area.nombre if o.team else "",
         "tabla": o.tabla, "disenador": o.designer.nombre_completo if o.designer else ""}
    d.update({c: getattr(o, c) for c in _CAMPOS})
    return d


def _pasaria(o) -> bool:
    """Las mismas reglas que trasladar_holds para el formato viejo."""
    e = sd._normalizar_texto(o.estado or "")
    if e in _ESTADOS_PASAN:
        return True
    if o.tabla == "nightguard" and e == sd._normalizar_texto(sd.ESTADO_BITE_READY):
        return True
    return o.tabla == sd.TABLA_MATERIAL and e in ("dr authorization", "changes")


def _es(producto, tabla: str) -> bool:
    return sd._normalizar_texto(producto or "") in {sd._normalizar_texto(x) for x in sd.PRODUCTOS_N6_TABLA[tabla]}


def _anterior(db: Session, o, antes_de: date):
    """El día anterior más reciente en que esa orden estuvo en Material Change (formato viejo) en N6."""
    return (db.query(DesignOrden).filter(DesignOrden.team_id == o.team_id, DesignOrden.id != o.id, DesignOrden.fecha < antes_de,
                                         func.upper(func.trim(DesignOrden.orden)) == (o.orden or "").strip().upper(),
                                         DesignOrden.tabla == sd.TABLA_MATERIAL)
            .order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).first())


def convertir(db: Session, o, antes_de: date | None = None) -> tuple[dict, list, list[str]]:
    """Cómo pasa la orden `o` (formato viejo) al formato nuevo: (columnas que cambian, notas de etapa [(prefijo, texto)],
    explicación). No cambia nada; `aplicar` lo hace. `antes_de` = el día de donde sale (para buscar su historial)."""
    antes_de = antes_de or o.fecha
    c, notas, txt = {}, [], []
    e = sd._normalizar_texto(o.estado or "")
    nota = (o.notas or "").strip()
    if o.tabla == "principal":
        c["tabla"] = sd.n6_tabla_de_producto("principal", o.producto)
        txt.append(f"Pasa a {'Dummy' if c['tabla'] == sd.TABLA_DUMMY else 'Cirugías'} con su estado ({o.estado}) y sus horas.")
        return c, notas, txt
    if o.tabla == sd.TABLA_MATERIAL:
        tibar = _es(o.producto, sd.TABLA_TIBAR)
        c["tabla"] = sd.TABLA_TIBAR if tibar else sd.TABLA_MATERIAL
        txt.append(f"Pasa a {'Over Ti-bar' if tibar else 'Material Change'}.")
        z_empezo = bool((o.z_hora_inicio or "").strip())
        etapa_nota = ""
        if e == "dr authorization" and not z_empezo:
            c["estado"] = sd.ESTADO_DR_AUT
            if not (o.hora_fin or "").strip() and (o.s_hold or "").strip() and not (o.f_hold or "").strip():
                c["hora_fin"], c["s_hold"] = o.s_hold, ""
                txt.append(f"Bite design: Fin = {o.s_hold} (cuando la pusieron en Dr authorization) y se quita ese Hold abierto.")
            if (o.z_s_hold or "").strip() or (o.z_f_hold or "").strip():
                c.update({"z_s_hold": "", "z_f_hold": "", "z_hold_minutos": 0})
                txt.append("Se borra el S.Hold que el formato viejo dejó en Zirconia design (nunca empezó).")
            txt.append("Bite design en Dr authorization → Órdenes en espera." + ("" if o.qc else " OJO: no tiene QC, no entra a espera."))
        elif sd.es_etapa_zirconia(o.etapa):
            c.update({"estado": "Approved", "z_estado": o.estado or "", "z_designer_id": o.designer_id})
            etapa_nota = "z_"
            txt.append(f"Ya iba en Zirconia design: Bite design queda Approved; Zirconia design queda en {o.estado} con el mismo diseñador.")
        else:
            txt.append(f"Bite design queda en {o.estado}, con sus horas.")
        if nota:
            notas.append((etapa_nota, nota))
            txt.append(f"La nota «{nota}» pasa a las notas de {_NOMBRE_ETAPA[etapa_nota]}.")
        return c, notas, txt
    if o.tabla == "nightguard" and (_es(o.producto, sd.TABLA_TIBAR) or _es(o.producto, sd.TABLA_MATERIAL) or _es(o.producto, "principal")):
        tibar = _es(o.producto, sd.TABLA_TIBAR)
        prev = _anterior(db, o, antes_de)
        if prev is None:
            txt.append("Producto de Material Change / Over Ti-bar en Nightguards / TC, pero no tiene días anteriores: se queda igual.")
            return {}, [], txt
        sig = "x_" if tibar else "n_"
        c["tabla"] = sd.TABLA_TIBAR if tibar else sd.TABLA_MATERIAL
        # lo trabajado en Nightguards / TC es la etapa siguiente, con su diseñador
        c.update({sig + k: getattr(o, k) for k in _HORAS})
        c.update({sig + "estado": o.estado or "", sig + "designer_id": o.designer_id, sig + "qc": bool(o.qc), sig + "qc_reporte": o.qc_reporte or ""})
        # Bite design y Zirconia design: copiados del día anterior, sin diseñador (ya se contaron ese día)
        c.update({k: getattr(prev, k) for k in _HORAS + ("qc", "qc_reporte")})
        c.update({"z_" + k: getattr(prev, "z_" + k) for k in _HORAS + ("qc", "qc_reporte")})
        zir = sd.es_etapa_zirconia(prev.etapa)
        c.update({"estado": "Approved" if zir or (prev.hora_fin or "").strip() else (prev.estado or ""),
                  "z_estado": (prev.estado or "") if zir else "", "designer_id": None, "z_designer_id": None, "designer_prestado": ""})
        dia = prev.fecha.strftime("%d/%m/%Y")
        notas.append(("", f"Hecha el {dia} (se copió al pasar al formato nuevo; ya se contó ese día)."))
        if zir:
            notas.append(("z_", f"Hecha el {dia} (se copió al pasar al formato nuevo; ya se contó ese día)."))
        if nota:
            notas.append((sig, nota))
        txt.append(f"Pasa a {'Over Ti-bar' if tibar else 'Material Change'} completa: Bite design" + (" y Zirconia design" if zir else "") +
                   f" copiadas del {dia} (sin diseñador, para no contarlas otra vez); lo trabajado en Nightguards / TC va a "
                   f"{_NOMBRE_ETAPA[sig]} en {o.estado}" + (f" y la nota «{nota}» a sus notas." if nota else "."))
        return c, notas, txt
    txt.append(f"Se queda en Nightguards / TC ({o.estado}).")
    return {}, [], txt


def aplicar(o, cambios: dict, notas: list) -> None:
    for k, v in cambios.items():
        setattr(o, k, v)
    if notas:
        try:
            d = json.loads(o.notas_etapas or "{}") or {}
        except ValueError:
            d = {}
        ahora = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        for pref, texto in notas:
            clave = {"": "b", "z_": "z", "x_": "x", "n_": "n"}[pref]
            d.setdefault(clave, []).append({"id": uuid.uuid4().hex[:10], "t": texto, "f": ahora, "u": None})
        o.notas_etapas = json.dumps(d, ensure_ascii=False)


def _candidatas(db: Session) -> list:
    n6 = db.query(DesignArea).filter(DesignArea.nombre == sd.AREA_N6).first()
    equipos = [t.id for t in db.query(DesignTeam).filter(DesignTeam.area_id == n6.id)] if n6 else []
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
             .filter(DesignOrden.team_id.in_(equipos or [-1]), DesignOrden.fecha == ORIGEN)
             .order_by(DesignOrden.team_id, DesignOrden.tabla, DesignOrden.orden_visual, DesignOrden.id).all())
    return [o for o in filas if _pasaria(o)]


def revisar(db: Session, orden: str = "") -> dict:
    """Solo lectura: las órdenes de N6 del 28 que pasarían al 29, cómo quedarían, y el historial de `orden` (todos los días)."""
    pasan = []
    for o in _candidatas(db):
        cambios, notas, txt = convertir(db, o)
        pasan.append({**_fila(o), "propuesta": txt, "cambios": cambios, "notasNuevas": [[_NOMBRE_ETAPA[p], t] for p, t in notas]})
    from .models_design import DesignConexionRegla
    ya = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "respaldo", DesignConexionRegla.clave == MARCA).first()
    n6 = db.query(DesignArea).filter(DesignArea.nombre == sd.AREA_N6).first()
    equipos = [t.id for t in db.query(DesignTeam).filter(DesignTeam.area_id == n6.id)] if n6 else []
    en_destino = db.query(func.count(DesignOrden.id)).filter(DesignOrden.team_id.in_(equipos or [-1]), DesignOrden.fecha == DESTINO).scalar()
    out = {"origen": ORIGEN.isoformat(), "destino": DESTINO.isoformat(), "total": len(pasan), "yaSeHizo": bool(ya),
           "yaEnDestino": en_destino, "ordenes": pasan}
    if orden.strip():
        hist = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
                .filter(func.upper(func.trim(DesignOrden.orden)) == orden.strip().upper())
                .order_by(DesignOrden.fecha, DesignOrden.id).all())
        out["historial"] = {"orden": orden.strip().upper(), "filas": [_fila(o) for o in hist]}
    return out


def _foto(o) -> dict:
    """Todas las columnas de la orden, para la copia de seguridad."""
    return {c.name: (v.isoformat() if isinstance(v, (date, datetime)) else v)
            for c in DesignOrden.__table__.columns for v in [getattr(o, c.key)]}


def pasar_ahora(db: Session, user) -> dict:
    """Una sola vez: pasa ya al 29 las órdenes de N6 del 28 que pasarían solas a las 5:00 a. m., convertidas. Guarda antes una
    copia de seguridad de cada una (design_conexion_reglas, tipo «respaldo»), para poder deshacerlo con deshacer()."""
    from .models_design import DesignConexionRegla
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "respaldo", DesignConexionRegla.clave == MARCA).first():
        raise ValueError("El traslado adelantado ya se hizo.")
    ordenes = _candidatas(db)
    respaldo = [_foto(o) for o in ordenes]
    miembros: dict = {}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id):
        miembros.setdefault(tid, set()).add(eid)
    hecho = []
    for o in ordenes:
        cambios, notas, txt = convertir(db, o, ORIGEN)
        aplicar(o, cambios, notas)
        # como trasladar_holds: el prestado vale solo para su día
        propios = miembros.get(o.team_id, set()) | ({o.team.manager_id} if o.team.manager_id else set())
        if (o.designer_id and o.designer_id not in propios) or (o.designer_prestado or "").strip():
            o.designer_id, o.designer_prestado = None, ""
        maxv = (db.query(func.max(DesignOrden.orden_visual))
                .filter(DesignOrden.team_id == o.team_id, DesignOrden.fecha == DESTINO, DesignOrden.tabla == o.tabla).scalar())
        o.fecha, o.orden_visual = DESTINO, (maxv or 0) + 1
        db.flush()
        hecho.append({"id": o.id, "orden": o.orden, "tabla": o.tabla, "cambios": txt})
    db.add(DesignConexionRegla(tipo="respaldo", clave=MARCA, creado_por=getattr(user, "nombre_completo", "Sistema"),
                               valor=json.dumps({"ordenes": respaldo}, ensure_ascii=False, default=str)))
    db.commit()
    sd.alinear_copias_rd(db)
    return {"movidas": len(hecho), "ordenes": hecho}


def deshacer(db: Session) -> dict:
    """Devuelve las órdenes del traslado adelantado exactamente como estaban (copia de seguridad)."""
    from .models_design import DesignConexionRegla
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "respaldo", DesignConexionRegla.clave == MARCA).first()
    if not r:
        raise ValueError("No hay un traslado adelantado que deshacer.")
    cols = {c.name: c for c in DesignOrden.__table__.columns}
    n = 0
    for f in json.loads(r.valor or "{}").get("ordenes", []):
        o = db.get(DesignOrden, f["id"])
        if not o:
            continue
        for k, v in f.items():
            if k == "id" or k not in cols:
                continue
            try:
                tipo = cols[k].type.python_type
            except NotImplementedError:
                tipo = None
            if v is not None and tipo is date:
                v = date.fromisoformat(v)
            elif v is not None and tipo is datetime:
                v = datetime.fromisoformat(v)
            setattr(o, cols[k].key, v)
        n += 1
    db.delete(r)
    db.commit()
    return {"devueltas": n}
