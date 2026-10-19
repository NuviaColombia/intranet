"""Solicitar ayuda (19-oct-2026): un aprobador de N3 pide un diseñador libre a los demás aprobadores de N3.

Flujo:
1. El aprobador elige «🤝 Pedir ayuda…» al final de la lista de Diseñador de una orden de hoy (`solicitar`). Puede tener
   una solicitud abierta por orden.
2. Se buscan los diseñadores LIBRES de los otros equipos de N3 (`libres_n3`). Si no hay ninguno, no sale ninguna
   notificación y se le dice al solicitante que contacte al manager General.
3. Cada aprobador con diseñadores libres recibe una notificación (push fijo + aviso en pantalla) con SUS libres; el
   sistema sugiere al que menos casos lleva en el mes (`ofrecer`).
4. El primero que elige cierra la solicitud (`elegir`): el diseñador queda puesto como Diseñador de esa orden (funciona como
   el diseñador prestado: la orden también le sale en su Schedule) y como ayuda del día en la lista del solicitante («(ayuda)»).
5. `reporte` (Dashboard › Ayudas, solo admins) dice si los aprobadores siguen la sugerencia.

Libre (reglas de Rosember, 19-oct-2026): sin casos, o solo con casos sin iniciar (también Nightguard / TC sin iniciar) o en
Hold, o con una cirugía iniciada que todavía NO tiene tiempos de articulación (esperando al articulador). Ocupado: tiene un
caso iniciado trabajándose, o una cirugía iniciada que ya tiene tiempo en START o RTD de articulación. No cuenta como
libre quien está en break, almuerzo, ausente, inhabilitado, o ya fue elegido como ayuda hoy.
"""
import json
import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from . import services_design as sd
from .models import Empleado
from .models_design import (DesignArea, DesignAyudaOferta, DesignAyudaSolicitud, DesignBreak, DesignOrden, DesignTeam,
                            DesignTeamDesigner)

log = logging.getLogger(__name__)

AREA_N3 = "N3 Prosthetic"
VENCE_MIN = 15
MSG_SIN_DISPONIBLES = "No hay diseñadores disponibles en este momento. Contacta al manager General."
# Estados de un caso que significan "lo está trabajando ahora"
_INICIADOS = {"initiated", "re-initiated"}


def _hoy() -> date:
    return sd.ahora_colombia().date()


def _ahora_col() -> datetime:
    return sd.ahora_colombia().replace(tzinfo=None)


def _equipos_n3(db: Session) -> list[DesignTeam]:
    return (db.query(DesignTeam).join(DesignArea, DesignTeam.area_id == DesignArea.id)
            .options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado), joinedload(DesignTeam.manager))
            .filter(DesignArea.nombre == AREA_N3, DesignTeam.activo == 1, DesignArea.activo == 1).order_by(DesignTeam.orden).all())


def equipo_de_solicitante(db: Session, user: Empleado) -> DesignTeam | None:
    """El equipo de N3 que maneja `user` hoy (como manager o como diseñador a cargo). None si no maneja ninguno."""
    cargo = {tid for tid, eid in sd.delegaciones_activas(db).items() if eid == user.id}
    for t in _equipos_n3(db):
        if t.manager_id == user.id or t.id in cargo:
            return t
    return None


# ---------- Quién está libre ----------

def _en_pausa(b: DesignBreak, minuto: int) -> bool:
    for ini, fin, largo in ((b.almuerzo_inicio, b.almuerzo_fin, sd.SEG_MIN_ALMUERZO), (b.break1_inicio, b.break1_fin, sd.SEG_MIN_BREAK),
                            (b.break2_inicio, b.break2_fin, sd.SEG_MIN_BREAK)):
        i = sd._seg_hora(ini)
        if i is None:
            continue
        f = sd._seg_hora(fin)
        f = f if f is not None and f > i else i + largo
        if i <= minuto < f:
            return True
    return False


def _ocupa(o: DesignOrden) -> bool:
    """¿Esta orden lo mantiene ocupado? Solo lo que está trabajando. Una cirugía de N3 iniciada que todavía no tiene
    tiempos de articulación está esperando al articulador: no lo ocupa."""
    e = (o.estado or "").strip().lower()
    if e not in sd.SEG_TRABAJANDO:
        return False
    esperando_articulador = (e in _INICIADOS and o.tabla == "principal" and o.team is not None and o.team.area is not None
                             and o.team.area.nombre == AREA_N3 and not (o.art_start or "").strip() and not (o.art_rtd or "").strip())
    return not esperando_articulador


def _casos_del_mes(db: Session, ids: list[int], hoy: date) -> dict[int, int]:
    """Órdenes asignadas a cada diseñador en el mes en curso (Cirugías, Nightguards y TC), sin canceladas ni skipped."""
    if not ids:
        return {}
    primero = hoy.replace(day=1)
    fin = (primero + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    cuenta: dict[int, int] = {}
    for did, estado in (db.query(DesignOrden.designer_id, DesignOrden.estado)
                        .filter(DesignOrden.designer_id.in_(ids), DesignOrden.fecha >= primero, DesignOrden.fecha <= fin,
                                DesignOrden.tabla.in_(["principal", "nightguard"])).all()):
        if not sd._es_cancelada(estado):
            cuenta[did] = cuenta.get(did, 0) + 1
    return cuenta


def libres_n3(db: Session, ahora: datetime | None = None, excluir_equipo_id: int | None = None) -> list[dict]:
    """Diseñadores libres de los equipos de N3 (sin contar a los managers). Cada uno: {id, nombre, equipoId, equipo,
    aprobadorId, casos (del mes), libreDesde (min del día; -1 si no ha terminado nada)}. Ordenados para sugerir:
    menos casos en el mes primero; si empatan, el que lleva más tiempo libre."""
    ahora = ahora or sd.ahora_colombia()
    hoy, minuto = ahora.date(), ahora.hour * 60 + ahora.minute
    from . import services_design_accesos as sacc
    inhab = sacc.ids_inhabilitados(db)
    ya_ayudando = {a for (a,) in db.query(DesignAyudaSolicitud.elegido_id)
                   .filter(DesignAyudaSolicitud.fecha == hoy, DesignAyudaSolicitud.estado == "atendida").all() if a}
    candidatos: dict[int, dict] = {}
    for t in _equipos_n3(db):
        if excluir_equipo_id and t.id == excluir_equipo_id:
            continue
        for d in t.designers:
            e = d.empleado
            if (not e or not getattr(e, "activo", 1) or e.id in inhab or e.id in ya_ayudando or e.id == t.manager_id
                    or e.id in candidatos):
                continue
            candidatos[e.id] = {"id": e.id, "nombre": e.nombre_completo, "equipoId": t.id, "equipo": t.nombre, "aprobadorId": t.manager_id}
    if not candidatos:
        return []
    ids = list(candidatos)
    ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area))
               .filter(DesignOrden.fecha == hoy, DesignOrden.designer_id.in_(ids)).all())
    pausas = db.query(DesignBreak).filter(DesignBreak.fecha == hoy, DesignBreak.empleado_id.in_(ids)).all()
    permisos = sd._permisos_aprobados_del_dia(db, ids, hoy)
    por_persona: dict[int, list] = {}
    for o in ordenes:
        por_persona.setdefault(o.designer_id, []).append(o)
    pausas_de: dict[int, list] = {}
    for b in pausas:
        pausas_de.setdefault(b.empleado_id, []).append(b)
    casos = _casos_del_mes(db, ids, hoy)
    libres = []
    for pid, x in candidatos.items():
        mias = por_persona.get(pid, [])
        if any(_ocupa(o) for o in mias):
            continue
        bs = pausas_de.get(pid, [])
        if permisos.get(pid) or any((b.tipo_ausencia or "").strip() for b in bs) or any(_en_pausa(b, minuto) for b in bs):
            continue
        fines = [sd._seg_hora(o.hora_fin) for o in mias
                 if (o.estado or "").strip() and (o.estado or "").strip().lower() not in sd.SEG_POR_HACER | sd.SEG_TRABAJANDO
                 and sd._seg_hora(o.hora_fin) is not None]
        x["libreDesde"] = max(fines) if fines else -1
        x["casos"] = casos.get(pid, 0)
        libres.append(x)
    libres.sort(key=lambda x: (x["casos"], x["libreDesde"], x["nombre"].lower()))
    return libres


# ---------- Solicitar ----------

def _vencer_las_vencidas(db: Session) -> None:
    ahora = datetime.utcnow()
    n = (db.query(DesignAyudaSolicitud).filter(DesignAyudaSolicitud.estado == "abierta", DesignAyudaSolicitud.vence_en < ahora)
         .update({"estado": "vencida"}, synchronize_session=False))
    if n:
        db.commit()


def _avisar(ids: list[int], titulo: str, cuerpo: str, url: str, etiqueta: str, fijo: bool) -> None:
    """Push (a quien tenga notificaciones activadas) y aviso en pantalla (Design abierto)."""
    try:
        from . import services_design_push as spush
        spush.enviar_en_segundo_plano(sorted({i for i in ids if i}), titulo, cuerpo, url=url, etiqueta=etiqueta, fijo=fijo)
    except Exception:  # noqa: BLE001
        log.exception("Solicitar ayuda: no se pudo enviar el push")
    try:
        from . import services_design_vivo as svivo
        svivo.publicar([{"t": "ayuda"}])
    except Exception:  # noqa: BLE001
        log.exception("Solicitar ayuda: no se pudo avisar en vivo")


def _datos_orden(o: DesignOrden | None) -> dict:
    return {"orden": (o.orden or "").strip() if o else "", "producto": (o.producto or "").strip() if o else "",
            "centro": (o.centro or "").strip() if o else "", "paciente": (o.paciente or "").strip() if o else ""}


def puede_pedir_en_orden(db: Session, user: Empleado, team_id: int, fecha: date) -> bool:
    """¿Se muestra «Pedir ayuda» en la lista de Diseñador de este equipo y día? Solo al aprobador de ese equipo de N3, hoy."""
    if fecha != _hoy():
        return False
    t = equipo_de_solicitante(db, user)
    return bool(t and t.id == team_id)


def solicitar(db: Session, user: Empleado, orden_id: int) -> dict:
    """Crea la solicitud de ayuda para una orden de hoy. Devuelve {ok, estado, mensaje, ...}."""
    _vencer_las_vencidas(db)
    team = equipo_de_solicitante(db, user)
    if not team:
        raise PermissionError("Solo un aprobador de un equipo de N3 puede solicitar ayuda.")
    hoy = _hoy()
    o = db.get(DesignOrden, orden_id)
    if not o or o.team_id != team.id:
        raise PermissionError("Solo puedes pedir ayuda para órdenes de tu equipo.")
    if o.tabla not in ("principal", "nightguard"):
        raise ValueError("La ayuda se pide para órdenes de Cirugías o de Nightguards / TC.")
    if o.fecha != hoy:
        raise ValueError("La ayuda solo se pide para órdenes de hoy.")
    if not (o.orden or "").strip() or not (o.centro or "").strip():
        raise ValueError("Completa el número de orden y el centro antes de pedir ayuda.")
    abierta = (db.query(DesignAyudaSolicitud).filter(DesignAyudaSolicitud.orden_id == o.id, DesignAyudaSolicitud.estado == "abierta").first())
    if abierta:
        return {"ok": True, "ya": True, "id": abierta.id, "estado": "abierta",
                "mensaje": "Ya pediste ayuda para esta orden: espera a que un aprobador responda o cancela la solicitud."}
    libres = libres_n3(db, excluir_equipo_id=team.id)
    # los managers a quienes les toca decidir: los de los equipos que tienen libres (menos el propio solicitante)
    por_aprobador: dict[int, list] = {}
    for x in libres:
        if x["aprobadorId"] and x["aprobadorId"] != user.id:
            por_aprobador.setdefault(x["aprobadorId"], []).append(x)
    s = DesignAyudaSolicitud(solicitante_id=user.id, team_id=team.id, area_id=team.area_id, fecha=hoy, orden_id=o.id,
                             vence_en=datetime.utcnow() + timedelta(minutes=VENCE_MIN),
                             n_aprobadores=len(por_aprobador), n_libres=sum(len(v) for v in por_aprobador.values()))
    if not por_aprobador:
        s.estado = "sin_disponibles"
        db.add(s)
        db.commit()
        return {"ok": False, "id": s.id, "estado": "sin_disponibles", "sinDisponibles": True, "mensaje": MSG_SIN_DISPONIBLES}
    db.add(s)
    db.flush()
    for aid, lista in por_aprobador.items():
        lista = sorted(lista, key=lambda x: (x["casos"], x["libreDesde"], x["nombre"].lower()))
        db.add(DesignAyudaOferta(solicitud_id=s.id, aprobador_id=aid, sugerido_id=lista[0]["id"],
                                 libres=json.dumps([{"id": x["id"], "nombre": x["nombre"], "casos": x["casos"], "equipoId": x["equipoId"]} for x in lista],
                                                   ensure_ascii=False)))
    db.commit()
    info = _datos_orden(o)
    detalle = " · ".join(x for x in (f"Orden {info['orden']}", info["producto"], info["centro"]) if x)
    _avisar(list(por_aprobador), f"Pedido de ayuda de {user.nombre_completo}",
            f"{detalle}. Tienes diseñadores libres: elige a quién enviar.", f"/design?ayuda={s.id}", f"ayuda-{s.id}", True)
    return {"ok": True, "id": s.id, "estado": "abierta", "aprobadores": len(por_aprobador),
            "mensaje": f"Solicitud enviada a {len(por_aprobador)} aprobador(es). Te avisamos cuando elijan a alguien."}


def cancelar(db: Session, user: Empleado, solicitud_id: int) -> dict:
    s = db.get(DesignAyudaSolicitud, solicitud_id)
    if not s or s.solicitante_id != user.id or s.estado != "abierta":
        raise LookupError("Esa solicitud ya no está abierta.")
    s.estado = "cancelada"
    ids = [o.aprobador_id for o in db.query(DesignAyudaOferta).filter(DesignAyudaOferta.solicitud_id == s.id)]
    db.commit()
    _avisar(ids, "Pedido de ayuda cancelado", f"{user.nombre_completo} canceló su solicitud.", "/design", f"ayuda-{s.id}", False)
    return {"ok": True}


# ---------- Responder ----------

def _libres_vigentes(db: Session, oferta: DesignAyudaOferta) -> list[dict]:
    """Los diseñadores de la oferta que siguen libres ahora (la situación cambia mientras tanto)."""
    ofrecidos = json.loads(oferta.libres or "[]")
    aun = {x["id"] for x in libres_n3(db)}
    return [x for x in ofrecidos if x["id"] in aun]


def estado(db: Session, user: Empleado) -> dict:
    """Todo lo que la pantalla necesita saber de ayudas para `user`."""
    _vencer_las_vencidas(db)
    hoy = _hoy()
    team = equipo_de_solicitante(db, user)
    out = {"puedeSolicitar": team is not None, "equipo": team.nombre if team else "", "solicitudes": [], "pendientes": [], "ayudaHoy": []}
    if team:
        mias = (db.query(DesignAyudaSolicitud).options(joinedload(DesignAyudaSolicitud.elegido))
                .filter(DesignAyudaSolicitud.solicitante_id == user.id, DesignAyudaSolicitud.fecha == hoy)
                .order_by(DesignAyudaSolicitud.id.desc()).limit(8).all())
        ords = {o.id: o for o in db.query(DesignOrden).filter(DesignOrden.id.in_([s.orden_id for s in mias if s.orden_id] or [0]))}
        for s in mias:
            out["solicitudes"].append({"id": s.id, "estado": s.estado, "creada": s.creada_en.isoformat() + "Z", "vence": s.vence_en.isoformat() + "Z",
                                       "elegido": s.elegido.nombre_completo if s.elegido else "", "asignada": s.asignada,
                                       "mensaje": MSG_SIN_DISPONIBLES if s.estado == "sin_disponibles" else "", **_datos_orden(ords.get(s.orden_id))})
        out["ayudaHoy"] = ayudas_del_equipo(db, team.id, hoy)
    ords_p = {}
    ofertas = (db.query(DesignAyudaOferta, DesignAyudaSolicitud).join(DesignAyudaSolicitud, DesignAyudaSolicitud.id == DesignAyudaOferta.solicitud_id)
               .options(joinedload(DesignAyudaSolicitud.solicitante), joinedload(DesignAyudaSolicitud.team))
               .filter(DesignAyudaOferta.aprobador_id == user.id, DesignAyudaSolicitud.estado == "abierta").all())
    if ofertas:
        ords_p = {o.id: o for o in db.query(DesignOrden).filter(DesignOrden.id.in_([s.orden_id for _, s in ofertas if s.orden_id] or [0]))}
    for of, s in ofertas:
        libres = _libres_vigentes(db, of)
        if not libres:
            continue
        out["pendientes"].append({**_datos_orden(ords_p.get(s.orden_id)), "id": s.id, "solicitante": s.solicitante.nombre_completo if s.solicitante else "",
                                  "equipo": s.team.nombre if s.team else "", "creada": s.creada_en.isoformat() + "Z", "vence": s.vence_en.isoformat() + "Z",
                                  "sugeridoId": libres[0]["id"],   # la lista ya viene ordenada: el primero es el de menos casos en el mes
                                  "libres": [{"id": x["id"], "nombre": x["nombre"], "casos": x["casos"]} for x in libres]})
    return out


def elegir(db: Session, user: Empleado, solicitud_id: int, empleado_id: int) -> dict:
    _vencer_las_vencidas(db)
    s = db.get(DesignAyudaSolicitud, solicitud_id)
    if not s:
        raise LookupError("Esa solicitud no existe.")
    if s.estado != "abierta":
        raise ValueError({"atendida": "Otro aprobador ya envió un diseñador para esta solicitud.", "cancelada": "El solicitante canceló la solicitud.",
                          "vencida": "La solicitud venció sin respuesta."}.get(s.estado, "Esta solicitud ya no está abierta."))
    of = (db.query(DesignAyudaOferta).filter(DesignAyudaOferta.solicitud_id == s.id, DesignAyudaOferta.aprobador_id == user.id).first())
    if not of:
        raise PermissionError("Esta solicitud no te llegó a ti.")
    vigentes = _libres_vigentes(db, of)
    elegido = next((x for x in vigentes if x["id"] == empleado_id), None)
    if not elegido:
        raise ValueError("Ese diseñador ya no está libre. Elige otro de la lista.")
    sugerido = vigentes[0]["id"]   # el sugerido es el de menos casos entre los que siguen libres
    s.estado, s.elegido_id, s.elegido_por_id, s.elegido_team_id = "atendida", empleado_id, user.id, elegido.get("equipoId")
    s.sugerido_id, s.siguio_sugerencia, s.atendida_en = sugerido, empleado_id == sugerido, datetime.utcnow()
    otros = [o.aprobador_id for o in db.query(DesignAyudaOferta).filter(DesignAyudaOferta.solicitud_id == s.id, DesignAyudaOferta.aprobador_id != user.id)]
    solicitante_id, equipo_id = s.solicitante_id, s.team_id
    # Se asigna solo: el diseñador queda como Diseñador de esa orden (si la orden sigue ahí, es de hoy y no se cerró el día).
    orden = db.get(DesignOrden, s.orden_id) if s.orden_id else None
    s.asignada = bool(orden and orden.team_id == equipo_id and orden.fecha == _hoy() and not sd.dia_cerrado(orden.fecha))
    detalle = ""
    if s.asignada:
        orden.designer_id, orden.designer_prestado = empleado_id, ""
        detalle = f" para la orden {(orden.orden or '').strip()}"
    db.commit()
    _avisar([solicitante_id], "Ayuda en camino",
            (f"{elegido['nombre']} fue asignado{detalle}." if s.asignada else f"{elegido['nombre']} fue enviado a tu equipo: asígnalo en tu Schedule de hoy."),
            f"/design?area_id={s.area_id}&team_id={equipo_id}", f"ayuda-{s.id}-resp", True)
    if otros:   # reemplaza (misma etiqueta) el aviso que tenían pendiente
        _avisar(otros, "Pedido de ayuda atendido", f"{user.nombre_completo} ya envió a {elegido['nombre']}.", "/design", f"ayuda-{s.id}", False)
    return {"ok": True, "nombre": elegido["nombre"], "siguioSugerencia": s.siguio_sugerencia, "asignada": bool(s.asignada)}


# ---------- La ayuda en el Schedule del solicitante ----------

def ayudas_del_equipo(db: Session, team_id: int, fecha: date) -> list[dict]:
    """Diseñadores enviados como ayuda a este equipo en `fecha` (solo el mismo día). Salen en la lista de diseñadores."""
    if fecha != _hoy():
        return []
    filas = (db.query(DesignAyudaSolicitud).options(joinedload(DesignAyudaSolicitud.elegido))
             .filter(DesignAyudaSolicitud.team_id == team_id, DesignAyudaSolicitud.fecha == fecha, DesignAyudaSolicitud.estado == "atendida").all())
    return [{"id": s.elegido_id, "nombre": s.elegido.nombre_completo, "esAyuda": True} for s in filas if s.elegido]


# ---------- Reporte (Dashboard › Ayudas) ----------

def reporte(db: Session, desde: date, hasta: date) -> dict:
    _vencer_las_vencidas(db)
    q = (db.query(DesignAyudaSolicitud).options(joinedload(DesignAyudaSolicitud.solicitante), joinedload(DesignAyudaSolicitud.elegido),
                                                joinedload(DesignAyudaSolicitud.elegido_por), joinedload(DesignAyudaSolicitud.team))
         .filter(DesignAyudaSolicitud.fecha >= desde, DesignAyudaSolicitud.fecha <= hasta).order_by(DesignAyudaSolicitud.creada_en.desc()))
    filas, por_aprobador = [], {}
    todas = q.all()
    ords_r = {o.id: o for o in db.query(DesignOrden).filter(DesignOrden.id.in_([s.orden_id for s in todas if s.orden_id] or [0]))}
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_(
        {i for (i,) in db.query(DesignAyudaSolicitud.sugerido_id).filter(DesignAyudaSolicitud.sugerido_id.isnot(None)).distinct()} or {0}))}
    for s in todas:
        col = lambda dt: dt.replace(tzinfo=None) - timedelta(hours=5) if dt else None   # UTC guardado → hora de Colombia
        filas.append({"id": s.id, "fecha": s.fecha.isoformat(), "hora": col(s.creada_en).strftime("%H:%M"),
                      "solicitante": s.solicitante.nombre_completo if s.solicitante else "", "equipo": s.team.nombre if s.team else "",
                      "orden": (ords_r[s.orden_id].orden or "").strip() if s.orden_id in ords_r else "", "producto": (ords_r[s.orden_id].producto or "").strip() if s.orden_id in ords_r else "",
                      "estado": s.estado, "aprobadores": s.n_aprobadores, "libres": s.n_libres,
                      "sugerido": nombres.get(s.sugerido_id, ""), "elegido": s.elegido.nombre_completo if s.elegido else "",
                      "elegidoPor": s.elegido_por.nombre_completo if s.elegido_por else "", "siguio": s.siguio_sugerencia,
                      "respuestaMin": round((s.atendida_en - s.creada_en).total_seconds() / 60, 1) if s.atendida_en else None})
        if s.estado == "atendida" and s.elegido_por:
            a = por_aprobador.setdefault(s.elegido_por_id, {"nombre": s.elegido_por.nombre_completo, "atendidas": 0, "siguio": 0})
            a["atendidas"] += 1
            a["siguio"] += bool(s.siguio_sugerencia)
    atendidas = [f for f in filas if f["estado"] == "atendida"]
    kpis = {"total": len(filas), "atendidas": len(atendidas), "sinDisponibles": sum(1 for f in filas if f["estado"] == "sin_disponibles"),
            "sinRespuesta": sum(1 for f in filas if f["estado"] in ("vencida", "cancelada")),
            "siguieron": sum(1 for f in atendidas if f["siguio"]), "noSiguieron": sum(1 for f in atendidas if f["siguio"] is False),
            "pctSiguieron": round(100 * sum(1 for f in atendidas if f["siguio"]) / len(atendidas)) if atendidas else None}
    resumen = sorted(({**a, "pct": round(100 * a["siguio"] / a["atendidas"])} for a in por_aprobador.values()), key=lambda a: (-a["atendidas"], a["nombre"]))
    return {"kpis": kpis, "porAprobador": resumen, "items": filas}
