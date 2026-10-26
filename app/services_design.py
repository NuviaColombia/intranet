"""Lógica de negocio del módulo Design Schedule."""
import json
import logging
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from sqlalchemy.orm import Session, joinedload, defer, aliased
from sqlalchemy import func, and_, or_, event
from .models import EMPRESA_DESIGN, Empleado, Solicitud, TipoPermiso
from .models_design import FORMATO_N2, FORMATO_SUPPORT, FORMATO_SINGLE, FORMATO_DUAL
from .models_design import (DesignFotoPerfil, DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo,
                            DesignAusenciaTipo, DesignOrden, DesignBreak, DesignComentarioHistorial,
                            DesignFaq, DesignPreApprovedSheet, DesignPreApprovedCentro,
                            DesignPreApprovedDoctor, DesignPreApprovedFila, DesignPreApprovedCelda, DesignPreApprovedFoto,
                            DesignPerfCriterio, DesignPerfSheet, DesignPerfEmpleado, DesignPerfCelda,
                            DesignPerfGanador, DesignPerfSeleccionFila, DesignPerfSeleccionCelda,
                            DesignTrash, DesignFavorito, DesignCanvasDoc,
                            DesignComentarioTemplate, DesignFaqHoja)

CAMPOS_ORDEN = [
    "orden", "paciente", "centro", "producto", "designer_id", "designer_prestado",
    "hora_inicio", "hora_inicio_diseno", "hora_fin", "hold_minutos",
    "esferas", "critico", "arco", "s_hold", "f_hold",
    "etapa", "solicitado_por", "situacion", "solucion", "clasificacion", "soporte",
    "estado", "qc", "qc_reporte", "notas",
    "z_hora_inicio", "z_s_hold", "z_f_hold", "z_hold_minutos", "z_hora_fin", "z_qc", "z_qc_reporte",
    "art_start", "art_rtd",
]

log = logging.getLogger(__name__)



# Orden de presentación de las áreas en toda la UI de Design Schedule. Se aplica en código
# (no en la columna `orden` de la BD); áreas que no estén aquí van al final por su `orden`.
ORDEN_AREAS_UI = ["Face Design", "N2 Demodenture", "N3 Prosthetic", "N6 Material Changes", "Removable Denture", "Training", "Support"]
# Removable Denture (Rosember, 20-oct-2026): un solo equipo («Schedule Removable Denture», diseñador Nestor Rojas). Toda
# orden de N3 / N6 cuyo producto dice «Removable» tiene una COPIA ahí (la removable la diseña Nestor; la original la
# trabaja su equipo). Ver rd_una_vez, sincronizar_copia_rd y DesignCopiaRD. En Nightguards / TC también se le puede
# asignar a Nestor un caso como prestado (le aparece en «Prestadas a otros equipos").
AREA_RD = "Removable Denture"
EQUIPO_RD = "Schedule Removable Denture"
ETAPA_DENTURE = "Denture design"
AREA_TRAINING = "Training"   # Schedule de entrenamiento (13-oct-2026): igual al de N3; los casos llegan desde N3 y todos lo ven


def es_training(team) -> bool:
    return bool(team is not None and team.area is not None and team.area.nombre == AREA_TRAINING)


def ordenar_areas(areas: list[DesignArea]) -> list[DesignArea]:
    def clave(a: DesignArea):
        pos = ORDEN_AREAS_UI.index(a.nombre) if a.nombre in ORDEN_AREAS_UI else len(ORDEN_AREAS_UI)
        return (pos, a.orden or 0)
    return sorted(areas, key=clave)


def memo_sesion(db: Session, clave, calcular):
    """Lo mismo consultado varias veces en UNA petición (la sesión de la base dura lo que dura la petición) se pide una
    sola vez. Se olvida apenas la sesión guarda algo (ver _olvidar_memo), así nunca se usa un dato viejo.
    Simulación de 150 personas (19-oct-2026): abrir el Schedule repetía mis_equipos 3 veces (24 consultas -> 14); con la
    demora de red hacia la base cada consulta cuenta."""
    m = db.info.setdefault("ds_memo", {})
    if clave not in m:
        m[clave] = calcular()
    return m[clave]


@event.listens_for(Session, "after_flush")
def _olvidar_memo(session, _contexto):
    session.info.pop("ds_memo", None)


def areas_disponibles(db: Session) -> list[DesignArea]:
    rd_una_vez(db)
    return list(memo_sesion(db, "areas", lambda: ordenar_areas(db.query(DesignArea).filter(DesignArea.activo == 1).all())))


_rd = {"ok": False}


def rd_una_vez(db: Session) -> None:
    """Crea (una vez) el área Removable Denture con los catálogos de N3 y su equipo; agrega a Nestor Rojas cuando existe."""
    if _rd["ok"]:
        return
    try:
        area = db.query(DesignArea).filter(DesignArea.nombre == AREA_RD).first()
        if not area:
            n3 = db.query(DesignArea).filter(DesignArea.nombre == AREA_N3).first()
            if not n3:
                return
            n6 = db.query(DesignArea).filter(DesignArea.nombre == AREA_N6).first()
            area = DesignArea(nombre=AREA_RD, formato=FORMATO_DUAL, orden=((n6 or n3).orden or 0) + 1, activo=1)
            db.add(area)
            db.flush()
            for c in db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n3.id).all():
                db.add(DesignCatalogo(area_id=area.id, tipo=c.tipo, valor=c.valor, orden=c.orden, activo=c.activo))
        team = db.query(DesignTeam).filter(DesignTeam.area_id == area.id, DesignTeam.nombre == EQUIPO_RD).first()
        if not team:
            team = DesignTeam(area_id=area.id, nombre=EQUIPO_RD, manager_id=None, orden=1, activo=1)
            db.add(team)
            db.flush()
        if not db.query(DesignTeamDesigner.id).filter(DesignTeamDesigner.team_id == team.id).first():
            nestor = (db.query(Empleado).filter(Empleado.activo == 1, Empleado.empresa == EMPRESA_DESIGN,
                                                func.lower(Empleado.nombres).like("nestor%"), func.lower(Empleado.apellidos).like("rojas%"))
                      .first())
            if not nestor:   # con tilde
                nestor = (db.query(Empleado).filter(Empleado.activo == 1, func.lower(Empleado.nombres).like("néstor%"),
                                                    func.lower(Empleado.apellidos).like("rojas%")).first())
            if nestor:
                db.add(DesignTeamDesigner(team_id=team.id, empleado_id=nestor.id))
            else:
                db.commit()
                return   # se vuelve a intentar en la próxima petición (cuando exista en People)
        db.commit()
        _rd["ok"] = True
    except Exception:  # noqa: BLE001  nunca debe tumbar la página
        db.rollback()


def ids_rd(db: Session) -> set[int]:
    """Diseñadores del Schedule Removable Denture."""
    return set(memo_sesion(db, "ids_rd", lambda: {i for (i,) in (
        db.query(DesignTeamDesigner.empleado_id).join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
        .join(DesignArea, DesignArea.id == DesignTeam.area_id).filter(DesignArea.nombre == AREA_RD, DesignTeam.activo == 1))}))


ESTADO_ORDER_ENTERED = "Order Entered"
_HORAS_BITE = ("hora_inicio", "s_hold", "f_hold", "hora_fin", "hold_minutos")


def _bite_desde_original(c: DesignOrden, o: DesignOrden) -> None:
    """Removable Denture: el START de Bite design (y sus Hold) son los de la orden original de N3 / N6. El FINISH ya no
    sale del Fin de la original (ese es el Fin de todo el caso): lo pone «Bite Finish» en la lista de estados de N3
    (bite_finish_rd; Rosember, 21-oct-2026). Cuando el Bite ya terminó, la original deja de cambiar estas horas."""
    if (c.hora_fin or "").strip() or _normalizar_texto(c.etapa or "") == _normalizar_texto(ETAPA_DENTURE):
        return
    for k in ("hora_inicio", "s_hold", "f_hold", "hold_minutos"):
        setattr(c, k, getattr(o, k) or (0 if k == "hold_minutos" else ""))
    if _normalizar_texto(c.estado or "") in ("", _normalizar_texto(ESTADO_READY)) and not (c.z_hora_inicio or "").strip():
        c.etapa, c.estado = ETAPA_BITE, ESTADO_ORDER_ENTERED


BITE_FINISH = "Bite Finish"


def copia_rd_de(db: Session, origen_id: int) -> DesignOrden | None:
    from .models_design import DesignCopiaRD
    r = db.query(DesignCopiaRD).filter(DesignCopiaRD.origen_orden_id == origen_id).first()
    return db.get(DesignOrden, r.rd_orden_id) if r else None


def estado_bite_rd(db: Session, origen_ids: list[int]) -> dict[int, str]:
    """{orden de N3 / N6: 'pendiente' | 'hecho'} para las que tienen copia en Removable Denture (la opción «Bite Finish»)."""
    from .models_design import DesignCopiaRD
    if not origen_ids:
        return {}
    regs = db.query(DesignCopiaRD).filter(DesignCopiaRD.origen_orden_id.in_(origen_ids)).all()
    copias = {c.id: c for c in db.query(DesignOrden).filter(DesignOrden.id.in_([r.rd_orden_id for r in regs] or [-1]))}
    out = {}
    for r in regs:
        c = copias.get(r.rd_orden_id)
        if c is not None:
            hecho = (c.hora_fin or "").strip() or _normalizar_texto(c.etapa or "") == _normalizar_texto(ETAPA_DENTURE)
            out[r.origen_orden_id] = "hecho" if hecho else "pendiente"
    return out


def bite_finish_rd(db: Session, o: DesignOrden, user: Empleado) -> dict:
    """«Bite Finish» en la orden de N3 / N6 (Rosember, 21-oct-2026): la orden original no cambia de estado; en su copia de
    Removable Denture se pone el FINISH de Bite design (ahora), pasa a Denture design · Ready to design y se avisa a Nestor."""
    c = copia_rd_de(db, o.id)
    if c is None:
        raise ValueError("Esta orden no tiene copia en Removable Denture (su producto no dice «Removable»).")
    if (c.hora_fin or "").strip() or _normalizar_texto(c.etapa or "") == _normalizar_texto(ETAPA_DENTURE):
        raise ValueError(f"El Bite design de esta orden ya estaba terminado ({(c.hora_fin or '').strip() or 'Denture design'}).")
    if not (o.hora_inicio or "").strip():
        raise ValueError("Primero inicia la orden (Initiated): el START de Bite design sale de ahí.")
    ahora = ahora_colombia().strftime("%H:%M")
    for k in ("hora_inicio", "s_hold", "f_hold", "hold_minutos"):
        setattr(c, k, getattr(o, k) or (0 if k == "hold_minutos" else ""))
    if (c.s_hold or "").strip() and not (c.f_hold or "").strip():
        c.f_hold = ahora   # estaba en Hold: el Hold termina con el Bite
    c.hora_fin, c.etapa, c.estado = ahora, ETAPA_DENTURE, ESTADO_READY
    db.commit()
    _push_bite_finish(db, c, user)
    return {"finish": ahora, "copiaId": c.id}


def _push_bite_finish(db: Session, c: DesignOrden, user: Empleado) -> None:
    try:
        from . import services_design_push as spush
        if not c.designer_id:
            return
        team_rd = db.get(DesignTeam, c.team_id)
        cuerpo = " · ".join(x for x in ((c.orden or "").strip(), (c.centro or "").strip(), (c.producto or "").strip()) if x)
        spush.enviar_en_segundo_plano([c.designer_id], "🦷 Bite design terminado",
                                      f"{cuerpo}\nYa puedes empezar el Denture design (marcó el Bite Finish {user.nombre_completo}).",
                                      url=f"/design?area_id={team_rd.area_id}&team_id={team_rd.id}" if team_rd else "/design",
                                      etiqueta=f"rd-bite-{c.id}")
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("design.rd").exception("Removable Denture: no se pudo avisar el Bite Finish")


def es_producto_rd(producto: str | None) -> bool:
    return "removable" in (producto or "").lower()


def _equipo_rd(db: Session) -> DesignTeam | None:
    return (db.query(DesignTeam).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter(DesignArea.nombre == AREA_RD, DesignTeam.activo == 1).order_by(DesignTeam.orden, DesignTeam.id).first())


def sincronizar_copia_rd(db: Session, o: DesignOrden | None, borrada: bool = False, origen_id: int | None = None,
                         avisar: bool = True) -> None:
    """Después de crear, editar o borrar una orden de N3 / N6: crea, actualiza o quita su copia en Removable Denture.
    - Producto con «Removable» y sin copia → copia ese mismo día, de Nestor, en Bite design · Order Entered.
    - Con copia → orden, paciente, centro, producto y horas de Bite design iguales a los de la original
      (_bite_desde_original: al poner el Fin en la original, la copia pasa a Denture design · Ready to design).
    - Si ya no dice «Removable» o la borraron → la copia se borra si Nestor no la ha empezado (sigue en Ready to design y
      sin horas); si ya la empezó, se queda."""
    from .models_design import DesignCopiaRD
    oid = origen_id or (o.id if o else None)
    if not oid:
        return
    try:
        if o is not None and not borrada:
            t = o.team or db.get(DesignTeam, o.team_id)
            if not t or not t.area or t.area.nombre not in (AREA_N3, AREA_N6):
                return
        regs = db.query(DesignCopiaRD).filter(DesignCopiaRD.origen_orden_id == oid).all()
        quiere = (o is not None and not borrada and es_producto_rd(o.producto))
        if quiere and not regs:
            team_rd = _equipo_rd(db)
            designer = (db.query(DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id == team_rd.id)
                        .order_by(DesignTeamDesigner.orden, DesignTeamDesigner.id).first()) if team_rd else None
            if not team_rd:
                return
            sig = (db.query(func.max(DesignOrden.orden_visual)).filter(DesignOrden.team_id == team_rd.id, DesignOrden.fecha == o.fecha,
                                                                        DesignOrden.tabla == TABLA_MATERIAL).scalar() or 0) + 1
            c = DesignOrden(team_id=team_rd.id, fecha=o.fecha, fecha_creada=o.fecha, tabla=TABLA_MATERIAL, orden_visual=sig,
                            orden=(o.orden or "").strip().upper(), paciente=o.paciente or "", centro=o.centro or "",
                            producto=o.producto or "", designer_id=designer[0] if designer else None, estado=ESTADO_ORDER_ENTERED,
                            etapa=ETAPA_BITE, origen_equipo=t.nombre, creado_por_id=o.creado_por_id)
            _bite_desde_original(c, o)
            db.add(c)
            db.flush()
            db.add(DesignCopiaRD(rd_orden_id=c.id, origen_orden_id=o.id, origen_team_id=o.team_id))
            db.commit()
            if avisar and c.designer_id:
                _push_copia_rd(c, t, team_rd)
            return
        for r in regs:
            c = db.get(DesignOrden, r.rd_orden_id)
            if c is None:   # la borraron en Removable Denture: el vínculo queda para no volver a crearla
                if not quiere:
                    db.delete(r)
                continue
            if quiere:
                c.fecha = o.fecha   # siempre el mismo día que la original
                c.orden, c.paciente = (o.orden or "").strip().upper(), o.paciente or ""
                c.centro, c.producto = o.centro or "", o.producto or ""
                _bite_desde_original(c, o)
                r.origen_team_id = o.team_id
            else:
                sin_empezar = (_normalizar_texto(c.estado or "") in ("", _normalizar_texto(ESTADO_READY), _normalizar_texto(ESTADO_ORDER_ENTERED))
                               and not (c.z_hora_inicio or "").strip())
                if sin_empezar:
                    db.delete(c)
                    db.delete(r)
        db.commit()
    except Exception:  # noqa: BLE001  la orden original ya quedó guardada; la copia nunca debe hacerla fallar
        db.rollback()
        import logging
        logging.getLogger("design.rd").exception("Removable Denture: no se pudo sincronizar la copia de la orden %s", oid)


def alinear_copias_rd(db: Session) -> int:
    """Pone cada copia de Removable Denture en el mismo día que su orden original (20-oct-2026: el paso de Ready / Hold al
    día siguiente movía la copia, que sigue en Ready to design, aunque la original no se moviera)."""
    from .models_design import DesignCopiaRD
    Orig = aliased(DesignOrden)
    filas = (db.query(DesignOrden, Orig.fecha).join(DesignCopiaRD, DesignCopiaRD.rd_orden_id == DesignOrden.id)
             .join(Orig, Orig.id == DesignCopiaRD.origen_orden_id).filter(DesignOrden.fecha != Orig.fecha).all())
    for c, fecha in filas:
        sig = (db.query(func.max(DesignOrden.orden_visual)).filter(DesignOrden.team_id == c.team_id, DesignOrden.fecha == fecha,
                                                                    DesignOrden.tabla == c.tabla).scalar() or 0) + 1
        c.fecha, c.orden_visual = fecha, sig
        db.flush()
    if filas:
        db.commit()
    return len(filas)


def _push_copia_rd(c: DesignOrden, origen: DesignTeam, team_rd: DesignTeam) -> None:
    """Aviso push al diseñador de Removable Denture (Nestor) cuando le llega un caso nuevo (Rosember, 21-oct-2026)."""
    try:
        from . import services_design_push as spush
        cuerpo = " · ".join(x for x in ((c.orden or "").strip(), (c.centro or "").strip(), (c.producto or "").strip()) if x)
        spush.enviar_en_segundo_plano([c.designer_id], "🦷 Nuevo caso de Removable Denture",
                                      f"{cuerpo}\nViene de {origen.nombre}. Queda en Order Entered hasta que terminen el Bite design.",
                                      url=f"/design?area_id={team_rd.area_id}&team_id={team_rd.id}", etiqueta=f"rd-copia-{c.id}")
    except Exception:  # noqa: BLE001  la copia ya quedó; el aviso nunca debe hacerla fallar
        import logging
        logging.getLogger("design.rd").exception("Removable Denture: no se pudo enviar el aviso push")


def push_rd_aprobada(db: Session, c: DesignOrden, user: Empleado) -> None:
    """Nestor aprueba la removable (la copia): aviso push al manager del equipo de N3 / N6 de donde viene la orden
    (Rosember, 21-oct-2026) y al diseñador de esa orden (26-oct-2026). Si falla, la aprobación ya quedó."""
    try:
        from .models_design import DesignCopiaRD
        from . import services_design_push as spush
        r = db.get(DesignCopiaRD, c.id)
        origen = db.get(DesignTeam, r.origen_team_id) if r else None
        if not origen:
            return
        original = db.get(DesignOrden, r.origen_orden_id)
        ids = {origen.manager_id, original.designer_id if original else None} - {None, user.id}
        if not ids:
            return
        cuerpo = " · ".join(x for x in ((c.orden or "").strip(), (c.centro or "").strip(), (c.producto or "").strip()) if x)
        spush.enviar_en_segundo_plano(sorted(ids), "✅ Removable Denture aprobada",
                                      f"{cuerpo}\n{user.nombre_completo} aprobó el Denture design.",
                                      url=f"/design?area_id={origen.area_id}&team_id={origen.id}", etiqueta=f"rd-aprobada-{c.id}")
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("design.rd").exception("Removable Denture: no se pudo avisar la aprobación")


_rd_copias = {"ok": False}


def rd_copias_una_vez(db: Session) -> None:
    """Al cambiar al modelo de copias: las órdenes de hoy en adelante con «Removable» en el producto reciben su copia."""
    if _rd_copias["ok"]:
        return
    _rd_copias["ok"] = True
    try:
        alinear_copias_rd(db)
        hoy = ahora_colombia().date()
        ordenes = (db.query(DesignOrden).join(DesignTeam, DesignTeam.id == DesignOrden.team_id)
                   .join(DesignArea, DesignArea.id == DesignTeam.area_id)
                   .filter(DesignArea.nombre.in_([AREA_N3, AREA_N6]), DesignOrden.fecha >= hoy,
                           func.lower(DesignOrden.producto).like("%removable%")).all())
        for o in ordenes:
            sincronizar_copia_rd(db, o, avisar=False)   # órdenes de antes: sin aviso push (serían muchos a la vez)
    except Exception:  # noqa: BLE001
        db.rollback()


def copias_rd_info(db: Session, ids: list[int]) -> dict:
    """{id de la copia: (equipo de origen, manager de origen, id del equipo)} para la tabla de Removable Denture."""
    from .models_design import DesignCopiaRD
    if not ids:
        return {}
    regs = db.query(DesignCopiaRD).filter(DesignCopiaRD.rd_orden_id.in_(ids)).all()
    teams = {t.id: t for t in db.query(DesignTeam).options(joinedload(DesignTeam.manager))
             .filter(DesignTeam.id.in_([r.origen_team_id for r in regs] or [-1]))}
    out = {}
    for r in regs:
        t = teams.get(r.origen_team_id)
        out[r.rd_orden_id] = (t.nombre if t else "", nombre_corto(t.manager) if t and t.manager else "", r.origen_team_id)
    return out


def rd_horas_por_estado(actual: dict, estado_nuevo: str) -> dict:
    """Removable Denture: como Material Change, por etapa. Bite design usa las horas de siempre; Denture design, las z_.
    Aprobar Bite llena su Fin y deja la orden en Denture design, Ready to design."""
    p = "z_" if _normalizar_texto(actual.get("etapa") or "") == _normalizar_texto(ETAPA_DENTURE) else ""
    base = {k: actual.get(p + k) for k in ("hora_inicio", "s_hold", "f_hold", "hora_fin", "hold_minutos")}
    cambios = {p + k: v for k, v in face_horas_por_estado(base, estado_nuevo).items()}
    if not p and _normalizar_texto(actual.get("etapa") or "") != _normalizar_texto(ETAPA_BITE):
        cambios["etapa"] = ETAPA_BITE
    if not p and estado_nuevo == "Approved":
        cambios.update({"etapa": ETAPA_DENTURE, "estado": ESTADO_READY})
    return cambios


def equipos_de_area(db: Session, area_id: int) -> list[DesignTeam]:
    return (db.query(DesignTeam).options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado),
                                        joinedload(DesignTeam.manager))
            .filter(DesignTeam.area_id == area_id, DesignTeam.activo == 1)
            .order_by(DesignTeam.orden).all())


def nombre_corto(e) -> str:
    """Primer nombre y primer apellido («Ana María Restrepo Gómez» → «Ana Restrepo»): la columna Diseñador del Schedule
    (Rosember, 19-oct-2026). Si no hay apellidos separados, el nombre completo."""
    if not e:
        return ""
    n, a = (getattr(e, "nombres", "") or "").split(), (getattr(e, "apellidos", "") or "").split()
    return " ".join(x for x in (n[0] if n else "", a[0] if a else "") if x) or (getattr(e, "nombre_completo", "") or "")


def es_admin(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def equipos_como_designer(db: Session, user: Empleado) -> set[int]:
    """Ids de los equipos en los que `user` está asignado como diseñador."""
    return set(memo_sesion(db, ("como_designer", user.id), lambda: {tid for (tid,) in db.query(DesignTeamDesigner.team_id)
                                                                    .filter(DesignTeamDesigner.empleado_id == user.id).all()}))


# Personas que, sin ser manager, pueden CREAR órdenes de un solo producto en ciertos equipos (el producto queda fijo).
# María José Lemus: Maxilar Print en los Schedules de Face de Juliana y de Nicole (pedido por Rosember el 12-oct-2026).
# "persona" y "managers" se comparan por palabras, sin tildes ni mayúsculas.
CREAN_PRODUCTO = [
    {"persona": "maria jose lemus", "area": "Face Design", "managers": ["juliana", "nicole"], "producto": "Maxilar Print"},
]


def producto_que_crea(user: Empleado, team: DesignTeam) -> str | None:
    """El producto con el que `user` puede crear órdenes en `team` sin ser su manager (o None)."""
    nombre = set(_normalizar_texto(user.nombre_completo or "").split())
    mgr = _normalizar_texto(team.manager.nombre_completo) if team and team.manager else ""
    for r in CREAN_PRODUCTO:
        if (set(r["persona"].split()) <= nombre and team.area and team.area.nombre == r["area"]
                and any(m in mgr.split() for m in r["managers"])):
            return r["producto"]
    return None


def gestiona_equipo(user: Empleado, team: DesignTeam) -> bool:
    """Ve y edita todo el horario del equipo: admins/superadmins, el manager del equipo, el diseñador que el
    manager dejó a cargo (solo en sus fechas) y, en Support, todos sus miembros (allí 'Diseñador' es el del caso,
    de otra área; quien atiende va en 'Soporte')."""
    if es_admin(user) or team.manager_id == user.id:
        return True
    if team.area.formato == FORMATO_SUPPORT and any(d.empleado_id == user.id for d in team.designers):
        return True
    from sqlalchemy.orm import object_session
    db = object_session(team)
    if db and team.area.formato == FORMATO_SUPPORT:  # quien cubre un turno de Support (Support Time) edita su Schedule
        from .services_design_support import empleados_cubriendo
        if user.id in empleados_cubriendo(db, ahora_colombia().date()):
            return True
    return bool(db) and delegaciones_activas(db).get(team.id) == user.id


# ---------- Diseñador a cargo del equipo (cuando el manager no está) ----------
_DELEG_CACHE = {"t": 0.0, "dia": None, "v": None}


# Varias asignaciones por equipo (Rosember, 26-oct-2026): si el manager sale una semana, cada día puede quedar a cargo una
# persona distinta (una por día, sin cruces). La lista de cada equipo se guarda en design_conexion_reglas (tipo «sistema»,
# clave DELEG_CLAVE + team_id), sin cambiar la estructura de la base. design_delegaciones sigue con una fila por equipo como
# espejo de la asignación de hoy (o la próxima): así el Schedule en vivo se entera de los cambios. Un equipo que todavía no
# tiene lista usa esa fila (lo de antes de este cambio).
DELEG_CLAVE = "delegaciones_equipo_"


def _deleg_entrada(d) -> dict:
    return {"id": "fila", "e": d.empleado_id, "d": d.desde.isoformat(), "h": d.hasta.isoformat(), "por": d.asignado_por or ""}


def _deleg_listas(db: Session) -> dict[int, list[dict]]:
    """{team_id: [entradas]} de todos los equipos: la lista guardada o, si no hay, la fila de design_delegaciones."""
    from .models_design import DesignConexionRegla, DesignDelegacion
    out: dict[int, list[dict]] = {}
    for r in db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                                  DesignConexionRegla.clave.like(DELEG_CLAVE + "%")):
        try:
            out[int(r.clave[len(DELEG_CLAVE):])] = json.loads(r.valor or "[]")
        except (ValueError, TypeError):
            continue
    for d in db.query(DesignDelegacion).all():
        out.setdefault(d.team_id, [_deleg_entrada(d)])
    return out


def _deleg_lista(db: Session, team_id: int) -> list[dict]:
    from .models_design import DesignConexionRegla, DesignDelegacion
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                             DesignConexionRegla.clave == DELEG_CLAVE + str(team_id)).first()
    if r:
        try:
            return json.loads(r.valor or "[]")
        except ValueError:
            return []
    d = db.get(DesignDelegacion, team_id)
    return [_deleg_entrada(d)] if d else []


def _deleg_guardar(db: Session, team_id: int, lista: list[dict]) -> None:
    """Guarda la lista (sin las vencidas, en orden) y actualiza el espejo en design_delegaciones."""
    from .models_design import DesignConexionRegla, DesignDelegacion
    hoy = ahora_colombia().date().isoformat()
    lista = sorted((x for x in lista if x["h"] >= hoy), key=lambda x: x["d"])
    clave = DELEG_CLAVE + str(team_id)
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).first()
    if not r:
        r = DesignConexionRegla(tipo="sistema", clave=clave, creado_por="Dejar a cargo")
        db.add(r)
    r.valor = json.dumps(lista, ensure_ascii=False)
    espejo = next((x for x in lista if x["d"] <= hoy), lista[0] if lista else None)
    d = db.get(DesignDelegacion, team_id)
    if espejo:
        d = d or DesignDelegacion(team_id=team_id)
        d.empleado_id, d.desde, d.hasta = espejo["e"], date.fromisoformat(espejo["d"]), date.fromisoformat(espejo["h"])
        d.asignado_por, d.asignado_en = espejo.get("por", ""), datetime.utcnow()
        db.add(d)
    elif d:
        db.delete(d)
    db.commit()
    _DELEG_CACHE["v"] = None


def delegaciones_activas(db: Session) -> dict[int, int]:
    """{team_id: empleado_id} de quien está a cargo hoy (fecha de Colombia). Se guarda 20 s."""
    import time as _t
    hoy = ahora_colombia().date()
    c = _DELEG_CACHE
    if c["v"] is not None and c["dia"] == hoy and _t.monotonic() - c["t"] < 20:
        return c["v"]
    h = hoy.isoformat()
    v = {}
    for tid, lista in _deleg_listas(db).items():
        x = next((x for x in lista if x["d"] <= h <= x["h"]), None)
        if x:
            v[tid] = x["e"]
    c["t"], c["dia"], c["v"] = _t.monotonic(), hoy, v
    return v


def puede_delegar(user: Empleado, team: DesignTeam) -> bool:
    """Solo el manager del equipo (o un admin) deja a alguien a cargo; el que está a cargo no puede pasarlo a otro."""
    return es_admin(user) or team.manager_id == user.id


def delegacion_de(db: Session, team: DesignTeam) -> dict | None:
    """La asignación de hoy (o la próxima programada) con la lista de todas las que siguen (las vencidas no cuentan)."""
    hoy = ahora_colombia().date().isoformat()
    vig = sorted((x for x in _deleg_lista(db, team.id) if x["h"] >= hoy), key=lambda x: x["d"])
    if not vig:
        return None
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_({x["e"] for x in vig}))}
    lista = [{"id": x["id"], "empleadoId": x["e"], "nombre": nombres.get(x["e"], ""), "desde": x["d"], "hasta": x["h"],
              "activa": x["d"] <= hoy, "asignadoPor": x.get("por", "")} for x in vig]
    actual = next((x for x in lista if x["activa"]), lista[0])
    return dict(actual, lista=lista)


def candidatos_delegacion(db: Session, team: DesignTeam) -> list[dict]:
    """«Otra persona…» en Dejar a cargo (Rosember, 26-oct-2026): a veces queda a cargo alguien de otro equipo. Personas
    activas de la MISMA área (diseñadores y managers de sus equipos activos) que no son de este equipo ni su manager."""
    del_equipo = {d.empleado_id for d in team.designers} | {team.manager_id}
    equipos = (db.query(DesignTeam).options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado),
                                            joinedload(DesignTeam.manager))
               .filter(DesignTeam.area_id == team.area_id, DesignTeam.activo == 1, DesignTeam.id != team.id)
               .order_by(DesignTeam.orden, DesignTeam.nombre).all())
    out: dict[int, dict] = {}
    for t in equipos:
        gente = ([(t.manager, "manager")] if t.manager else []) + [(d.empleado, "") for d in t.designers if d.empleado]
        for e, rol in gente:
            if e.id in del_equipo or e.id in out or not e.activo:
                continue
            out[e.id] = {"id": e.id, "nombre": e.nombre_completo, "equipo": t.nombre + (" (manager)" if rol else "")}
    return sorted(out.values(), key=lambda x: _normalizar_texto(x["nombre"]))


def guardar_delegacion(db: Session, team: DesignTeam, empleado_id: int, desde: date, hasta: date, por: str) -> str | None:
    """Agrega una asignación: alguien queda a cargo del equipo entre `desde` y `hasta`. Puede ser un diseñador del equipo
    o, con «Otra persona…», alguien de la misma área (candidatos_delegacion). Cada día solo una persona: no deja cruzar
    fechas con otra asignación. Devuelve el error."""
    import uuid
    if (not any(d.empleado_id == empleado_id for d in team.designers)
            and not any(c["id"] == empleado_id for c in candidatos_delegacion(db, team))):
        return "Solo puedes dejar a cargo a alguien del equipo o de la misma área."
    if empleado_id == team.manager_id:
        return "El manager ya tiene el permiso."
    if hasta < desde:
        return "La fecha final no puede ser antes de la inicial."
    if hasta < ahora_colombia().date():
        return "La fecha final ya pasó."
    d, h = desde.isoformat(), hasta.isoformat()
    hoy = ahora_colombia().date().isoformat()
    lista = [x for x in _deleg_lista(db, team.id) if x["h"] >= hoy]
    cruce = next((x for x in lista if not (h < x["d"] or d > x["h"])), None)
    if cruce:
        e = db.get(Empleado, cruce["e"])
        meses = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
        corta = lambda iso: f"{int(iso[8:10])} {meses[int(iso[5:7]) - 1]}"
        rango = corta(cruce["d"]) if cruce["d"] == cruce["h"] else f"{corta(cruce['d'])} al {corta(cruce['h'])}"
        return (f"Esas fechas se cruzan con {e.nombre_completo if e else 'otra persona'} ({rango}). "
                "Cada día solo puede quedar una persona a cargo.")
    lista.append({"id": uuid.uuid4().hex[:8], "e": empleado_id, "d": d, "h": h, "por": por})
    _deleg_guardar(db, team.id, lista)
    return None


def quitar_delegacion(db: Session, team: DesignTeam, entrada_id: str = "") -> bool:
    """Quita una asignación (por su id) o, sin id, todas las del equipo."""
    lista = _deleg_lista(db, team.id)
    nueva = [x for x in lista if entrada_id and x["id"] != entrada_id]
    if len(nueva) == len(lista):
        return False
    _deleg_guardar(db, team.id, nueva)
    return True


# Comments: cada pestaña es de unas áreas. Support y los admins ven las dos (1-oct-2026). Training ve la de N3
# (Rosember, 22-oct-2026): su Schedule es igual al de N3 y sus casos llegan de N3.
COMMENTS_AREAS = {"n3": {"N3 Prosthetic", "N6 Material Changes", AREA_TRAINING}, "faq": {"N2 Demodenture", "Face Design"}}


def comments_permitidos(db: Session, user: Empleado) -> dict:
    """{"n3": bool, "faq": bool}: qué pestañas de Comments ve `user`, según las áreas de sus equipos activos
    (como manager o diseñador)."""
    if es_admin(user):
        return {k: True for k in COMMENTS_AREAS}
    ids = equipos_como_designer(db, user)
    teams = (db.query(DesignTeam).options(joinedload(DesignTeam.area))
             .filter(DesignTeam.activo == 1, or_(DesignTeam.manager_id == user.id, DesignTeam.id.in_(ids or [-1]))).all())
    if any(t.area.formato == FORMATO_SUPPORT for t in teams):
        return {k: True for k in COMMENTS_AREAS}
    areas = {t.area.nombre for t in teams}
    return {k: bool(areas & v) for k, v in COMMENTS_AREAS.items()}


# Pre-Approved: cada quien ve su área; N6 ve también N3 y Face también N2 (no tienen hojas propias).
# Support y los admins ven todas (1-oct-2026).
PA_AREAS_VINCULADAS = {"N6 Material Changes": "N3 Prosthetic", "Face Design": "N2 Demodenture"}


def preapproved_areas_permitidas(db: Session, user: Empleado) -> set[int] | None:
    """Ids de las áreas de Pre-Approved que ve `user`; None = todas."""
    if es_admin(user):
        return None
    ids = equipos_como_designer(db, user)
    teams = (db.query(DesignTeam).options(joinedload(DesignTeam.area))
             .filter(DesignTeam.activo == 1, or_(DesignTeam.manager_id == user.id, DesignTeam.id.in_(ids or [-1]))).all())
    if any(t.area.formato == FORMATO_SUPPORT for t in teams):
        return None
    nombres = {t.area.nombre for t in teams}
    nombres |= {PA_AREAS_VINCULADAS[n] for n in nombres if n in PA_AREAS_VINCULADAS}
    return {a.id for a in db.query(DesignArea).all() if a.nombre in nombres}


def preapproved_buscar(db: Session, q: str, areas_permitidas: set[int] | None, limite: int = 300) -> list[dict]:
    """Doctores y centros cuyo nombre contiene `q` en todas las hojas que la persona ve, en el orden de las áreas,
    de las hojas y de las columnas (así 'siguiente' recorre las hojas en orden)."""
    q = _normalizar_texto(q)
    if not q:
        return []
    pos = {a.id: i for i, a in enumerate(areas_disponibles(db))}
    hojas = [s for s in db.query(DesignPreApprovedSheet).all()
             if s.area_id in pos and (areas_permitidas is None or s.area_id in areas_permitidas)]
    hojas.sort(key=lambda s: (pos[s.area_id], s.orden or 0, s.id))
    ids = [s.id for s in hojas]
    centros, doctores = {}, {}
    for c in db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id.in_(ids or [-1])).all():
        centros.setdefault(c.sheet_id, []).append(c)
    for d in db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id.in_(ids or [-1])).all():
        doctores.setdefault(d.sheet_id, []).append(d)
    out = []
    for s in hojas:
        for c in sorted(centros.get(s.id, []), key=lambda x: (x.orden or 0, x.id)):
            if q in _normalizar_texto(c.nombre):
                out.append({"sheetId": s.id, "areaId": s.area_id, "hoja": s.nombre, "tipo": "centro", "id": c.id, "nombre": c.nombre})
        for d in sorted(doctores.get(s.id, []), key=lambda x: (x.orden or 0, x.id)):
            if q in _normalizar_texto(d.nombre):
                out.append({"sheetId": s.id, "areaId": s.area_id, "hoja": s.nombre, "tipo": "doctor", "id": d.id, "nombre": d.nombre})
        if len(out) >= limite:
            break
    return out[:limite]


def preapproved_hoja_de(db: Session, user: Empleado) -> dict | None:
    """Hoja de Pre-Approved que se abre sola para un empleado o aprobador: la del manager de su equipo. Se usa la
    misma conexión que Parámetros › Conexión con los equipos (hoja conectada a mano, o nombre de la hoja = manager).
    Se busca en el área del equipo y, si allí no hay, en la vinculada (N6 → N3, Face → N2)."""
    equipos = mis_equipos(db, user)
    if not equipos:
        return None
    reglas = reglas_conexion(db)["pa_manager"]
    nombre_area = {a.id: a.nombre for a in db.query(DesignArea).all()}
    id_area = {v: k for k, v in nombre_area.items()}
    for e in equipos:
        team = db.get(DesignTeam, e["teamId"])
        if not team:
            continue
        areas = [team.area_id]
        vinc = PA_AREAS_VINCULADAS.get(nombre_area.get(team.area_id))
        if vinc in id_area:
            areas.append(id_area[vinc])
        for area_id in areas:
            hojas = preapproved_sheets(db, area_id)
            elegida = next((s for s in hojas if reglas.get(s.id) == team.id), None)
            if not elegida and team.manager:
                pm = _palabras(team.manager.nombre_completo)
                elegida = next((s for s in hojas if _palabras(_sin_prefijo_area(s.nombre))
                                and _palabras(_sin_prefijo_area(s.nombre)) <= pm), None)
            if elegida:
                return {"areaId": elegida.area_id, "sheetId": elegida.id}
    return None


def mis_equipos(db: Session, user: Empleado) -> list[dict]:
    """Equipos propios de un empleado o aprobador (no admin): primero los que maneja y luego aquellos en los que
    está como diseñador, cada grupo según el orden de las áreas. El primero es el que se abre al entrar."""
    if es_admin(user):
        return []
    return [dict(x) for x in memo_sesion(db, ("mis_equipos", user.id), lambda: _mis_equipos(db, user))]


def _mis_equipos(db: Session, user: Empleado) -> list[dict]:
    areas = areas_disponibles(db)
    pos = {a.id: i for i, a in enumerate(areas)}
    nombre_area = {a.id: a.nombre for a in areas}
    activos = [t for t in db.query(DesignTeam).filter(DesignTeam.activo == 1).all() if t.area_id in pos]
    clave = lambda t: (pos[t.area_id], t.orden or 0, t.id)
    ids = equipos_como_designer(db, user)
    # Diseñador a cargo hoy (13-oct-2026): ve su equipo igual que el manager, así que también aparece en su lista
    a_cargo = {tid for tid, eid in delegaciones_activas(db).items() if eid == user.id}
    propios = sorted((t for t in activos if t.manager_id == user.id), key=clave)
    propios += [t for t in sorted((t for t in activos if t.id in ids or t.id in a_cargo), key=clave) if t not in propios]
    return [{"areaId": t.area_id, "teamId": t.id, "nombre": t.nombre, "area": nombre_area[t.area_id]} for t in propios]


def puede_ver_equipo(user: Empleado, team: DesignTeam, ids_designer: set[int] = frozenset()) -> bool:
    """Admins ven todos los equipos; un manager, los suyos; un diseñador, los equipos en los que está
    asignado (y dentro de ellos solo sus propias órdenes y tiempos libres: ver gestiona_equipo)."""
    return gestiona_equipo(user, team) or team.id in ids_designer or es_training(team)   # Training lo ve todo el mundo


def catalogo(db: Session, area_id: int, tipo: str) -> list[str]:
    ordenar_estados_n3_n6_una_vez(db)
    productos_n6_igual_n3_una_vez(db)
    productos_n6_primeros_una_vez(db)
    estado_changes_ready_una_vez(db)
    material_change_una_vez(db)
    producto_prosthetic_scan_una_vez(db)
    prosthetic_scan_unico_n3_una_vez(db)
    productos_al_final_una_vez(db)
    productos_n2_a_face_una_vez(db)
    vals = [c.valor for c in db.query(DesignCatalogo)
            .filter(DesignCatalogo.area_id == area_id, DesignCatalogo.tipo == tipo, DesignCatalogo.activo == 1)
            .order_by(DesignCatalogo.orden).all()]
    return _orden_productos_n6(db, area_id, tipo, vals)


# N6: los productos que empiezan por "N6" van primero y debajo los demás (los de N3), en su orden (pedido por Rosember
# el 7-oct-2026). Se aplica al mostrar la lista, así también los productos que se agreguen después quedan en su lugar.
AREA_N6 = "N6 Material Changes"
AREA_N3 = "N3 Prosthetic"
# N3 › Cirugías (Rosember, 19-oct-2026): para poner Approved la fila debe estar completa. «Fin» no se exige (lo llena
# Approved); «Inicio diseño» lo llena Initiated. Start hold y Re-initiated van en pareja. Notas y QC son opcionales.
# Igual que DS_APROBAR_N3 en static/design/schedule.js.
APROBAR_N3 = (("orden", "Orden"), ("paciente", "Paciente"), ("centro", "Centro"), ("producto", "Producto"),
              ("designer", "Diseñador"), ("art_start", "START"), ("art_rtd", "RTD"), ("hora_inicio", "Inicio diseño"),
              ("critico", "Crítico"))


def faltan_para_aprobar(area_nombre: str, tabla: str, valores: dict) -> list[str]:
    """Columnas vacías que impiden poner Approved (vacío si se puede). `valores` con claves de columna de DesignOrden."""
    if area_nombre != AREA_N3 or tabla != "principal":
        return []
    lleno = lambda c: bool(str(valores.get(c) or "").strip())
    falta = []
    for c, nombre in APROBAR_N3:
        ok = (valores.get("designer_id") or lleno("designer_prestado")) if c == "designer" else lleno(c)
        if not ok:
            falta.append(nombre)
    if lleno("s_hold") and not lleno("f_hold"):
        falta.append("Re-initiated (hay Start hold)")
    return falta


def msg_faltan_aprobar(falta: list[str]) -> str:
    return "Para poner Approved hay que llenar: " + ", ".join(falta) + "."


def _orden_productos_n6(db: Session, area_id: int, tipo: str, vals: list[str]) -> list[str]:
    if tipo != "producto":
        return vals
    a = db.get(DesignArea, area_id)
    if not a or a.nombre != AREA_N6:
        return vals
    primeros = {_normalizar_texto(x) for x in PRODUCTOS_N6_PRIMEROS}
    return sorted(vals, key=lambda v: not (_normalizar_texto(v).startswith("n6") or _normalizar_texto(v) in primeros))  # estable: conserva el orden dentro de cada grupo


_productos_n6 = {"ok": False}

# Productos de N6 que van de primeros en la lista, en este orden (pedido por Rosember el 12-oct-2026). "Screw Retained -
# Dummy" no empieza por "N6" pero va con ellos. Se agregan una sola vez (productos_n6_primeros_una_vez); después se
# administran en Parámetros como cualquier producto.
PRODUCTOS_N6_PRIMEROS = [
    "N6 - Material Change Full Mouth 24Z", "N6 - Material Change Single 24Z",
    "N6 - Redo Material Change Full Mouth 24Z", "N6 - Redo Material Change Single 24Z",
    "N6 - Single G-CAM Ti Bar Remake", "N6 - Dummy Set", "N6 - Aesthetic Dummy",
    "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)",
    "N6 - Full Mouth G-CAM Remake", "Screw Retained - Dummy", "N6 - Single G-CAM Remake",
]
_productos_n6_primeros = {"ok": False}


def productos_n6_primeros_una_vez(db: Session) -> None:
    """Una sola vez (12-oct-2026): agrega a N6 los productos de PRODUCTOS_N6_PRIMEROS (o los reactiva si existían)
    y los deja de primeros en la lista, en ese orden; los demás quedan después en su orden de antes. Lo agregado queda
    anotado en design_conexion_reglas (tipo sistema, clave productos_n6_primeros_2026_10_12)."""
    from .models_design import DesignConexionRegla
    if _productos_n6_primeros["ok"]:
        return
    marca = "productos_n6_primeros_2026_10_12"
    try:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            _productos_n6_primeros["ok"] = True
            return
        n6 = db.query(DesignArea).filter(DesignArea.nombre == AREA_N6).first()
        if not n6:
            return
        existentes = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n6.id, DesignCatalogo.tipo == "producto")
                      .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
        por_nombre = {_normalizar_texto(c.valor): c for c in existentes}
        agregados, reactivados, primeros = [], [], []
        for nombre in PRODUCTOS_N6_PRIMEROS:
            c = por_nombre.get(_normalizar_texto(nombre))
            if not c:
                c = DesignCatalogo(area_id=n6.id, tipo="producto", valor=nombre, activo=1)
                db.add(c); agregados.append(nombre)
            elif not c.activo:
                c.activo = 1; reactivados.append(nombre)
            primeros.append(c)
        for i, c in enumerate(primeros + [c for c in existentes if c not in primeros], start=1):
            c.orden = i
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema",
                                   valor=json.dumps({"agregados": agregados, "reactivados": reactivados}, ensure_ascii=False)))
        db.commit()
        _productos_n6_primeros["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def productos_n6_igual_n3_una_vez(db: Session) -> None:
    """Una sola vez (7-oct-2026): N6 tiene todos los productos activos de N3 (los que le falten se agregan o se
    reactivan) y su catálogo queda ordenado: primero los N6, luego los de N3 en el orden de N3 y al final los demás.
    Lo agregado queda anotado en design_conexion_reglas (tipo sistema, clave productos_n6_igual_n3)."""
    from .models_design import DesignConexionRegla
    if _productos_n6["ok"]:
        return
    marca = "productos_n6_igual_n3"
    try:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            _productos_n6["ok"] = True
            return
        n3 = db.query(DesignArea).filter(DesignArea.nombre == "N3 Prosthetic").first()
        n6 = db.query(DesignArea).filter(DesignArea.nombre == AREA_N6).first()
        if not n3 or not n6:
            return
        q = lambda area: (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "producto")
                          .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
        de_n3 = [c for c in q(n3) if c.activo]
        de_n6 = q(n6)
        por_nombre = {_normalizar_texto(c.valor): c for c in de_n6}
        agregados, reactivados = [], []
        for c in de_n3:
            x = por_nombre.get(_normalizar_texto(c.valor))
            if not x:
                x = DesignCatalogo(area_id=n6.id, tipo="producto", valor=c.valor, activo=1)
                db.add(x); de_n6.append(x); por_nombre[_normalizar_texto(c.valor)] = x; agregados.append(c.valor)
            elif not x.activo:
                x.activo = 1; reactivados.append(c.valor)
        orden_n3 = {_normalizar_texto(c.valor): i for i, c in enumerate(de_n3)}
        def clave(x):
            n = _normalizar_texto(x.valor)
            if n.startswith("n6"):
                return (0, de_n6.index(x))
            return (1, orden_n3.get(n, 10_000 + de_n6.index(x)))
        for i, x in enumerate(sorted(de_n6, key=clave), start=1):
            x.orden = i
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema",
                                   valor=json.dumps({"agregados": agregados, "reactivados": reactivados}, ensure_ascii=False)))
        db.commit()
        _productos_n6["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# Orden de los estados en N3 y N6 (pedido por Rosember el 2-oct-2026). Los que falten se crean; los demás estados
# activos del área quedan después, en su orden de antes.
ESTADOS_N3_N6 = ["Order Entered", "Pickup received", "Ready to design", "Initiated", "Hold", "Bite ready",
                 "Approved", "Skipped", "Canceled"]
_estados_ordenados = {"ok": False}


# Estado "Changes ready" para TC y Nightguards en N3 y N6 (pedido por Rosember el 12-oct-2026). Se agrega una sola vez al
# catálogo de estados, antes de "Approved"; en el Schedule solo se ofrece en la tabla de Nightguards/TC y en filas con
# producto TC o Nightguard (DS_ESTADOS_SOLO_NG en static/design/schedule.js).
ESTADO_CHANGES_READY = "Changes ready"
_changes_ready = {"ok": False}


def estado_changes_ready_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _changes_ready["ok"]:
        return
    marca = "estado_changes_ready_n3_n6_2026_10_12"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            for area in db.query(DesignArea).filter(DesignArea.nombre.in_(["N3 Prosthetic", "N6 Material Changes"])).all():
                estados = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "estado")
                           .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
                ya = next((c for c in estados if _normalizar_texto(c.valor) == _normalizar_texto(ESTADO_CHANGES_READY)), None)
                if ya:
                    ya.activo = 1
                    continue
                nuevo = DesignCatalogo(area_id=area.id, tipo="estado", valor=ESTADO_CHANGES_READY, activo=1)
                db.add(nuevo)
                pos = next((i for i, c in enumerate(estados) if _normalizar_texto(c.valor) == "approved"), len(estados))
                for i, c in enumerate(estados[:pos] + [nuevo] + estados[pos:], start=1):
                    c.orden = i
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        _changes_ready["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# ---------- N6 · Material Change (pedido por Rosember el 12-oct-2026) ----------
# Panel propio en el Schedule de N6, arriba de Cirugías y Nightguards / TC (tabla "material"). Cada orden pasa por dos
# etapas en la misma fila: Bite design (horas y QC de siempre) y Zirconia design (columnas z_*). El estado llena las
# horas de la etapa activa; al aprobar Bite se llena su Fin y la orden pasa sola a Zirconia design en Ready to design.
# Estados propios: "Dr authorization" (igual que Hold: color, pausa el tiempo y pasa al día siguiente) y "Changes"
# (igual que Ready to design: color y pasa al día siguiente). Sus productos solo se eligen en este panel.
TABLA_MATERIAL = "material"
ETAPA_BITE = "Bite design"
ETAPA_ZIRCONIA = "Zirconia design"
ESTADO_DR_AUT = "Dr authorization"
ESTADO_CHANGES = "Changes"
TRASLADO_MATERIAL_DESDE = date(2026, 10, 12)
PRODUCTOS_MATERIAL = [
    "N6 - Material Change Full Mouth 24Z", "N6 - Material Change Single 24Z",
    "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)",
    "N6 - Redo Material Change Full Mouth 24Z", "N6 - Redo Material Change Single 24Z",
    "N6 - Full Mouth 24Z Remake", "N6 - Single 24Z Remake",
]
_material_change = {"ok": False}


def es_etapa_zirconia(etapa: str | None) -> bool:
    return _normalizar_texto(etapa or "") == _normalizar_texto(ETAPA_ZIRCONIA)


HOLD_SIN_INICIO = "Primero inicia la orden (Initiated): Hold solo se puede poner después de iniciar."


def es_hold(estado: str | None) -> bool:
    return _normalizar_texto(estado or "") == _normalizar_texto(ESTADO_HOLD)


def orden_iniciada(actual: dict, tabla: str, por_etapas: bool = False) -> bool:
    """¿La etapa en curso ya tiene Inicio? Hold solo se permite después de iniciar (Rosember, 21-oct-2026: casos puestos en
    Hold antes de empezar dejaban el Start hold antes del Inicio y el Total salía mal). Material Change y Removable
    Denture miran la etapa activa (Zirconia / Denture usan las columnas z_)."""
    etapa = _normalizar_texto(actual.get("etapa") or "")
    segunda = etapa in (_normalizar_texto(ETAPA_ZIRCONIA), _normalizar_texto(ETAPA_DENTURE))
    if (tabla == TABLA_MATERIAL or por_etapas) and segunda:
        return bool((actual.get("z_hora_inicio") or "").strip())
    return bool((actual.get("hora_inicio") or "").strip())


def material_horas_por_estado(actual: dict, estado_nuevo: str) -> dict:
    """Como face_horas_por_estado, pero en la etapa activa de la orden (Bite: columnas de siempre; Zirconia: z_*).
    "Dr authorization" cuenta como Hold. Aprobar Bite llena su Fin y deja la orden en Zirconia design, Ready to design."""
    p = "z_" if es_etapa_zirconia(actual.get("etapa")) else ""
    est = ESTADO_HOLD if _normalizar_texto(estado_nuevo) == _normalizar_texto(ESTADO_DR_AUT) else estado_nuevo
    base = {k: actual.get(p + k) for k in ("hora_inicio", "s_hold", "f_hold", "hora_fin", "hold_minutos")}
    cambios = {p + k: v for k, v in face_horas_por_estado(base, est).items()}
    if not p and estado_nuevo == "Approved":
        cambios.update({"etapa": ETAPA_ZIRCONIA, "estado": ESTADO_READY})
    return cambios


def horas_de_estado(tabla: str, actual: dict, estado_nuevo: str) -> dict:
    """Horas que llena el estado: Material Change por etapa; las demás tablas, igual que Face."""
    if tabla == TABLA_MATERIAL:
        return material_horas_por_estado(actual, estado_nuevo)
    if tabla == "nightguard" and _normalizar_texto(estado_nuevo) == _normalizar_texto(ESTADO_BITE_READY):
        estado_nuevo = ESTADO_HOLD   # Nightguards / TC: Bite ready registra el tiempo como Hold (Rosember, 20-oct-2026)
    return face_horas_por_estado(actual, estado_nuevo)


def material_change_una_vez(db: Session) -> None:
    """Una sola vez: N6 tiene los estados "Dr authorization" (después de Hold) y "Changes" (después de Ready to design)
    y los productos de PRODUCTOS_MATERIAL (los que falten se agregan o se reactivan)."""
    from .models_design import DesignConexionRegla
    if _material_change["ok"]:
        return
    marca = "material_change_n6_2026_10_12"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            n6 = db.query(DesignArea).filter(DesignArea.nombre == AREA_N6).first()
            if not n6:
                return
            estados = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n6.id, DesignCatalogo.tipo == "estado")
                       .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
            for nuevo_valor, despues_de in ((ESTADO_DR_AUT, ESTADO_HOLD), (ESTADO_CHANGES, ESTADO_READY)):
                ya = next((c for c in estados if _normalizar_texto(c.valor) == _normalizar_texto(nuevo_valor)), None)
                if ya:
                    ya.activo = 1
                    continue
                nuevo = DesignCatalogo(area_id=n6.id, tipo="estado", valor=nuevo_valor, activo=1)
                db.add(nuevo)
                pos = next((i + 1 for i, c in enumerate(estados) if _normalizar_texto(c.valor) == _normalizar_texto(despues_de)), len(estados))
                estados.insert(pos, nuevo)
            for i, c in enumerate(estados, start=1):
                c.orden = i
            productos = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n6.id, DesignCatalogo.tipo == "producto")
                         .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
            por_nombre = {_normalizar_texto(c.valor): c for c in productos}
            agregados = []
            sig = max([c.orden or 0 for c in productos] or [0])
            for nombre in PRODUCTOS_MATERIAL:
                c = por_nombre.get(_normalizar_texto(nombre))
                if not c:
                    sig += 1
                    db.add(DesignCatalogo(area_id=n6.id, tipo="producto", valor=nombre, activo=1, orden=sig))
                    agregados.append(nombre)
                elif not c.activo:
                    c.activo = 1
                    agregados.append(nombre)
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema",
                                       valor=json.dumps({"productos": agregados}, ensure_ascii=False)))
            db.commit()
        _material_change["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# "Prosthetic Scan/Measurement" al final de los productos de N3 y N6 (pedido por Rosember el 12-oct-2026). Una sola vez:
# si ya existe se reactiva y pasa al final. En N6 no empieza por "N6", así que queda en el último grupo (_orden_productos_n6).
PRODUCTO_PROSTHETIC_SCAN = "Prosthetic Scan/Measurement"
_prosthetic_scan = {"ok": False}


# Productos que se agregan una sola vez al final de la lista de un área: (áreas, producto, marca en design_conexion_reglas).
# Si ya existe, se reactiva y pasa al final. Para agregar otro, se suma una fila con una marca nueva.
PRODUCTOS_AL_FINAL = [
    (["Face Design"], "Maxilar Print", "producto_maxilar_print_face_2026_10_12"),  # pedido por Rosember el 12-oct-2026
    (None, "Training", "producto_training_todas_2026_10_26"),   # producto fantasma (ver PRODUCTO_FANTASMA); None = todas las áreas
]
_productos_al_final = {"ok": False}


_n2_a_face = {"ok": False}


def productos_n2_a_face_una_vez(db: Session) -> None:
    """Una sola vez (pedido por Rosember el 12-oct-2026): Face tiene todos los productos activos de N2. Los que Face ya
    tiene (aunque estén escritos con otras mayúsculas o tildes) se ignoran; si estaban desactivados, se reactivan. Los
    nuevos van al final, en el orden de N2. Lo agregado queda anotado en design_conexion_reglas."""
    from .models_design import DesignConexionRegla
    if _n2_a_face["ok"]:
        return
    marca = "productos_n2_a_face_2026_10_12"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            n2 = db.query(DesignArea).filter(DesignArea.nombre == "N2 Demodenture").first()
            face = db.query(DesignArea).filter(DesignArea.nombre == "Face Design").first()
            if not n2 or not face:
                return
            de_n2 = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n2.id, DesignCatalogo.tipo == "producto", DesignCatalogo.activo == 1)
                     .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
            de_face = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == face.id, DesignCatalogo.tipo == "producto").all()
            por_nombre = {_normalizar_texto(c.valor): c for c in de_face}
            ult = max([c.orden or 0 for c in de_face] or [0])
            agregados, reactivados = [], []
            for c in de_n2:
                k = _normalizar_texto(c.valor)
                ya = por_nombre.get(k)
                if ya:
                    if not ya.activo:
                        ya.activo = 1
                        reactivados.append(ya.valor)
                    continue
                ult += 1
                nuevo = DesignCatalogo(area_id=face.id, tipo="producto", valor=c.valor, activo=1, orden=ult)
                db.add(nuevo)
                por_nombre[k] = nuevo
                agregados.append(c.valor)
            mp = por_nombre.get(_normalizar_texto("Maxilar Print"))  # Maxilar Print sigue de último (pedido del mismo día)
            if mp is not None:
                mp.orden = ult + 1
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema",
                                       valor=json.dumps({"agregados": agregados, "reactivados": reactivados}, ensure_ascii=False)))
            db.commit()
        _n2_a_face["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def productos_al_final_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _productos_al_final["ok"]:
        return
    try:
        hechas = {r[0] for r in db.query(DesignConexionRegla.clave).filter(DesignConexionRegla.tipo == "sistema")}
        for areas, producto, marca in PRODUCTOS_AL_FINAL:
            if marca in hechas:
                continue
            for area in (db.query(DesignArea).all() if areas is None else db.query(DesignArea).filter(DesignArea.nombre.in_(areas)).all()):
                productos = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "producto").all()
                ult = max([c.orden or 0 for c in productos] or [0]) + 1
                c = next((x for x in productos if _normalizar_texto(x.valor) == _normalizar_texto(producto)), None)
                if c:
                    c.activo, c.orden = 1, ult
                else:
                    db.add(DesignCatalogo(area_id=area.id, tipo="producto", valor=producto, activo=1, orden=ult))
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
        db.commit()
        _productos_al_final["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def producto_prosthetic_scan_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _prosthetic_scan["ok"]:
        return
    marca = "producto_prosthetic_scan_n3_n6_2026_10_12"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            for area in db.query(DesignArea).filter(DesignArea.nombre.in_(["N3 Prosthetic", AREA_N6])).all():
                productos = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "producto").all()
                ult = max([c.orden or 0 for c in productos] or [0]) + 1
                c = next((x for x in productos if _normalizar_texto(x.valor) == _normalizar_texto(PRODUCTO_PROSTHETIC_SCAN)), None)
                if c:
                    c.activo, c.orden = 1, ult
                else:
                    db.add(DesignCatalogo(area_id=area.id, tipo="producto", valor=PRODUCTO_PROSTHETIC_SCAN, activo=1, orden=ult))
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        _prosthetic_scan["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def _es_scan_measurement(valor: str) -> bool:
    """¿Es un producto de tipo Prosthetic Scan / Scan-Measurement? Compara sin mayúsculas, espacios ni signos."""
    k = re.sub(r"[^a-z0-9]", "", _normalizar_texto(valor))
    return "prostheticscan" in k or k in ("scanmeasurement", "scanmeasurements")


_scan_unico = {"ok": False}


def prosthetic_scan_unico_n3_una_vez(db: Session) -> None:
    """Una sola vez (pedido por Rosember el 19-oct-2026): en el catálogo de N3 solo queda UN producto de Prosthetic Scan
    ("Prosthetic Scan/Measurement"); los repetidos se desactivan (no se borran: las órdenes que ya los tienen los
    conservan). El que queda solo se elige en Nightguards / TC (ver dsEsProductoSoloNG en schedule.js), no en Cirugías.
    Lo desactivado queda anotado en design_conexion_reglas."""
    from .models_design import DesignConexionRegla
    if _scan_unico["ok"]:
        return
    marca = "prosthetic_scan_unico_n3_2026_10_19"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            n3 = db.query(DesignArea).filter(DesignArea.nombre == "N3 Prosthetic").first()
            desactivados = []
            if n3:
                prods = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == n3.id, DesignCatalogo.tipo == "producto")
                         .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
                cand = [c for c in prods if _es_scan_measurement(c.valor)]
                if cand:
                    canon = _normalizar_texto(PRODUCTO_PROSTHETIC_SCAN)
                    quedan = next((c for c in cand if _normalizar_texto(c.valor) == canon), None) or next((c for c in cand if c.activo), cand[0])
                    quedan.activo = 1
                    for c in cand:
                        if c is not quedan and c.activo:
                            c.activo = 0
                            desactivados.append(c.valor)
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema",
                                       valor=json.dumps({"desactivados": desactivados}, ensure_ascii=False)))
            db.commit()
        _scan_unico["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def ordenar_estados_n3_n6_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _estados_ordenados["ok"]:
        return
    marca = "estados_n3_n6_orden"
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
        _estados_ordenados["ok"] = True
        return
    try:
        for area in db.query(DesignArea).filter(DesignArea.nombre.in_(["N3 Prosthetic", "N6 Material Changes"])).all():
            existentes = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "estado")
                          .order_by(DesignCatalogo.orden, DesignCatalogo.id).all())
            por_nombre = {_normalizar_texto(c.valor): c for c in existentes}
            usados = []
            for i, nombre in enumerate(ESTADOS_N3_N6, start=1):
                c = por_nombre.get(_normalizar_texto(nombre))
                if not c:
                    c = DesignCatalogo(area_id=area.id, tipo="estado", valor=nombre)
                    db.add(c)
                c.orden, c.activo = i, 1
                usados.append(c)
            resto = [c for c in existentes if c not in usados]
            for k, c in enumerate(resto, start=len(ESTADOS_N3_N6) + 1):
                c.orden = k
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
        db.commit()
        _estados_ordenados["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def catalogos_de_area(db: Session, area_id: int) -> dict[str, list[str]]:
    ordenar_estados_n3_n6_una_vez(db)
    productos_n6_igual_n3_una_vez(db)
    productos_n6_primeros_una_vez(db)
    estado_changes_ready_una_vez(db)
    material_change_una_vez(db)
    producto_prosthetic_scan_una_vez(db)
    prosthetic_scan_unico_n3_una_vez(db)
    productos_al_final_una_vez(db)
    productos_n2_a_face_una_vez(db)
    out: dict[str, list[str]] = {}
    for c in (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area_id, DesignCatalogo.activo == 1)
              .order_by(DesignCatalogo.tipo, DesignCatalogo.orden).all()):
        out.setdefault(c.tipo, []).append(c.valor)
    if "producto" in out:
        out["producto"] = _orden_productos_n6(db, area_id, "producto", out["producto"])
    return out


def agregar_valor_catalogo(db: Session, area_id: int, tipo: str, valor: str) -> None:
    valor = valor.strip()
    if not valor:
        return
    existe = (db.query(DesignCatalogo)
             .filter(DesignCatalogo.area_id == area_id, DesignCatalogo.tipo == tipo,
                     DesignCatalogo.valor == valor).first())
    if existe:
        if not existe.activo:
            existe.activo = 1
            db.commit()
        return
    orden = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area_id,
                                            DesignCatalogo.tipo == tipo).count() + 1
    db.add(DesignCatalogo(area_id=area_id, tipo=tipo, valor=valor, orden=orden))
    db.commit()


def ausencias_disponibles(db: Session) -> list[str]:
    return [a.nombre for a in db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.activo == 1)
            .order_by(DesignAusenciaTipo.orden).all()]


# Ausencia automática desde People (validado con Rosember el 20-oct-2026): todo permiso de DÍA COMPLETO aprobado en
# People que cubre el día pone la ausencia en Tiempos libres, cualquiera que sea su tipo. El tipo de People se busca en
# el catálogo de ausencias de Design por nombre (sin tildes ni mayúsculas), luego por los equivalentes de abajo y por
# palabras clave; si no se parece a ninguno queda como «Permiso personal». Los permisos POR HORAS no son ausencia: se
# muestran como aviso en la tarjeta y cuentan como pausa en Seguimiento mientras duran.
MAPEO_PERMISO_A_AUSENCIA_DESIGN = {
    "Vacaciones": "Vacaciones",
    "Calamidad doméstica": "Calamidad doméstica",
    "Licencia de luto": "Licencia por luto",
    "Permiso personal": "Permiso personal",
}
_CLAVES_AUSENCIA = (("vacacion", "Vacaciones"), ("luto", "Licencia por luto"), ("paternidad", "Licencia por paternidad"),
                    ("maternidad", "Licencia por paternidad"), ("calamidad", "Calamidad doméstica"), ("incapacidad", "Incapacidad"),
                    ("enfermedad", "Incapacidad"), ("cumple", "Cumpleaños"), ("grado", "Grado"), ("suspension", "Suspensión"),
                    ("festivo", "Festivo compensatorio"), ("compensatorio", "Descanso compensatorio"),
                    ("no remunerad", "No remunerada"), ("remunerad", "Remunerada"))


def ausencia_design_de(nombre_tipo: str, es_vacaciones: bool, catalogo: list[str]) -> str:
    """Nombre del catálogo de ausencias de Design para un tipo de permiso de People."""
    por_norma = {_normalizar_texto(c): c for c in catalogo}
    if es_vacaciones and "vacaciones" in por_norma:
        return por_norma["vacaciones"]
    for candidato in (nombre_tipo, MAPEO_PERMISO_A_AUSENCIA_DESIGN.get(nombre_tipo, "")):
        if candidato and _normalizar_texto(candidato) in por_norma:
            return por_norma[_normalizar_texto(candidato)]
    t = _normalizar_texto(nombre_tipo)
    for clave, destino in _CLAVES_AUSENCIA:
        if clave in t and _normalizar_texto(destino) in por_norma:
            return por_norma[_normalizar_texto(destino)]
    return por_norma.get("permiso personal") or (catalogo[0] if catalogo else nombre_tipo)


# Estados de People que cuentan como ausencia: aprobada y «pendiente de soporte» (21-oct-2026, Rosember: las licencias
# ya aprobadas por el jefe quedan esperando que People valide el documento, y mientras tanto salían libres en Seguimiento).
ESTADOS_AUSENCIA_PEOPLE = ("aprobada", "pendiente_soporte")


def _permisos_aprobados_del_dia(db: Session, empleado_ids: list[int], fecha: date) -> dict[int, str]:
    """{empleado_id: nombre_ausencia_design} para permisos de día completo aprobados en People que cubren `fecha`."""
    if not empleado_ids:
        return {}
    filas = (db.query(Solicitud.empleado_id, TipoPermiso.nombre, TipoPermiso.es_vacaciones)
            .join(TipoPermiso, Solicitud.tipo_id == TipoPermiso.id)
            .filter(Solicitud.empleado_id.in_(empleado_ids), Solicitud.estado.in_(ESTADOS_AUSENCIA_PEOPLE),
                    Solicitud.fecha_inicio <= fecha, Solicitud.fecha_fin >= fecha,
                    Solicitud.hora_inicio.is_(None), Solicitud.hora_fin.is_(None)).all())
    if not filas:
        return {}
    catalogo = memo_sesion(db, ("ausencias_catalogo",), lambda: ausencias_disponibles(db))
    return {empleado_id: ausencia_design_de(nombre_tipo, bool(es_vac), catalogo) for empleado_id, nombre_tipo, es_vac in filas}


def permisos_por_horas_del_dia(db: Session, empleado_ids: list[int], fecha: date) -> dict[int, list[dict]]:
    """{empleado_id: [{tipo, desde, hasta}]} permisos por horas aprobados en People para `fecha` (no son ausencia)."""
    if not empleado_ids:
        return {}
    out: dict[int, list[dict]] = {}
    for eid, tipo, hi, hf in (db.query(Solicitud.empleado_id, TipoPermiso.nombre, Solicitud.hora_inicio, Solicitud.hora_fin)
                              .join(TipoPermiso, Solicitud.tipo_id == TipoPermiso.id)
                              .filter(Solicitud.empleado_id.in_(empleado_ids), Solicitud.estado.in_(ESTADOS_AUSENCIA_PEOPLE),
                                      Solicitud.fecha_inicio <= fecha, Solicitud.fecha_fin >= fecha,
                                      Solicitud.hora_inicio.isnot(None))
                              .order_by(Solicitud.hora_inicio)):
        out.setdefault(eid, []).append({"tipo": tipo, "desde": hi.strftime("%H:%M"), "hasta": hf.strftime("%H:%M") if hf else ""})
    return out


# Producto «Training» (Rosember, 26-oct-2026): está en todas las áreas solo para practicar; es un producto fantasma.
# La orden se ve y se edita en el Schedule, pero no cuenta en ninguna parte: contadores, Dashboard, Producción,
# N3/N2 Producción, Seguimiento, rankings, Reparto, Selección asistida, reportes de QC ni casos asignados. Tampoco pasa
# de Face a N2. El frontend usa el mismo criterio en dsEsFantasma().
PRODUCTO_FANTASMA = "Training"


def es_producto_fantasma(producto: str | None) -> bool:
    return _normalizar_texto(producto or "") == _normalizar_texto(PRODUCTO_FANTASMA)


def filtro_no_fantasma():
    return func.lower(func.trim(func.coalesce(DesignOrden.producto, ""))) != PRODUCTO_FANTASMA.lower()


def filtro_orden_completa():
    """Una orden solo cuenta (contadores, Dashboard, vista de todas las áreas) si tiene centro, producto y
    diseñador, y si el producto no es el fantasma «Training». Las filas a medio llenar y las de práctica siguen
    guardadas y visibles en el horario del equipo. El frontend usa el mismo criterio en dsOrdenCompleta() y dsEsFantasma()."""
    return and_(func.coalesce(DesignOrden.centro, "") != "", func.coalesce(DesignOrden.producto, "") != "",
                or_(DesignOrden.designer_id.isnot(None), func.coalesce(DesignOrden.designer_prestado, "") != ""),
                filtro_no_fantasma())


# ---------- Cierre diario del horario (hora Colombia) ----------
# El día D se cierra a las 5:00 am (Colombia) del día siguiente: desde ese momento nadie puede editar sus
# órdenes ni sus tiempos libres; solo el checkbox de QC sigue editable hasta las 5:00 am de D+2.
# Al cierre, las órdenes en "Hold" pasan al siguiente día hábil (lunes a viernes) del mismo equipo.
ZONA_COLOMBIA = timezone(timedelta(hours=-5))  # Colombia no usa horario de verano
HORA_CIERRE = 5
ESTADO_HOLD = "Hold"
# Solo se trasladan las órdenes en Hold a partir de esta fecha (las anteriores se quedan en su día).
TRASLADO_HOLD_DESDE = date(2026, 9, 22)
# N2 Demodenture: las órdenes en "Html" también pasan al siguiente día hábil, como Hold (pedido por Rosember el
# 6-oct-2026; las de días anteriores se quedan en su día).
ESTADO_HTML = "Html"
AREA_HTML = "N2 Demodenture"
TRASLADO_HTML_DESDE = date(2026, 10, 6)
# Todas las áreas: las órdenes en "Ready to design" también pasan al siguiente día hábil (pedido por Rosember el
# 6-oct-2026; las de días anteriores se quedan y las que ya se pasaron a mano se limpian en Parámetros).
ESTADO_READY = "Ready to design"
TRASLADO_READY_DESDE = date(2026, 10, 6)
# Nightguards / TC: las órdenes en "Bite ready" también pasan al siguiente día hábil, como Hold (pedido por Rosember el
# 19-oct-2026; las de días anteriores se quedan en su día).
ESTADO_BITE_READY = "Bite ready"
TRASLADO_BITE_NG_DESDE = date(2026, 10, 19)
# Un mismo número de orden puede estar hasta 5 veces en el horario de un equipo el mismo día.
MAX_REPETICIONES_ORDEN = 5


def ahora_colombia() -> datetime:
    return datetime.now(ZONA_COLOMBIA)


def _limite(fecha: date, dias_despues: int) -> datetime:
    return datetime.combine(fecha + timedelta(days=dias_despues), time(HORA_CIERRE), ZONA_COLOMBIA)


def dia_cerrado(fecha: date, ahora: datetime | None = None) -> bool:
    return (ahora or ahora_colombia()) >= _limite(fecha, 1)


def qc_editable(fecha: date, ahora: datetime | None = None) -> bool:
    return (ahora or ahora_colombia()) < _limite(fecha, 2)


def qc_editable_hasta(fecha: date) -> datetime:
    return _limite(fecha, 2)


# Festivos de la empresa (Parámetros › Festivos). Los iniciales son los que dio Rosember el 2-oct-2026.
FESTIVOS_INICIALES = [(date(2026, 1, 1), "Año nuevo"), (date(2026, 1, 2), "Año nuevo"), (date(2026, 5, 25), "Memorial Day"),
                      (date(2026, 7, 3), "Independence Day"), (date(2026, 9, 7), "Labor Day"),
                      (date(2026, 11, 26), "Thanksgiving"), (date(2026, 11, 27), "Thanksgiving"), (date(2026, 12, 25), "Navidad")]
_FESTIVOS_CACHE = {"t": 0.0, "v": None}


def festivos(db: Session) -> set[date]:
    """Fechas festivas de la empresa. La primera vez se llena con FESTIVOS_INICIALES (una sola vez: si después se
    borran, no vuelven)."""
    import time as _t
    from .models_design import DesignFestivo, DesignConexionRegla
    c = _FESTIVOS_CACHE
    if c["v"] is not None and _t.monotonic() - c["t"] < 60:
        return c["v"]
    if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                                DesignConexionRegla.clave == "festivos_iniciales").first():
        try:
            for f, n in FESTIVOS_INICIALES:
                if not db.get(DesignFestivo, f):
                    db.add(DesignFestivo(fecha=f, nombre=n, creado_por="Sistema"))
            db.add(DesignConexionRegla(tipo="sistema", clave="festivos_iniciales", creado_por="Sistema"))
            db.commit()
        except Exception:
            log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
            db.rollback()  # otro proceso los llenó al mismo tiempo
    v = {f.fecha for f in db.query(DesignFestivo).all()}
    c["t"], c["v"] = _t.monotonic(), v
    return v


def festivos_invalidar() -> None:
    _FESTIVOS_CACHE["v"] = None
    from . import services_design_avisos
    services_design_avisos.invalidar()   # el Centro de avisos no envía en festivos: recarga su plan


def siguiente_dia_habil(fecha: date, no_laborables: set[date] = frozenset()) -> date:
    """El siguiente día que no es sábado, domingo ni festivo de la empresa."""
    d = fecha + timedelta(days=1)
    while d.weekday() >= 5 or d in no_laborables:
        d += timedelta(days=1)
    return d


def ultimo_dia_cerrado(ahora: datetime | None = None) -> date:
    """El día más reciente ya cerrado: D está cerrado si ahora >= D+1 05:00."""
    return ((ahora or ahora_colombia()) - timedelta(hours=HORA_CIERRE)).date() - timedelta(days=1)


_traslado_hecho_hasta: date | None = None  # evita repetir la consulta en cada petición del mismo proceso


def trasladar_holds(db: Session, ahora: datetime | None = None) -> int:
    """Mueve al siguiente día hábil abierto las órdenes en Hold de días ya cerrados. Se ejecuta al leer el
    horario (no hay tarea programada en el servidor), así que ocurre en la primera consulta después de las
    5:00 am. Es idempotente: si dos peticiones lo corren a la vez, el resultado es el mismo."""
    global _traslado_hecho_hasta
    cerrado_hasta = ultimo_dia_cerrado(ahora)
    if _traslado_hecho_hasta == cerrado_hasta:
        return 0
    ordenes = (db.query(DesignOrden)
               .filter(DesignOrden.estado == ESTADO_HOLD, DesignOrden.fecha >= TRASLADO_HOLD_DESDE,
                       DesignOrden.fecha <= cerrado_hasta)
               .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    equipos_html = [t.id for t in db.query(DesignTeam).join(DesignArea).filter(DesignArea.nombre == AREA_HTML).all()]
    if equipos_html:
        ordenes += (db.query(DesignOrden)
                    .filter(func.lower(DesignOrden.estado) == ESTADO_HTML.lower(), DesignOrden.team_id.in_(equipos_html),
                            DesignOrden.fecha >= TRASLADO_HTML_DESDE, DesignOrden.fecha <= cerrado_hasta)
                    .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    ordenes += (db.query(DesignOrden)
                .filter(func.lower(DesignOrden.estado) == ESTADO_READY.lower(),
                        DesignOrden.fecha >= TRASLADO_READY_DESDE, DesignOrden.fecha <= cerrado_hasta)
                .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    ordenes += (db.query(DesignOrden)
                .filter(DesignOrden.tabla == "nightguard", func.lower(DesignOrden.estado) == ESTADO_BITE_READY.lower(),
                        DesignOrden.fecha >= TRASLADO_BITE_NG_DESDE, DesignOrden.fecha <= cerrado_hasta)
                .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    # Material Change (N6): "Dr authorization" pasa como Hold y "Changes" como Ready to design
    ordenes += (db.query(DesignOrden)
                .filter(DesignOrden.tabla == TABLA_MATERIAL,
                        func.lower(DesignOrden.estado).in_([ESTADO_DR_AUT.lower(), ESTADO_CHANGES.lower()]),
                        DesignOrden.fecha >= TRASLADO_MATERIAL_DESDE, DesignOrden.fecha <= cerrado_hasta)
                .order_by(DesignOrden.fecha, DesignOrden.orden_visual, DesignOrden.id).all())
    # las copias de Removable Denture no se pasan solas: van el mismo día que su original (alinear_copias_rd, abajo)
    equipos_rd = {t.id for t in db.query(DesignTeam).join(DesignArea).filter(DesignArea.nombre == AREA_RD)}
    ordenes = [o for o in ordenes if o.team_id not in equipos_rd]
    ordenes.sort(key=lambda o: (o.fecha, o.orden_visual or 0, o.id))
    libres = festivos(db) if ordenes else set()
    miembros: dict[int, set[int]] = {}  # team_id -> diseñadores del equipo (para reconocer al prestado)
    if ordenes:
        equipos = {o.team_id for o in ordenes}
        for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id.in_(equipos)):
            miembros.setdefault(tid, set()).add(eid)
        for t in db.query(DesignTeam).filter(DesignTeam.id.in_(equipos)).options(joinedload(DesignTeam.area)):
            if t.manager_id:
                miembros.setdefault(t.id, set()).add(t.manager_id)
            if t.area.formato == FORMATO_SUPPORT:  # en Support el diseñador es el del caso, no un prestado
                miembros[t.id] = None
    for o in ordenes:
        # El prestado vale solo para el día en que se pidió: al pasar el caso al día siguiente vuelve sin diseñador
        # (pedido por Rosember el 9-oct-2026), así el prestado no sigue saliendo en Producción los días siguientes.
        propios = miembros.get(o.team_id, set())
        if propios is not None and ((o.designer_id and o.designer_id not in propios) or (o.designer_prestado or "").strip()):
            o.designer_id = None
            o.designer_prestado = ""
        destino = siguiente_dia_habil(o.fecha, libres)  # se saltan sábados, domingos y festivos de la empresa
        while destino <= cerrado_hasta:  # si nadie abrió el horario varios días, llega al primer día abierto
            destino = siguiente_dia_habil(destino, libres)
        max_visual = (db.query(func.max(DesignOrden.orden_visual))
                      .filter(DesignOrden.team_id == o.team_id, DesignOrden.fecha == destino,
                              DesignOrden.tabla == o.tabla).scalar())
        o.fecha = destino
        o.orden_visual = (max_visual or 0) + 1  # queda al final de las órdenes de ese día
        db.flush()
    db.commit()
    alinear_copias_rd(db)
    _traslado_hecho_hasta = cerrado_hasta
    return len(ordenes)


# ---------- Contador de casos asignados sin iniciar (número junto a "Design Schedule" en la barra) ----------
# Cuenta los casos de la persona en "Ready to design" o "Hold" en los días abiertos (los de días cerrados ya pasaron
# solos al día abierto). Initiated, Approved y los demás estados no cuentan (pedido por Rosember el 12-oct-2026).
ESTADOS_ASIGNADOS = (ESTADO_READY, ESTADO_HOLD, "Changes", "Dr authorization")  # Material Change (N6): como Ready y Hold


def mis_asignaciones(db: Session, user: Empleado) -> dict:
    trasladar_holds(db)
    desde = ultimo_dia_cerrado() + timedelta(days=1)
    estados = [e.lower() for e in ESTADOS_ASIGNADOS]
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.team))
         .filter(DesignOrden.fecha >= desde, func.lower(func.trim(DesignOrden.estado)).in_(estados), filtro_no_fantasma()))
    nombre = _normalizar_texto(user.nombre_completo)
    # el diseñador prestado se guarda por nombre: se reconoce comparando el nombre completo
    ordenes = [o for o in q.filter(or_(DesignOrden.designer_id == user.id, func.coalesce(DesignOrden.designer_prestado, "") != "")).all()
               if o.designer_id == user.id or (nombre and _normalizar_texto(o.designer_prestado) == nombre)]
    ordenes.sort(key=lambda o: (o.fecha, o.orden_visual or 0, o.id))
    lista = [{"id": o.id, "orden": o.orden, "paciente": o.paciente, "producto": o.producto, "estado": o.estado.strip(),
              "fecha": o.fecha.isoformat(), "teamId": o.team_id, "areaId": o.team.area_id if o.team else None,
              "equipo": o.team.nombre if o.team else ""} for o in ordenes]
    ready = sum(1 for x in lista if x["estado"].lower() in (ESTADO_READY.lower(), "changes"))
    return {"total": len(lista), "ready": ready, "hold": len(lista) - ready, "ordenes": lista, "yo": user.id}


# ---------- Seguimiento en tiempo real (Gestión › Seguimiento) ----------
# Qué está haciendo cada diseñador ahora, para saber quién está libre (pedido por Rosember el 12-oct-2026).
# Grupos, en este orden: libre (sin casos por hacer, fuera de break/almuerzo), pausa (en break o almuerzo según su
# Schedule), asignado (casos sin iniciar), ocupado (trabajando un caso) y ausente (ausencia registrada hoy).
SEG_TRABAJANDO = {"initiated", "re-initiated", "meeting", "practice", "training"}
SEG_POR_HACER = {"ready to design", "hold", "order entered", "pickup received", "bite ready", "change ready", "changes ready",
                 "dr authorization", "changes"}
# Hold (y "Dr authorization", que cuenta como Hold) va aparte de los casos asignados sin iniciar: el caso espera al doctor
# (pedido por Rosember el 13-oct-2026). Un diseñador cuyos pendientes son solo Hold sale en el grupo "hold".
SEG_HOLD = {"hold", "dr authorization"}
SEG_GRUPOS = ["libre", "pausa", "asignado", "hold", "ocupado", "ausente"]
SEG_MIN_ALMUERZO, SEG_MIN_BREAK = 60, 15   # si no tiene hora de fin


def _seg_hora(hhmm: str) -> int | None:
    try:
        h, m = str(hhmm or "").strip().split(":")[:2]
        return int(h) * 60 + int(m)
    except (ValueError, TypeError):
        return None


def seguimiento(db: Session, ahora: datetime | None = None, fin_jornada: str = "17:00") -> dict:
    from .models import Empleado as _E
    trasladar_holds(db)
    ahora = ahora or ahora_colombia()
    hoy, minuto = ahora.date(), ahora.hour * 60 + ahora.minute
    equipos = (db.query(DesignTeam).join(DesignArea).filter(DesignTeam.activo == 1, DesignArea.activo == 1,
                                                            DesignArea.formato != FORMATO_SUPPORT)
               .options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado)).all())
    # Support no sale en Seguimiento (Rosember, 21-oct-2026): ni sus equipos ni las dos personas de Support Time,
    # aunque trabajen casos de N3 como «Support Designer». Quien solo cubre un turno sí sale (es de su equipo).
    from . import services_design_support as _ss
    from . import services_design_geovictoria as _gv
    try:
        _gv_tol = _gv.config(db)["tolerancia"]
    except Exception:  # noqa: BLE001
        _gv_tol = _gv.TOLERANCIA
    _cfg = _ss.config(db)
    sin_support = {i for i in (_cfg.persona_a_id, _cfg.persona_b_id) if i} | {
        i for (i,) in db.query(DesignTeamDesigner.empleado_id).join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
        .join(DesignArea, DesignArea.id == DesignTeam.area_id).filter(DesignArea.formato == FORMATO_SUPPORT, DesignTeam.activo == 1)}
    personas: dict[int, dict] = {}
    for t in equipos:
        for d in t.designers:
            e = d.empleado
            if not e or not getattr(e, "activo", 1):
                continue
            x = personas.setdefault(e.id, {"id": e.id, "nombre": e.nombre_completo, "equipos": [], "teamIds": [], "areas": [], "manager": False})
            x["equipos"].append(t.nombre); x["teamIds"].append(t.id)
            if t.area.nombre not in x["areas"]:
                x["areas"].append(t.area.nombre)
    # Los managers también diseñan: cada equipo activo suma a su manager, aunque no esté en la lista de diseñadores
    # (pedido por Rosember el 12-oct-2026: faltaban managers como Luisa Ortiz).
    por_equipo = {t.id: t for t in equipos}
    mgr_ids = {t.manager_id for t in equipos if t.manager_id}
    mgrs = {e.id: e for e in db.query(_E).filter(_E.id.in_(mgr_ids))} if mgr_ids else {}
    for t in equipos:
        e = mgrs.get(t.manager_id)
        if not e or not getattr(e, "activo", 1):
            continue
        x = personas.setdefault(e.id, {"id": e.id, "nombre": e.nombre_completo, "equipos": [], "teamIds": [], "areas": [], "manager": False})
        x["manager"] = True
        if t.id not in x["teamIds"]:
            x["equipos"].append(t.nombre); x["teamIds"].append(t.id)
        if t.area.nombre not in x["areas"]:
            x["areas"].append(t.area.nombre)
    # Y quien tenga casos hoy en un equipo activo sin estar en él (p. ej. lo quitaron del equipo pero sigue con casos)
    sueltos = (db.query(DesignOrden.designer_id, DesignOrden.team_id)
               .filter(DesignOrden.fecha == hoy, DesignOrden.designer_id.isnot(None), DesignOrden.team_id.in_(list(por_equipo)))
               .distinct().all()) if por_equipo else []
    faltan = {did for did, _ in sueltos if did not in personas}
    for e in (db.query(_E).filter(_E.id.in_(faltan)).all() if faltan else []):
        if not getattr(e, "activo", 1):
            continue
        x = personas.setdefault(e.id, {"id": e.id, "nombre": e.nombre_completo, "equipos": [], "teamIds": [], "areas": [], "manager": False})
        for did, tid in sueltos:
            t = por_equipo.get(tid)
            if did == e.id and t and t.id not in x["teamIds"]:
                x["equipos"].append(t.nombre); x["teamIds"].append(t.id)
                if t.area.nombre not in x["areas"]:
                    x["areas"].append(t.area.nombre)
    for i in sin_support:
        personas.pop(i, None)
    ids = list(personas)
    ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.team))
               .filter(DesignOrden.fecha == hoy, DesignOrden.designer_id.in_(ids), filtro_no_fantasma()).all()) if ids else []
    pausas = db.query(DesignBreak).filter(DesignBreak.fecha == hoy, DesignBreak.empleado_id.in_(ids)).all() if ids else []
    permisos_people = _permisos_aprobados_del_dia(db, ids, hoy)
    horas_people = permisos_por_horas_del_dia(db, ids, hoy)
    por_persona: dict[int, list] = {}
    for o in ordenes:
        por_persona.setdefault(o.designer_id, []).append(o)
    # Managers y aprobadores salen solo si tienen casos hoy: "libre / sin casos" no aplica para ellos (12-oct-2026)
    # Quien está a cargo de un equipo hoy (Dejar a cargo) queda igual que un aprobador (Rosember, 28-oct-2026): no puede estar
    # disponible, así que sin casos propios no sale; con casos sale con lo que está haciendo.
    a_cargo = set(delegaciones_activas(db).values())
    roles = {e.id: e.rol for e in db.query(_E.id, _E.rol).filter(_E.id.in_(ids))} if ids else {}
    out = []
    for pid, x in personas.items():
        mias = sorted(por_persona.get(pid, []), key=lambda o: (o.orden_visual or 0, o.id))
        if not mias and (x["manager"] or pid in a_cargo or roles.get(pid) in ("aprobador", "admin", "superadmin")):
            continue
        est = lambda o: (o.estado or "").strip().lower()
        trabajando = [o for o in mias if est(o) in SEG_TRABAJANDO]
        por_hacer = [o for o in mias if est(o) in SEG_POR_HACER and est(o) not in SEG_HOLD]   # sin iniciar (sin Hold)
        en_hold = [o for o in mias if est(o) in SEG_HOLD]
        terminados = [o for o in mias if est(o) not in SEG_TRABAJANDO | SEG_POR_HACER | SEG_HOLD and (o.estado or "").strip()]
        fines = [h for h in ((o.hora_fin or "").strip() for o in terminados) if _seg_hora(h) is not None]
        x.update({"terminadosHoy": len(terminados), "ultimoFin": max(fines, key=_seg_hora) if fines else "",
                  "pendientes": {"ready": sum(1 for o in por_hacer if est(o) == "ready to design"),
                                 "hold": len(en_hold),
                                 "otros": sum(1 for o in por_hacer if est(o) != "ready to design")},
                  "porHacer": [{"orden": o.orden, "paciente": o.paciente, "producto": o.producto, "estado": (o.estado or "").strip()} for o in por_hacer[:6]],
                  "enHold": [{"orden": o.orden, "paciente": o.paciente, "producto": o.producto, "estado": (o.estado or "").strip()} for o in en_hold[:6]],
                  "actual": None, "pausa": None, "ausencia": ""})
        # ausencia y pausas (break / almuerzo) registradas en su Schedule hoy; y lo aprobado en People
        if permisos_people.get(pid):
            x["ausencia"] = permisos_people[pid]
        for p in horas_people.get(pid, []):
            i, f = _seg_hora(p["desde"]), _seg_hora(p["hasta"])
            if i is not None and (f is None or f > i) and i <= minuto < (f if f is not None else i + 60):
                x["pausa"] = {"tipo": "Permiso (" + p["tipo"] + ")", "desde": p["desde"], "hasta": p["hasta"]}
        for b in (b for b in pausas if b.empleado_id == pid):
            if (b.tipo_ausencia or "").strip():
                x["ausencia"] = b.tipo_ausencia.strip()
            for tipo, ini, fin, largo in (("Almuerzo", b.almuerzo_inicio, b.almuerzo_fin, SEG_MIN_ALMUERZO),
                                          ("Break", b.break1_inicio, b.break1_fin, SEG_MIN_BREAK),
                                          ("Break", b.break2_inicio, b.break2_fin, SEG_MIN_BREAK)):
                i = _seg_hora(ini)
                if i is None:
                    continue
                f = _seg_hora(fin)
                f = f if f is not None and f > i else i + largo
                if i <= minuto < f:
                    x["pausa"] = {"tipo": tipo, "desde": ini.strip(), "hasta": f"{f // 60:02d}:{f % 60:02d}"}
        if trabajando:
            o = trabajando[-1]
            desde = next((h for h in ((o.f_hold or "").strip(), (o.hora_inicio_diseno or "").strip(), (o.hora_inicio or "").strip()) if h), "")
            x["actual"] = {"orden": o.orden, "paciente": o.paciente, "producto": o.producto, "estado": (o.estado or "").strip(),
                           "desde": desde, "equipo": o.team.nombre if o.team else "", "otrosTrabajando": len(trabajando) - 1}
        # GeoVictoria (22-oct-2026): marcas de hoy (entrada, almuerzo, salida) y lo que falta marcar; solo desde memoria
        x["marcas"] = _gv.para_seguimiento(pid, ahora.replace(tzinfo=None), _gv_tol)
        if x["ausencia"] and not trabajando:
            x["grupo"] = "ausente"
        elif x["pausa"]:
            x["grupo"] = "pausa"
        elif trabajando:
            x["grupo"] = "ocupado"
        elif por_hacer:
            x["grupo"] = "asignado"
        elif en_hold:
            x["grupo"] = "hold"
        else:
            x["grupo"] = "libre"
        out.append(x)
    def clave(x):
        g = SEG_GRUPOS.index(x["grupo"])
        if x["grupo"] == "libre":   # primero el que lleva más tiempo libre (terminó antes o no ha tenido casos)
            return (g, _seg_hora(x["ultimoFin"]) if x["ultimoFin"] else -1, x["nombre"].lower())
        return (g, 0, x["nombre"].lower())
    out.sort(key=clave)
    resumen = {g: sum(1 for x in out if x["grupo"] == g) for g in SEG_GRUPOS}
    return {"fecha": hoy.isoformat(), "hora": ahora.strftime("%H:%M:%S"), "resumen": resumen, "disenadores": out,
            "areas": sorted({a for x in out for a in x["areas"]}),
            "equipos": seguimiento_equipos(db, fin_jornada, ahora, out), "finJornada": fin_jornada}


def areas_de_gestion(db: Session, user: Empleado) -> set[str] | None:
    """Áreas que `user` puede ver en Seguimiento (19-oct-2026): None = todas (admins); un aprobador, solo las áreas de los
    equipos que maneja (como manager o como diseñador a cargo hoy)."""
    if es_admin(user):
        return None
    cargo = {tid for tid, eid in delegaciones_activas(db).items() if eid == user.id}
    teams = db.query(DesignTeam).options(joinedload(DesignTeam.area)).filter(DesignTeam.activo == 1).all()
    return {t.area.nombre for t in teams if t.area and (t.manager_id == user.id or t.id in cargo)}


_SEG_CACHE = {"k": None, "t": 0.0, "v": None}
SEG_CACHE_S = 4   # segundos que se comparte el cálculo entre quienes tienen Seguimiento abierto


def seguimiento_compartido(db: Session, fin_jornada: str = "17:00") -> dict:
    """El cálculo de Seguimiento es el mismo para todos (después se recorta por área), así que se hace una vez cada
    SEG_CACHE_S segundos y se comparte: con 18 aprobadores mirándolo, cada uno recalculaba toda la plataforma (12 consultas
    y ~140 KB) con cada cambio (auditoría 19-oct-2026). Devuelve una copia superficial: quien la recorta no daña la compartida."""
    import time as _t
    c = _SEG_CACHE
    if c["v"] is None or c["k"] != fin_jornada or _t.monotonic() - c["t"] >= SEG_CACHE_S:
        c["v"], c["k"], c["t"] = seguimiento(db, fin_jornada=fin_jornada), fin_jornada, _t.monotonic()
    return dict(c["v"])


def seguimiento_visible(db: Session, user: Empleado, fin_jornada: str = "17:00") -> dict:
    """Seguimiento recortado a lo que `user` puede ver: los admins todo (con el filtro por área); un aprobador, solo los
    diseñadores y equipos de su área (Luisa Ortiz, de N3, no ve N2, Face ni N6)."""
    d = seguimiento_compartido(db, fin_jornada)
    areas = areas_de_gestion(db, user)
    d["alcance"] = "todas" if areas is None else "area"
    if areas is None:
        return d
    d["disenadores"] = [dict(x, areas=[a for a in x["areas"] if a in areas]) for x in d["disenadores"] if any(a in areas for a in x["areas"])]
    d["equipos"] = [e for e in d["equipos"] if e["area"] in areas]
    d["areas"] = sorted(areas)
    d["resumen"] = {g: sum(1 for x in d["disenadores"] if x["grupo"] == g) for g in SEG_GRUPOS}
    return d


# ---------- Seguimiento › Casos por equipo: ¿alcanza el equipo a cumplir su producción de hoy? ----------
# Por equipo: casos que programó el manager hoy, cómo van, diseñadores en turno y una estimación de si alcanzan
# antes del fin de la jornada. El tiempo de cada caso pendiente es el promedio real de su producto (últimos 30 días);
# la capacidad, los diseñadores en turno por los minutos que quedan hasta el fin de la jornada.
# (Cuando se conecte GeoVictoria, "en turno" y el fin de cada turno saldrán de las marcaciones.)
_promedios_cache = {"t": 0.0, "v": None}
SEG_MIN_POR_DEFECTO = 90   # producto sin historial ni promedio del área


def _promedios_producto(db: Session) -> dict:
    """{(area_id, producto normalizado): minutos promedio, (area_id, None): promedio del área}, últimos 30 días."""
    import time as _t
    c = _promedios_cache
    if c["v"] is not None and _t.monotonic() - c["t"] < 600:
        return c["v"]
    desde = ahora_colombia().date() - timedelta(days=30)
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area))
             .filter(DesignOrden.fecha >= desde, func.coalesce(DesignOrden.hora_fin, "") != "").all())
    suma: dict = {}
    for o in filas:
        if not o.team or _es_cancelada(o.estado):
            continue
        d = duracion_orden_min(o, o.team.area.formato)
        if not 5 <= d <= 600:   # descarta horas mal registradas
            continue
        for k in ((o.team.area_id, _normalizar_texto(o.producto)), (o.team.area_id, None)):
            a = suma.setdefault(k, [0.0, 0]); a[0] += d; a[1] += 1
    v = {k: a[0] / a[1] for k, a in suma.items() if a[1]}
    c["t"], c["v"] = _t.monotonic(), v
    return v


def seguimiento_equipos(db: Session, fin_jornada: str = "17:00", ahora: datetime | None = None, personas: list | None = None) -> list[dict]:
    ahora = ahora or ahora_colombia()
    hoy, minuto = ahora.date(), ahora.hour * 60 + ahora.minute
    fin = _seg_hora(fin_jornada)
    fin = fin if fin is not None else 17 * 60
    restante = max(0, fin - minuto)
    promedios = _promedios_producto(db)
    estado_de = {x["id"]: x for x in (personas or [])}   # lo que hace cada diseñador ahora (de seguimiento())
    equipos = (db.query(DesignTeam).join(DesignArea).filter(DesignTeam.activo == 1, DesignArea.activo == 1, DesignArea.formato != FORMATO_SUPPORT)
               .options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado))
               .order_by(DesignArea.orden, DesignTeam.orden, DesignTeam.nombre).all())
    ordenes = db.query(DesignOrden).filter(DesignOrden.fecha == hoy, DesignOrden.team_id.in_([t.id for t in equipos]),
                                           filtro_no_fantasma()).all() if equipos else []
    ausentes = {b.empleado_id for b in db.query(DesignBreak).filter(DesignBreak.fecha == hoy, func.coalesce(DesignBreak.tipo_ausencia, "") != "")}
    ausentes |= set(_permisos_aprobados_del_dia(db, [d.empleado_id for t in equipos for d in t.designers], hoy))   # y lo de People
    mgr = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_([t.manager_id for t in equipos if t.manager_id]))} if equipos else {}
    a_cargo = set(delegaciones_activas(db).values())   # quien está a cargo hoy no cuenta como diseñador en turno (28-oct-2026)
    con_casos_hoy = {o.designer_id for o in ordenes if o.designer_id}
    out = []
    for t in equipos:
        mias = [o for o in ordenes if o.team_id == t.id and ((o.orden or "").strip() or (o.producto or "").strip() or (o.paciente or "").strip())]
        mias = [o for o in mias if not _es_cancelada(o.estado)]
        est = lambda o: (o.estado or "").strip().lower()
        trabajando = [o for o in mias if est(o) in SEG_TRABAJANDO]
        hechos = [o for o in mias if est(o) and est(o) not in SEG_TRABAJANDO | SEG_POR_HACER]
        por_hacer = [o for o in mias if o not in trabajando and o not in hechos]
        holds = [o for o in por_hacer if est(o) in SEG_HOLD]   # se muestran aparte de "por hacer" (el tiempo estimado los sigue contando)
        sin_disenador = [o for o in mias if o not in hechos and not o.designer_id and not (o.designer_prestado or "").strip()]
        def estimado(o):
            return promedios.get((t.area_id, _normalizar_texto(o.producto))) or promedios.get((t.area_id, None)) or SEG_MIN_POR_DEFECTO
        pendiente_min = sum(estimado(o) for o in por_hacer)
        for o in trabajando:   # lo que le falta al caso en proceso (mínimo 15 min)
            ini = _seg_hora(next((h for h in ((o.f_hold or "").strip(), (o.hora_inicio_diseno or "").strip(), (o.hora_inicio or "").strip()) if h), ""))
            pendiente_min += max(15, estimado(o) - (minuto - ini if ini is not None and ini <= minuto else 0))
        propios = [d.empleado for d in t.designers if d.empleado and getattr(d.empleado, "activo", 1)]
        # el manager cuenta en su equipo cuando tiene casos propios hoy (también diseña)
        if t.manager_id and t.manager_id not in {e.id for e in propios} and any(o.designer_id == t.manager_id for o in mias):
            m_e = db.get(Empleado, t.manager_id)
            if m_e and getattr(m_e, "activo", 1):
                propios.append(m_e)
        en_turno = [e for e in propios if e.id not in ausentes and (e.id not in a_cargo or e.id in con_casos_hoy)]
        prestados = sorted({(o.designer_prestado or "").strip() for o in mias if (o.designer_prestado or "").strip()})
        de_otros = sorted({o.designer_id for o in mias if o.designer_id and o.designer_id not in {e.id for e in propios}})
        capacidad = (len(en_turno) + len(prestados) + len(de_otros)) * restante
        if not (por_hacer or trabajando):
            semaforo = "listo" if hechos else "sin_casos"
        elif not capacidad:
            semaforo = "no"
        elif pendiente_min <= capacidad * 0.85:
            semaforo = "si"
        elif pendiente_min <= capacidad:
            semaforo = "justo"
        else:
            semaforo = "no"
        def persona(e):
            x = estado_de.get(e.id) or {}
            return {"id": e.id, "nombre": e.nombre_completo, "grupo": x.get("grupo", "libre"), "manager": e.id == t.manager_id}
        out.append({"teamId": t.id, "equipo": t.nombre, "area": t.area.nombre, "manager": mgr.get(t.manager_id, ""),
                    "cirugias": sum(1 for o in mias if o.tabla == "principal"), "nightguards": sum(1 for o in mias if o.tabla == "nightguard"),
                    "material": sum(1 for o in mias if o.tabla == TABLA_MATERIAL),
                    "total": len(mias), "hechos": len(hechos), "enProceso": len(trabajando), "porHacer": len(por_hacer) - len(holds), "enHold": len(holds), "sinDisenador": len(sin_disenador),
                    "disenadores": len(propios), "enTurno": [persona(e) for e in en_turno],
                    "ausentes": [e.nombre_completo for e in propios if e.id in ausentes], "prestados": prestados,
                    "deOtrosEquipos": len(de_otros), "pendienteMin": round(pendiente_min), "capacidadMin": capacidad, "restanteMin": restante,
                    "casosPorDisenador": round((len(por_hacer) + len(trabajando)) / len(en_turno), 1) if en_turno else None,
                    "semaforo": semaforo})
    return out


def _designer_inhabilitado(o: DesignOrden) -> bool:
    """El diseñador de la orden ya no tiene acceso (p. ej. renunció): su nombre se conserva como registro."""
    if not o.designer_id:
        return False
    from sqlalchemy.orm import object_session
    from . import services_design_accesos as sacc
    db = object_session(o)
    return bool(db and o.designer_id in sacc.ids_inhabilitados(db))


def mover_a_training(db: Session, o: DesignOrden, user: Empleado) -> DesignTeam:
    """Pasa un caso de N3 › Cirugías al Schedule de Training (el manager lo hace con la opción "Training" del diseñador).
    Se mueve la misma orden (conserva horas, estado y notas); queda sin diseñador para que la entrenadora lo asigne."""
    team = db.get(DesignTeam, o.team_id)
    if not gestiona_equipo(user, team):
        raise PermissionError("Solo el manager del equipo o un administrador puede pasar casos a Training.")
    if not team.area or team.area.nombre != "N3 Prosthetic" or o.tabla != "principal":
        raise ValueError("Solo se pasan a Training los casos de N3 › Cirugías.")
    faltan = [n for n, v in (("el número de orden", o.orden), ("el nombre del paciente", o.paciente), ("el centro", o.centro)) if not (v or "").strip()]
    if faltan:
        raise ValueError("Falta " + ", ".join(faltan) + " para pasar el caso a Training.")
    from .services_design_permisos import dia_cerrado_para
    if dia_cerrado_para(db, user, o.fecha):
        raise PermissionError("Este día ya se cerró y no se puede editar.")
    destino = (db.query(DesignTeam).join(DesignArea, DesignTeam.area_id == DesignArea.id)
               .filter(DesignArea.nombre == AREA_TRAINING, DesignTeam.activo == 1).order_by(DesignTeam.orden, DesignTeam.id).first())
    if not destino:
        raise ValueError("Todavía no hay un equipo en el área Training.")
    ultimo = db.query(func.max(DesignOrden.orden_visual)).filter(DesignOrden.team_id == destino.id, DesignOrden.fecha == o.fecha).scalar() or 0
    o.origen_equipo = (team.manager.nombre_completo if team.manager else team.nombre)[:150]
    o.team_id, o.designer_id, o.designer_prestado, o.orden_visual = destino.id, None, "", ultimo + 1
    db.commit()
    return destino


def _pal_manager(t: str) -> set:
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", _normalizar_texto(t or "")).split() if len(w) > 1}


def manager_n2_de_centro(db: Session, centro: str) -> str:
    """Manager de N2 que dice Openings para ese centro ("" si no hay)."""
    k = _normalizar_texto(centro or "")
    for f in _openings_filas_cache(db):
        if k and _normalizar_texto(f.get("centro", "")) == k:
            return (f.get("manager_n2", "") or "").strip()
    return ""


def copiar_face_a_n2(db: Session, orden: DesignOrden, user: Empleado) -> dict | None:
    """Face (13-oct-2026): al marcar el QC de una orden de Face, su número de orden, paciente, centro y producto se copian
    en una orden nueva del equipo de N2 cuyo manager es el que dice Openings para ese centro. La copia queda en el día en
    que se marca el QC (hoy), sea cual sea el día de la orden en Face (pedido por Rosember el 14-oct-2026; antes solo
    copiaba las órdenes de mañana). No se copia dos veces (si ya existe esa orden en ese equipo y día, solo avisa).
    Devuelve None si no aplica; si no se pudo, {ok: False, motivo}."""
    if not orden.team or not orden.team.area or orden.team.area.nombre != "Face Design":
        return None
    if es_producto_fantasma(orden.producto):   # producto «Training»: es de práctica, no pasa a N2
        return None
    dia = ahora_colombia().date()
    if orden.fecha != dia:
        # 21-oct-2026 (Rosember): solo la hoja de hoy pasa a N2. Al llenar o corregir semanas viejas de Face no se crean
        # casos nuevos en N2 (antes cualquier QC marcado copiaba el caso al día de hoy).
        return None
    numero = (orden.orden or "").strip().upper()
    if not numero or not (orden.centro or "").strip():
        return {"ok": False, "motivo": "La orden no tiene número o centro: no se copió a N2."}
    mgr = manager_n2_de_centro(db, orden.centro)
    if not mgr:
        return {"ok": False, "motivo": f"Openings no tiene manager de N2 para {orden.centro}: no se copió a N2."}
    p = _pal_manager(mgr)
    equipos = [t for t in db.query(DesignTeam).join(DesignArea, DesignTeam.area_id == DesignArea.id)
               .filter(DesignArea.nombre == "N2 Demodenture", DesignTeam.activo == 1).all()
               if t.manager and p and p <= _pal_manager(t.manager.nombre_completo)]
    if len(equipos) != 1:
        motivo = "no hay un equipo de N2 para" if not equipos else "hay más de un equipo de N2 para"
        return {"ok": False, "motivo": f"{motivo} {mgr}: no se copió a N2."}
    equipo = equipos[0]
    from .models_design import DesignCopiaFace
    ya = (db.query(DesignOrden).filter(DesignOrden.team_id == equipo.id, DesignOrden.fecha == dia,
                                       func.upper(func.trim(DesignOrden.orden)) == numero).first())
    if ya:
        reg = db.get(DesignCopiaFace, ya.id)
        if reg and reg.estado in ("pendiente", "borrada") and reg.face_orden_id == orden.id:
            reg.estado, reg.desmarcada_en = "activa", None   # volvieron a marcar el QC en Face: se conserva
            db.commit()
        return {"ok": True, "ya": True, "equipo": equipo.nombre, "manager": mgr, "equipoId": equipo.id}
    nueva = crear_orden(db, user, equipo.id, dia, "principal",
                        {"orden": numero, "paciente": orden.paciente or "", "centro": orden.centro.strip(),
                         "producto": (orden.producto or "").strip()})
    db.add(DesignCopiaFace(n2_orden_id=nueva.id, face_orden_id=orden.id, estado="activa", face_equipo=orden.team.nombre))
    db.commit()
    return {"ok": True, "ya": False, "equipo": equipo.nombre, "manager": mgr, "equipoId": equipo.id, "n2OrdenId": nueva.id}


_face_n2_viejas = {"ok": False}


def face_n2_viejas_una_vez(db: Session) -> int:
    """Una vez (21-oct-2026, Rosember): quita de N2 las copias del 21-oct que llegaron desde hojas viejas de Face (antes
    de la regla «solo la hoja de hoy»), si N2 no las ha empezado: siguen en Ready to design (o sin estado) y sin horas.
    Las que N2 ya trabajó se quedan. Devuelve cuántas quitó."""
    from .models_design import DesignConexionRegla, DesignCopiaFace
    if _face_n2_viejas["ok"]:
        return 0
    _face_n2_viejas["ok"] = True
    marca, dia = "face_n2_hojas_viejas_2026_10_21", date(2026, 10, 21)
    try:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            return 0
        Face = aliased(DesignOrden)
        filas = (db.query(DesignCopiaFace, DesignOrden).join(DesignOrden, DesignOrden.id == DesignCopiaFace.n2_orden_id)
                 .join(Face, Face.id == DesignCopiaFace.face_orden_id)
                 .filter(DesignOrden.fecha == dia, Face.fecha < dia).all())
        quitadas = 0
        for reg, o in filas:
            sin_empezar = (_normalizar_texto(o.estado or "") in ("", _normalizar_texto(ESTADO_READY))
                           and not any((getattr(o, c) or "").strip() for c in ("hora_inicio", "s_hold", "hora_fin")))
            if sin_empezar:
                db.delete(o)
                db.delete(reg)
                quitadas += 1
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, valor=str(quitadas), creado_por="Sistema"))
        db.commit()
        log.info("Face → N2: se quitaron %s copias de hojas viejas de Face", quitadas)
        return quitadas
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("Face → N2: no se pudieron quitar las copias de hojas viejas")
        return 0


def copia_face_desmarcada(db: Session, orden: DesignOrden) -> int:
    """Se desmarcó el QC en Face: las copias en N2 de esa orden quedan pendientes (no se borran solas). Aunque el
    manager de N2 ya la hubiera mantenido, se vuelve a preguntar."""
    from .models_design import DesignCopiaFace
    regs = db.query(DesignCopiaFace).filter(DesignCopiaFace.face_orden_id == orden.id,
                                            DesignCopiaFace.estado.in_(("activa", "pendiente", "mantenida"))).all()
    for r in regs:
        r.estado, r.desmarcada_en = "pendiente", datetime.utcnow()
    if regs:
        db.commit()
    return len(regs)


def copias_pendientes_dia(db: Session, team: DesignTeam, fecha: date) -> list[dict]:
    """Órdenes de N2 de este equipo y día cuyo QC en Face se desmarcó: esperan la decisión del manager de N2."""
    from .models_design import DesignCopiaFace
    filas = (db.query(DesignCopiaFace, DesignOrden)
             .join(DesignOrden, DesignOrden.id == DesignCopiaFace.n2_orden_id)
             .filter(DesignCopiaFace.estado == "pendiente", DesignOrden.team_id == team.id, DesignOrden.fecha == fecha).all())
    return [{"ordenId": o.id, "orden": o.orden, "paciente": o.paciente, "centro": o.centro, "producto": o.producto,
             "faceEquipo": r.face_equipo,
             "desmarcadaEn": (r.desmarcada_en.isoformat() + "Z") if r.desmarcada_en else ""} for r, o in filas]


def decidir_copia_face(db: Session, n2_orden_id: int, accion: str, user: Empleado) -> dict:
    """El manager de N2 decide: "borrar" quita la orden de N2; "mantener" la conserva."""
    from .models_design import DesignCopiaFace
    reg = db.get(DesignCopiaFace, n2_orden_id)
    if not reg or reg.estado != "pendiente":
        raise ValueError("Esa orden no está esperando decisión.")
    if accion not in ("borrar", "mantener"):
        raise ValueError("Acción inválida.")
    if accion == "borrar":
        eliminar_orden(db, n2_orden_id)
        reg.estado = "borrada"
    else:
        reg.estado = "mantenida"
    reg.decidida_por = user.nombre_completo[:150]
    db.commit()
    return {"ok": True, "accion": accion}


def equipos_dash_ids(db: Session, user: Empleado) -> set[int]:
    """Equipos que ve el Dashboard de esta persona: los que maneja y el que tiene a cargo hoy (13-oct-2026: quien
    está a cargo ve el Dashboard como si fuera el aprobador)."""
    ids = {tid for (tid,) in db.query(DesignTeam.id).filter(DesignTeam.manager_id == user.id).all()}
    ids |= {tid for tid, eid in delegaciones_activas(db).items() if eid == user.id}
    return ids


def es_gestor_efectivo(db: Session, user: Empleado) -> bool:
    """Aprobadores, admins y quien está a cargo hoy ven el Dashboard y las pantallas de aprobador."""
    return user.rol in ("aprobador", "admin", "superadmin") or any(eid == user.id for eid in delegaciones_activas(db).values())


def serializar_orden(o: DesignOrden) -> dict:
    return {
        "id": o.id, "tabla": o.tabla, "orden": o.orden, "paciente": o.paciente,
        "centro": o.centro, "producto": o.producto,
        "designerId": o.designer_id, "designerNombre": o.designer.nombre_completo if o.designer else "", "arco": o.arco or "",
        "designerCorto": nombre_corto(o.designer),
        "designerPrestado": o.designer_prestado, "designerInhabilitado": _designer_inhabilitado(o),
        "horaInicio": o.hora_inicio, "horaInicioDiseno": o.hora_inicio_diseno, "horaFin": o.hora_fin,
        "holdMinutos": o.hold_minutos, "esferas": o.esferas, "critico": o.critico,
        "sHold": o.s_hold, "fHold": o.f_hold,
        "etapa": o.etapa, "solicitadoPor": o.solicitado_por, "situacion": o.situacion,
        "solucion": o.solucion, "clasificacion": o.clasificacion, "soporte": o.soporte,
        "estado": o.estado, "qc": o.qc, "qcReporte": o.qc_reporte, "notas": o.notas,
        "artStart": o.art_start or "", "artRtd": o.art_rtd or "", "origenEquipo": o.origen_equipo or "",
        "zHoraInicio": o.z_hora_inicio or "", "zSHold": o.z_s_hold or "", "zFHold": o.z_f_hold or "",
        "zHoldMinutos": o.z_hold_minutos or 0, "zHoraFin": o.z_hora_fin or "", "zQc": bool(o.z_qc),
        "zQcReporte": o.z_qc_reporte or "",
        "ordenVisual": o.orden_visual,
        # días que lleva desde que se creó (para el Total de un caso que pasó varias noches en Hold: dsMenosHold)
        "diasDesdeCreada": (o.fecha - o.fecha_creada).days if (o.fecha_creada and o.fecha) else 0,
    }


def serializar_break(b: DesignBreak) -> dict:
    return {
        "id": b.id, "empleadoId": b.empleado_id, "tipoAusencia": b.tipo_ausencia,
        "almuerzoInicio": b.almuerzo_inicio, "almuerzoFin": b.almuerzo_fin,
        "break1Inicio": b.break1_inicio, "break1Fin": b.break1_fin,
        "break2Inicio": b.break2_inicio, "break2Fin": b.break2_fin,
    }


def datos_dia(db: Session, team: DesignTeam, fecha: date, solo_empleado_id: int | None = None) -> dict:
    face_convertir_una_vez(db)
    """Horario del equipo en `fecha`. Con `solo_empleado_id` (vista de un diseñador) solo van sus órdenes
    y sus tiempos libres."""
    trasladar_holds(db)
    if team.area.nombre == AREA_RD:
        rd_copias_una_vez(db)
    if team.area.nombre == "N2 Demodenture":
        face_n2_viejas_una_vez(db)
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
         .filter(DesignOrden.team_id == team.id, DesignOrden.fecha == fecha))
    qb = db.query(DesignBreak).filter(DesignBreak.team_id == team.id, DesignBreak.fecha == fecha)
    qd = (db.query(DesignTeamDesigner).options(joinedload(DesignTeamDesigner.empleado))
          .filter(DesignTeamDesigner.team_id == team.id))
    if solo_empleado_id is not None:
        q = q.filter(DesignOrden.designer_id == solo_empleado_id)
        qb = qb.filter(DesignBreak.empleado_id == solo_empleado_id)
        qd = qd.filter(DesignTeamDesigner.empleado_id == solo_empleado_id)
    ordenes = q.order_by(DesignOrden.orden_visual, DesignOrden.id).all()
    if es_face_nuevo(team.area.formato, fecha):
        # Formato nuevo: si una hora quedó en el campo viejo (página abierta desde antes del cambio), pasa a Inicio diseño
        sueltas = [o for o in ordenes if o.tabla == "principal" and not (o.hora_inicio or "").strip()
                   and (o.hora_inicio_diseno or "").strip()]
        for o in sueltas:
            o.hora_inicio, o.hora_inicio_diseno = o.hora_inicio_diseno, ""
        if sueltas:
            db.commit()
    breaks = qb.all()
    principal = [serializar_orden(o) for o in ordenes if o.tabla == "principal"]
    if team.area.nombre in (AREA_N3, AREA_N6) and principal:   # «Bite Finish» para las que tienen copia en Removable Denture
        rdb = estado_bite_rd(db, [p["id"] for p in principal])
        for p in principal:
            if p["id"] in rdb:
                p["rdBite"] = rdb[p["id"]]
    nightguard = [serializar_orden(o) for o in ordenes if o.tabla == "nightguard"]
    material = [serializar_orden(o) for o in ordenes if o.tabla == TABLA_MATERIAL]
    es_rd = team.area.nombre == AREA_RD
    if es_rd:   # Removable Denture: sus copias, con el equipo y el manager de donde viene cada una
        principal, nightguard = [], []
        info = copias_rd_info(db, [m["id"] for m in material])
        material = [{**m, "equipo": info.get(m["id"], ("",))[0] or m.get("origenEquipo", ""),
                     "manager": info.get(m["id"], ("", ""))[1], "teamOrigen": info.get(m["id"], ("", "", None))[2]} for m in material]
    # Diseñadores con su empleado en una sola consulta (team.designers haría una consulta por diseñador).
    designers = qd.order_by(DesignTeamDesigner.orden).all()

    permisos = _permisos_aprobados_del_dia(db, [d.empleado_id for d in designers], fecha)
    por_horas = permisos_por_horas_del_dia(db, [d.empleado_id for d in designers], fecha)
    breaks_out = []
    vistos = set()
    for b in breaks:
        data = serializar_break(b)
        if not data["tipoAusencia"] and permisos.get(b.empleado_id):
            data["tipoAusencia"] = permisos[b.empleado_id]
            data["ausenciaAutomatica"] = True
        breaks_out.append(data)
        vistos.add(b.empleado_id)
    for empleado_id, ausencia in permisos.items():
        if empleado_id in vistos:
            continue
        breaks_out.append({
            "id": None, "empleadoId": empleado_id, "tipoAusencia": ausencia,
            "almuerzoInicio": "", "almuerzoFin": "", "break1Inicio": "", "break1Fin": "",
            "break2Inicio": "", "break2Fin": "", "ausenciaAutomatica": True,
        })
        vistos.add(empleado_id)
    for empleado_id, lista in por_horas.items():   # permisos por horas aprobados en People: aviso en la tarjeta
        b = next((x for x in breaks_out if x["empleadoId"] == empleado_id), None)
        if b is None:
            b = {"id": None, "empleadoId": empleado_id, "tipoAusencia": "", "almuerzoInicio": "", "almuerzoFin": "",
                 "break1Inicio": "", "break1Fin": "", "break2Inicio": "", "break2Fin": ""}
            breaks_out.append(b)
        b["permisosHoras"] = lista

    salida = {
        "principal": principal, "nightguard": nightguard, "material": material,
        "breaks": breaks_out,
        # un diseñador cuyo empleado ya no existe se omite (antes hacía fallar la carga del día de su equipo)
        "designers": [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo, "corto": nombre_corto(d.empleado)}
                      for d in designers if d.empleado],
        "cerrado": dia_cerrado(fecha), "qcEditable": qc_editable(fecha),
        "qcEditableHasta": qc_editable_hasta(fecha).isoformat(),
        "soloPropias": solo_empleado_id is not None,
        "prestadas": [],
    }
    # ⚠️ ORIGEN DE DATOS DE DESIGN — validar con Rosember antes de cambiar (ver app/services_design_origenes.py y CLAUDE.md).
    salida["centros"] = centros_de_equipo(db, team)  # desplegable Centro: los centros de Openings de su manager
    # El manager a veces diseña casos: va al final de la columna Diseñador (no en Tiempos libres, que usa "designers").
    salida["manager"] = _manager_elegible(team, {d.empleado_id for d in designers}) if solo_empleado_id is None else None
    if team.area.formato == FORMATO_SUPPORT:
        # En Support el 'Diseñador' es el del caso: se elige entre todos los diseñadores de Design (y al final los managers).
        salida["designersCaso"] = disenadores_de_todos_los_equipos(db) + managers_de_todos_los_equipos(db)
    if solo_empleado_id is not None:
        salida["prestadas"] = [o for o in ordenes_prestadas(db, solo_empleado_id, fecha) if o["teamId"] != team.id]
    elif team.area.formato != FORMATO_SUPPORT:
        salida["prestadosEquipo"], salida["prestadosTipo"] = prestados_por_disenador(db, [d.empleado_id for d in designers], fecha,
                                                                                     por_tipo=True)
    return salida


# Productos de la tabla Nightguards / TC que cuentan como Tc aunque su nombre no diga «TC» (Rosember, 22-oct-2026).
# Se comparan sin mayúsculas, tildes ni espacios de más. Igual que DS_PRODUCTOS_TC en static/design/schedule.js.
PRODUCTOS_TC = ["N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"]


def tipo_produccion(tabla: str, producto: str) -> str:
    """Producción del día por tipo: «sx» la tabla principal (Cirugías en N3, Dummy en N6), «mc» Material Change (N6;
    21-oct-2026), «tc» los TC y «ng» los Nightguards (la tabla Nightguards / TC). Igual que dsTipoProduccion en
    static/design/schedule.js. N3 muestra Sx · Tc · Ng; N6, Mc · D · Ng · Tc."""
    if tabla == TABLA_MATERIAL:
        return "mc"
    if tabla != "nightguard":
        return "sx"
    p = re.sub(r"\s+", " ", _normalizar_texto(producto or "")).strip()
    if re.search(r"\btc\b", p) or p in {re.sub(r"\s+", " ", _normalizar_texto(x)).strip() for x in PRODUCTOS_TC}:
        return "tc"
    return "ng"


def prestados_por_disenador(db: Session, ids: list[int], fecha: date, por_tipo: bool = False):
    """Casos del día que cada diseñador hizo prestado en equipos a los que no pertenece (sin canceladas): cuentan en su
    producción (Rosember, 19-oct-2026). {empleado_id: casos}; con por_tipo, además {empleado_id: {sx, tc, ng}}.
    Lo usa la ventana «Producción del día» del manager."""
    if not ids:
        return ({}, {}) if por_tipo else {}
    miembro = {}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.empleado_id.in_(ids)):
        miembro.setdefault(eid, set()).add(tid)
    support = {i for (i,) in _equipos_support_ids(db).all()}
    out: dict = {}
    tipos: dict = {}
    for eid, tid, estado, tabla, producto in (db.query(DesignOrden.designer_id, DesignOrden.team_id, DesignOrden.estado,
                                                       DesignOrden.tabla, DesignOrden.producto)
                                              .filter(DesignOrden.designer_id.in_(ids), DesignOrden.fecha == fecha, filtro_no_fantasma(),
                                                      DesignOrden.tabla.in_(["principal", "nightguard", TABLA_MATERIAL]))):
        if tid in miembro.get(eid, set()) or tid in support or _es_cancelada(estado):
            continue
        out[eid] = out.get(eid, 0) + 1
        t = tipos.setdefault(eid, {"sx": 0, "tc": 0, "ng": 0, "mc": 0})
        t[tipo_produccion(tabla, producto)] += 1
    return (out, tipos) if por_tipo else out


def _manager_elegible(team: DesignTeam, ya: set) -> dict | None:
    m = team.manager
    if not m or not m.activo or m.id in ya:
        return None
    return {"id": m.id, "nombre": m.nombre_completo, "corto": nombre_corto(m), "esManager": True}


def managers_de_todos_los_equipos(db: Session) -> list[dict]:
    """Managers de equipos activos que no son también diseñadores (para el final de la lista de Support)."""
    disenadores = {i for (i,) in db.query(DesignTeamDesigner.empleado_id).join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
                   .filter(DesignTeam.activo == 1)}
    filas = (db.query(Empleado.id, Empleado.nombres, Empleado.apellidos).join(DesignTeam, DesignTeam.manager_id == Empleado.id)
             .filter(DesignTeam.activo == 1, Empleado.activo == 1).distinct().all())
    out = [{"id": i, "nombre": f"{n or ''} {a or ''}".strip(), "corto": nombre_corto(type("E", (), {"nombres": n, "apellidos": a})),
            "esManager": True} for i, n, a in filas if i not in disenadores]
    return sorted(out, key=lambda d: d["nombre"].lower())


def disenadores_de_todos_los_equipos(db: Session) -> list[dict]:
    filas = (db.query(Empleado.id, Empleado.nombres, Empleado.apellidos)
             .join(DesignTeamDesigner, DesignTeamDesigner.empleado_id == Empleado.id)
             .join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
             .filter(DesignTeam.activo == 1, Empleado.activo == 1).distinct().all())
    out = [{"id": i, "nombre": f"{n or ''} {a or ''}".strip(), "corto": nombre_corto(type("E", (), {"nombres": n, "apellidos": a}))}
           for i, n, a in filas]
    return sorted(out, key=lambda d: d["nombre"].lower())


def _equipos_support_ids(db: Session):
    return (db.query(DesignTeam.id).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter(DesignArea.formato == FORMATO_SUPPORT))


def es_orden_prestada_a(db: Session, o: DesignOrden, user: Empleado) -> bool:
    """La orden es de otro equipo pero está asignada a `user` como diseñador prestado. No aplica a Support,
    donde la columna Diseñador es la del caso y no quien lo atiende."""
    return (o.designer_id == user.id and o.team.area.formato != FORMATO_SUPPORT
            and o.team_id not in equipos_como_designer(db, user) and o.team.manager_id != user.id)


def ordenes_prestadas(db: Session, empleado_id: int, fecha: date) -> list[dict]:
    """Órdenes del día asignadas a esta persona en equipos a los que no pertenece (la pidieron prestada)."""
    propios = db.query(DesignTeamDesigner.team_id).filter(DesignTeamDesigner.empleado_id == empleado_id)
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.designer),
                                           joinedload(DesignOrden.team).joinedload(DesignTeam.area))
             .filter(DesignOrden.designer_id == empleado_id, DesignOrden.fecha == fecha,
                     DesignOrden.team_id.notin_(propios), DesignOrden.team_id.notin_(_equipos_support_ids(db)))
             .order_by(DesignOrden.team_id, DesignOrden.orden_visual, DesignOrden.id).all())
    return [{**serializar_orden(o), "equipo": o.team.nombre, "teamId": o.team_id,
             "area": o.team.area.nombre, "formato": o.team.area.formato} for o in filas]


def resumen_todas_areas(db: Session, user: Empleado, fecha: date) -> list[dict]:
    """Vista "todas las áreas": áreas, equipos visibles para `user` y sus órdenes del día, en 3 consultas
    (antes: 1 petición por área + 1 por equipo desde el navegador)."""
    trasladar_holds(db)
    areas = areas_disponibles(db)
    teams = (db.query(DesignTeam)
             .filter(DesignTeam.area_id.in_([a.id for a in areas]), DesignTeam.activo == 1)
             .order_by(DesignTeam.orden).all())
    ids_designer = equipos_como_designer(db, user)
    teams = [t for t in teams if puede_ver_equipo(user, t, ids_designer)]
    gestionados = {t.id for t in teams if gestiona_equipo(user, t)}
    ordenes = []
    if teams:
        ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
                   .filter(DesignOrden.team_id.in_([t.id for t in teams]), DesignOrden.fecha == fecha,
                           DesignOrden.tabla.in_(["principal", "nightguard", TABLA_MATERIAL]), filtro_orden_completa())
                   .order_by(DesignOrden.orden_visual, DesignOrden.id).all())
        # En los equipos donde solo es diseñador, únicamente sus órdenes.
        abiertos = {t.id for t in teams if es_training(t)}   # Training: todos ven todos sus casos
        ordenes = [o for o in ordenes if o.team_id in gestionados or o.team_id in abiertos or o.designer_id == user.id]
    por_team: dict[int, list[DesignOrden]] = {}
    for o in ordenes:
        por_team.setdefault(o.team_id, []).append(o)

    def ordenes_de(team_id: int) -> list[dict]:
        # Mismo orden que la vista de equipo: Material Change (N6), Cirugías y Nightguards.
        lista = por_team.get(team_id, [])
        return ([serializar_orden(o) for o in lista if o.tabla == TABLA_MATERIAL] +
                [serializar_orden(o) for o in lista if o.tabla == "principal"] +
                [serializar_orden(o) for o in lista if o.tabla == "nightguard"])

    return [{"id": a.id, "nombre": a.nombre, "formato": a.formato,
             "teams": [{"id": t.id, "nombre": t.nombre, "ordenes": ordenes_de(t.id)}
                       for t in teams if t.area_id == a.id]}
            for a in areas]


def version_todas_areas(db: Session, fecha: date) -> str:
    """Huella corta de la vista "todas las áreas" en `fecha` (órdenes del día y equipos). La pantalla la pide cada
    5 s y solo vuelve a pedir todos los datos si cambió (antes los pedía completos cada 5 s)."""
    import hashlib
    partes = [tuple(x) for x in (db.query(DesignOrden.id, DesignOrden.team_id, DesignOrden.tabla, DesignOrden.orden_visual,
                                          DesignOrden.actualizado_en, DesignOrden.designer_id)
                                 .filter(DesignOrden.fecha == fecha, DesignOrden.tabla.in_(["principal", "nightguard", TABLA_MATERIAL]))
                                 .order_by(DesignOrden.id).all())]
    partes += [tuple(x) for x in db.query(DesignTeam.id, DesignTeam.nombre, DesignTeam.activo, DesignTeam.area_id, DesignTeam.orden)
               .order_by(DesignTeam.id).all()]
    return hashlib.md5(repr(partes).encode()).hexdigest()[:16]


def crear_orden(db: Session, user: Empleado, team_id: int, fecha: date, tabla: str, datos: dict, guardar: bool = True) -> DesignOrden:
    """`guardar=False`: solo agrega a la sesión (el lote guarda todo junto al final, M9)."""
    max_visual = (db.query(DesignOrden.orden_visual)
                 .filter(DesignOrden.team_id == team_id, DesignOrden.fecha == fecha, DesignOrden.tabla == tabla)
                 .order_by(DesignOrden.orden_visual.desc()).first())
    siguiente_visual = (max_visual[0] + 1) if max_visual else 1
    o = DesignOrden(team_id=team_id, fecha=fecha, tabla=tabla, creado_por_id=user.id, orden_visual=siguiente_visual,
                    fecha_creada=fecha)
    for campo in CAMPOS_ORDEN:
        if campo in datos:
            setattr(o, campo, datos[campo])
    if tabla == TABLA_MATERIAL and not (o.etapa or "").strip():
        o.etapa = ETAPA_BITE  # Material Change empieza en Bite design
    db.add(o)
    if not guardar:
        db.flush()   # la siguiente orden del lote ve esta en su número de orden visual
        return o
    db.commit()
    db.refresh(o)
    return o


def actualizar_orden(db: Session, orden_id: int, datos: dict) -> DesignOrden | None:
    o = db.get(DesignOrden, orden_id)
    if not o:
        return None
    for campo in CAMPOS_ORDEN:
        if campo in datos:
            setattr(o, campo, datos[campo])
    db.commit()
    db.refresh(o)
    return o


def eliminar_orden(db: Session, orden_id: int) -> bool:
    o = db.get(DesignOrden, orden_id)
    if not o:
        return False
    db.delete(o)
    db.commit()
    return True


def guardar_break(db: Session, team_id: int, empleado_id: int, fecha: date, datos: dict) -> DesignBreak:
    b = (db.query(DesignBreak)
        .filter(DesignBreak.team_id == team_id, DesignBreak.empleado_id == empleado_id,
                DesignBreak.fecha == fecha).first())
    if not b:
        b = DesignBreak(team_id=team_id, empleado_id=empleado_id, fecha=fecha)
        db.add(b)
    for campo in ("tipo_ausencia", "almuerzo_inicio", "almuerzo_fin",
                  "break1_inicio", "break1_fin", "break2_inicio", "break2_fin"):
        if campo in datos:
            setattr(b, campo, datos[campo])
    db.commit()
    db.refresh(b)
    return b


def puede_qc(user: Empleado, team: DesignTeam) -> bool:
    """Marcar o desmarcar el QC: aprobadores y admins, y el diseñador que está a cargo del equipo (5-oct-2026)."""
    if user.rol in ("aprobador", "admin", "superadmin"):
        return True
    from sqlalchemy.orm import object_session
    db = object_session(team)
    return bool(db) and delegaciones_activas(db).get(team.id) == user.id


def version_preapproved(db: Session, sheet_id: int) -> str | None:
    """Huella de una hoja de Pre-Approved (y de la lista de hojas de su área) para verla en vivo."""
    import hashlib
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return None
    hojas = [(h.id, h.nombre, h.orden) for h in preapproved_sheets(db, s.area_id)]
    return hashlib.md5(json.dumps([preapproved_detalle(db, sheet_id), hojas], sort_keys=True, default=str).encode()).hexdigest()[:16]


def preapproved_de_centro(db: Session, area_id: int, centro: str, areas_permitidas: set[int] | None,
                          team_id: int | None = None) -> list[dict]:
    """Doctores de Pre-Approved del `centro` del Schedule (para la ventana flotante del Schedule). Busca en las hojas
    del área y de su área vinculada (N6 → N3, Face → N2). Cada encabezado de centro agrupa los `span` doctores que
    le siguen, como en la pantalla de Pre-Approved. Coincide el nombre sin tildes ni mayúsculas (o uno contiene al otro)."""
    area = db.get(DesignArea, area_id)
    if not area or not (centro or "").strip():
        return []
    nombres = {area.nombre}
    if area.nombre in PA_AREAS_VINCULADAS:
        nombres.add(PA_AREAS_VINCULADAS[area.nombre])
    ids_area = [a.id for a in db.query(DesignArea).all() if a.nombre in nombres
                and (areas_permitidas is None or a.id in areas_permitidas)]
    hojas = (db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id.in_(ids_area or [-1]))
             .order_by(DesignPreApprovedSheet.area_id != area_id, DesignPreApprovedSheet.orden, DesignPreApprovedSheet.id).all())
    q = _normalizar_texto(centro)
    exactos, parciales = [], []
    for h in hojas:
        docs, i = h.doctores, 0
        for c in h.centros:
            span = max(1, c.span or 1)
            grupo = docs[i:i + span]
            i += span
            n = _normalizar_texto(c.nombre)
            if not grupo or not n:
                continue
            if n == q or (len(q) >= 4 and (q in n or n in q)):
                (exactos if n == q else parciales).append((h, c, grupo))
    # Primero la hoja del equipo de la orden (misma conexión que preapproved_hoja_de: a mano o nombre = manager)
    team = db.get(DesignTeam, team_id) if team_id else None
    reglas = reglas_conexion(db)["pa_manager"] if team else {}
    pm = _palabras(team.manager.nombre_completo) if team and team.manager else set()
    def del_equipo(h):
        if not team:
            return False
        if reglas.get(h.id) == team.id:
            return True
        pal = _palabras(_sin_prefijo_area(h.nombre))
        return bool(pm and pal and pal <= pm)
    out = []
    # Un centro repetido en varios grupos de la misma hoja se muestra junto (una tabla por hoja)
    por_hoja: dict[int, list] = {}
    for h, c, grupo in exactos or parciales:
        if h.id in por_hoja:
            por_hoja[h.id][2] = por_hoja[h.id][2] + [d for d in grupo if d not in por_hoja[h.id][2]]
        else:
            por_hoja[h.id] = [h, c, list(grupo)]
    for h, c, grupo in sorted(por_hoja.values(), key=lambda x: not del_equipo(x[0])):
        ids = [d.id for d in grupo]
        valores: dict[int, dict[int, str]] = {}
        for ce in (db.query(DesignPreApprovedCelda).join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
                   .filter(DesignPreApprovedFila.sheet_id == h.id, DesignPreApprovedCelda.doctor_id.in_(ids))):
            valores.setdefault(ce.fila_id, {})[ce.doctor_id] = ce.valor or ""
        fotos = preapproved_fotos_de(db, h.filas, ids)
        out.append({"sheetId": h.id, "hoja": h.nombre, "titulo": h.titulo, "changesLabel": h.changes_label, "delEquipo": del_equipo(h),
                    "centro": c.nombre, "doctores": [d.nombre for d in grupo],
                    "filas": [{"criterio": f.criterio, "valores": [valores.get(f.id, {}).get(d, "") for d in ids],
                               "fotos": [[x["id"] for x in fotos.get(f"{f.id}-{d}", [])] for d in ids]} for f in h.filas]})
    return out


# ---------- Schedule en vivo: huella del día para saber si alguien cambió algo ----------

def version_dia(db: Session, team: DesignTeam, fecha: date, empleado_id: int | None = None, solo_propias: bool = False,
                extra=None) -> str:
    """Huella corta de lo que VE esa persona en el día de un equipo. Si cambia, la pantalla vuelve a pedir el día.
    - Manager / admin / a cargo: todas las órdenes y tiempos libres del equipo, la composición del equipo y las copias
      Face → N2 pendientes.
    - Diseñador (`solo_propias`): solo sus órdenes (también las que le prestaron de otros equipos) y sus tiempos libres;
      así no recarga cuando un compañero cambia algo que él no ve (auditoría 19-oct-2026).
    `extra`: lo que depende de la persona (permiso para editar días cerrados, ayudas recibidas).
    Son pocas filas, así que se calcula directo."""
    import hashlib
    from .models_design import DesignCopiaFace
    # Solo las columnas de la huella (la pantalla la pide cada 5 s por pestaña abierta: tiene que ser liviana).
    q = (db.query(DesignOrden.id, DesignOrden.team_id, DesignOrden.tabla, DesignOrden.orden_visual, DesignOrden.actualizado_en)
         .filter(DesignOrden.fecha == fecha))
    q = q.filter(DesignOrden.designer_id == empleado_id) if (solo_propias and empleado_id) else q.filter(DesignOrden.team_id == team.id)
    partes = [(o.id, o.team_id, o.tabla, o.orden_visual, o.actualizado_en.isoformat() if o.actualizado_en else "")
              for o in q.order_by(DesignOrden.id).all()]
    qb = (db.query(DesignBreak.id, DesignBreak.empleado_id, DesignBreak.tipo_ausencia, DesignBreak.almuerzo_inicio, DesignBreak.almuerzo_fin,
                   DesignBreak.break1_inicio, DesignBreak.break1_fin, DesignBreak.break2_inicio, DesignBreak.break2_fin)
          .filter(DesignBreak.team_id == team.id, DesignBreak.fecha == fecha))
    if solo_propias and empleado_id:
        qb = qb.filter(DesignBreak.empleado_id == empleado_id)
    for b in qb.order_by(DesignBreak.id).all():
        partes.append(tuple(b))
    partes.append(("deleg", delegaciones_activas(db).get(team.id)))
    if not solo_propias:
        partes.append(("equipo", team.manager_id, tuple(sorted(d.empleado_id for d in team.designers))))
        partes.append(("copias", tuple((c, e) for c, e in (db.query(DesignCopiaFace.n2_orden_id, DesignCopiaFace.estado)
                                                          .join(DesignOrden, DesignOrden.id == DesignCopiaFace.n2_orden_id)
                                                          .filter(DesignOrden.team_id == team.id, DesignOrden.fecha == fecha,
                                                                  DesignCopiaFace.estado == "pendiente").order_by(DesignCopiaFace.n2_orden_id).all()))))
    if extra:
        partes.append(("extra", extra))
    return hashlib.md5(repr(partes).encode()).hexdigest()[:16]


# ---------- Dashboard ----------

def _es_aprobada(estado: str) -> bool:
    return "approv" in (estado or "").lower()


def _es_cancelada(estado: str) -> bool:
    e = (estado or "").lower()
    return "cancel" in e or "skip" in e


def _fin_hold(s_hold: str, f_hold: str, fin: str) -> str:
    """Hasta dónde va el Hold abierto: el Re-initiated; si no hay (pasó de Hold directo a Approved, p. ej. el lunes después
    de un Hold del viernes), hasta el Fin. Antes no se descontaba y el total sumaba todo el fin de semana (20-oct-2026)."""
    return f_hold or (fin if s_hold else "")


def _hold_min(o: DesignOrden) -> float:
    """Tiempo en Hold de la orden: Hold acumulado más el Hold con inicio y fin (S. Hold → F. Hold / Re-initiated o el Fin)."""
    fh = _fin_hold(o.s_hold, o.f_hold, o.hora_fin)
    return (o.hold_minutos or 0) + (_entre(o.s_hold, fh) if o.s_hold and fh else 0)


DASH_RANGO_MAX_DIAS = 366   # A8 (13-oct-2026): el Dashboard se mira por área y por periodo de hasta un año; no hay "Todo"


def dashboard_tendencia(db: Session, user: Empleado, area_id: int | None, team_id: int | None, desde: date, hasta: date) -> dict:
    """Gráfica comparativa por equipos (A8, 13-oct-2026): casos completos de cada equipo en cada tramo del periodo.
    Tramos de días si el periodo es de un mes o menos; si no, semanas (desde el lunes). Solo cuentan las órdenes
    completas en estado Approved (21-oct-2026). Un aprobador ve solo los equipos que maneja."""
    q = (db.query(DesignOrden.team_id, DesignOrden.fecha, DesignOrden.estado, DesignTeam.nombre)
         .join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
         .filter(filtro_orden_completa(), DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta))
    if not es_admin(user):
        q = q.filter(DesignTeam.id.in_(equipos_dash_ids(db, user)))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.filter(DesignTeam.area_id == area_id)
    dias = (hasta - desde).days + 1
    if dias <= 31:
        clave = lambda f: f
        etiqueta = lambda f: f.strftime("%d/%m")
    else:
        clave = lambda f: f - timedelta(days=f.weekday())
        etiqueta = lambda f: "Sem " + f.strftime("%d/%m")
    # Sábados y domingos no cuentan (13-oct-2026): no son días de trabajo del horario.
    tramos = sorted({clave(desde + timedelta(days=i)) for i in range(dias)
                     if (desde + timedelta(days=i)).weekday() < 5})
    equipos: dict[int, dict] = {}
    for tid, fecha, estado, nombre in q.all():
        # Solo cuentan las órdenes en Approved (Rosember, 21-oct-2026), en Resumen y en Filtros
        if (estado or "").strip().lower() != "approved" or fecha.weekday() >= 5:
            continue
        e = equipos.setdefault(tid, {"id": tid, "nombre": nombre, "valores": {}})
        k = clave(fecha)
        e["valores"][k] = e["valores"].get(k, 0) + 1
    # El aprobador (manager) de cada equipo y si tiene foto: Resumen pone su cara en el día de hoy (21-oct-2026)
    mans = {t.id: t.manager for t in db.query(DesignTeam).filter(DesignTeam.id.in_(list(equipos)))} if equipos else {}
    mids = [m.id for m in mans.values() if m]
    con_foto = {r[0] for r in db.query(DesignFotoPerfil.empleado_id).filter(DesignFotoPerfil.empleado_id.in_(mids),
                                                                           DesignFotoPerfil.datos.isnot(None))} if mids else set()
    series = []
    for e in sorted(equipos.values(), key=lambda x: (-sum(x["valores"].values()), x["nombre"].lower())):
        m = mans.get(e["id"])
        series.append({"id": e["id"], "nombre": e["nombre"], "total": sum(e["valores"].values()),
                       "valores": [e["valores"].get(t, 0) for t in tramos],
                       "aprobador": m.nombre_completo if m else "",
                       "foto": f"/design/api/foto/{m.id}" if m and m.id in con_foto else ""})
    hoy = date.today()
    return {"desde": desde.isoformat(), "hasta": hasta.isoformat(), "tramos": [etiqueta(t) for t in tramos], "series": series,
            "hoy": tramos.index(clave(hoy)) if clave(hoy) in tramos and hoy.weekday() < 5 else None}


def dashboard_qc_disenadores(db: Session, user: Empleado, desde: date, hasta: date) -> dict:
    """Dashboard › Resumen › Reportes de QC por diseñador (Rosember, 21-oct-2026): cuántos reportes de QC (hallazgo
    escrito al marcar el QC) tuvo cada diseñador en el periodo, de más a menos; quien no tiene ninguno no sale. Todas las
    áreas en una sola lista (un aprobador, solo sus equipos). En N6 el QC de Zirconia cuenta como otro reporte. Sin
    canceladas ni skipped. El diseñador prestado cuenta con su nombre (se junta con el mismo nombre escrito igual)."""
    q = (db.query(DesignOrden).join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
         .filter(filtro_orden_completa(), DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta,
                 or_(and_(DesignOrden.qc.is_(True), func.coalesce(DesignOrden.qc_reporte, "") != ""),
                     and_(DesignOrden.z_qc.is_(True), func.coalesce(DesignOrden.z_qc_reporte, "") != ""))))
    if not es_admin(user):
        q = q.filter(DesignTeam.id.in_(equipos_dash_ids(db, user)))
    por: dict[str, dict] = {}
    for f in q.all():
        if _es_cancelada(f.estado):
            continue
        hallazgos = [h for h in (((f.qc_reporte or "").strip() if f.qc else ""),
                                 ((f.z_qc_reporte or "").strip() if f.z_qc else "")) if h]
        if not hallazgos:
            continue
        nombre = f.designer.nombre_completo if f.designer else (f.designer_prestado or "").strip() or "Sin asignar"
        d = por.setdefault(_normalizar_texto(nombre), {"nombre": nombre, "designerId": f.designer_id, "reportes": 0,
                                                       "equipos": [], "lista": []})
        d["designerId"] = d["designerId"] or f.designer_id
        if f.team.nombre not in d["equipos"]:
            d["equipos"].append(f.team.nombre)
        for h in hallazgos:
            d["reportes"] += 1
            d["lista"].append({"orden": f.orden, "fecha": f.fecha.isoformat(), "hallazgo": h, "paciente": f.paciente or "",
                               "producto": f.producto or "", "equipo": f.team.nombre})
    ids = [d["designerId"] for d in por.values() if d["designerId"]]
    con_foto = {r[0] for r in db.query(DesignFotoPerfil.empleado_id).filter(DesignFotoPerfil.empleado_id.in_(ids),
                                                                           DesignFotoPerfil.datos.isnot(None))} if ids else set()
    filas = sorted(por.values(), key=lambda x: (-x["reportes"], x["nombre"].lower()))
    for d in filas:
        d["foto"] = f"/design/api/foto/{d['designerId']}" if d["designerId"] in con_foto else ""
        d["lista"].sort(key=lambda x: x["fecha"], reverse=True)
    return {"desde": desde.isoformat(), "hasta": hasta.isoformat(), "total": sum(d["reportes"] for d in filas), "disenadores": filas}


REPARTO_MAX_PRODUCTOS = 10   # columnas de producto en la tabla; el resto se junta en «Otros»
# Quién y qué no cuenta en el reparto, por área (Rosember, 22-oct-2026). María José Lemus hace solo Maxilar Print en los
# equipos de Face (CREAN_PRODUCTO): ni ella ni ese producto son parte del reparto de los diseñadores.
REPARTO_CHANGES_APARTE = {"N2 Demodenture"}   # áreas cuyo reparto muestra los Changes aparte (Rosember, 22-oct-2026)
REPARTO_EXCLUIR = [
    {"area": "Face Design", "personas": ["maria jose lemus"], "productos": ["Maxilar Print"]},
]


def dashboard_reparto(db: Session, user: Empleado, desde: date, hasta: date, team_id: int | None = None, seccion: str = "") -> dict:
    """Dashboard › Resumen › Reparto de productos (Rosember, 21-oct-2026): para ver si en un equipo los productos se
    reparten parejo entre sus diseñadores. Tabla diseñador × producto con los casos del periodo (órdenes completas, sin
    canceladas ni skipped). Los prestados salen aparte y no cuentan para la equidad. Sin team_id se muestra el equipo
    con más casos. Un aprobador solo ve sus equipos. Personas y productos de REPARTO_EXCLUIR no cuentan.
    Presencia día a día (Rosember, 22-oct-2026): los casos de cada día se reparten, en lo que «le correspondía», entre
    los diseñadores del equipo que estaban ese día (sin vacaciones, incapacidad, luto, calamidad… de día completo, de
    Tiempos libres o de People). Así, cuando alguien falta, a los presentes les corresponde más y no salen «por encima»,
    y quien faltó no sale «por debajo». La equidad compara lo que hizo cada uno contra lo que le correspondía
    (variación ponderada: ≤ 25 % pareja, ≤ 50 % algo desigual, más desigual); quien faltó todo el periodo no cuenta."""
    q = (db.query(DesignOrden.team_id, DesignTeam.nombre, DesignArea.nombre, func.count(DesignOrden.id))
         .join(DesignTeam, DesignOrden.team_id == DesignTeam.id).join(DesignArea, DesignTeam.area_id == DesignArea.id)
         .filter(filtro_orden_completa(), DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta, DesignArea.nombre != AREA_RD)
         .group_by(DesignOrden.team_id, DesignTeam.nombre, DesignArea.nombre))
    if not es_admin(user):
        q = q.filter(DesignTeam.id.in_(equipos_dash_ids(db, user)))
    equipos = sorted(({"id": tid, "nombre": nom, "area": area, "casos": n} for tid, nom, area, n in q.all()),
                     key=lambda e: (e["area"].lower(), e["nombre"].lower()))
    vacio = {"desde": desde.isoformat(), "hasta": hasta.isoformat(), "equipos": equipos, "teamId": None,
             "productos": [], "filas": [], "prestados": None, "totales": [], "equidad": []}
    if not equipos:
        return vacio
    if team_id not in {e["id"] for e in equipos}:
        team_id = max(equipos, key=lambda e: e["casos"])["id"]
    miembros = {eid for (eid,) in db.query(DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id == team_id)}
    equipo = db.get(DesignTeam, team_id)
    # El aprobador (manager) no cuenta en el reparto (Rosember, 21-oct-2026): hace casos ocasionales; sus casos no salen
    # ni como fila ni como prestados ni en los totales.
    miembros.discard(equipo.manager_id)
    excl = [r for r in REPARTO_EXCLUIR if r["area"] == equipo.area.nombre]
    excl_personas = [set(p.split()) for r in excl for p in r["personas"]]
    excl_productos = {_normalizar_texto(p) for r in excl for p in r["productos"]}
    excluida = lambda nombre: any(p <= set(_normalizar_texto(nombre or "").split()) for p in excl_personas)
    # N2 (Rosember, 22-oct-2026): los Changes van en un apartado propio (seccion="changes"); la tabla principal no los trae
    changes_aparte = equipo.area.nombre in REPARTO_CHANGES_APARTE
    if excl_personas:
        miembros = {e.id for e in db.query(Empleado).filter(Empleado.id.in_(miembros or [-1])) if not excluida(e.nombre_completo)}
    es_support = equipo.area.formato == FORMATO_SUPPORT   # en Support el diseñador es el del caso: no hay prestados
    quienes: dict[str, int] = {}
    n_ordenes = 0   # órdenes reales (en N6 una orden suma en Bite y en Zirconia, pero es un solo caso)
    ordenes = (db.query(DesignOrden).filter(DesignOrden.team_id == team_id, filtro_orden_completa(),
                                            DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta).all())
    nombres_p: dict[str, str] = {}
    por_prod: dict[str, int] = {}
    celdas: dict[str, dict[str, int]] = {}
    datos_d: dict[str, dict] = {}
    del_dia: dict[date, dict[str, int]] = {}   # casos del equipo (sin prestados) por día y producto: base de lo que le correspondía a cada uno
    for o in ordenes:
        if _es_cancelada(o.estado) or (equipo.manager_id and o.designer_id == equipo.manager_id):
            continue
        if _normalizar_texto(o.producto or "") in excl_productos:
            continue
        if changes_aparte and ("change" in _normalizar_texto(o.producto or "")) != (seccion == "changes"):
            continue
        if excl_personas and excluida(o.designer.nombre_completo if o.designer else o.designer_prestado):
            continue
        n_ordenes += 1
        kp0 = re.sub(r"\s+", " ", _normalizar_texto(o.producto or "")).strip()
        np0 = re.sub(r"\s+", " ", (o.producto or "").strip())
        # N6 Material Change (21-oct-2026): cada producto se divide en sus dos etapas. Bite design cuenta siempre; Zirconia
        # design solo cuando la orden ya llegó a esa etapa.
        if o.tabla == TABLA_MATERIAL:
            etapas = [(kp0 + "|bite", np0 + " · " + ETAPA_BITE)]
            if es_etapa_zirconia(o.etapa):
                etapas.append((kp0 + "|zir", np0 + " · " + ETAPA_ZIRCONIA))
        else:
            etapas = [(kp0, np0)]
        prestado = not es_support and (bool((o.designer_prestado or "").strip()) or not o.designer_id or o.designer_id not in miembros)
        if prestado:   # quién fue, para verlo al pasar el mouse por la fila de Prestados
            nom = o.designer.nombre_completo if o.designer else ((o.designer_prestado or "").strip() or "Sin asignar")
            if o.designer and o.designer_id not in miembros:
                otros_eq = [td.team.nombre for td in db.query(DesignTeamDesigner).filter(DesignTeamDesigner.empleado_id == o.designer_id)]
                nom += f" ({', '.join(otros_eq)})" if otros_eq else " (sin equipo)"
            quienes[nom] = quienes.get(nom, 0) + 1
        kd = "prestados" if prestado else str(o.designer_id)
        if kd not in datos_d:
            datos_d[kd] = {"nombre": "Prestados" if prestado else (o.designer.nombre_completo if o.designer else "Sin asignar"), "designerId": None if prestado else o.designer_id}
        celdas.setdefault(kd, {})
        for kp, np_ in etapas:
            nombres_p.setdefault(kp, np_)
            por_prod[kp] = por_prod.get(kp, 0) + 1
            celdas[kd][kp] = celdas[kd].get(kp, 0) + 1
            if not prestado:
                dd = del_dia.setdefault(o.fecha, {})
                dd[kp] = dd.get(kp, 0) + 1
    base = lambda k: k.split("|")[0]   # las dos etapas de N6 de un mismo producto quedan juntas (Bite y luego Zirconia)
    por_base: dict[str, int] = {}
    for k, v in por_prod.items():
        por_base[base(k)] = por_base.get(base(k), 0) + v
    orden_p = sorted(por_prod, key=lambda k: (-por_base[base(k)], base(k), k.endswith("|zir")))
    cols = orden_p[:REPARTO_MAX_PRODUCTOS]
    otros = orden_p[REPARTO_MAX_PRODUCTOS:]
    productos = [nombres_p[k] for k in cols] + (["Otros"] if otros else [])
    col_de = {k: i for i, k in enumerate(cols)}
    col_de.update({k: len(cols) for k in otros})
    n = len(productos)

    # Los miembros activos del equipo salen aunque no tengan casos: si estuvieron disponibles y no recibieron, es desigual
    for e in db.query(Empleado).filter(Empleado.id.in_(miembros or [-1]), Empleado.activo == 1):
        if str(e.id) not in datos_d:
            datos_d[str(e.id)] = {"nombre": e.nombre_completo, "designerId": e.id}
    habiles, ausencias = _reparto_dias(db, [d["designerId"] for d in datos_d.values() if d["designerId"]], desde, hasta)
    claves = [kd for kd in datos_d if kd != "prestados"]
    presente = lambda kd, f: f not in ausencias.get(datos_d[kd]["designerId"], {})

    # Lo que le correspondía a cada uno: cada caso del día se reparte entre los presentes de ese día
    esperado = {kd: [0.0] * (n + 1) for kd in claves}
    for f, prods in del_dia.items():
        hoy = [kd for kd in claves if presente(kd, f)]
        if not hoy:
            continue
        for kp, c in prods.items():
            for kd in hoy:
                esperado[kd][col_de[kp]] += c / len(hoy)
                esperado[kd][n] += c / len(hoy)

    def fila(kd):
        c = celdas.get(kd, {})
        vals = [c.get(k, 0) for k in cols] + ([sum(c.get(k, 0) for k in otros)] if otros else [])
        out = {"nombre": datos_d[kd]["nombre"], "designerId": datos_d[kd]["designerId"], "valores": vals, "total": sum(vals)}
        if kd != "prestados":
            aus = ausencias.get(datos_d[kd]["designerId"], {})
            out.update({"dias": sum(1 for f in habiles if f not in aus), "ausencias": _resumen_ausencias(aus),
                        "esperado": [round(x, 1) for x in esperado[kd]]})
        return out
    filas = sorted((fila(kd) for kd in claves), key=lambda f: (-f["total"], f["nombre"].lower()))
    prestados = fila("prestados") if "prestados" in datos_d else None
    if prestados:
        prestados["quienes"] = [{"nombre": k, "casos": v} for k, v in sorted(quienes.items(), key=lambda x: (-x[1], x[0].lower()))]

    disponibles = [f for f in filas if f["dias"] > 0]   # quien faltó todo el periodo no entra en la equidad

    def equidad(i):
        pares = [(f["total"] if i == n else f["valores"][i], esperado[str(f["designerId"])][i]) for f in disponibles]
        pares = [(v, e) for v, e in pares if e > 0 or v > 0]
        suma_e = sum(e for _, e in pares)
        suma_v = sum(v for v, _ in pares)
        if len(pares) < 2 or not suma_v or not suma_e:
            return None
        # variación de «lo que hizo ÷ lo que le correspondía», ponderada por lo que le correspondía
        cv = round((sum(e * (v / e - 1) ** 2 for v, e in pares if e > 0) / suma_e) ** 0.5, 4)
        desvio = max(abs(v - e) for v, e in pares)
        # Con pocos casos el % exagera (1 contra 0 daría «desigual»): si cada uno quedó a menos de 1 caso de lo que le
        # correspondía, no se podía repartir mejor y es pareja. Con menos de 2 casos por diseñador no se juzga.
        if desvio < 1:
            nivel = "pareja"
        elif suma_v < 2 * len(pares):
            nivel = "pocos"
        else:
            nivel = "pareja" if cv <= 0.25 else ("algo" if cv <= 0.5 else "desigual")
        return {"cv": round(cv * 100), "nivel": nivel, "promedio": round(suma_v / len(pares), 1)}
    equidades = [equidad(i) for i in range(n + 1)]
    totales = [sum(f["valores"][i] for f in filas) + (prestados["valores"][i] if prestados else 0) for i in range(n)]
    return {**vacio, "teamId": team_id, "productos": productos, "filas": filas, "prestados": prestados,
            "totales": totales + [sum(totales)], "equidad": equidades, "casos": n_ordenes, "habiles": len(habiles)}

def _reparto_dias(db: Session, empleado_ids: list[int], desde: date, hasta: date) -> tuple[list[date], dict[int, dict[date, str]]]:
    """Días hábiles del periodo (lunes a viernes sin festivos) y, por diseñador, sus días de ausencia de día completo
    {fecha: tipo}: lo que se marcó en Tiempos libres del Schedule y los permisos de People (aprobados o pendientes de
    soporte, sin los por horas)."""
    fest = festivos(db)
    habiles = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)
               if (desde + timedelta(days=i)).weekday() < 5 and desde + timedelta(days=i) not in fest]
    dias = set(habiles)
    aus: dict[int, dict[date, str]] = {}
    if not empleado_ids or not habiles:
        return habiles, aus
    for eid, f, tipo in (db.query(DesignBreak.empleado_id, DesignBreak.fecha, DesignBreak.tipo_ausencia)
                         .filter(DesignBreak.empleado_id.in_(empleado_ids), DesignBreak.fecha >= desde, DesignBreak.fecha <= hasta,
                                 func.coalesce(DesignBreak.tipo_ausencia, "") != "")):
        if f in dias:
            aus.setdefault(eid, {})[f] = tipo.strip()
    catalogo = ausencias_disponibles(db)
    for eid, fi, ff, tipo, es_vac in (db.query(Solicitud.empleado_id, Solicitud.fecha_inicio, Solicitud.fecha_fin, TipoPermiso.nombre,
                                                TipoPermiso.es_vacaciones)
                                       .join(TipoPermiso, Solicitud.tipo_id == TipoPermiso.id)
                                       .filter(Solicitud.empleado_id.in_(empleado_ids), Solicitud.estado.in_(ESTADOS_AUSENCIA_PEOPLE),
                                               Solicitud.fecha_inicio <= hasta, Solicitud.fecha_fin >= desde,
                                               Solicitud.hora_inicio.is_(None), Solicitud.hora_fin.is_(None))):
        nombre = ausencia_design_de(tipo, bool(es_vac), catalogo)
        for i in range((min(ff, hasta) - max(fi, desde)).days + 1):
            f = max(fi, desde) + timedelta(days=i)
            if f in dias:
                aus.setdefault(eid, {}).setdefault(f, nombre)
    return habiles, aus


def _resumen_ausencias(aus: dict[date, str]) -> list[dict]:
    cuenta: dict[str, int] = {}
    for tipo in aus.values():
        cuenta[tipo] = cuenta.get(tipo, 0) + 1
    return [{"tipo": t, "dias": n} for t, n in sorted(cuenta.items(), key=lambda x: (-x[1], x[0]))]


def dashboard_productos(db: Session, user: Empleado, anio: int, area_id: int | None = None, team_id: int | None = None) -> dict:
    """Dashboard › Productos (pedido por Rosember el 12-oct-2026): cuántas órdenes de cada producto hay en cada mes del
    año. Cuentan las órdenes completas (centro, producto y diseñador) que no están canceladas ni skipped, por su fecha
    en el Schedule (una orden que pasó de un día a otro cuenta una sola vez, en su día actual). Un aprobador ve solo
    los equipos que maneja, como en el resto del Dashboard. El mismo producto escrito distinto se junta."""
    q = (db.query(DesignOrden.producto, DesignOrden.fecha, DesignOrden.estado, DesignTeam.area_id)
         .join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
         .filter(filtro_orden_completa(), DesignOrden.fecha >= date(anio, 1, 1), DesignOrden.fecha <= date(anio, 12, 31)))
    if not es_admin(user):
        q = q.filter(DesignTeam.id.in_(equipos_dash_ids(db, user)))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.filter(DesignTeam.area_id == area_id)
    areas = {a.id: a.nombre for a in db.query(DesignArea).all()}
    por: dict[str, dict] = {}
    for prod, fecha, estado, aid in q.all():
        if _es_cancelada(estado):
            continue
        k = re.sub(r"\s+", " ", _normalizar_texto(prod or "")).strip()
        p = por.setdefault(k, {"producto": re.sub(r"\s+", " ", (prod or "").strip()), "meses": [0] * 12, "areas": set()})
        p["meses"][fecha.month - 1] += 1
        p["areas"].add(areas.get(aid, ""))
    filas = sorted(({"producto": p["producto"], "meses": p["meses"], "total": sum(p["meses"]), "areas": sorted(a for a in p["areas"] if a)}
                    for p in por.values()), key=lambda x: (-x["total"], x["producto"].lower()))
    anios = sorted({r[0].year for r in db.query(DesignOrden.fecha).filter(filtro_orden_completa()).distinct()} | {anio}, reverse=True)
    return {"anio": anio, "anios": anios, "productos": filas, "totales": [sum(f["meses"][i] for f in filas) for i in range(12)]}


ART_LIMITE_MIN = 120   # lo normal es articular en 2 horas; pasado ese tiempo el caso cuenta como "tardó más"


def dashboard_articulacion(db: Session, user: Empleado, desde: date, hasta: date, area_id: int | None = None,
                           team_id: int | None = None) -> dict:
    """Dashboard › Articulación (pedido por Rosember el 13-oct-2026): tiempo que tardó el articulador en entregar cada caso
    de N3 › Cirugías (RTD − START). Se mide a las órdenes completas con START y RTD, sin canceladas ni skipped. Por
    centro: casos medidos, cuántos pasaron de 2 horas, % y promedio, para hacer seguimiento a los que más tardan."""
    q = (db.query(DesignOrden, DesignTeam)
         .join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
         .filter(filtro_orden_completa(), DesignOrden.tabla == "principal", DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta,
                 func.coalesce(DesignOrden.art_start, "") != "", func.coalesce(DesignOrden.art_rtd, "") != ""))
    if not es_admin(user):
        q = q.filter(DesignTeam.id.in_(equipos_dash_ids(db, user)))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.filter(DesignTeam.area_id == area_id)
    centros: dict[str, dict] = {}
    casos = []
    for o, t in q.order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).all():
        if _es_cancelada(o.estado):
            continue
        m = _entre(o.art_start, o.art_rtd)
        k = re.sub(r"\s+", " ", _normalizar_texto(o.centro or "")).strip()
        c = centros.setdefault(k, {"centro": re.sub(r"\s+", " ", (o.centro or "").strip()), "casos": 0, "pasadas": 0, "suma": 0.0, "max": 0.0})
        c["casos"] += 1
        c["suma"] += m
        c["max"] = max(c["max"], m)
        if m > ART_LIMITE_MIN:
            c["pasadas"] += 1
            casos.append({"id": o.id, "orden": o.orden, "paciente": o.paciente, "fecha": o.fecha.isoformat(), "centro": o.centro,
                          "equipo": t.nombre, "designer": o.designer.nombre_completo if o.designer else (o.designer_prestado or ""),
                          "start": o.art_start, "rtd": o.art_rtd, "min": round(m)})
    filas = sorted(({"centro": c["centro"], "casos": c["casos"], "pasadas": c["pasadas"],
                     "pct": round(c["pasadas"] * 100 / c["casos"]), "promedio": round(c["suma"] / c["casos"]), "max": round(c["max"])}
                    for c in centros.values()), key=lambda x: (-x["pasadas"], -x["pct"], x["centro"].lower()))
    medidos = sum(c["casos"] for c in centros.values())
    pasadas = sum(c["pasadas"] for c in centros.values())
    return {"limiteMin": ART_LIMITE_MIN, "medidos": medidos, "pasadas": pasadas, "pct": round(pasadas * 100 / medidos) if medidos else 0,
            "promedio": round(sum(c["suma"] for c in centros.values()) / medidos) if medidos else 0,
            "centros": filas, "casos": sorted(casos, key=lambda x: -x["min"])[:500]}


def dashboard_query(db: Session, area_id: int | None = None, team_id: int | None = None,
                    designer_id: int | None = None, producto: str = "", estado: str = "",
                    qc: str = "", fecha_desde: date | None = None, fecha_hasta: date | None = None,
                    user: Empleado | None = None, designer_nombre: str = "") -> dict:
    """Dashboard de Design. Los filtros de diseñador, producto, estado y QC se aplican después de armar las listas
    de opciones (así cada lista muestra lo que hay en el área, el equipo y las fechas elegidas).
    El reporte de QC es el hallazgo que escribe el aprobador al marcar el QC (qc_reporte); las Notas no salen."""
    trasladar_holds(db)
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.designer),
                                       joinedload(DesignOrden.team).joinedload(DesignTeam.area),
                                       joinedload(DesignOrden.team).joinedload(DesignTeam.manager))
         .filter(filtro_orden_completa()))
    if user is not None and not es_admin(user):
        # Un aprobador ve el Dashboard solo de los equipos que maneja.
        q = q.filter(DesignOrden.team_id.in_(equipos_dash_ids(db, user)))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.join(DesignTeam, DesignOrden.team_id == DesignTeam.id).filter(DesignTeam.area_id == area_id)
    if fecha_desde:
        q = q.filter(DesignOrden.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(DesignOrden.fecha <= fecha_hasta)
    todas = q.order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).all()

    def nombre_de(f):
        return f.designer.nombre_completo if f.designer else (f.designer_prestado or "Sin asignar")

    # Los diseñadores del Dashboard son los del equipo de cada orden: un diseñador prestado (de otro equipo o escrito a
    # mano) no sale en la tabla de Producción ni en el filtro de Diseñador (pedido por Rosember el 9-oct-2026).
    miembros: dict[int, set[int] | None] = {}
    equipos_ids = {f.team_id for f in todas}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id.in_(equipos_ids or [-1])):
        miembros.setdefault(tid, set()).add(eid)
    for f in todas:
        t = f.team
        miembros.setdefault(t.id, set())
        if t.manager_id:
            miembros[t.id].add(t.manager_id)  # el manager que diseña casos cuenta como del equipo
        if t.area.formato == FORMATO_SUPPORT:
            miembros[t.id] = None  # Support: el diseñador es el del caso, no un prestado

    def es_prestado(f) -> bool:
        propios = miembros.get(f.team_id)
        if propios is None:
            return False
        return bool((f.designer_prestado or "").strip()) or bool(f.designer_id and f.designer_id not in propios)

    # Opciones de los filtros (antes de filtrar por diseñador, producto, estado y QC)
    disenadores: dict[str, str] = {}
    for f in todas:
        if es_prestado(f):
            continue
        disenadores.setdefault(str(f.designer_id) if f.designer_id else "libre:" + nombre_de(f), nombre_de(f))
    sel_area = area_id or (db.get(DesignTeam, team_id).area_id if team_id and db.get(DesignTeam, team_id) else None)
    productos, estados = [], []
    if sel_area:
        cat = catalogos_de_area(db, sel_area)
        productos, estados = list(cat.get("producto", [])), list(cat.get("estado", []))
    for f in todas:
        if f.producto and f.producto not in productos:
            productos.append(f.producto)
        if f.estado and f.estado not in estados:
            estados.append(f.estado)
    if not sel_area:
        productos.sort(key=lambda x: x.lower())
        estados.sort(key=lambda x: x.lower())
    estados = [e for e in estados if not _es_cancelada(e)]   # 14-oct-2026: Canceled / Skipped no se ofrecen en el filtro

    nombre_q = _normalizar_texto(designer_nombre or "")
    filas = []
    for f in todas:
        if designer_id and f.designer_id != designer_id:
            continue
        if nombre_q and nombre_q not in _normalizar_texto(nombre_de(f)):
            continue
        if producto and f.producto != producto:
            continue
        if estado and f.estado != estado:
            continue
        if qc == "si" and not f.qc:
            continue
        if qc == "no" and f.qc:
            continue
        if qc == "hallazgos" and not (f.qc and (f.qc_reporte or "").strip()):
            continue
        filas.append(f)

    por_designer: dict[str, dict] = {}
    por_producto: dict[str, dict] = {}
    por_equipo: dict[int, dict] = {}
    por_estado: dict[str, int] = {}
    por_dia: dict[str, int] = {}
    qc_reportes, sin_qc = [], []
    k = {"aprobadas": 0, "canceladas": 0, "conQc": 0, "qcHallazgos": 0, "duracionMin": 0.0, "conTiempo": 0,
         "holdMin": 0.0, "conHold": 0}
    for f in filas:
        nombre_d = nombre_de(f)
        formato = f.team.area.formato
        cancelada = _es_cancelada(f.estado)
        dur = 0 if cancelada else duracion_orden_min(f, formato)
        hold = 0 if cancelada else _hold_min(f)
        aprobada = _es_aprobada(f.estado)
        hallazgo = (f.qc_reporte or "").strip() if f.qc else ""
        if not es_prestado(f):
            clave = str(f.designer_id) if f.designer_id else "libre:" + nombre_d
            d = por_designer.setdefault(clave, {"clave": clave, "designerId": f.designer_id, "nombre": nombre_d, "equipos": [],
                                                "casos": 0, "aprobadas": 0, "canceladas": 0, "duracionMin": 0, "conTiempo": 0,
                                                "holdMin": 0, "conQc": 0, "qcHallazgos": 0})
            if f.team.nombre not in d["equipos"]:
                d["equipos"].append(f.team.nombre)
            d["casos"] += 1
            d["aprobadas"] += aprobada
            d["canceladas"] += cancelada
            d["duracionMin"] += dur
            d["conTiempo"] += dur > 0
            d["holdMin"] += hold
            d["conQc"] += bool(f.qc)
            d["qcHallazgos"] += bool(hallazgo)

        if not cancelada:   # Casos por producto: sin canceladas ni skipped (14-oct-2026)
            p = por_producto.setdefault(f.producto, {"producto": f.producto, "casos": 0, "duracionMin": 0, "conTiempo": 0, "lista": []})
            p["lista"].append({"ordenId": f.id, "orden": f.orden, "paciente": f.paciente, "fecha": f.fecha.isoformat(),
                               "equipo": f.team.nombre, "designerNombre": nombre_d, "estado": f.estado, "duracionMin": round(dur, 1)})
            p["casos"] += 1
            p["duracionMin"] += dur
            p["conTiempo"] += dur > 0

        e = por_equipo.setdefault(f.team_id, {"equipo": f.team.nombre, "area": f.team.area.nombre,
                                              "manager": f.team.manager.nombre_completo if f.team.manager else "", "casos": 0,
                                              "aprobadas": 0, "duracionMin": 0, "conTiempo": 0, "qcHallazgos": 0})
        e["casos"] += 1
        e["aprobadas"] += aprobada
        e["duracionMin"] += dur
        e["conTiempo"] += dur > 0
        e["qcHallazgos"] += bool(hallazgo)

        por_estado[f.estado or "(sin estado)"] = por_estado.get(f.estado or "(sin estado)", 0) + 1
        por_dia[f.fecha.isoformat()] = por_dia.get(f.fecha.isoformat(), 0) + 1

        k["aprobadas"] += aprobada
        k["canceladas"] += cancelada
        k["conQc"] += bool(f.qc)
        k["qcHallazgos"] += bool(hallazgo)
        k["duracionMin"] += dur
        k["conTiempo"] += dur > 0
        k["holdMin"] += hold
        k["conHold"] += hold > 0

        if hallazgo:
            qc_reportes.append({"ordenId": f.id, "orden": f.orden, "paciente": f.paciente, "fecha": f.fecha.isoformat(),
                                "equipo": f.team.nombre, "producto": f.producto, "estado": f.estado,
                                "qcReporte": hallazgo, "designerNombre": nombre_d})
        if aprobada and not f.qc and not (f.team.area and f.team.area.nombre == AREA_RD):   # Removable Denture no lleva QC (21-oct-2026)
            sin_qc.append({"ordenId": f.id, "orden": f.orden, "paciente": f.paciente, "fecha": f.fecha.isoformat(),
                           "equipo": f.team.nombre, "producto": f.producto, "estado": f.estado, "designerNombre": nombre_d})

    prom = lambda x: round(x["duracionMin"] / x["conTiempo"], 1) if x["conTiempo"] else 0
    for lista in (por_designer.values(), por_producto.values(), por_equipo.values()):
        for x in lista:
            x["promedioMin"] = prom(x)
            x["duracionMin"] = round(x["duracionMin"], 1)
            if "holdMin" in x:
                x["holdMin"] = round(x["holdMin"], 1)
    return {
        "totalCasos": len(filas),
        "kpis": {**k, "duracionMin": round(k["duracionMin"], 1), "holdMin": round(k["holdMin"], 1),
                 "promedioMin": prom(k), "enProceso": len(filas) - k["aprobadas"] - k["canceladas"]},
        "porDesigner": sorted(por_designer.values(), key=lambda d: (-d["casos"], d["nombre"])),
        "porProducto": sorted(por_producto.values(), key=lambda d: -d["casos"]),
        "porEquipo": sorted(por_equipo.values(), key=lambda d: (d["area"], d["equipo"])),
        "porEstado": sorted([{"estado": e, "casos": c} for e, c in por_estado.items()], key=lambda d: -d["casos"]),
        "porDia": [{"fecha": f, "casos": por_dia[f]} for f in sorted(por_dia)],
        "qcReportes": qc_reportes,
        "sinQc": sin_qc,
        "opciones": {"disenadores": sorted([{"clave": c, "nombre": n} for c, n in disenadores.items()], key=lambda d: d["nombre"].lower()),
                     "productos": productos, "estados": estados},
    }


def _minutos(hhmm: str) -> int | None:
    try:
        h, m = [int(x) for x in (hhmm or "").split(":")[:2]]
        return h * 60 + m
    except (ValueError, IndexError):
        return None


def _entre(inicio: str, fin: str) -> float:
    """Minutos de `inicio` a `fin`; si cruza la medianoche se suma un día (como la herramienta original)."""
    a, b = _minutos(inicio), _minutos(fin)
    if a is None or b is None:
        return 0
    d = b - a
    return d + 24 * 60 if d < 0 else d


# Face Design desde el 5-oct-2026 (pedido por Rosember): Inicio diseño · Start hold · Re-initiated · Fin.
# Total = Fin − Inicio diseño − tiempo en Hold. El tiempo en Hold es Re-initiated − Start hold más los Hold anteriores
# del mismo caso (se acumulan en hold_minutos). Las horas se llenan solas con el estado (ver face_horas_por_estado).
# 21-oct-2026 (Rosember): todo octubre con el formato actual (los aprobadores están llenando los días vacíos). Antes: 5-oct.
FACE_NUEVO_DESDE = date(2026, 10, 1)
# N3 y N6 (tabla Cirugías) con el mismo formato desde el 5-oct-2026 (Nightguards / TC sigue con Inicio y Fin).
DUAL_NUEVO_DESDE = date(2026, 10, 1)   # antes: 5-oct


# Nightguards / TC de N3 y N6 con el mismo formato desde el 6-oct-2026 (pedido por Rosember). Los campos son los mismos
# (Inicio → hora_inicio, Fin → hora_fin), así que las órdenes de antes no se convierten.
NG_NUEVO_DESDE = date(2026, 10, 1)   # antes: 6-oct (21-oct-2026: todo octubre)


# N2 Demodenture con las horas llenadas por el estado como N3 (pedido por Rosember el 9-oct-2026): Initiated → Inicio
# (y Re-initiated si venía de Hold), Hold → S.Hold, Approved → Fin. Varios Hold en el mismo caso se acumulan en
# hold_minutos y T. Hold es el total. Conserva sus columnas Inicio · S.Hold · F.Hold · T. Hold · Fin.
N2_NUEVO_DESDE = date(2026, 10, 1)   # antes: 9-oct (21-oct-2026: todo octubre)


def horas_por_estado(formato: str, fecha: date, tabla: str) -> bool:
    """¿Esta orden usa el formato Inicio diseño · Start hold · Re-initiated · Fin (el estado llena las horas)?"""
    if formato == FORMATO_N2:
        return fecha >= N2_NUEVO_DESDE
    if tabla == "nightguard":
        return formato == FORMATO_DUAL and fecha >= NG_NUEVO_DESDE
    return es_face_nuevo(formato, fecha)


def es_face_nuevo(formato: str, fecha: date) -> bool:
    """Formato de horas nuevo (Inicio diseño · Start hold · Re-initiated · Fin): Face y la tabla Cirugías de N3/N6.
    Quien lo use para N3/N6 debe revisar que la orden sea de la tabla principal (Nightguards no cambia)."""
    return ((formato == FORMATO_SINGLE and fecha >= FACE_NUEVO_DESDE) or
            (formato == FORMATO_DUAL and fecha >= DUAL_NUEVO_DESDE))


# N3 › Cirugías: el estado marca la articulación (Rosember, 21-oct-2026). «Pickup received» llena START y «Ready to design»
# llena RTD (solo si están vacías; se pueden corregir a mano). De Pickup received no se puede saltar a Initiated (ni a
# otro estado de diseño): primero Ready to design, que cierra la articulación.
ESTADO_PICKUP = "Pickup received"
PICKUP_SIGUIENTES = {"pickup received", "ready to design", "order entered"}
PICKUP_SALTO = "Primero marca Ready to design: así queda el RTD de la articulación. Después ya puedes iniciar (Initiated)."


def estado_al_escribir_orden(area_nombre: str, orden: str, estado: str) -> str | None:
    """N3 (Rosember, 22-oct-2026): al escribir el número de orden, una fila sin estado queda en «Order Entered».
    Devuelve el estado que hay que poner, o None si no aplica. Igual que dsEstadoAlEscribirOrden en schedule.js."""
    if area_nombre == AREA_N3 and (orden or "").strip() and not (estado or "").strip():
        return ESTADO_ORDER_ENTERED
    return None


def _es_cirugia_n3(area_nombre: str, tabla: str) -> bool:
    return area_nombre == AREA_N3 and tabla == "principal"


def articulacion_por_estado(area_nombre: str, tabla: str, actual: dict, estado_nuevo: str) -> dict:
    """START / RTD que llena el estado en una cirugía de N3. `actual` = valores de la orden ya combinados (art_start, art_rtd)."""
    if not _es_cirugia_n3(area_nombre, tabla):
        return {}
    e = _normalizar_texto(estado_nuevo or "")
    ahora = ahora_colombia().strftime("%H:%M")
    if e == _normalizar_texto(ESTADO_PICKUP) and not (actual.get("art_start") or "").strip():
        return {"art_start": ahora}
    if e == _normalizar_texto(ESTADO_READY) and (actual.get("art_start") or "").strip() and not (actual.get("art_rtd") or "").strip():
        return {"art_rtd": ahora}
    return {}


def pickup_salta(area_nombre: str, tabla: str, estado_antes: str, estado_nuevo: str) -> bool:
    """¿Pasa de Pickup received a un estado de diseño sin Ready to design? (cancelar o skip sí se puede)."""
    if not _es_cirugia_n3(area_nombre, tabla) or _normalizar_texto(estado_antes or "") != _normalizar_texto(ESTADO_PICKUP):
        return False
    nuevo = _normalizar_texto(estado_nuevo or "")
    return bool(nuevo) and nuevo not in PICKUP_SIGUIENTES and not _es_cancelada(estado_nuevo)


def face_horas_por_estado(actual: dict, estado_nuevo: str) -> dict:
    """Horas que el estado llena solas en Face (hora de Colombia). `actual` = valores de la orden ya combinados con lo
    que se está guardando (claves de columna). Solo llena horas vacías; un Hold nuevo después de un Re-initiated
    acumula el Hold anterior y empieza otro. Devuelve solo lo que cambia."""
    ahora = ahora_colombia().strftime("%H:%M")
    s_hold, f_hold = actual.get("s_hold") or "", actual.get("f_hold") or ""
    if estado_nuevo == "Initiated":
        if s_hold and not f_hold:
            return {"f_hold": ahora}  # vuelve de Hold: Re-initiated
        if not actual.get("hora_inicio"):
            return {"hora_inicio": ahora}  # primera vez: Inicio diseño
    elif estado_nuevo == "Hold":
        if s_hold and f_hold:  # otro Hold en el mismo caso: se suma el anterior y empieza uno nuevo
            return {"hold_minutos": (actual.get("hold_minutos") or 0) + _entre(s_hold, f_hold), "s_hold": ahora, "f_hold": ""}
        if not s_hold:
            return {"s_hold": ahora}
    elif estado_nuevo == "Approved":
        cambios = {}
        if s_hold and not f_hold:
            cambios["f_hold"] = ahora   # de Hold directo a Approved: el Hold termina ahora (no cuenta como diseño)
        if not actual.get("hora_fin"):
            cambios["hora_fin"] = ahora
        return cambios
    return {}


_face_convertido = {"ok": False}


def face_convertir_una_vez(db: Session) -> None:
    """Una sola vez: las órdenes de Face desde el 5-oct-2026 que se llenaron con el formato anterior pasan al nuevo
    conservando su Total: Inicio diseño (anterior) → Inicio diseño (nuevo, columna hora_inicio); Hold (min) queda
    como tiempo en Hold acumulado."""
    from .models_design import DesignConexionRegla
    if _face_convertido["ok"]:
        return
    # (marca, formato, desde): Face primero; N3/N6 (Cirugías) se agregó después con su propia marca
    # 21-oct-2026: la fecha de corte pasó al 1-oct; las marcas «_oct1» convierten también las órdenes del 1 al 4 de octubre
    for marca, formato, desde in (("face_formato_nuevo", FORMATO_SINGLE, FACE_NUEVO_DESDE),
                                  ("dual_formato_nuevo", FORMATO_DUAL, DUAL_NUEVO_DESDE),
                                  ("face_formato_nuevo_oct1", FORMATO_SINGLE, FACE_NUEVO_DESDE),
                                  ("dual_formato_nuevo_oct1", FORMATO_DUAL, DUAL_NUEVO_DESDE)):
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            continue
        try:
            ids = [t.id for t in db.query(DesignTeam).join(DesignArea).filter(DesignArea.formato == formato).all()]
            for o in db.query(DesignOrden).filter(DesignOrden.team_id.in_(ids or [-1]), DesignOrden.fecha >= desde,
                                                   DesignOrden.tabla == "principal").all():
                if (o.hora_inicio_diseno or "").strip():
                    o.hora_inicio = o.hora_inicio_diseno
                    o.hora_inicio_diseno = ""
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        except Exception:
            log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
            db.rollback()
            return
    _face_convertido["ok"] = True


def material_minutos(o: DesignOrden) -> tuple[float, float, float]:
    """Material Change: (Bite, Zirconia, total) en minutos; una etapa sin Inicio o sin Fin cuenta 0."""
    def etapa(ini, fin, s, f, previos):
        if not ini or not fin:
            return 0
        fh = _fin_hold(s, f, fin)
        return max(0, _entre(ini, fin) - (previos or 0) - (_entre(s, fh) if s and fh else 0))
    b = etapa(o.hora_inicio, o.hora_fin, o.s_hold, o.f_hold, o.hold_minutos)
    z = etapa(o.z_hora_inicio, o.z_hora_fin, o.z_s_hold, o.z_f_hold, o.z_hold_minutos)
    return b, z, b + z


def _menos_hold(o: DesignOrden, fin_menos_inicio: float, hold: float) -> float:
    """Fin − Inicio − Hold. Las horas se guardan sin fecha: si el caso pasó varias noches en Hold, «Fin − Inicio» pierde
    días enteros y el resultado sale negativo (0h 0m; orden 242472, 19-oct-2026). Se suman los días que hagan falta, sin
    pasar de los que la orden lleva desde que se creó (fecha − fecha_creada); una orden del mismo día no cambia."""
    dias_max = (o.fecha - o.fecha_creada).days if (o.fecha_creada and o.fecha) else 0
    k = 0
    while fin_menos_inicio + 1440 * k - hold < 0 and k < dias_max:
        k += 1
    return max(0, fin_menos_inicio + 1440 * k - hold)


def duracion_orden_min(o: DesignOrden, formato: str) -> float:
    """Duración de una orden, igual que en el horario (dsDuracionFila en design_schedule.html):
    - N3/N6 (Cirugías) y Face: Fin − Inicio diseño − Hold (min).
    - N2: Fin − Inicio − T. Hold, con T. Hold = Hold anteriores (hold_minutos) + F.Hold − S.Hold.
    - Nightguards / TC: Fin − Inicio.  - Support: no lleva horas."""
    if formato == FORMATO_SUPPORT:
        return 0
    if o.tabla == TABLA_MATERIAL:  # Material Change: Bite + Zirconia, cada etapa Fin − Inicio − tiempo en Hold
        return material_minutos(o)[2]
    if o.tabla == "nightguard" and not horas_por_estado(formato, o.fecha, o.tabla):
        return _entre(o.hora_inicio, o.hora_fin)
    if formato == FORMATO_N2:
        if not o.hora_inicio or not o.hora_fin:
            return 0
        return _menos_hold(o, _entre(o.hora_inicio, o.hora_fin), (o.hold_minutos or 0) + _entre(o.s_hold, _fin_hold(o.s_hold, o.f_hold, o.hora_fin)))
    if horas_por_estado(formato, o.fecha, o.tabla):
        if not o.hora_inicio or not o.hora_fin:
            return 0
        fh = _fin_hold(o.s_hold, o.f_hold, o.hora_fin)
        hold = (o.hold_minutos or 0) + (_entre(o.s_hold, fh) if o.s_hold and fh else 0)
        return _menos_hold(o, _entre(o.hora_inicio, o.hora_fin), hold)
    if not o.hora_inicio_diseno or not o.hora_fin:
        return 0
    return max(0, _entre(o.hora_inicio_diseno, o.hora_fin) - (o.hold_minutos or 0))


def buscar_ordenes(db: Session, texto: str, user: Empleado | None = None) -> list[dict]:
    texto = texto.strip().upper()
    if not texto:
        return []
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area))
         .filter((DesignOrden.orden.ilike(f"%{texto}%")) | (DesignOrden.paciente.ilike(f"%{texto}%"))))
    if user is not None and not es_admin(user):  # mismo alcance que el horario
        support_propios = (db.query(DesignTeamDesigner.team_id)
                           .filter(DesignTeamDesigner.empleado_id == user.id,
                                   DesignTeamDesigner.team_id.in_(_equipos_support_ids(db))))
        q = (q.join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
             .filter(or_(DesignTeam.manager_id == user.id,
                         DesignOrden.team_id.in_(support_propios),
                         and_(DesignOrden.designer_id == user.id,
                              DesignOrden.team_id.notin_(_equipos_support_ids(db))))))
    filas = q.order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).limit(50).all()
    out = []
    for f in filas:
        r = {"ordenId": f.id, "orden": f.orden, "paciente": f.paciente, "fecha": f.fecha.isoformat(),
             "estado": f.estado, "area": f.team.area.nombre, "areaId": f.team.area_id,
             "equipo": f.team.nombre, "teamId": f.team_id, "abrirTeamId": f.team_id, "abrirAreaId": f.team.area_id}
        if user is not None and es_orden_prestada_a(db, f, user):
            # Orden prestada: se abre en su propio horario (bloque "Prestadas"), no en el equipo ajeno.
            propio = (db.query(DesignTeam).join(DesignTeamDesigner, DesignTeamDesigner.team_id == DesignTeam.id)
                      .filter(DesignTeamDesigner.empleado_id == user.id, DesignTeam.activo == 1)
                      .order_by(DesignTeam.id).first())
            if propio:
                r["abrirTeamId"], r["abrirAreaId"] = propio.id, propio.area_id
        out.append(r)
    return out


def orden_repetida(db: Session, team_id: int, fecha: date, orden: str, excluir_id: int | None = None,
                   mas: int = 0) -> bool:
    """¿El número ya llegó al máximo de veces (MAX_REPETICIONES_ORDEN) en el horario del equipo ese día (Cirugías y
    Nightguards)? `mas` = cuántas más se van a crear con el mismo número en el mismo lote."""
    orden = (orden or "").strip().upper()
    if not orden:
        return False
    q = db.query(DesignOrden.id).filter(DesignOrden.team_id == team_id, DesignOrden.fecha == fecha,
                                        func.upper(func.trim(DesignOrden.orden)) == orden)
    if excluir_id is not None:
        q = q.filter(DesignOrden.id != excluir_id)
    return q.count() + mas >= MAX_REPETICIONES_ORDEN


def ready_movidas_a_mano(db: Session, hoy: date | None = None) -> list[dict]:
    """Órdenes en "Ready to design" de días anteriores cuyo mismo número ya está en un día posterior del mismo equipo
    (alguien la pasó a mano al día siguiente). Para revisarlas y borrarlas en Parámetros."""
    hoy = hoy or ahora_colombia().date()
    viejas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
              .filter(func.lower(DesignOrden.estado) == ESTADO_READY.lower(), DesignOrden.fecha < hoy,
                      func.coalesce(DesignOrden.orden, "") != "")
              .order_by(DesignOrden.fecha, DesignOrden.team_id, DesignOrden.id).all())
    if not viejas:
        return []
    # Una sola consulta para todas las copias posteriores (antes: una consulta por orden vieja)
    copias: dict = {}
    for team_id, fecha, estado, num in (db.query(DesignOrden.team_id, DesignOrden.fecha, DesignOrden.estado, DesignOrden.orden)
                                        .filter(DesignOrden.team_id.in_({o.team_id for o in viejas}),
                                                DesignOrden.fecha > min(o.fecha for o in viejas),
                                                func.coalesce(DesignOrden.orden, "") != "")
                                        .order_by(DesignOrden.fecha).all()):
        copias.setdefault((team_id, (num or "").strip().upper()), []).append((fecha, estado or ""))
    out = []
    for o in viejas:
        despues = next(((f, e) for f, e in copias.get((o.team_id, (o.orden or "").strip().upper()), []) if f > o.fecha), None)
        if not despues:
            continue
        out.append({"id": o.id, "orden": o.orden, "paciente": o.paciente, "fecha": o.fecha.isoformat(), "area": o.team.area.nombre,
                    "equipo": o.team.nombre, "disenador": o.designer.nombre_completo if o.designer else (o.designer_prestado or ""),
                    "despuesFecha": despues[0].isoformat(), "despuesEstado": despues[1]})
    return out


def autocompletar_support(db: Session, orden: str) -> dict | None:
    """Support: datos del caso tomados del horario donde ya existe esa orden (la más reciente, fuera de
    Support). Solo paciente, centro, producto y diseñador."""
    orden = (orden or "").strip().upper()
    if not orden:
        return None
    o = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
         .filter(func.upper(func.trim(DesignOrden.orden)) == orden,
                 DesignOrden.team_id.notin_(_equipos_support_ids(db)))
         .order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).first())
    if not o:
        return None
    return {"paciente": o.paciente or "", "centro": o.centro or "", "producto": o.producto or "",
            "designerId": o.designer_id, "designerNombre": o.designer.nombre_completo if o.designer else ""}


def equipos_prestables(db: Session, team: DesignTeam) -> list[dict]:
    """Otros equipos activos de la misma área, con sus diseñadores, para elegir un diseñador prestado."""
    teams = [t for t in equipos_de_area(db, team.area_id) if t.id != team.id]
    return [{"id": t.id, "nombre": t.nombre,
             "designers": sorted(({"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in t.designers if d.empleado),
                                 key=lambda x: x["nombre"].lower()),
             "manager": _manager_elegible(t, {d.empleado_id for d in t.designers})}
            for t in teams]


# ---------- Comments N3: historial ----------

def historial_comentarios(db: Session) -> list[dict]:
    limite = datetime.utcnow() - timedelta(days=2)
    db.query(DesignComentarioHistorial).filter(DesignComentarioHistorial.creado_en < limite).delete()
    db.commit()
    filas = (db.query(DesignComentarioHistorial)
            .filter(DesignComentarioHistorial.creado_en >= limite)
            .order_by(DesignComentarioHistorial.creado_en.desc()).all())
    return [{"id": h.id, "paciente": h.paciente, "orden": h.orden, "campos": json.loads(h.campos),
            "creadoEn": h.creado_en.isoformat()} for h in filas]


def guardar_historial_comentario(db: Session, user: Empleado, paciente: str, orden: str, campos: dict) -> None:
    db.add(DesignComentarioHistorial(paciente=paciente, orden=orden, campos=json.dumps(campos),
                                     creado_por_id=user.id))
    db.commit()


def eliminar_historial_comentario(db: Session, historial_id: int) -> bool:
    h = db.get(DesignComentarioHistorial, historial_id)
    if not h:
        return False
    db.delete(h)
    db.commit()
    return True


# ---------- Foto de perfil de Zoho (solo Design) ----------

FOTO_MAX_BYTES = 2_000_000


async def foto_design_al_iniciar(client, access_token: str, info: dict, email: str) -> None:
    """Al iniciar sesión con Zoho se guarda la foto de perfil de la persona (todos los módulos la muestran en la barra).
    Prueba la foto del perfil de Zoho (userinfo "picture", el API de perfil y la de contactos). Nunca falla el login:
    si no se consigue, queda anotado el motivo (Parámetros › /design/api/parametros/fotos)."""
    from .database import SessionLocal
    from .config import ZOHO_REGION
    from .models_design import DesignFotoPerfil
    db = SessionLocal()
    try:
        user = db.query(Empleado).filter(Empleado.email == email, Empleado.activo == 1).first()
        if not user:
            return
        zuid = str(info.get("sub") or info.get("ZUID") or "")
        urls = [u for u in [info.get("picture"), f"https://profile.zoho.{ZOHO_REGION}/api/v1/user/self/photo",
                            f"https://contacts.zoho.{ZOHO_REGION}/file?ID={zuid}&fs=thumb" if zuid else None] if u]
        notas, foto = [], None
        for u in urls:
            try:
                r = await client.get(u, headers={"Authorization": f"Zoho-oauthtoken {access_token}"}, follow_redirects=True, timeout=10)
                tipo = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                if r.status_code == 200 and tipo.startswith("image/") and 200 < len(r.content) <= FOTO_MAX_BYTES:
                    foto = (r.content, tipo, u.split("?")[0])
                    break
                notas.append(f"{u.split('?')[0]} → {r.status_code} {tipo} {len(r.content)} B")
            except Exception as e:  # noqa: BLE001
                notas.append(f"{u.split('?')[0]} → {type(e).__name__}")
        reg = db.get(DesignFotoPerfil, user.id) or DesignFotoPerfil(empleado_id=user.id)
        if foto and (reg.origen or "").startswith("manual") and reg.datos:
            foto = None   # la subió un admin a mano (Formatos Canva › Cumpleaños, 22-oct-2026): Zoho no la reemplaza
            notas.append("se conserva la foto subida a mano")
        if foto:
            reg.datos, reg.tipo, reg.origen, reg.error = foto[0], foto[1], foto[2], ""
        else:  # se conserva la foto anterior, si había
            reg.error = ("campos de Zoho: " + ", ".join(sorted(info.keys())) + " | " + " | ".join(notas))[:2000]
        reg.actualizado_en = datetime.utcnow()
        db.add(reg)
        db.commit()
    finally:
        db.close()


def respuesta_foto(request, datos: bytes, tipo: str):
    """Foto de perfil con ETag (13-oct-2026): el navegador siempre pregunta si cambió y solo recibe la foto nueva.
    Antes se guardaba una hora y, al iniciar sesión, la foto actualizada de Zoho tardaba en verse."""
    import hashlib
    from fastapi import Response
    etag = '"' + hashlib.sha1(datos).hexdigest()[:20] + '"'
    cabeceras = {"Cache-Control": "private, no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cabeceras)
    return Response(datos, media_type=tipo or "image/jpeg", headers=cabeceras)


# ---------- Comments N3: plantillas de notas personalizadas ----------

def cmt_templates_listar(db: Session) -> list[DesignComentarioTemplate]:
    cmt_ng_con_paciente_una_vez(db)
    return db.query(DesignComentarioTemplate).order_by(DesignComentarioTemplate.orden).all()


_cmt_ng_ok = {"ok": False}


def cmt_ng_con_paciente_una_vez(db: Session) -> None:
    """Una sola vez (7-oct-2026): "NG Design Ready to print" empieza con el paciente y la orden, como las demás.
    Solo si sigue con el texto original (si alguien ya la editó, no se toca)."""
    from .models_design import DesignConexionRegla
    if _cmt_ng_ok["ok"]:
        return
    marca = "cmt_ng_con_paciente"
    try:
        if not db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            for t in db.query(DesignComentarioTemplate).filter(DesignComentarioTemplate.texto == "NG Design Ready to print").all():
                t.texto = "{PO}\nNG Design Ready to print"
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        _cmt_ng_ok["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def cmt_template_crear(db: Session, nombre: str, texto: str, creado_por: str = "") -> DesignComentarioTemplate:
    orden = db.query(DesignComentarioTemplate).count() + 1
    t = DesignComentarioTemplate(nombre=nombre.strip() or "Sin título", texto=texto, orden=orden,
                                 creado_por=creado_por)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def cmt_template_editar(db: Session, template_id: int, nombre: str, texto: str) -> DesignComentarioTemplate | None:
    t = db.get(DesignComentarioTemplate, template_id)
    if not t:  # todas se pueden editar (también las 11 del formato original); las fijas no se borran
        return None
    if (nombre.strip() or t.nombre) != t.nombre or texto != t.texto:
        _trash_registrar(db, "cmt-template", f'Versión anterior de la plantilla "{t.nombre}"',
                         {"template": {"nombre": t.nombre + " (anterior)", "texto": t.texto, "creado_por": t.creado_por}}, "")
    t.nombre = nombre.strip() or t.nombre
    t.texto = texto
    db.commit()
    return t


def cmt_template_eliminar(db: Session, template_id: int, eliminado_por: str = "") -> bool:
    t = db.get(DesignComentarioTemplate, template_id)
    if not t or t.es_fija:
        return False
    payload = {"template": {"nombre": t.nombre, "texto": t.texto, "creado_por": t.creado_por}}
    _trash_registrar(db, "cmt-template", f'Plantilla de nota: "{t.nombre}"', payload, eliminado_por)
    db.query(DesignFavorito).filter(DesignFavorito.tipo == "cmt_template",
                                    DesignFavorito.cmt_template_id == template_id).delete()
    db.delete(t)
    db.commit()
    return True


# ---------- Comments N2 / Face: hojas FAQ ----------
# Cada hoja tiene sus columnas (JSON). Las claves fijas son campos de DesignFaq; las columnas
# propias ("c1", "c2"...) se guardan en DesignFaq.extras. La sección agrupa filas contiguas.

FAQ_CAMPOS_FIJOS = ("situacion", "producto", "como_proceder", "plantilla", "ejemplos")
FAQ_COLUMNAS_BASE = [{"k": "situacion", "l": "Situación"}, {"k": "producto", "l": "Producto"},
                     {"k": "como_proceder", "l": "Cómo proceder"}, {"k": "plantilla", "l": "Template"},
                     {"k": "ejemplos", "l": "Ejemplos"}]


def _json(texto, defecto):
    try:
        v = json.loads(texto or "")
        return v if isinstance(v, type(defecto)) else defecto
    except (ValueError, TypeError):
        return defecto


def faq_columnas(h: DesignFaqHoja) -> list[dict]:
    return _json(h.columnas, [])


def _faq_fila_dict(f: DesignFaq) -> dict:
    d = {"id": f.id, "seccion": f.seccion or ""}
    for c in FAQ_CAMPOS_FIJOS:
        d[c] = getattr(f, c) or ""
    d.update({k: str(v) for k, v in _json(f.extras, {}).items()})
    return d


def _faq_filas(db: Session, hoja_id: int) -> list[DesignFaq]:
    return (db.query(DesignFaq).filter(DesignFaq.hoja_id == hoja_id)
            .order_by(DesignFaq.orden, DesignFaq.id).all())


def faq_hojas(db: Session) -> list[dict]:
    hojas = db.query(DesignFaqHoja).order_by(DesignFaqHoja.orden, DesignFaqHoja.id).all()
    return [{"id": h.id, "nombre": h.nombre} for h in hojas]


def faq_hoja_detalle(db: Session, hoja_id: int) -> dict | None:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return None
    return {"id": h.id, "nombre": h.nombre, "columnas": faq_columnas(h),
            "filas": [_faq_fila_dict(f) for f in _faq_filas(db, h.id)]}


def _faq_area_por_defecto(db: Session) -> int | None:
    a = (db.query(DesignArea).filter(DesignArea.nombre == "Face Design").first()
         or db.query(DesignArea).order_by(DesignArea.orden).first())
    return a.id if a else None


def faq_hoja_crear(db: Session, nombre: str, duplicar_de: int | None = None) -> DesignFaqHoja | None:
    origen = db.get(DesignFaqHoja, duplicar_de) if duplicar_de else None
    if duplicar_de and not origen:
        return None
    orden = (db.query(func.max(DesignFaqHoja.orden)).scalar() or 0) + 1
    h = DesignFaqHoja(nombre=(nombre or "").strip()[:150] or "Nueva hoja", orden=orden,
                      area_id=origen.area_id if origen else _faq_area_por_defecto(db),
                      columnas=origen.columnas if origen else json.dumps(FAQ_COLUMNAS_BASE, ensure_ascii=False))
    db.add(h)
    db.flush()
    if origen:
        for f in _faq_filas(db, origen.id):
            db.add(DesignFaq(area_id=f.area_id, hoja_id=h.id, seccion=f.seccion, situacion=f.situacion,
                             producto=f.producto, como_proceder=f.como_proceder, plantilla=f.plantilla,
                             ejemplos=f.ejemplos, extras=f.extras, orden=f.orden))
    else:
        db.add(DesignFaq(area_id=h.area_id, hoja_id=h.id, seccion="Nueva sección", orden=1))
    db.commit()
    db.refresh(h)
    return h


def faq_hoja_renombrar(db: Session, hoja_id: int, nombre: str) -> bool:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (nombre or "").strip():
        return False
    h.nombre = nombre.strip()[:150]
    db.commit()
    return True


def faq_hoja_eliminar(db: Session, hoja_id: int, eliminado_por: str = "") -> str:
    """'ok' | 'no-existe' | 'ultima' (debe quedar al menos una hoja)."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return "no-existe"
    if db.query(DesignFaqHoja).count() <= 1:
        return "ultima"
    filas = _faq_filas(db, h.id)
    payload = {"hoja": {"nombre": h.nombre, "area_id": h.area_id, "columnas": faq_columnas(h), "orden": h.orden},
               "filas": [_faq_fila_dict(f) for f in filas]}
    _trash_registrar(db, "faq-hoja", f'Hoja Comments N2 / Face: "{h.nombre}"', payload, eliminado_por)
    for f in filas:
        db.delete(f)
    db.delete(h)
    db.commit()
    return "ok"


def faq_columna_agregar(db: Session, hoja_id: int, titulo: str) -> dict | None:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (titulo or "").strip():
        return None
    cols = faq_columnas(h)
    usados = {c["k"] for c in cols}
    n = 1
    while f"c{n}" in usados:
        n += 1
    col = {"k": f"c{n}", "l": titulo.strip()[:100]}
    cols.append(col)
    h.columnas = json.dumps(cols, ensure_ascii=False)
    db.commit()
    return col


def faq_columna_renombrar(db: Session, hoja_id: int, clave: str, titulo: str) -> bool:
    h = db.get(DesignFaqHoja, hoja_id)
    if not h or not (titulo or "").strip():
        return False
    cols = faq_columnas(h)
    for c in cols:
        if c["k"] == clave:
            c["l"] = titulo.strip()[:100]
            h.columnas = json.dumps(cols, ensure_ascii=False)
            db.commit()
            return True
    return False


def _faq_valor(f: DesignFaq, clave: str) -> str:
    if clave in FAQ_CAMPOS_FIJOS:
        return getattr(f, clave) or ""
    return str(_json(f.extras, {}).get(clave, ""))


def _faq_poner(f: DesignFaq, clave: str, valor: str) -> None:
    if clave in FAQ_CAMPOS_FIJOS:
        setattr(f, clave, valor)
        return
    ex = _json(f.extras, {})
    if valor:
        ex[clave] = valor
    else:
        ex.pop(clave, None)
    f.extras = json.dumps(ex, ensure_ascii=False)


def faq_columna_eliminar(db: Session, hoja_id: int, clave: str, eliminado_por: str = "") -> bool:
    """Quita la columna de la hoja y borra su contenido; queda en la Papelera para restaurarla."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return False
    cols = faq_columnas(h)
    idx = next((i for i, c in enumerate(cols) if c["k"] == clave), None)
    if idx is None:
        return False
    valores = {}
    for f in _faq_filas(db, h.id):
        v = _faq_valor(f, clave)
        if v:
            valores[str(f.id)] = v
            _faq_poner(f, clave, "")
    payload = {"hoja_id": h.id, "indice": idx, "columna": cols[idx], "valores": valores}
    _trash_registrar(db, "faq-col", f'Columna "{cols[idx]["l"]}" de la hoja "{h.nombre}"', payload, eliminado_por)
    del cols[idx]
    h.columnas = json.dumps(cols, ensure_ascii=False)
    db.commit()
    return True


def faq_fila_crear(db: Session, hoja_id: int, seccion: str, despues_de: int | None = None) -> DesignFaq | None:
    """Crea una fila al final de la hoja o justo después de `despues_de` (corre las siguientes)."""
    h = db.get(DesignFaqHoja, hoja_id)
    if not h:
        return None
    filas = _faq_filas(db, h.id)
    pos = len(filas)
    if despues_de:
        pos = next((i + 1 for i, f in enumerate(filas) if f.id == despues_de), pos)
    for i, f in enumerate(filas):
        f.orden = i + 1 if i < pos else i + 2
    nueva = DesignFaq(area_id=h.area_id or _faq_area_por_defecto(db), hoja_id=h.id,
                      seccion=(seccion or "").strip()[:150], orden=pos + 1)
    db.add(nueva)
    db.commit()
    db.refresh(nueva)
    return nueva


def faq_fila_actualizar(db: Session, fila_id: int, clave: str, valor: str) -> DesignFaq | None:
    f = db.get(DesignFaq, fila_id)
    if not f or not f.hoja_id:
        return None
    h = db.get(DesignFaqHoja, f.hoja_id)
    if clave not in FAQ_CAMPOS_FIJOS and clave not in {c["k"] for c in faq_columnas(h)}:
        return None
    _faq_poner(f, clave, valor or "")
    db.commit()
    return f


def faq_seccion_renombrar(db: Session, hoja_id: int, fila_ids: list[int], nombre: str) -> int:
    """Renombra la sección de las filas indicadas (el grupo visible), no otras con el mismo nombre."""
    filas = (db.query(DesignFaq).filter(DesignFaq.hoja_id == hoja_id, DesignFaq.id.in_(fila_ids or [0])).all())
    for f in filas:
        f.seccion = (nombre or "").strip()[:150]
    db.commit()
    return len(filas)


def faq_fila_eliminar(db: Session, fila_id: int, eliminado_por: str = "") -> bool:
    f = db.get(DesignFaq, fila_id)
    if not f or not f.hoja_id:
        return False
    h = db.get(DesignFaqHoja, f.hoja_id)
    payload = {"hoja_id": f.hoja_id, "orden": f.orden, "area_id": f.area_id, "fila": _faq_fila_dict(f)}
    texto = (f.situacion or f.seccion or "(fila)")[:80]
    _trash_registrar(db, "faq-fila", f'Situación "{texto}" de la hoja "{h.nombre if h else ""}"', payload, eliminado_por)
    db.delete(f)
    db.commit()
    return True


def _faq_fila_desde_dict(fila: DesignFaq, d: dict) -> None:
    fila.seccion = d.get("seccion", "")
    extras = {}
    for k, v in d.items():
        if k in ("id", "seccion"):
            continue
        if k in FAQ_CAMPOS_FIJOS:
            setattr(fila, k, v)
        elif v:
            extras[k] = v
    fila.extras = json.dumps(extras, ensure_ascii=False)


def _trash_restaurar_faq_hoja(db: Session, payload: dict) -> bool:
    h = payload.get("hoja") or {}
    hoja = DesignFaqHoja(nombre=h.get("nombre", "Hoja restaurada"), area_id=h.get("area_id"),
                         columnas=json.dumps(h.get("columnas", []), ensure_ascii=False),
                         orden=(db.query(func.max(DesignFaqHoja.orden)).scalar() or 0) + 1)
    db.add(hoja)
    db.flush()
    for i, d in enumerate(payload.get("filas", []), start=1):
        fila = DesignFaq(area_id=hoja.area_id or _faq_area_por_defecto(db), hoja_id=hoja.id, orden=i)
        _faq_fila_desde_dict(fila, d)
        db.add(fila)
    return True


def _trash_restaurar_faq_fila(db: Session, payload: dict) -> bool:
    h = db.get(DesignFaqHoja, payload.get("hoja_id") or 0)
    if not h:
        return False
    orden = payload.get("orden") or 0
    for f in _faq_filas(db, h.id):
        if f.orden >= orden:
            f.orden += 1
    fila = DesignFaq(area_id=payload.get("area_id") or h.area_id or _faq_area_por_defecto(db), hoja_id=h.id, orden=orden)
    _faq_fila_desde_dict(fila, payload.get("fila") or {})
    db.add(fila)
    return True


def _trash_restaurar_faq_col(db: Session, payload: dict) -> bool:
    h = db.get(DesignFaqHoja, payload.get("hoja_id") or 0)
    col = payload.get("columna") or {}
    if not h or not col.get("k"):
        return False
    cols = faq_columnas(h)
    if any(c["k"] == col["k"] for c in cols):
        return False
    cols.insert(min(payload.get("indice", len(cols)), len(cols)), col)
    h.columnas = json.dumps(cols, ensure_ascii=False)
    for fila_id, valor in (payload.get("valores") or {}).items():
        f = db.get(DesignFaq, int(fila_id))
        if f and f.hoja_id == h.id:
            _faq_poner(f, col["k"], valor)
    return True


def faq_sembrar(db: Session, ruta_seed: Path) -> None:
    """Idempotente. Filas antiguas sin hoja (de la versión por área) van a una hoja "<área> (anterior)".
    Si no hay ninguna hoja, carga las 4 del formato original (FACE, NEW FACE, N2, FACE MANAGER QUESTIONS)."""
    huerfanas = db.query(DesignFaq).filter(DesignFaq.hoja_id.is_(None)).order_by(DesignFaq.orden, DesignFaq.id).all()
    hojas_nuevas = db.query(DesignFaqHoja).count() == 0
    orden = db.query(func.max(DesignFaqHoja.orden)).scalar() or 0
    if hojas_nuevas and ruta_seed.exists():
        areas = {a.nombre: a.id for a in db.query(DesignArea).all()}
        with open(ruta_seed, encoding="utf-8") as fh:
            datos = json.load(fh)
        for hd in datos:
            orden += 1
            h = DesignFaqHoja(nombre=hd["nombre"], area_id=areas.get(hd.get("area")) or _faq_area_por_defecto(db),
                              columnas=json.dumps(hd["columnas"], ensure_ascii=False), orden=orden)
            db.add(h)
            db.flush()
            for i, d in enumerate(hd["filas"], start=1):
                fila = DesignFaq(area_id=h.area_id, hoja_id=h.id, orden=i)
                _faq_fila_desde_dict(fila, d)
                db.add(fila)
    if huerfanas:
        por_area = {}
        for f in huerfanas:
            por_area.setdefault(f.area_id, []).append(f)
        for area_id, filas in por_area.items():
            area = db.get(DesignArea, area_id)
            orden += 1
            h = DesignFaqHoja(nombre=f"{area.nombre if area else 'Hoja'} (anterior)", area_id=area_id,
                              columnas=json.dumps(FAQ_COLUMNAS_BASE, ensure_ascii=False), orden=orden)
            db.add(h)
            db.flush()
            for i, f in enumerate(filas, start=1):
                f.hoja_id, f.orden = h.id, i


# ---------- Pre-Approved ----------

def preapproved_sheets(db: Session, area_id: int) -> list[DesignPreApprovedSheet]:
    return (db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id)
            .order_by(DesignPreApprovedSheet.orden).all())


def preapproved_detalle(db: Session, sheet_id: int) -> dict | None:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return None
    doctores = s.doctores
    celdas_por_fila = {}
    for c in (db.query(DesignPreApprovedCelda).join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
              .filter(DesignPreApprovedFila.sheet_id == s.id)):
        celdas_por_fila.setdefault(c.fila_id, {})[c.doctor_id] = c.valor
    ids_doctores = [d.id for d in doctores]   # una sola vez (antes se rehacía por cada fila)
    return {
        "id": s.id, "nombre": s.nombre, "titulo": s.titulo, "changesLabel": s.changes_label,
        "anchos": _json(s.anchos, {}),
        "centros": [{"id": c.id, "nombre": c.nombre, "span": c.span} for c in s.centros],
        "doctores": [{"id": d.id, "nombre": d.nombre} for d in doctores],
        "filas": [{"id": f.id, "criterio": f.criterio,
                  "valores": {str(did): celdas_por_fila.get(f.id, {}).get(did, "") for did in ids_doctores}}
                 for f in s.filas],
        "fotos": preapproved_fotos_de(db, s.filas, ids_doctores),
    }


# ---------- Fotos en las celdas de Pre-Approved (pedido por Rosember el 12-oct-2026) ----------
# Cada foto es de un doctor y un criterio (por su nombre, ver DesignPreApprovedFoto). Las agregan y quitan los mismos
# roles que editan Pre-Approved; se ven en la tabla y en la ventana de Pre-Approved del Schedule.
PA_FOTO_MAX = 8 * 1024 * 1024
PA_FOTO_TIPOS = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def pa_crit_clave(criterio: str) -> str:
    """Mismo criterio aunque cambien espacios, mayúsculas o signos (igual que _crit_clave en services_design_origenes)."""
    return re.sub(r"[^a-z0-9]", "", _normalizar_texto(criterio or ""))


def preapproved_fotos_de(db: Session, filas, doctor_ids: list[int]) -> dict:
    """{"<fila_id>-<doctor_id>": [{"id": foto_id}, ...]} de las celdas de estas filas y doctores."""
    if not doctor_ids:
        return {}
    por_clave: dict[str, list] = {}
    for f in filas:
        por_clave.setdefault(pa_crit_clave(f.criterio), []).append(f.id)
    out: dict[str, list] = {}
    for x in (db.query(DesignPreApprovedFoto.id, DesignPreApprovedFoto.doctor_id, DesignPreApprovedFoto.criterio_clave)
              .filter(DesignPreApprovedFoto.doctor_id.in_(doctor_ids))
              .order_by(DesignPreApprovedFoto.orden, DesignPreApprovedFoto.id)):
        for fid in por_clave.get(x.criterio_clave, [])[:1]:
            out.setdefault(f"{fid}-{x.doctor_id}", []).append({"id": x.id})
    return out


def preapproved_agregar_foto(db: Session, fila_id: int, doctor_id: int, nombre: str, tipo: str, datos: bytes,
                             por: str = "") -> DesignPreApprovedFoto | None:
    """Agrega la foto a la celda (fila × doctor de la misma hoja). La misma foto en la misma celda no se repite."""
    import hashlib
    fila, doc = db.get(DesignPreApprovedFila, fila_id), db.get(DesignPreApprovedDoctor, doctor_id)
    if not fila or not doc or fila.sheet_id != doc.sheet_id:
        return None
    clave, huella = pa_crit_clave(fila.criterio), hashlib.sha1(datos).hexdigest()
    ya = (db.query(DesignPreApprovedFoto).filter(DesignPreApprovedFoto.doctor_id == doctor_id,
                                                  DesignPreApprovedFoto.criterio_clave == clave,
                                                  DesignPreApprovedFoto.huella == huella).first())
    if ya:
        return ya
    orden = (db.query(func.max(DesignPreApprovedFoto.orden)).filter(DesignPreApprovedFoto.doctor_id == doctor_id,
                                                                     DesignPreApprovedFoto.criterio_clave == clave).scalar() or 0) + 1
    f = DesignPreApprovedFoto(doctor_id=doctor_id, criterio_clave=clave, nombre=(nombre or "foto")[:255], tipo=tipo,
                              tamano=len(datos), huella=huella, orden=orden, datos=datos, creado_por=(por or "")[:150])
    db.add(f)
    db.flush()
    return f


def preapproved_hoja_de_foto(db: Session, foto_id: int) -> DesignPreApprovedSheet | None:
    f = db.get(DesignPreApprovedFoto, foto_id)
    d = db.get(DesignPreApprovedDoctor, f.doctor_id) if f else None
    return db.get(DesignPreApprovedSheet, d.sheet_id) if d else None


def crear_preapproved_sheet(db: Session, area_id: int, nombre: str) -> DesignPreApprovedSheet:
    orden = db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id).count() + 1
    s = DesignPreApprovedSheet(area_id=area_id, nombre=nombre.strip() or f"Hoja {orden}", orden=orden)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def actualizar_preapproved_sheet(db: Session, sheet_id: int, datos: dict) -> DesignPreApprovedSheet | None:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return None
    for campo in ("nombre", "titulo", "changes_label"):
        if datos.get(campo) is not None:
            setattr(s, campo, datos[campo])
    db.commit()
    db.refresh(s)
    return s


def eliminar_preapproved_sheet(db: Session, sheet_id: int, eliminado_por: str = "") -> bool:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return False
    payload = {"area_id": s.area_id, "orden": s.orden, "detalle": preapproved_detalle(db, sheet_id)}
    _trash_registrar(db, "pa-sheet", f"Hoja Pre-Approved: {s.nombre}", payload, eliminado_por)
    db.query(DesignFavorito).filter(DesignFavorito.tipo == "preapproved",
                                    DesignFavorito.preapproved_sheet_id == sheet_id).delete()
    db.delete(s)
    db.commit()
    return True


def preapproved_agregar_centro(db: Session, sheet_id: int, nombre: str = "", span: int = 1) -> DesignPreApprovedCentro:
    """Crea el centro al final con `span` doctores nuevos ("Dr. ") debajo."""
    span = max(1, min(span or 1, 30))
    orden = (db.query(func.max(DesignPreApprovedCentro.orden))
             .filter(DesignPreApprovedCentro.sheet_id == sheet_id).scalar() or 0) + 1
    c = DesignPreApprovedCentro(sheet_id=sheet_id, nombre=(nombre or "").strip()[:150], span=span, orden=orden)
    db.add(c)
    ult = (db.query(func.max(DesignPreApprovedDoctor.orden))
           .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0)
    for k in range(span):
        db.add(DesignPreApprovedDoctor(sheet_id=sheet_id, nombre="Dr. ", orden=ult + k + 1))
    db.commit()
    db.refresh(c)
    return c


def preapproved_actualizar_centro(db: Session, centro_id: int, nombre: str, span: int) -> None:
    c = db.get(DesignPreApprovedCentro, centro_id)
    if c:
        c.nombre = nombre
        c.span = max(1, span)
        db.commit()


def preapproved_eliminar_centro(db: Session, centro_id: int, eliminado_por: str = "") -> bool:
    c = db.get(DesignPreApprovedCentro, centro_id)
    if not c:
        return False
    doctores = _pac_doctores_del_centro(db, c)
    payload = {"sheet_id": c.sheet_id, "nombre": c.nombre, "span": c.span, "doctores": [
        {"nombre": d.nombre, "celdas": [{"fila_id": x.fila_id, "valor": x.valor} for x in
                                        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id)]}
        for d in doctores]}
    _trash_registrar(db, "pa-centro", f"Centro Pre-Approved: {c.nombre}", payload, eliminado_por)
    for d in doctores:
        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == d.id).delete()
        db.delete(d)
    db.delete(c)
    db.commit()
    return True


def preapproved_agregar_doctor(db: Session, sheet_id: int, nombre: str = "", centro_id: int | None = None) -> DesignPreApprovedDoctor:
    """Agrega el doctor dentro de un centro: el elegido (`centro_id`, 27-oct-2026: queda al final de las columnas de ese
    centro y los doctores de los centros siguientes se corren) o, sin centro elegido, al final de la hoja en el último
    centro (o crea uno sin nombre si no hay). Cada centro es un grupo de doctores consecutivos (su `span`)."""
    centros = _pac_centros_ordenados(db, sheet_id)
    elegido = next((c for c in centros if c.id == centro_id), None) if centro_id else None
    if centro_id and not elegido:
        raise ValueError("Ese centro no está en esta hoja.")
    doctores = _pac_doctores_ordenados(db, sheet_id)
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=nombre or "Dr. ", orden=0)
    if elegido:
        # posición: justo después de la última columna de ese centro (las columnas de cada centro son consecutivas)
        pos = min(len(doctores), sum(max(1, c.span) for c in centros[:centros.index(elegido)]) + max(1, elegido.span))
        doctores.insert(pos, d)
        elegido.span = max(1, elegido.span) + 1
    else:
        doctores.append(d)
        if centros:
            centros[-1].span += 1
        else:
            db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre="", span=1, orden=1))
    db.add(d)
    for i, x in enumerate(doctores, start=1):   # orden seguido: las celdas van por doctor_id, no cambian
        x.orden = i
    db.commit()
    db.refresh(d)
    return d


def preapproved_renombrar_doctor(db: Session, doctor_id: int, nombre: str) -> None:
    d = db.get(DesignPreApprovedDoctor, doctor_id)
    if d:
        d.nombre = nombre
        db.commit()


def preapproved_eliminar_doctor(db: Session, doctor_id: int, eliminado_por: str = "") -> bool:
    d = db.get(DesignPreApprovedDoctor, doctor_id)
    if not d:
        return False
    celdas = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).all()
    orden_docs = [x.id for x in _pac_doctores_ordenados(db, d.sheet_id)]
    dentro = orden_docs.index(d.id) < sum(c.span for c in _pac_centros_ordenados(db, d.sheet_id))
    centro = _pac_centro_de_doctor(db, d.sheet_id, d.id) if dentro else None
    payload = {"sheet_id": d.sheet_id, "nombre": d.nombre,
              "celdas": [{"fila_id": c.fila_id, "valor": c.valor} for c in celdas],
              "centro_id": centro.id if centro else None, "centro_nombre": centro.nombre if centro else ""}
    _trash_registrar(db, "pa-doctor", f"Doctor Pre-Approved: {d.nombre}", payload, eliminado_por)
    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).delete()
    db.delete(d)
    if centro:
        centro.span -= 1
        if centro.span <= 0:
            db.delete(centro)
    db.commit()
    return True


def preapproved_guardar_ancho(db: Session, sheet_id: int, clave: str, px: int | None) -> bool:
    s = db.get(DesignPreApprovedSheet, sheet_id)
    if not s:
        return False
    anchos = _json(s.anchos, {})
    if px:
        anchos[str(clave)[:20]] = max(60, min(int(px), 800))
    else:
        anchos.pop(str(clave), None)
    s.anchos = json.dumps(anchos)
    db.commit()
    return True


def preapproved_agregar_fila(db: Session, sheet_id: int, criterio: str = "") -> DesignPreApprovedFila:
    orden = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).count() + 1
    f = DesignPreApprovedFila(sheet_id=sheet_id, criterio=criterio, orden=orden)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


def preapproved_renombrar_fila(db: Session, fila_id: int, criterio: str) -> None:
    f = db.get(DesignPreApprovedFila, fila_id)
    if f:
        viejo, nuevo = pa_crit_clave(f.criterio), pa_crit_clave(criterio)
        if viejo != nuevo:  # las fotos de la fila siguen al criterio con su nombre nuevo
            ids = [d.id for d in db.query(DesignPreApprovedDoctor.id).filter(DesignPreApprovedDoctor.sheet_id == f.sheet_id)]
            if ids:
                (db.query(DesignPreApprovedFoto).filter(DesignPreApprovedFoto.doctor_id.in_(ids), DesignPreApprovedFoto.criterio_clave == viejo)
                 .update({"criterio_clave": nuevo}, synchronize_session=False))
        f.criterio = criterio
        db.commit()


def preapproved_eliminar_fila(db: Session, fila_id: int, eliminado_por: str = "") -> bool:
    f = db.get(DesignPreApprovedFila, fila_id)
    if not f:
        return False
    celdas = db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.fila_id == fila_id).all()
    payload = {"sheet_id": f.sheet_id, "criterio": f.criterio,
              "celdas": [{"doctor_id": c.doctor_id, "valor": c.valor} for c in celdas]}
    _trash_registrar(db, "pa-fila", f"Criterio Pre-Approved: {f.criterio}", payload, eliminado_por)
    db.delete(f)
    db.commit()
    return True


def preapproved_guardar_celda(db: Session, fila_id: int, doctor_id: int, valor: str, commit: bool = True) -> bool:
    fila, doc = db.get(DesignPreApprovedFila, fila_id), db.get(DesignPreApprovedDoctor, doctor_id)
    if not fila or not doc or fila.sheet_id != doc.sheet_id:
        return False  # fila y doctor deben existir y ser de la misma hoja
    c = (db.query(DesignPreApprovedCelda)
        .filter(DesignPreApprovedCelda.fila_id == fila_id, DesignPreApprovedCelda.doctor_id == doctor_id).first())
    if not c:
        c = DesignPreApprovedCelda(fila_id=fila_id, doctor_id=doctor_id, valor=valor)
        db.add(c)
    else:
        c.valor = valor
    if commit:
        db.commit()
    return True


# ---------------------------------------------------------------------------
# Pre-Approved "Cambios": mover o intercambiar doctores/centros entre hojas
# (managers) de una misma área. Los valores viajan emparejados por NOMBRE de
# criterio (no por posición), para no corromper datos cuando dos managers
# tienen criterios distintos; lo que no tiene coincidencia en el destino se
# descarta y se informa como "unmatched", igual que en la herramienta original.
# ---------------------------------------------------------------------------

def _pac_normalizar(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _pac_valores_doctor(db: Session, doctor_id: int) -> dict[str, str]:
    filas = (db.query(DesignPreApprovedCelda, DesignPreApprovedFila.criterio)
            .join(DesignPreApprovedFila, DesignPreApprovedCelda.fila_id == DesignPreApprovedFila.id)
            .filter(DesignPreApprovedCelda.doctor_id == doctor_id).all())
    return {_pac_normalizar(criterio): celda.valor for celda, criterio in filas if (celda.valor or "").strip()}


def _pac_aplicar_valores(db: Session, doctor_id: int, sheet_id: int, valores: dict[str, str]) -> int:
    """Escribe `valores` (clave = criterio normalizado) en las celdas de doctor_id dentro de
    sheet_id, alineando por nombre de criterio. Devuelve cuántos valores no encontraron fila."""
    filas = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).all()
    mapa = {_pac_normalizar(f.criterio): f for f in filas}
    sin_match = 0
    for criterio_norm, valor in valores.items():
        fila = mapa.get(criterio_norm)
        if fila:
            preapproved_guardar_celda(db, fila.id, doctor_id, valor, commit=False)
        else:
            sin_match += 1
    return sin_match


def _pac_doctores_ordenados(db: Session, sheet_id: int) -> list[DesignPreApprovedDoctor]:
    return (db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_id)
            .order_by(DesignPreApprovedDoctor.orden, DesignPreApprovedDoctor.id).all())


def _pac_centros_ordenados(db: Session, sheet_id: int) -> list[DesignPreApprovedCentro]:
    return (db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_id)
            .order_by(DesignPreApprovedCentro.orden, DesignPreApprovedCentro.id).all())


def _pac_centro_de_doctor(db: Session, sheet_id: int, doctor_id: int) -> DesignPreApprovedCentro | None:
    doctores = _pac_doctores_ordenados(db, sheet_id)
    centros = _pac_centros_ordenados(db, sheet_id)
    idx = next((i for i, d in enumerate(doctores) if d.id == doctor_id), None)
    if idx is None:
        return None
    acumulado = 0
    for c in centros:
        if idx < acumulado + c.span:
            return c
        acumulado += c.span
    return centros[-1] if centros else None


def _pac_posicion_centro(db: Session, centro: DesignPreApprovedCentro) -> int:
    acumulado = 0
    for c in _pac_centros_ordenados(db, centro.sheet_id):
        if c.id == centro.id:
            return acumulado
        acumulado += c.span
    return acumulado


def _pac_doctores_del_centro(db: Session, centro: DesignPreApprovedCentro) -> list[DesignPreApprovedDoctor]:
    inicio = _pac_posicion_centro(db, centro)
    return _pac_doctores_ordenados(db, centro.sheet_id)[inicio:inicio + centro.span]


def _pac_insertar_doctor(db: Session, doctor: DesignPreApprovedDoctor, sheet_dst_id: int,
                         centro_dst_id: int | None, nombre_centro_si_nuevo: str) -> None:
    """Ubica `doctor` (ya con sheet_id = sheet_dst_id) en la posición del centro destino
    (o crea un centro nuevo al final) y renumera doctores/centros de la hoja destino."""
    if centro_dst_id is None:
        centros = _pac_centros_ordenados(db, sheet_dst_id)
        nuevo = DesignPreApprovedCentro(sheet_id=sheet_dst_id, nombre=nombre_centro_si_nuevo, span=1,
                                        orden=len(centros) + 1)
        db.add(nuevo)
        db.flush()
        insert_at = len(_pac_doctores_ordenados(db, sheet_dst_id)) - 1  # doctor ya está en la hoja, sin insertar aún
    else:
        centro = db.get(DesignPreApprovedCentro, centro_dst_id)
        span_original = centro.span
        centro.span = span_original + 1
        acumulado = 0
        insert_at = 0
        for c in _pac_centros_ordenados(db, sheet_dst_id):
            if c.id == centro_dst_id:
                acumulado += span_original
                insert_at = acumulado
                break
            acumulado += c.span

    doctores = [d for d in _pac_doctores_ordenados(db, sheet_dst_id) if d.id != doctor.id]
    doctores.insert(insert_at, doctor)
    for i, d in enumerate(doctores, start=1):
        d.orden = i


def _pac_destino_invalido(db: Session, sheet_src_id: int, sheet_dst_id: int, centro_dst_id: int | None) -> str | None:
    src, dst = db.get(DesignPreApprovedSheet, sheet_src_id), db.get(DesignPreApprovedSheet, sheet_dst_id)
    if not src or not dst:
        return "El manager de destino no existe."
    if src.area_id != dst.area_id:
        return "Solo se puede mover entre managers de la misma área."
    if centro_dst_id:
        c = db.get(DesignPreApprovedCentro, centro_dst_id)
        if not c or c.sheet_id != sheet_dst_id:
            return "El centro de destino no pertenece a ese manager."
    return None


def _pac_mover_doctor_mismo_manager(db: Session, doctor: DesignPreApprovedDoctor, centro_dst_id: int | None) -> dict:
    """Pasa un doctor de un centro a otro de la MISMA hoja (pedido por Rosember el 13-oct-2026: Dariana mueve doctores entre
    sus propios centros). Los valores y las fotos no cambian: es la misma hoja y los mismos criterios."""
    if not centro_dst_id:
        return {"error": "Elige el centro al que quieres pasar al doctor."}
    centro_origen = _pac_centro_de_doctor(db, doctor.sheet_id, doctor.id)
    if centro_origen and centro_origen.id == centro_dst_id:
        return {"error": "Ese doctor ya está en ese centro."}
    if centro_origen:
        centro_origen.span -= 1
        if centro_origen.span <= 0:
            db.delete(centro_origen)
        db.flush()
    _pac_insertar_doctor(db, doctor, doctor.sheet_id, centro_dst_id, "")
    db.commit()
    return {"unmatched": 0}


def _pac_intercambiar_fotos(db: Session, a_id: int, b_id: int) -> None:
    """Al intercambiar dos doctores se cambian el nombre y los valores; sus fotos también van con la persona."""
    from .models_design import DesignPreApprovedFoto as F
    ids_a = [r[0] for r in db.query(F.id).filter(F.doctor_id == a_id)]
    ids_b = [r[0] for r in db.query(F.id).filter(F.doctor_id == b_id)]
    if ids_a:
        db.query(F).filter(F.id.in_(ids_a)).update({"doctor_id": b_id}, synchronize_session=False)
    if ids_b:
        db.query(F).filter(F.id.in_(ids_b)).update({"doctor_id": a_id}, synchronize_session=False)


def pac_mover_doctor(db: Session, doctor_id: int, sheet_dst_id: int, centro_dst_id: int | None) -> dict:
    doctor = db.get(DesignPreApprovedDoctor, doctor_id)
    if not doctor:
        return {"error": "Doctor no encontrado."}
    err = _pac_destino_invalido(db, doctor.sheet_id, sheet_dst_id, centro_dst_id)
    if err:
        return {"error": err}
    sheet_src_id = doctor.sheet_id
    if sheet_src_id == sheet_dst_id:
        return _pac_mover_doctor_mismo_manager(db, doctor, centro_dst_id)
    if db.query(DesignPreApprovedDoctor).filter(DesignPreApprovedDoctor.sheet_id == sheet_src_id).count() <= 1:
        return {"error": "El manager origen no puede quedar sin doctores."}

    valores = _pac_valores_doctor(db, doctor_id)
    centro_origen = _pac_centro_de_doctor(db, sheet_src_id, doctor_id)
    nombre_centro_origen = centro_origen.nombre if centro_origen else ""

    db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id == doctor_id).delete()
    if centro_origen:
        centro_origen.span -= 1
        if centro_origen.span <= 0:
            db.delete(centro_origen)

    doctor.sheet_id = sheet_dst_id
    db.flush()
    _pac_insertar_doctor(db, doctor, sheet_dst_id, centro_dst_id, nombre_centro_origen)
    sin_match = _pac_aplicar_valores(db, doctor_id, sheet_dst_id, valores)
    db.commit()
    return {"unmatched": sin_match}


def pac_mover_centro(db: Session, centro_id: int, sheet_dst_id: int, centro_dst_id: int | None) -> dict:
    centro = db.get(DesignPreApprovedCentro, centro_id)
    if not centro:
        return {"error": "Centro no encontrado."}
    err = _pac_destino_invalido(db, centro.sheet_id, sheet_dst_id, centro_dst_id)
    if err:
        return {"error": err}
    sheet_src_id = centro.sheet_id
    if sheet_src_id == sheet_dst_id:
        return {"error": "Elige un manager de destino distinto."}
    if db.query(DesignPreApprovedCentro).filter(DesignPreApprovedCentro.sheet_id == sheet_src_id).count() <= 1:
        return {"error": "El manager origen no puede quedar sin centros."}

    doctores_bloque = _pac_doctores_del_centro(db, centro)
    valores_por_doctor = {d.id: _pac_valores_doctor(db, d.id) for d in doctores_bloque}
    nombre_centro = centro.nombre

    ids = [d.id for d in doctores_bloque]
    if ids:
        db.query(DesignPreApprovedCelda).filter(DesignPreApprovedCelda.doctor_id.in_(ids)).delete(synchronize_session=False)
    db.delete(centro)
    db.flush()

    if centro_dst_id is None:
        centros_dst = _pac_centros_ordenados(db, sheet_dst_id)
        nuevo = DesignPreApprovedCentro(sheet_id=sheet_dst_id, nombre=nombre_centro, span=len(doctores_bloque),
                                        orden=len(centros_dst) + 1)
        db.add(nuevo)
        db.flush()
        insert_at = len(_pac_doctores_ordenados(db, sheet_dst_id))
    else:
        centro_dst = db.get(DesignPreApprovedCentro, centro_dst_id)
        span_original = centro_dst.span
        centro_dst.span = span_original + len(doctores_bloque)
        acumulado = 0
        insert_at = 0
        for c in _pac_centros_ordenados(db, sheet_dst_id):
            if c.id == centro_dst_id:
                acumulado += span_original
                insert_at = acumulado
                break
            acumulado += c.span

    for d in doctores_bloque:
        d.sheet_id = sheet_dst_id
    doctores = [d for d in _pac_doctores_ordenados(db, sheet_dst_id) if d.id not in ids]
    doctores[insert_at:insert_at] = doctores_bloque
    for i, d in enumerate(doctores, start=1):
        d.orden = i
    db.flush()

    unmatched = 0
    for d in doctores_bloque:
        unmatched += _pac_aplicar_valores(db, d.id, sheet_dst_id, valores_por_doctor[d.id])
    db.commit()
    return {"unmatched": unmatched}


def pac_intercambiar_doctor(db: Session, doctor_a_id: int, doctor_b_id: int) -> dict:
    a = db.get(DesignPreApprovedDoctor, doctor_a_id)
    b = db.get(DesignPreApprovedDoctor, doctor_b_id)
    if not a or not b:
        return {"error": "Doctor no encontrado."}
    if a.id == b.id:
        return {"error": "Elige dos doctores distintos."}
    if a.sheet_id == b.sheet_id:   # dentro del mismo manager: tienen que estar en centros distintos
        ca, cb = _pac_centro_de_doctor(db, a.sheet_id, a.id), _pac_centro_de_doctor(db, b.sheet_id, b.id)
        if ca and cb and ca.id == cb.id:
            return {"error": "Esos dos doctores ya están en el mismo centro."}
    err = _pac_destino_invalido(db, a.sheet_id, b.sheet_id, None)
    if err:
        return {"error": err}

    valores_a = _pac_valores_doctor(db, doctor_a_id)
    valores_b = _pac_valores_doctor(db, doctor_b_id)
    sheet_a_id, sheet_b_id = a.sheet_id, b.sheet_id
    a.nombre, b.nombre = b.nombre, a.nombre

    db.query(DesignPreApprovedCelda).filter(
        DesignPreApprovedCelda.doctor_id.in_([doctor_a_id, doctor_b_id])).delete(synchronize_session=False)
    db.flush()

    unmatched = _pac_aplicar_valores(db, doctor_a_id, sheet_a_id, valores_b)
    unmatched += _pac_aplicar_valores(db, doctor_b_id, sheet_b_id, valores_a)
    _pac_intercambiar_fotos(db, doctor_a_id, doctor_b_id)
    db.commit()
    return {"unmatched": unmatched}


def pac_intercambiar_centro(db: Session, centro_a_id: int, centro_b_id: int) -> dict:
    a = db.get(DesignPreApprovedCentro, centro_a_id)
    b = db.get(DesignPreApprovedCentro, centro_b_id)
    if not a or not b:
        return {"error": "Centro no encontrado."}
    if a.sheet_id == b.sheet_id:
        return {"error": "Para intercambiar elige dos managers distintos."}
    err = _pac_destino_invalido(db, a.sheet_id, b.sheet_id, None)
    if err:
        return {"error": err}

    sheet_a_id, sheet_b_id = a.sheet_id, b.sheet_id
    doctores_a = _pac_doctores_del_centro(db, a)
    doctores_b = _pac_doctores_del_centro(db, b)
    valores_a = [_pac_valores_doctor(db, d.id) for d in doctores_a]
    valores_b = [_pac_valores_doctor(db, d.id) for d in doctores_b]
    nombres_a = [d.nombre for d in doctores_a]
    nombres_b = [d.nombre for d in doctores_b]
    nombre_centro_a, nombre_centro_b = a.nombre, b.nombre

    ids_borrar = [d.id for d in doctores_a] + [d.id for d in doctores_b]
    if ids_borrar:
        db.query(DesignPreApprovedCelda).filter(
            DesignPreApprovedCelda.doctor_id.in_(ids_borrar)).delete(synchronize_session=False)

    pos_a = _pac_posicion_centro(db, a)
    pos_b = _pac_posicion_centro(db, b)
    for d in doctores_a + doctores_b:
        db.delete(d)
    db.flush()

    nuevos_en_a = [DesignPreApprovedDoctor(sheet_id=sheet_a_id, nombre=n, orden=0) for n in nombres_b]
    nuevos_en_b = [DesignPreApprovedDoctor(sheet_id=sheet_b_id, nombre=n, orden=0) for n in nombres_a]
    for d in nuevos_en_a + nuevos_en_b:
        db.add(d)
    db.flush()

    resto_a = _pac_doctores_ordenados(db, sheet_a_id)
    resto_a[pos_a:pos_a] = nuevos_en_a
    for i, d in enumerate(resto_a, start=1):
        d.orden = i

    resto_b = _pac_doctores_ordenados(db, sheet_b_id)
    resto_b[pos_b:pos_b] = nuevos_en_b
    for i, d in enumerate(resto_b, start=1):
        d.orden = i

    a.nombre, a.span = nombre_centro_b, len(nuevos_en_a)
    b.nombre, b.span = nombre_centro_a, len(nuevos_en_b)
    db.flush()

    unmatched = 0
    for d, valores in zip(nuevos_en_a, valores_b):
        unmatched += _pac_aplicar_valores(db, d.id, sheet_a_id, valores)
    for d, valores in zip(nuevos_en_b, valores_a):
        unmatched += _pac_aplicar_valores(db, d.id, sheet_b_id, valores)
    from .models_design import DesignPreApprovedFoto as F   # las fotos siguen a cada doctor (los doctores se recrean)
    for viejo, nuevo in list(zip(doctores_a, nuevos_en_b)) + list(zip(doctores_b, nuevos_en_a)):
        db.query(F).filter(F.doctor_id == viejo.id).update({"doctor_id": nuevo.id}, synchronize_session=False)
    db.commit()
    return {"unmatched": unmatched}


# ---------------------------------------------------------------------------
# Desempeño (Performance) — acceso restringido a aprobadores y administradores (RR.HH.).
# ---------------------------------------------------------------------------

def perf_criterios(db: Session) -> list[DesignPerfCriterio]:
    return db.query(DesignPerfCriterio).order_by(DesignPerfCriterio.orden).all()


def perf_sheets(db: Session) -> list[DesignPerfSheet]:
    perf_quitar_una_vez(db)
    perf_meses_2026_una_vez(db)
    perf_hoja_zulys_una_vez(db)
    perf_hoja_leonardo_una_vez(db)
    return db.query(DesignPerfSheet).order_by(DesignPerfSheet.orden).all()


# Hoja de Desempeño para la aprobadora Zulys (N3) y su equipo (Rosember, 28-oct-2026). Se crea una sola vez, buscando en la
# base a la manager de un equipo activo de N3 cuyo nombre sea Zulys (o Zuly, Zully…): la hoja se llama «N3 Zulys» (como «N3
# Paula»), con los 12 meses de 2026, una fila por cada diseñador de su equipo (sin ella) y asociada a ella, para que la vea y
# califique solo la suya como las demás aprobadoras. Si todavía no está registrada como manager de un equipo de N3 con ese
# nombre, no hace nada ni marca, y lo intenta en el próximo arranque. Si ya existe una hoja con ese nombre, solo la asocia.
PERF_HOJA_ZULYS = {"marca": "perf_hoja_n3_zulys_2026_10_28", "nombre": "N3 Zulys", "area": "N3 Prosthetic", "anio": 2026,
                   "patron": r"\bzul+[iy]s?\b"}
# Igual para el aprobador Leonardo (N3) y su equipo (Rosember, 26-oct-2026): hoja «N3 Leonardo».
PERF_HOJA_LEONARDO = {"marca": "perf_hoja_n3_leonardo_2026_10_26", "nombre": "N3 Leonardo", "area": "N3 Prosthetic", "anio": 2026,
                      "patron": r"\bleonardo\b"}
_perf_hoja_zulys = {"ok": False}
_perf_hoja_leonardo = {"ok": False}
_MESES_ES = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")


def perf_hoja_zulys_una_vez(db: Session) -> None:
    _perf_hoja_aprobador_una_vez(db, PERF_HOJA_ZULYS, _perf_hoja_zulys)


def perf_hoja_leonardo_una_vez(db: Session) -> None:
    _perf_hoja_aprobador_una_vez(db, PERF_HOJA_LEONARDO, _perf_hoja_leonardo)


def _perf_hoja_aprobador_una_vez(db: Session, cfg: dict, estado: dict) -> None:
    from .models_design import DesignConexionRegla
    if estado["ok"]:
        return
    try:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == cfg["marca"]).first():
            estado["ok"] = True
            return
        area = db.query(DesignArea).filter(DesignArea.nombre == cfg["area"]).first()
        if not area:
            return
        equipos = (db.query(DesignTeam).options(joinedload(DesignTeam.manager),
                                                joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado))
                   .filter(DesignTeam.area_id == area.id, DesignTeam.activo == 1, DesignTeam.manager_id.isnot(None)).all())
        suyos = [t for t in equipos if t.manager and getattr(t.manager, "activo", 1)
                 and re.search(cfg["patron"], _normalizar_texto(t.manager.nombre_completo))]
        managers = {t.manager_id for t in suyos}
        if len(managers) != 1:   # ninguna todavía, o más de una persona con ese nombre: no se adivina
            if len(managers) > 1:
                log.warning("Design: hay más de un manager de %s que coincide con %s; no se crea la hoja automáticamente",
                            cfg["area"], cfg["nombre"])
            return
        manager = suyos[0].manager
        hoja = next((h for h in db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "eval").all()
                     if _normalizar_texto(h.nombre) == _normalizar_texto(cfg["nombre"])), None)
        creada = hoja is None
        if creada:
            gente = {}
            for t in suyos:
                for d in t.designers:
                    e = d.empleado
                    if e and getattr(e, "activo", 1) and e.id != manager.id:
                        gente[e.id] = e
            orden = (db.query(func.max(DesignPerfSheet.orden)).scalar() or 0) + 1
            hoja = DesignPerfSheet(nombre=cfg["nombre"], tipo="eval", orden=orden,
                                   meses=json.dumps([f"{m} {cfg['anio']}" for m in _MESES_ES], ensure_ascii=False))
            db.add(hoja)
            db.flush()
            for i, e in enumerate(sorted(gente.values(), key=lambda x: _normalizar_texto(x.nombre_completo)), start=1):
                db.add(DesignPerfEmpleado(sheet_id=hoja.id, nombre=e.nombre_completo, orden=i, totales_mes=json.dumps([0.0] * 12)))
        db.add(DesignConexionRegla(tipo="sistema", clave=cfg["marca"], creado_por="Sistema",
                                   valor=json.dumps({"hoja": hoja.nombre, "manager": manager.nombre_completo, "creada": creada}, ensure_ascii=False)))
        db.commit()
        _guardar_regla(db, "hoja_manager", hoja.nombre,
                       json.dumps({"area": cfg["area"], "manager": manager.nombre_completo, "managerId": manager.id}, ensure_ascii=False), "Sistema")
        estado["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# ---------- Desempeño: personas de una hoja (Rosember, 26-oct-2026) ----------
# Aprobadores (en la hoja de su equipo) y admins (en cualquier hoja de evaluación) agregan nuevas contrataciones, corrigen el
# nombre y quitan a quien ya no está. Quitar deja la fila con sus calificaciones en la Papelera (se puede restaurar 15 días).
# El aprobador no se toca a sí mismo ni a nadie en DESIGN MANAGERS (esa hoja es de los admins).

def perf_puede_gestionar_hoja(user: Empleado, sheet: DesignPerfSheet) -> bool:
    if sheet.tipo != "eval":
        return False
    if es_admin(user):
        return True
    return not _es_hoja_general(sheet.nombre) and perf_sheet_visible(user, sheet)


def _perf_nombre_limpio(nombre: str) -> str:
    return re.sub(r"\s+", " ", nombre or "").strip()


def _perf_nombre_repetido(sheet: DesignPerfSheet, nombre: str, salvo_id: int | None = None) -> bool:
    n = _normalizar_texto(nombre)
    return any(_normalizar_texto(e.nombre) == n and e.id != salvo_id for e in sheet.empleados)


def perf_agregar_persona(db: Session, sheet: DesignPerfSheet, nombre: str) -> tuple[DesignPerfEmpleado | None, str | None]:
    nombre = _perf_nombre_limpio(nombre)
    if not nombre:
        return None, "Escribe el nombre de la persona."
    if len(nombre) > 150:
        return None, "El nombre es demasiado largo."
    if _perf_nombre_repetido(sheet, nombre):
        return None, f"{nombre} ya está en esta hoja."
    n_meses = len(json.loads(sheet.meses or "[]")) or 12
    orden = max((e.orden or 0 for e in sheet.empleados), default=0) + 1
    e = DesignPerfEmpleado(sheet_id=sheet.id, nombre=nombre, orden=orden, totales_mes=json.dumps([0.0] * n_meses))
    db.add(e)
    db.commit()
    return e, None


def perf_renombrar_persona(db: Session, emp: DesignPerfEmpleado, nombre: str) -> str | None:
    nombre = _perf_nombre_limpio(nombre)
    if not nombre:
        return "Escribe el nombre de la persona."
    if len(nombre) > 150:
        return "El nombre es demasiado largo."
    if _perf_nombre_repetido(emp.sheet, nombre, salvo_id=emp.id):
        return f"{nombre} ya está en esta hoja."
    emp.nombre = nombre
    db.commit()
    return None


def perf_quitar_persona(db: Session, emp: DesignPerfEmpleado, por: str) -> None:
    _trash_registrar(db, "perf-emp", f"Desempeño {emp.sheet.nombre}: {emp.nombre}", _snapshot_fila(emp), por)
    db.delete(emp)
    db.commit()


# Desempeño › N6 Marlene (Rosember, 28-oct-2026): los títulos de los meses de esa hoja decían 2025 y debían decir 2026
# (p. ej. «Oct 2025» → «Oct 2026»). Solo se cambia el año de los títulos de ESA hoja; las calificaciones van por la posición
# del mes y no se tocan. Una sola vez (marca en design_conexion_reglas); si la hoja todavía no existe, no marca y espera.
PERF_MESES_2026 = {"marca": "perf_meses_n6_marlene_a_2026_2026_10_28", "hoja": "N6 Marlene"}
_perf_meses_2026 = {"ok": False}


def perf_meses_2026_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _perf_meses_2026["ok"]:
        return
    try:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == PERF_MESES_2026["marca"]).first():
            _perf_meses_2026["ok"] = True
            return
        hojas = [h for h in db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "eval").all()
                 if _normalizar_texto(h.nombre) == _normalizar_texto(PERF_MESES_2026["hoja"])]
        if not hojas:
            return
        cambios = []
        for hoja in hojas:   # normalmente es una sola
            antes = json.loads(hoja.meses or "[]")
            despues = [re.sub(r"\b2025\b", "2026", x) if isinstance(x, str) else x for x in antes]
            if despues != antes:
                hoja.meses = json.dumps(despues, ensure_ascii=False)
            cambios.append({"hoja": hoja.nombre, "id": hoja.id, "antes": antes, "despues": despues})
        db.add(DesignConexionRegla(tipo="sistema", clave=PERF_MESES_2026["marca"], creado_por="Sistema",
                                   valor=json.dumps(cambios, ensure_ascii=False)))
        db.commit()
        _perf_meses_2026["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# Filas de Desempeño que se quitan una sola vez (pedido por Rosember). Cada una: el área cuyas hojas se revisan,
# las palabras del nombre (todas las de "todas" y al menos una de "alguna", sin tildes ni mayúsculas) y el motivo.
# La fila queda en la Papelera (se puede restaurar). Lo hecho queda anotado en design_conexion_reglas (tipo sistema).
PERF_QUITAR_UNA_VEZ = [
    {"marca": "perf_quitar_angelica_gallardo_n6_2026_10_12", "area": "N6 Material Changes",
     "todas": {"gallardo"}, "alguna": {"angelica", "anyelica", "angelika"},
     "motivo": "ya no pertenece a N6; ahora está en el equipo de Mauricio (12-oct-2026)"},
]
_perf_quitar = {"ok": False}


def perf_quitar_una_vez(db: Session) -> None:
    from .models_design import DesignConexionRegla
    if _perf_quitar["ok"]:
        return
    try:
        hechas = {r.clave for r in db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema",
                                                                     DesignConexionRegla.clave.in_([x["marca"] for x in PERF_QUITAR_UNA_VEZ]))}
        for x in PERF_QUITAR_UNA_VEZ:
            if x["marca"] in hechas:
                continue
            hojas = [h for h in db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "eval").all()
                     if (SHEET_MANAGER_MAP.get(h.nombre) or ("",))[0] == x["area"]
                     or _normalizar_texto(h.nombre).startswith(_normalizar_texto(x["area"]).split()[0] + " ")]
            quitadas = []
            for h in hojas:
                for e in list(h.empleados):
                    pal = _palabras(e.nombre)
                    if x["todas"] <= pal and pal & x["alguna"]:
                        _trash_registrar(db, "perf-emp", f"Desempeño {h.nombre}: {e.nombre}", _snapshot_fila(e), "Sistema")
                        quitadas.append(f"{h.nombre}: {e.nombre}")
                        db.delete(e)
            db.add(DesignConexionRegla(tipo="sistema", clave=x["marca"], creado_por="Sistema",
                                       valor=json.dumps({"quitadas": quitadas, "motivo": x["motivo"]}, ensure_ascii=False)))
            db.commit()
        _perf_quitar["ok"] = True
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


# Porcentaje de cada nivel de calificación. Todos los criterios pesan igual y un criterio sin calificar
# cuenta como 0 %. El frontend usa la misma tabla (PF_PCT) para recalcular al instante.
PERF_PORCENTAJE_NIVEL = {"ALTO": 100, "SOBRESALIENTE": 95, "MEDIO": 50, "BAJO": 0, "": 0}


def perf_totales(celdas: dict, criterio_ids: list[int], n_meses: int) -> tuple[list[float], float]:
    """(total de cada mes, total general) como fracción 0-1. Total general = promedio de los meses que tienen
    al menos un criterio calificado (los meses sin calificar no cuentan)."""
    totales, calificados = [], []
    for m in range(n_meses):
        niveles = [(celdas.get(f"{cid}_{m}") or {}).get("nivel", "") for cid in criterio_ids]
        total = (sum(PERF_PORCENTAJE_NIVEL.get(n, 0) for n in niveles) / len(criterio_ids) / 100) if criterio_ids else 0
        totales.append(total)
        if any(niveles):
            calificados.append(total)
    return totales, (sum(calificados) / len(calificados) if calificados else 0)


def perf_detalle_eval(db: Session, sheet_id: int) -> dict | None:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet or sheet.tipo != "eval":
        return None
    criterios = perf_criterios(db)
    empleados = (db.query(DesignPerfEmpleado)
        .filter(DesignPerfEmpleado.sheet_id == sheet_id)
        .order_by(DesignPerfEmpleado.orden).all())
    celdas_por_emp: dict[int, dict] = {}
    if empleados:
        emp_ids = [e.id for e in empleados]
        for c in db.query(DesignPerfCelda).filter(DesignPerfCelda.empleado_id.in_(emp_ids)).all():
            celdas_por_emp.setdefault(c.empleado_id, {})[f"{c.criterio_id}_{c.mes_indice}"] = {
                "nivel": c.nivel, "puntaje": PERF_PORCENTAJE_NIVEL.get(c.nivel, 0)}
    meses = json.loads(sheet.meses or "[]")
    criterio_ids = [c.id for c in criterios]
    salida = []
    for e in empleados:
        # Los totales se calculan siempre; los importados de Excel (e.totales_mes / e.total) ya no se usan.
        celdas = celdas_por_emp.get(e.id, {})
        totales, total = perf_totales(celdas, criterio_ids, len(meses))
        salida.append({"id": e.id, "nombre": e.nombre, "nota": e.nota, "total": total,
                       "totalesMes": totales, "celdas": celdas})
    return {
        "id": sheet.id, "nombre": sheet.nombre, "tipo": sheet.tipo, "meses": meses,
        "criterios": [{"id": c.id, "nombre": c.nombre} for c in criterios],
        "empleados": salida,
    }


PERF_MAX_MESES = 60


def perf_guardar_celda(db: Session, empleado_id: int, criterio_id: int, mes_indice: int,
                       nivel: str, puntaje: float) -> None:
    if not 0 <= mes_indice < PERF_MAX_MESES:
        return
    c = (db.query(DesignPerfCelda)
        .filter(DesignPerfCelda.empleado_id == empleado_id, DesignPerfCelda.criterio_id == criterio_id,
                DesignPerfCelda.mes_indice == mes_indice).first())
    if not c:
        c = DesignPerfCelda(empleado_id=empleado_id, criterio_id=criterio_id, mes_indice=mes_indice)
        db.add(c)
    c.nivel = nivel if nivel in PERF_PORCENTAJE_NIVEL else ""
    c.puntaje = PERF_PORCENTAJE_NIVEL[c.nivel]  # el porcentaje sale del nivel; no se edita a mano
    db.commit()


def perf_guardar_nota(db: Session, empleado_id: int, nota: str) -> None:
    e = db.get(DesignPerfEmpleado, empleado_id)
    if e:
        e.nota = nota
        db.commit()


def perf_detalle_seleccion(db: Session, sheet_id: int) -> dict | None:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet or sheet.tipo != "seleccion":
        return None
    ganadores = (db.query(DesignPerfGanador).filter(DesignPerfGanador.sheet_id == sheet_id)
        .order_by(DesignPerfGanador.orden).all())
    filas = (db.query(DesignPerfSeleccionFila).filter(DesignPerfSeleccionFila.sheet_id == sheet_id)
        .order_by(DesignPerfSeleccionFila.orden).all())
    filas_out = []
    for f in filas:
        celdas = {c.mes_indice: {"persona": c.persona, "puntaje": c.puntaje, "nota": c.nota}
                  for c in db.query(DesignPerfSeleccionCelda).filter(DesignPerfSeleccionCelda.fila_id == f.id).all()}
        filas_out.append({"id": f.id, "evaluador": f.evaluador, "celdas": celdas})
    return {
        "id": sheet.id, "nombre": sheet.nombre, "tipo": sheet.tipo,
        "meses": json.loads(sheet.meses or "[]"),
        "ganadores": [{"id": g.id, "categoria": g.categoria,
                       "ganadoresMes": json.loads(g.ganadores_mes or "[]")} for g in ganadores],
        "filas": filas_out,
    }


def perf_renombrar_categoria(db: Session, ganador_id: int, categoria: str) -> str:
    """Empleado del mes › Categoría (Rosember, 22-oct-2026): el admin corrige el texto de la categoría. Solo cambia el
    nombre de la fila; los ganadores ya registrados se quedan."""
    g = db.get(DesignPerfGanador, ganador_id)
    if not g:
        raise LookupError("Esa categoría ya no existe.")
    nuevo = re.sub(r"\s+", " ", categoria or "").strip()[:150]
    if not nuevo:
        raise ValueError("La categoría no puede quedar vacía.")
    g.categoria = nuevo
    db.commit()
    return nuevo


def perf_guardar_ganador_mes(db: Session, ganador_id: int, mes_indice: int, nombre: str) -> None:
    g = db.get(DesignPerfGanador, ganador_id)
    if not g or not 0 <= mes_indice < PERF_MAX_MESES:
        return
    valores = json.loads(g.ganadores_mes or "[]")
    while len(valores) <= mes_indice:
        valores.append("")
    valores[mes_indice] = nombre
    g.ganadores_mes = json.dumps(valores, ensure_ascii=False)
    db.commit()


def perf_guardar_celda_seleccion(db: Session, fila_id: int, mes_indice: int,
                                 persona: str, puntaje: str, nota: str) -> None:
    c = (db.query(DesignPerfSeleccionCelda)
        .filter(DesignPerfSeleccionCelda.fila_id == fila_id,
                DesignPerfSeleccionCelda.mes_indice == mes_indice).first())
    if not c:
        c = DesignPerfSeleccionCelda(fila_id=fila_id, mes_indice=mes_indice)
        db.add(c)
    c.persona = persona
    c.puntaje = puntaje
    c.nota = nota
    db.commit()


# ---------- Desempeño: quién ve y califica qué ----------
# Admins: todo. Un aprobador ve y califica solo la hoja de evaluación de su equipo (SHEET_MANAGER_MAP: la
# hoja "N3 Paula" es del manager "Paula Parra") y nunca su propia fila. En la hoja de selección solo edita
# su fila de evaluador; "Empleado del mes" (ganadores) y las hojas sin manager (DESIGN MANAGERS) son de
# los admins. Los nombres de Desempeño son texto libre, así que se comparan como en la importación de
# equipos (_buscar_empleado_por_nombre), que exige una coincidencia clara de palabras.

def _es_la_persona(nombre: str, user: Empleado) -> bool:
    return _buscar_empleado_por_nombre(nombre or "", [user]) is not None


def perf_sheet_visible(user: Empleado, sheet: DesignPerfSheet) -> bool:
    if es_admin(user) or sheet.tipo == "seleccion":
        return True
    if _es_hoja_general(sheet.nombre):  # DESIGN MANAGERS: el aprobador la ve si tiene su fila (solo verá esa fila)
        return any(_es_la_persona(e.nombre, user) for e in sheet.empleados)
    from sqlalchemy.orm import object_session
    db = object_session(sheet)
    mapeo = (mapa_hojas(db) if db else SHEET_MANAGER_MAP).get(sheet.nombre)
    return bool(mapeo) and _es_la_persona(mapeo[1], user)


def perf_puede_calificar(user: Empleado, emp: DesignPerfEmpleado) -> bool:
    if es_admin(user):
        return True
    return (emp.sheet.tipo == "eval" and perf_sheet_visible(user, emp.sheet)
            and not _es_la_persona(emp.nombre, user))


def perf_puede_editar_fila_seleccion(user: Empleado, fila: DesignPerfSeleccionFila) -> bool:
    return es_admin(user) or _es_la_persona(fila.evaluador, user)


# ---------------------------------------------------------------------------
# Papelera (Trash)
# ---------------------------------------------------------------------------

def _trash_registrar(db: Session, modulo: str, etiqueta: str, payload: dict, eliminado_por: str) -> DesignTrash:
    t = DesignTrash(modulo=modulo, etiqueta=etiqueta, payload=json.dumps(payload, ensure_ascii=False),
                    eliminado_por=eliminado_por or "Sistema")
    db.add(t)
    return t


# La Papelera se limpia sola: lo que entra se borra a los 15 días (pedido por Rosember el 12-oct-2026). El historial de
# Openings (design_openings_historial) NO se borra. Se revisa como mucho una vez al día, al abrir Design o la Papelera.
PAPELERA_DIAS = 15
_purga_papelera = {"dia": None}


def trash_purgar(db: Session, dias: int = PAPELERA_DIAS, forzar: bool = False) -> int:
    hoy = ahora_colombia().date()
    if _purga_papelera["dia"] == hoy and not forzar:
        return 0
    try:
        limite = datetime.utcnow() - timedelta(days=dias)
        n = db.query(DesignTrash).filter(DesignTrash.eliminado_en < limite).delete(synchronize_session=False)
        db.commit()
        _purga_papelera["dia"] = hoy
        return n
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()
        return 0


def trash_listar(db: Session) -> list[DesignTrash]:
    trash_purgar(db)
    return db.query(DesignTrash).options(defer(DesignTrash.payload)).order_by(DesignTrash.eliminado_en.desc()).all()


def trash_eliminar_permanente(db: Session, trash_id: int) -> bool:
    t = db.get(DesignTrash, trash_id)
    if not t:
        return False
    db.delete(t)
    db.commit()
    return True


def trash_vaciar(db: Session) -> None:
    db.query(DesignTrash).delete()
    db.commit()


def _trash_restaurar_pa_sheet(db: Session, payload: dict) -> bool:
    area_id = payload.get("area_id")
    det = payload.get("detalle") or {}
    if not area_id or not db.get(DesignArea, area_id) or not det:
        return False
    orden = db.query(DesignPreApprovedSheet).filter(DesignPreApprovedSheet.area_id == area_id).count() + 1
    s = DesignPreApprovedSheet(area_id=area_id, nombre=det.get("nombre", ""), titulo=det.get("titulo", ""),
                               changes_label=det.get("changesLabel", ""), orden=payload.get("orden") or orden)
    db.add(s)
    db.flush()
    for j, c in enumerate(det.get("centros", []), start=1):
        db.add(DesignPreApprovedCentro(sheet_id=s.id, nombre=c.get("nombre", ""), span=c.get("span") or 1, orden=j))
    doctor_map = {}
    for j, doc in enumerate(det.get("doctores", []), start=1):
        d = DesignPreApprovedDoctor(sheet_id=s.id, nombre=doc.get("nombre", ""), orden=j)
        db.add(d)
        db.flush()
        doctor_map[doc["id"]] = d.id
    for j, fila in enumerate(det.get("filas", []), start=1):
        f = DesignPreApprovedFila(sheet_id=s.id, criterio=fila.get("criterio", ""), orden=j)
        db.add(f)
        db.flush()
        for old_doc_id_str, valor in (fila.get("valores") or {}).items():
            if not valor:
                continue
            new_doc_id = doctor_map.get(int(old_doc_id_str))
            if new_doc_id:
                db.add(DesignPreApprovedCelda(fila_id=f.id, doctor_id=new_doc_id, valor=valor))
    return True


def _trash_restaurar_pa_centro(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = (db.query(func.max(DesignPreApprovedCentro.orden))
             .filter(DesignPreApprovedCentro.sheet_id == sheet_id).scalar() or 0) + 1
    doctores = payload.get("doctores")
    if doctores is None:  # borrados antes de este cambio: solo el encabezado
        db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre=payload.get("nombre", ""),
                                       span=payload.get("span") or 1, orden=orden))
        return True
    db.add(DesignPreApprovedCentro(sheet_id=sheet_id, nombre=payload.get("nombre", ""), span=max(1, len(doctores)), orden=orden))
    ult = (db.query(func.max(DesignPreApprovedDoctor.orden))
           .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0)
    for k, doc in enumerate(doctores or [{"nombre": "Dr. ", "celdas": []}], start=1):
        d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=doc.get("nombre", ""), orden=ult + k)
        db.add(d)
        db.flush()
        for c in doc.get("celdas", []):
            if db.get(DesignPreApprovedFila, c.get("fila_id")):
                db.add(DesignPreApprovedCelda(fila_id=c["fila_id"], doctor_id=d.id, valor=c.get("valor", "")))
    return True


def _trash_restaurar_pa_doctor(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = (db.query(func.max(DesignPreApprovedDoctor.orden))
             .filter(DesignPreApprovedDoctor.sheet_id == sheet_id).scalar() or 0) + 1
    d = DesignPreApprovedDoctor(sheet_id=sheet_id, nombre=payload.get("nombre", ""), orden=orden)
    db.add(d)
    db.flush()
    if "centro_id" in payload:  # vuelve a su centro (o a uno nuevo con su nombre si ya no existe)
        centro = db.get(DesignPreApprovedCentro, payload.get("centro_id") or 0)
        _pac_insertar_doctor(db, d, sheet_id, centro.id if centro and centro.sheet_id == sheet_id else None,
                             payload.get("centro_nombre", ""))
    for c in payload.get("celdas", []):
        if db.get(DesignPreApprovedFila, c.get("fila_id")):
            db.add(DesignPreApprovedCelda(fila_id=c["fila_id"], doctor_id=d.id, valor=c.get("valor", "")))
    return True


def _trash_restaurar_pa_fila(db: Session, payload: dict) -> bool:
    sheet_id = payload.get("sheet_id")
    if not db.get(DesignPreApprovedSheet, sheet_id):
        return False
    orden = db.query(DesignPreApprovedFila).filter(DesignPreApprovedFila.sheet_id == sheet_id).count() + 1
    f = DesignPreApprovedFila(sheet_id=sheet_id, criterio=payload.get("criterio", ""), orden=orden)
    db.add(f)
    db.flush()
    for c in payload.get("celdas", []):
        if db.get(DesignPreApprovedDoctor, c.get("doctor_id")):
            db.add(DesignPreApprovedCelda(fila_id=f.id, doctor_id=c["doctor_id"], valor=c.get("valor", "")))
    return True


def _trash_restaurar_cv_doc(db: Session, payload: dict) -> bool:
    area_id = payload.get("area_id")
    doc = payload.get("doc") or {}
    if not area_id or not db.get(DesignArea, area_id) or not doc:
        return False
    dueno_id = payload.get("dueno_id")  # hojas borradas antes de que tuvieran dueño: quedan sin dueño (no se listan)
    orden = payload.get("orden") or (db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id,
                                                                      DesignCanvasDoc.empleado_id == dueno_id).count() + 1)
    db.add(DesignCanvasDoc(area_id=area_id, empleado_id=dueno_id, nombre=doc.get("nombre", "Hoja"), template_id=doc.get("templateId", ""),
                           titulo=doc.get("titulo", ""), titulo_color=doc.get("tituloColor") or "#d10a11",
                           w=doc.get("w") or 1080, h=doc.get("h") or 1080,
                           frames=json.dumps(doc.get("frames", []), ensure_ascii=False),
                           elements=json.dumps(doc.get("elements", []), ensure_ascii=False),
                           orden=orden, creado_por=doc.get("creadoPor", "")))
    return True


def _trash_restaurar_cmt_template(db: Session, payload: dict) -> bool:
    t = payload.get("template") or {}
    if not t.get("nombre") or not t.get("texto"):
        return False
    orden = db.query(DesignComentarioTemplate).count() + 1
    db.add(DesignComentarioTemplate(nombre=t["nombre"], texto=t["texto"], orden=orden,
                                    creado_por=t.get("creado_por", "")))
    return True


def _trash_restaurar_perf_emp(db: Session, payload: dict) -> bool:
    if not db.get(DesignPerfSheet, payload.get("sheet_id")):
        return False
    e = DesignPerfEmpleado(sheet_id=payload["sheet_id"], nombre=payload.get("nombre", ""), nota=payload.get("nota", ""),
                           orden=payload.get("orden", 0))
    db.add(e)
    db.flush()
    criterios = {c.id for c in db.query(DesignPerfCriterio).all()}
    for c in payload.get("celdas", []):
        if c.get("criterio_id") in criterios:
            db.add(DesignPerfCelda(empleado_id=e.id, criterio_id=c["criterio_id"], mes_indice=c["mes_indice"],
                                   nivel=c.get("nivel", ""), puntaje=c.get("puntaje", 0)))
    db.commit()
    return True


def _trash_restaurar_pa_valores(db: Session, payload: dict) -> bool:
    """Valores de Pre-Approved reemplazados en lote (actualización desde el Excel): vuelven los de antes."""
    n = 0
    for c in payload.get("celdas", []):
        if preapproved_guardar_celda(db, c.get("fila_id") or 0, c.get("doctor_id") or 0, c.get("valor", ""), commit=False):
            n += 1
    return n > 0


_TRASH_RESTAURADORES = {
    "pa-valores": _trash_restaurar_pa_valores,
    "perf-emp": _trash_restaurar_perf_emp,
    "pa-sheet": _trash_restaurar_pa_sheet,
    "pa-centro": _trash_restaurar_pa_centro,
    "pa-doctor": _trash_restaurar_pa_doctor,
    "pa-fila": _trash_restaurar_pa_fila,
    "cv-doc": _trash_restaurar_cv_doc,
    "cmt-template": _trash_restaurar_cmt_template,
    "faq-hoja": _trash_restaurar_faq_hoja,
    "faq-fila": _trash_restaurar_faq_fila,
    "faq-col": _trash_restaurar_faq_col,
}


def trash_restaurar(db: Session, trash_id: int) -> bool:
    t = db.get(DesignTrash, trash_id)
    if not t:
        return False
    restaurador = _TRASH_RESTAURADORES.get(t.modulo)
    if not restaurador:
        return False
    payload = json.loads(t.payload)
    try:
        ok = restaurador(db, payload)
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()
        return False
    if ok:
        db.delete(t)
        db.commit()
    else:
        db.rollback()
    return ok


# ---------------------------------------------------------------------------
# Favoritos
# ---------------------------------------------------------------------------

def favoritos_de(db: Session, empleado_id: int, pa_areas: set[int] | None = None) -> list[dict]:
    favs = (db.query(DesignFavorito).filter(DesignFavorito.empleado_id == empleado_id)
           .order_by(DesignFavorito.creado_en.desc()).all())
    out = []
    huerfanos = []
    for f in favs:
        if f.tipo == "team":
            t = db.get(DesignTeam, f.team_id)
            if not t:
                huerfanos.append(f.id)
                continue
            out.append({"id": f.id, "tipo": "team", "etiqueta": t.area.nombre + " — " + t.nombre,
                       "areaId": t.area_id, "teamId": t.id})
        elif f.tipo == "preapproved":
            s = db.get(DesignPreApprovedSheet, f.preapproved_sheet_id)
            if not s:
                huerfanos.append(f.id)
                continue
            if pa_areas is not None and s.area_id not in pa_areas:
                continue  # hoja de un área que ya no ve
            out.append({"id": f.id, "tipo": "preapproved", "etiqueta": "Pre-Approved — " + s.nombre,
                       "areaId": s.area_id, "sheetId": s.id})
    if huerfanos:
        db.query(DesignFavorito).filter(DesignFavorito.id.in_(huerfanos)).delete(synchronize_session=False)
        db.commit()
    return out


def favorito_toggle_team(db: Session, empleado_id: int, team_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "team",
                DesignFavorito.team_id == team_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="team", team_id=team_id))
    db.commit()
    return True


def favorito_toggle_preapproved(db: Session, empleado_id: int, sheet_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "preapproved",
                DesignFavorito.preapproved_sheet_id == sheet_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="preapproved", preapproved_sheet_id=sheet_id))
    db.commit()
    return True


def favorito_toggle_cmt_template(db: Session, empleado_id: int, template_id: int) -> bool:
    existente = (db.query(DesignFavorito)
        .filter(DesignFavorito.empleado_id == empleado_id, DesignFavorito.tipo == "cmt_template",
                DesignFavorito.cmt_template_id == template_id).first())
    if existente:
        db.delete(existente)
        db.commit()
        return False
    db.add(DesignFavorito(empleado_id=empleado_id, tipo="cmt_template", cmt_template_id=template_id))
    db.commit()
    return True


def favoritos_activos(db: Session, empleado_id: int) -> dict:
    favs = db.query(DesignFavorito).filter(DesignFavorito.empleado_id == empleado_id).all()
    return {
        "teams": {f.team_id for f in favs if f.tipo == "team"},
        "preapproved": {f.preapproved_sheet_id for f in favs if f.tipo == "preapproved"},
        "cmtTemplates": {f.cmt_template_id for f in favs if f.tipo == "cmt_template"},
    }


# Protocols (biblioteca de SOPs con PDF, versiones y borradores en Nuvia Office) se retiró el 21-oct-2026 (Rosember):
# sus tablas se borraron al arrancar (ver main.design_retirar_protocolos).


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------

def canvas_serializar(d: DesignCanvasDoc) -> dict:
    return {
        "id": d.id, "areaId": d.area_id, "nombre": d.nombre, "templateId": d.template_id,
        "titulo": d.titulo, "tituloColor": d.titulo_color, "w": d.w, "h": d.h,
        "frames": json.loads(d.frames or "[]"), "elements": json.loads(d.elements or "[]"),
        "orden": d.orden, "creadoPor": d.creado_por,
    }


# Cada persona tiene sus propias hojas de Canvas por área (desde el 9-oct-2026): nadie edita las de otra.
# Las hojas compartidas de antes (empleado_id NULL) se dejan como estaban, sin listarse.
# Desde el 26-oct-2026 (Rosember) el Canvas se trabaja en el navegador de cada persona y aquí queda solo su respaldo
# privado: nadie más las ve (se quitó «Ver hojas de» para managers y admins).

def canvas_personas_visibles(db: Session, user: Empleado, area_id: int) -> list[dict]:
    """Personas cuyas hojas de Canvas puede ver `user` además de las suyas: ninguna desde el 26-oct-2026."""
    return []


def canvas_puede_ver(db: Session, user: Empleado, dueno_id: int | None, area_id: int) -> bool:
    """Solo el dueño ve sus hojas (26-oct-2026)."""
    return dueno_id is not None and dueno_id == user.id


def _canvas_sembrar(db: Session, area_id: int, empleado_id: int) -> None:
    """Primera vez de una persona en un área: recibe las hojas base con su formato inicial (sin fotos)."""
    from .main import CANVAS_TEMPLATES  # import tardío: main importa este módulo
    for i, tpl in enumerate(CANVAS_TEMPLATES, start=1):
        db.add(DesignCanvasDoc(area_id=area_id, empleado_id=empleado_id, nombre=tpl["nombre"], template_id=tpl["id"],
                               titulo=tpl["titulo"], orden=i,
                               frames=json.dumps([{"id": f"f{j}", **f, "img": None} for j, f in enumerate(tpl["frames"])],
                                                 ensure_ascii=False)))
    db.commit()


def canvas_docs(db: Session, area_id: int, user: Empleado, ver_de: int | None = None) -> list[dict] | None:
    """Hojas de `user` en el área, o las de `ver_de` si `user` puede verlas (None = no autorizado)."""
    dueno = ver_de or user.id
    if dueno != user.id and not canvas_puede_ver(db, user, dueno, area_id):
        return None
    q = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id, DesignCanvasDoc.empleado_id == dueno)
    if dueno == user.id and q.count() == 0:
        _canvas_sembrar(db, area_id, dueno)
    return [canvas_serializar(d) for d in q.order_by(DesignCanvasDoc.orden).all()]


def canvas_doc(db: Session, doc_id: int, user: Empleado) -> dict | None:
    d = db.get(DesignCanvasDoc, doc_id)
    return canvas_serializar(d) if d and canvas_puede_ver(db, user, d.empleado_id, d.area_id) else None


def canvas_doc_propio(db: Session, doc_id: int, user: Empleado) -> DesignCanvasDoc | None:
    """La hoja solo si es de `user`: guardar, renombrar, duplicar, mover y eliminar son del dueño."""
    d = db.get(DesignCanvasDoc, doc_id)
    return d if d and d.empleado_id == user.id else None


def canvas_crear_doc(db: Session, area_id: int, nombre: str, template_id: str, titulo: str,
                     frames: list, user: Empleado) -> DesignCanvasDoc:
    orden = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area_id,
                                             DesignCanvasDoc.empleado_id == user.id).count() + 1
    d = DesignCanvasDoc(area_id=area_id, empleado_id=user.id, nombre=nombre or "Hoja", template_id=template_id or "",
                       titulo=titulo or "", frames=json.dumps(frames or [], ensure_ascii=False),
                       orden=orden, creado_por=user.nombre_completo)
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


_CV_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_CV_IMG = re.compile(r"^data:image/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$")
_CV_NUM = ("x", "y", "w", "h", "r", "x1", "y1", "x2", "y2", "stroke", "size", "rot", "zoom", "ox", "oy", "sx", "sy")


def _cv_num(v, defecto=0):
    try:
        f = float(v)
        return f if f == f and abs(f) < 1e7 else defecto  # descarta NaN y valores absurdos
    except (TypeError, ValueError):
        return defecto


def _cv_limpiar(obj: dict) -> dict:
    """Deja solo datos seguros para dibujar: números en coordenadas, colores #hex e imágenes data:image."""
    if not isinstance(obj, dict):
        return {}
    o = dict(obj)
    for k in _CV_NUM:
        if k in o and not isinstance(o[k], (int, float)):
            o[k] = _cv_num(o[k])
    if "color" in o and not (isinstance(o["color"], str) and _CV_COLOR.match(o["color"])):
        o["color"] = "#e11d1d"
    if "n" in o:
        o["n"] = int(_cv_num(o["n"], 1))
    if "id" in o:
        o["id"] = re.sub(r"[^A-Za-z0-9_-]", "", str(o["id"]))[:40]
    if isinstance(o.get("points"), list):
        o["points"] = [{"x": _cv_num(p.get("x")), "y": _cv_num(p.get("y"))} for p in o["points"] if isinstance(p, dict)]
    img = o.get("img")
    if isinstance(img, dict):
        if not (isinstance(img.get("src"), str) and _CV_IMG.match(img["src"][:200] + ("" if len(img["src"]) <= 200 else "A"))):
            o["img"] = None
        else:
            o["img"] = {k: (v if k == "src" or isinstance(v, (int, float, bool)) or v is None else _cv_num(v)) for k, v in img.items()}
    elif img is not None:
        o["img"] = None
    return o


def canvas_guardar_doc(db: Session, doc_id: int, datos: dict, user: Empleado) -> DesignCanvasDoc | None:
    d = canvas_doc_propio(db, doc_id, user)
    if not d:
        return None
    if "tituloColor" in datos and not (isinstance(datos["tituloColor"], str) and _CV_COLOR.match(datos["tituloColor"] or "")):
        datos = {**datos, "tituloColor": None}
    if "frames" in datos and datos["frames"] is not None:
        datos = {**datos, "frames": [_cv_limpiar(f) for f in datos["frames"] if isinstance(f, dict)]}
    if "elements" in datos and datos["elements"] is not None:
        datos = {**datos, "elements": [_cv_limpiar(e) for e in datos["elements"] if isinstance(e, dict)]}
    if "nombre" in datos:
        d.nombre = datos["nombre"] or d.nombre
    if "titulo" in datos:
        d.titulo = datos["titulo"]
    if "tituloColor" in datos:
        d.titulo_color = datos["tituloColor"] or d.titulo_color
    if "w" in datos and datos["w"]:
        d.w = int(datos["w"])
    if "h" in datos and datos["h"]:
        d.h = int(datos["h"])
    if "frames" in datos and datos["frames"] is not None:
        d.frames = json.dumps(datos["frames"], ensure_ascii=False)
    if "elements" in datos and datos["elements"] is not None:
        d.elements = json.dumps(datos["elements"], ensure_ascii=False)
    db.commit()
    return d


def canvas_renombrar_doc(db: Session, doc_id: int, nombre: str, user: Empleado) -> bool:
    d = canvas_doc_propio(db, doc_id, user)
    if not d:
        return False
    d.nombre = nombre.strip() or d.nombre
    db.commit()
    return True


def canvas_duplicar_doc(db: Session, doc_id: int, user: Empleado) -> DesignCanvasDoc | None:
    d = canvas_doc_propio(db, doc_id, user)
    if not d:
        return None
    orden = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id,
                                             DesignCanvasDoc.empleado_id == user.id).count() + 1
    copia = DesignCanvasDoc(area_id=d.area_id, empleado_id=user.id, nombre=d.nombre + " (copia)", template_id=d.template_id,
                            titulo=d.titulo, titulo_color=d.titulo_color, w=d.w, h=d.h,
                            frames=d.frames, elements=d.elements, orden=orden, creado_por=d.creado_por)
    db.add(copia)
    db.commit()
    db.refresh(copia)
    return copia


def canvas_mover_doc(db: Session, doc_id: int, target_id: int, user: Empleado) -> bool:
    d = canvas_doc_propio(db, doc_id, user)
    t = canvas_doc_propio(db, target_id, user)
    if not d or not t or d.area_id != t.area_id:
        return False
    docs = (db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id, DesignCanvasDoc.empleado_id == user.id)
           .order_by(DesignCanvasDoc.orden).all())
    docs = [x for x in docs if x.id != d.id]
    idx = next((i for i, x in enumerate(docs) if x.id == t.id), len(docs))
    docs.insert(idx, d)
    for i, x in enumerate(docs, start=1):
        x.orden = i
    db.commit()
    return True


def canvas_eliminar_doc(db: Session, doc_id: int, user: Empleado) -> int | None:
    """Envía la hoja a la Papelera y devuelve el id de esa entrada (para "Deshacer"), o None si no existe o no es suya."""
    d = canvas_doc_propio(db, doc_id, user)
    if not d:
        return None
    eliminado_por, empleado_id = user.nombre_completo, user.id
    payload = {"area_id": d.area_id, "orden": d.orden, "doc": canvas_serializar(d), "eliminado_por_id": empleado_id,
               "dueno_id": d.empleado_id}
    t = _trash_registrar(db, "cv-doc", f'Hoja de Canvas "{d.nombre}"', payload, eliminado_por)
    db.delete(d)
    db.commit()
    return t.id


# ---------- Compartir una hoja de Canvas (Rosember, 26-oct-2026) ----------
# Una persona envía una COPIA de su hoja a alguien de su misma área, o a todos los del área. Va solo el formato:
# título, marcos (vacíos) y anotaciones; nada de fotos de pacientes (los marcos quedan sin imagen y las anotaciones con
# imagen no se copian). La copia queda en el respaldo de quien la recibe y su Canvas la trae al abrirse; le llega un push.

def canvas_destinatarios(db: Session, user: Empleado, area_id: int) -> list[dict]:
    """Personas activas del área (diseñadores y managers de sus equipos activos), sin contar a `user`."""
    equipos = (db.query(DesignTeam).options(joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado),
                                            joinedload(DesignTeam.manager))
               .filter(DesignTeam.area_id == area_id, DesignTeam.activo == 1).order_by(DesignTeam.orden, DesignTeam.nombre).all())
    out: dict[int, dict] = {}
    for t in equipos:
        for e in ([t.manager] if t.manager else []) + [d.empleado for d in t.designers if d.empleado]:
            if e.id != user.id and e.id not in out and e.activo:
                out[e.id] = {"id": e.id, "nombre": e.nombre_completo, "equipo": t.nombre}
    return sorted(out.values(), key=lambda x: _normalizar_texto(x["nombre"]))


def canvas_compartir(db: Session, doc_id: int, user: Empleado, destino) -> list[int]:
    """Copia la hoja (solo el formato) a `destino`: "area" = todos los del área, o el id de una persona del área.
    Devuelve a quiénes se copió. ValueError si no se puede."""
    d = canvas_doc_propio(db, doc_id, user)
    if not d:
        raise ValueError("Esa hoja no existe o no es tuya.")
    posibles = {p["id"] for p in canvas_destinatarios(db, user, d.area_id)}
    if destino == "area":
        ids = sorted(posibles)
    else:
        try:
            ids = [int(destino)]
        except (TypeError, ValueError):
            raise ValueError("Elige a quién compartir la hoja.")
        if ids[0] not in posibles:
            raise ValueError("Solo puedes compartir con personas de tu misma área.")
    if not ids:
        raise ValueError("No hay más personas en tu área.")
    frames = [dict(f, img=None) for f in json.loads(d.frames or "[]") if isinstance(f, dict)]
    elementos = [e for e in json.loads(d.elements or "[]") if isinstance(e, dict) and not e.get("img")]
    corto = " ".join(user.nombre_completo.split()[:2])
    for eid in ids:
        if not db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id, DesignCanvasDoc.empleado_id == eid).count():
            _canvas_sembrar(db, d.area_id, eid)   # primera vez en el área: recibe también sus hojas base
        orden = db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == d.area_id, DesignCanvasDoc.empleado_id == eid).count() + 1
        db.add(DesignCanvasDoc(area_id=d.area_id, empleado_id=eid, nombre=f"{d.nombre} (de {corto})"[:150], template_id=d.template_id,
                               titulo=d.titulo, titulo_color=d.titulo_color, w=d.w, h=d.h, orden=orden, creado_por=user.nombre_completo,
                               frames=json.dumps(frames, ensure_ascii=False), elements=json.dumps(elementos, ensure_ascii=False)))
    db.commit()
    try:
        from . import services_design_push as spush
        spush.enviar_en_segundo_plano(ids, f"🎨 {corto} te compartió una hoja de Canvas",
                                      f"«{d.nombre}» ya está en tu Canvas (solo el formato, sin fotos).",
                                      url="/design?panel=canvas", etiqueta=f"canvas-compartida-{d.id}")
    except Exception:  # noqa: BLE001  la copia ya quedó
        log.exception("Canvas: no se pudo enviar el aviso de hoja compartida")
    return ids


CANVAS_DESHACER_MINUTOS = 10


def canvas_deshacer_eliminar(db: Session, trash_id: int, empleado_id: int) -> str:
    """'Deshacer' tras borrar una hoja de Canvas: cualquier persona puede recuperar SU propia hoja
    recién borrada (hasta 10 min); lo demás sigue en la Papelera, que es solo para líderes.
    Devuelve 'ok' | 'no-existe' | 'ajena' | 'vencido' | 'error'."""
    t = db.get(DesignTrash, trash_id)
    if not t or t.modulo != "cv-doc":
        return "no-existe"
    if _json(t.payload, {}).get("eliminado_por_id") != empleado_id:
        return "ajena"
    if datetime.utcnow() - t.eliminado_en > timedelta(minutes=CANVAS_DESHACER_MINUTOS):
        return "vencido"
    return "ok" if trash_restaurar(db, trash_id) else "error"


# ---------------------------------------------------------------------------
# Importar equipos desde Desempeño: los 16 "equipos" de las hojas de evaluación
# (más "DESIGN MANAGERS", que no tiene equipo propio) ya reflejan la estructura
# real área→manager→diseñadores. Esto cruza esos nombres contra los Empleado ya
# registrados en People (no crea empleados nuevos: nunca se inventan datos de
# identificación de personas reales) y arma/confirma los DesignTeam.
# ---------------------------------------------------------------------------

# Mapeo hoja de Desempeño -> (área de Design Schedule, nombre completo del manager).
# Verificado a mano contra la hoja "DESIGN MANAGERS" (que lista los managers de
# cada equipo) para resolver casos ambiguos como los dos "Paula" (Parra vs. De la
# Torre, esta última identificada por el sufijo "Dlt" = "De la Torre").
SHEET_MANAGER_MAP = {
    "N6 Marlene": ("N6 Material Changes", "Marlene Aguirre"),
    "N2 Daniel": ("N2 Demodenture", "Daniel Valencia"),
    "N2 Heiner": ("N2 Demodenture", "Heiner Cañon"),
    "N2 Samuel": ("N2 Demodenture", "Samuel Ortega"),
    "N2 Gleider": ("N2 Demodenture", "Gleider Garcia"),
    "N2 Dariana": ("N2 Demodenture", "Dariana Ortega"),
    "Face Nicole": ("Face Design", "Nicole de la Hoz"),
    "Face Juliana": ("Face Design", "Juliana Molinares"),
    "N3 Paula": ("N3 Prosthetic", "Paula Parra"),
    "N3 Vanesa": ("N3 Prosthetic", "Vanesa Gutierrez"),
    "N3 David": ("N3 Prosthetic", "David Paredes"),
    "N3 Luisa": ("N3 Prosthetic", "Luisa Ortiz"),
    "N3 Paula Dlt": ("N3 Prosthetic", "Paula de la Torre"),
    "N3 Paola T": ("N3 Prosthetic", "Paola Tuiran"),
    "N3 Mauricio": ("N3 Prosthetic", "Mauricio Foliaco"),
    "N3 Julio": ("N3 Prosthetic", "Julio Hernandez Florez"),
}


def _normalizar_texto(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


def _palabras(s: str) -> set:
    return set(_normalizar_texto(s).split())


def _buscar_empleado_por_nombre(nombre_buscado: str, empleados: list[Empleado]) -> Empleado | None:
    """Empareja por CONJUNTO de palabras (tolera 'Apellido Nombre' vs 'Nombre Apellido').
    Solo devuelve un match si hay suficiente superposición; nunca inventa un empleado."""
    palabras_buscadas = _palabras(nombre_buscado)
    if not palabras_buscadas:
        return None
    mejor, mejor_score = None, 0.0
    for e in empleados:
        palabras_emp = _palabras(e.nombre_completo)
        if not palabras_emp:
            continue
        if palabras_buscadas == palabras_emp:
            return e  # coincidencia exacta de palabras -- corta inmediatamente
        interseccion = palabras_buscadas & palabras_emp
        union = palabras_buscadas | palabras_emp
        score = len(interseccion) / len(union) if union else 0
        if palabras_buscadas <= palabras_emp or palabras_emp <= palabras_buscadas:
            score = max(score, 0.75)
        if score > mejor_score:
            mejor_score, mejor = score, e
    return mejor if mejor_score >= 0.6 else None


def importar_equipos_desde_desempeno(db: Session, aplicar: bool = False) -> dict:
    # Lee las hojas de Desempeño actuales (con lo corregido en Parámetros), no la copia inicial
    # app/seed_data/design_perf.json (30-sep-2026).
    mapa = mapa_hojas(db)
    historicos = reglas_conexion(db)["historico"]
    empleados_design = (db.query(Empleado)
                        .filter(Empleado.empresa == "Nuvia Design Colombia SAS", Empleado.activo == 1).all())

    resultado = {"equipos": [], "sinMapeo": []}
    # dónde está hoy cada persona (para que la vista previa avise antes de aplicar)
    equipos_de: dict[int, list[tuple[int, str]]] = {}
    for d in (db.query(DesignTeamDesigner).join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
              .filter(DesignTeam.activo == 1).options(joinedload(DesignTeamDesigner.team)).all()):
        equipos_de.setdefault(d.empleado_id, []).append((d.team_id, d.team.nombre))
    for sheet in perf_sheets(db):
        if sheet.tipo != "eval":
            continue
        nombre_sheet = sheet.nombre
        mapeo = mapa.get(nombre_sheet)
        if not mapeo:
            resultado["sinMapeo"].append({"hoja": nombre_sheet, "general": _es_hoja_general(nombre_sheet)})
            continue
        area_nombre, manager_nombre = mapeo
        area = db.query(DesignArea).filter(DesignArea.nombre == area_nombre).first()
        manager_emp = _buscar_empleado_por_nombre(manager_nombre, empleados_design)

        miembros_info = []
        vistos = set()
        for emp_fila in sorted(sheet.empleados, key=lambda e: (e.orden, e.id)):
            nombre_raw = emp_fila.nombre or ""
            clave = _normalizar_texto(nombre_raw)
            if not clave or clave in vistos:
                continue  # evita duplicados dentro de la misma hoja (p.ej. un nombre repetido)
            vistos.add(clave)
            match = _buscar_empleado_por_nombre(nombre_raw, empleados_design)
            miembros_info.append({"nombreOriginal": nombre_raw, "empleadoId": match.id if match else None,
                                  "empleadoNombre": match.nombre_completo if match else None})

        equipo_existente = None
        if area and manager_emp:
            equipo_existente = (db.query(DesignTeam)
                                .filter(DesignTeam.area_id == area.id, DesignTeam.manager_id == manager_emp.id)
                                .first())
        for m in miembros_info:  # estado antes de aplicar
            if not m["empleadoId"]:
                m["estado"] = "sin_coincidencia"
                continue
            actuales = equipos_de.get(m["empleadoId"], [])
            if equipo_existente and any(tid == equipo_existente.id for tid, _ in actuales):
                m["estado"] = "en_equipo"
            elif manager_emp and m["empleadoId"] == manager_emp.id:
                m["estado"] = "es_manager"
            elif _es_historico(m["empleadoNombre"], historicos):
                m["estado"] = "historico"
            else:
                otros = [n for tid, n in actuales if not equipo_existente or tid != equipo_existente.id]
                m["estado"] = "otro_equipo" if otros else "nuevo"
                m["otrosEquipos"] = otros

        creado = False
        agregados = 0
        if aplicar and area and manager_emp:
            team = equipo_existente
            if not team:
                orden = db.query(DesignTeam).filter(DesignTeam.area_id == area.id).count() + 1
                team = DesignTeam(area_id=area.id, nombre=manager_emp.nombre_completo, orden=orden,
                                  manager_id=manager_emp.id)
                db.add(team)
                db.flush()
                creado = True
            ids_actuales = {d.empleado_id for d in db.query(DesignTeamDesigner)
                            .filter(DesignTeamDesigner.team_id == team.id).all()}
            orden_d = len(ids_actuales) + 1
            for m in miembros_info:
                if m.get("estado") == "nuevo" and m["empleadoId"] not in ids_actuales:
                    db.add(DesignTeamDesigner(team_id=team.id, empleado_id=m["empleadoId"], orden=orden_d))
                    ids_actuales.add(m["empleadoId"])
                    agregados += 1
                    orden_d += 1
            db.commit()

        resultado["equipos"].append({
            "hoja": nombre_sheet, "area": area_nombre, "areaEncontrada": bool(area), "areaId": area.id if area else None,
            "equipoId": (equipo_existente.id if equipo_existente else None),
            "managerBuscado": manager_nombre,
            "managerEncontrado": manager_emp.nombre_completo if manager_emp else None,
            "managerId": manager_emp.id if manager_emp else None,
            "equipoYaExistia": bool(equipo_existente),
            "equipoCreado": creado,
            "miembros": miembros_info,
            "miembrosAgregados": agregados,
        })
    return resultado



# ---------------------------------------------------------------------------
# Auditoría (solo lectura): qué partes de Design NO están conectadas con los equipos de Parámetros.
# Desempeño y Pre-Approved guardan nombres escritos (vienen del Excel), no la persona ni el equipo: esta
# revisión dice cuáles no coinciden para corregir los nombres. No modifica nada.
# ---------------------------------------------------------------------------

def _sin_prefijo_area(nombre: str) -> str:
    return re.sub(r"^\s*(face|n2|n3|n6)\s+", "", nombre or "", flags=re.I).strip()


# Personas que ya no son managers pero se conservan como históricas en Selección / Pre-Approved (30-sep-2026).
# Son el valor inicial de la tabla de reglas; desde ahí se agregan o quitan en Parámetros.
PERF_HISTORICOS = ["Luis Felipe Blaschke", "Paul Andion"]


# Personas que están en DESIGN MANAGERS sin ser manager de un equipo, y está bien así (30-sep-2026).
PERF_GENERAL_ACEPTADOS = {
    "Estefania Hernandez": "Entrenadora.",
    "Analia Ternera": "Manager de N2 sin equipo (incapacidad permanente).",
}


REGLA_TIPOS = ("historico", "aceptado_general", "hoja_manager", "pa_manager")
_REGLAS_CACHE = {"t": 0.0, "v": None}


def reglas_conexion(db: Session) -> dict:
    """{"historico": [nombres], "aceptado_general": {nombre: motivo}, "hoja_manager": {hoja: (área, manager)},
    "pa_manager": {sheet_id: team_id}}. La primera vez se llena con las decisiones que estaban en el código."""
    import time as _t
    from .models_design import DesignConexionRegla
    c = _REGLAS_CACHE
    if c["v"] is not None and _t.monotonic() - c["t"] < 20:
        return c["v"]
    filas = db.query(DesignConexionRegla).all()
    if not any(r.tipo == "sistema" and r.clave == "inicial" for r in filas):
        try:
            db.add(DesignConexionRegla(tipo="sistema", clave="inicial", creado_por="Sistema"))
            for n in PERF_HISTORICOS:
                db.add(DesignConexionRegla(tipo="historico", clave=n, creado_por="Sistema"))
            for n, m in PERF_GENERAL_ACEPTADOS.items():
                db.add(DesignConexionRegla(tipo="aceptado_general", clave=n, valor=m, creado_por="Sistema"))
            db.commit()
        except Exception:
            log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
            db.rollback()  # otro proceso la llenó al mismo tiempo
        filas = db.query(DesignConexionRegla).all()
    v = {"historico": [], "aceptado_general": {}, "hoja_manager": {}, "pa_manager": {},
         "filas": [{"id": r.id, "tipo": r.tipo, "clave": r.clave, "valor": r.valor or "", "creado_por": r.creado_por or ""}
                   for r in filas if r.tipo in REGLA_TIPOS]}
    for r in filas:
        if r.tipo == "historico":
            v["historico"].append(r.clave)
        elif r.tipo == "aceptado_general":
            v["aceptado_general"][r.clave] = r.valor or "Aceptado."
        elif r.tipo == "hoja_manager":
            try:
                d = json.loads(r.valor or "{}")
                v["hoja_manager"][r.clave] = (d["area"], d["manager"])
            except (ValueError, KeyError):
                pass
        elif r.tipo == "pa_manager" and (r.valor or "").isdigit() and r.clave.isdigit():
            v["pa_manager"][int(r.clave)] = int(r.valor)
    c["t"], c["v"] = _t.monotonic(), v
    return v


def _reglas_invalidar() -> None:
    _REGLAS_CACHE["v"] = None


def mapa_hojas(db: Session) -> dict:
    """Hoja de Desempeño → (área, manager): la lista del código + las hojas asociadas en Parámetros."""
    m = dict(SHEET_MANAGER_MAP)
    m.update(reglas_conexion(db)["hoja_manager"])
    return m


def _aceptado_general(nombre: str, aceptados: dict | None = None) -> str | None:
    pal = _palabras(nombre)
    for n, motivo in (PERF_GENERAL_ACEPTADOS if aceptados is None else aceptados).items():
        if pal and _palabras(n) <= pal:
            return motivo
    return None


def _es_historico(nombre: str, historicos: list | None = None) -> bool:
    pal = _palabras(_sin_prefijo_area(nombre))
    return bool(pal) and any(pal <= _palabras(h) or _palabras(h) <= pal
                             for h in (PERF_HISTORICOS if historicos is None else historicos))


def _es_hoja_general(nombre: str) -> bool:
    """DESIGN MANAGERS: hoja general donde se califica a todos los managers de las áreas (sin manager propio)."""
    return bool(re.search(r"design\s+managers?", nombre or "", re.I))


def _sugerencias(nombre: str, personas: list[Empleado], n: int = 3) -> list[dict]:
    """Personas de People con nombre parecido (tolera errores de escritura: Vazques ~ Vasquez)."""
    import difflib
    pal = _normalizar_texto(nombre).replace(".", " ").split()
    if not pal:
        return []
    out = []
    for e in personas:
        pe = _normalizar_texto(e.nombre_completo).split()
        if not pe:
            continue
        score = sum(max(difflib.SequenceMatcher(None, w, x).ratio() for x in pe) for w in pal) / len(pal)
        if score >= 0.72:
            out.append((score, e))
    out.sort(key=lambda t: -t[0])
    return [{"id": e.id, "nombre": e.nombre_completo, "parecido": round(sc, 2)} for sc, e in out[:n]]


def auditar_conexiones(db: Session) -> dict:
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    reglas = reglas_conexion(db)
    mapa = mapa_hojas(db)
    historicos, aceptados = reglas["historico"], reglas["aceptado_general"]
    teams = (db.query(DesignTeam).options(joinedload(DesignTeam.designers), joinedload(DesignTeam.area),
                                          joinedload(DesignTeam.manager))
             .filter(DesignTeam.activo == 1).all())
    equipo_de = {}  # empleado_id -> [nombres de equipo]
    for t in teams:
        for d in t.designers:
            equipo_de.setdefault(d.empleado_id, []).append(t.nombre)
    nombre_de = {e.id: e.nombre_completo for e in personas}
    managers_ids = {t.manager_id for t in teams if t.manager_id and t.area.formato != FORMATO_SUPPORT}
    todos_teams = None

    def por_que_no_manager(persona: Empleado) -> str:
        """Explica por qué alguien que se cree manager no cuenta como tal (dato para corregir en Equipos/People)."""
        nonlocal todos_teams
        if todos_teams is None:
            todos_teams = (db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.manager)).all())
        pal = _palabras(persona.nombre_completo)
        for t in todos_teams:
            if not t.manager:
                continue
            if t.manager_id == persona.id or _palabras(t.manager.nombre_completo) == pal:
                if t.manager_id != persona.id:
                    return (f'El equipo "{t.nombre}" ({t.area.nombre}) tiene como manager otro registro de People con el mismo nombre '
                            f'({t.manager.email or "sin correo"}{", inactivo" if t.manager.activo != 1 else ""}); '
                            f'la hoja coincide con {persona.email or "sin correo"}.')
                if t.activo != 1:
                    return f'Su equipo "{t.nombre}" ({t.area.nombre}) está inactivo.'
                return f'Su equipo "{t.nombre}" está en el área "{t.area.nombre}", marcada como Support (no cuenta como manager).'
        return "Es una hoja de managers y no es manager de ningún equipo."

    hojas = []
    for sh in perf_sheets(db):
        if sh.tipo != "eval":
            continue
        r = {"hoja": sh.nombre, "manager": None, "equipo": None, "problemas": [], "filas": [], "general": False,
             "accion": None, "asociada": sh.nombre in reglas["hoja_manager"]}
        mapeo = mapa.get(sh.nombre)
        team = None
        if _es_hoja_general(sh.nombre):
            r["general"] = True
        elif not mapeo:
            r["problemas"].append("La hoja no está asociada a ningún manager (el nombre no está en la lista de hojas).")
            r["accion"] = "asociar"
        else:
            area_nombre, manager_nombre = mapeo
            mgr = _buscar_empleado_por_nombre(manager_nombre, personas)
            if not mgr:
                r["problemas"].append(f'El manager "{manager_nombre}" no se encontró en People.')
                r["accion"] = "asociar"
            else:
                r["manager"] = mgr.nombre_completo
                team = next((t for t in teams if t.manager_id == mgr.id and t.area.nombre == area_nombre), None)
                if not team:
                    r["problemas"].append(f'{mgr.nombre_completo} no es manager de ningún equipo activo de {area_nombre} en Parámetros.')
                    r["accion"] = "crear_equipo"
                else:
                    r["equipo"] = team.nombre
        ids_team = {d.empleado_id for d in team.designers} if team else set()
        vistos = set()
        for fila in sh.empleados:
            persona = _buscar_empleado_por_nombre(fila.nombre, personas)
            item = {"nombre": fila.nombre, "persona": persona.nombre_completo if persona else None, "estado": "ok", "detalle": ""}
            if not persona:
                item["estado"], item["detalle"] = "sin_persona", "No coincide con nadie en People."
                item["sugerencias"] = _sugerencias(fila.nombre, personas)
            else:
                vistos.add(persona.id)
                if r["general"] and persona.id not in managers_ids and _aceptado_general(persona.nombre_completo, aceptados):
                    item["detalle"] = _aceptado_general(persona.nombre_completo, aceptados)
                elif r["general"] and persona.id not in managers_ids and not _es_historico(persona.nombre_completo, historicos):
                    item["estado"], item["detalle"] = "no_manager", por_que_no_manager(persona)
                elif r["general"] and persona.id not in managers_ids:
                    item["estado"], item["detalle"] = "historico", "Histórico: ya no es manager."
                elif team and persona.id not in ids_team and persona.id != team.manager_id:
                    otros = equipo_de.get(persona.id) or []
                    item["estado"] = "otro_equipo"
                    item["otros"] = otros
                    item["detalle"] = (f"En Parámetros está en {', '.join(otros)}." if otros
                                       else "En Parámetros no está en ningún equipo.")
            r["filas"].append(item)
        # en el equipo (o, en la hoja general, managers) sin fila en la hoja
        esperados = managers_ids if r["general"] else ids_team
        r["faltan"] = sorted(nombre_de.get(i, str(i)) for i in esperados - vistos)
        hojas.append(r)

    managers = {t.manager_id for t in teams if t.manager_id}
    seleccion = []
    for sh in perf_sheets(db):
        if sh.tipo != "seleccion":
            continue
        for fila in sh.filas_seleccion:
            persona = _buscar_empleado_por_nombre(fila.evaluador, personas)
            estado = "ok" if persona and persona.id in managers else ("no_manager" if persona else "sin_persona")
            if estado != "ok" and _es_historico(fila.evaluador, historicos):
                estado = "historico"
            seleccion.append({"filaId": fila.id, "hoja": sh.nombre, "evaluador": fila.evaluador, "persona": persona.nombre_completo if persona else None,
                              "estado": estado})

    preapproved = []
    for sh in db.query(DesignPreApprovedSheet).options(joinedload(DesignPreApprovedSheet.area)).order_by(
            DesignPreApprovedSheet.area_id, DesignPreApprovedSheet.orden).all():
        palabras = _palabras(_sin_prefijo_area(sh.nombre))
        elegido = next((t for t in teams if t.id == reglas["pa_manager"].get(sh.id) and t.manager), None)
        candidatos = [elegido] if elegido else [t for t in teams if t.area_id == sh.area_id and t.manager and palabras
                                                and palabras <= _palabras(t.manager.nombre_completo)]
        estado = "ok" if len(candidatos) == 1 else ("ambiguo" if candidatos else "sin_manager")
        if estado != "ok" and _es_historico(sh.nombre, historicos):
            estado = "historico"
        preapproved.append({"sheetId": sh.id, "areaId": sh.area_id, "area": sh.area.nombre, "hoja": sh.nombre, "estado": estado,
                            "asociada": bool(elegido),
                            "managers": [f"{t.manager.nombre_completo} ({t.nombre})" for t in candidatos]})

    # Equipos activos con manager que no tienen hoja de evaluación asociada
    con_hoja = {h["equipo"] for h in hojas if h["equipo"]}
    sin_hoja = sorted(({"texto": f"{t.area.nombre} · {t.nombre}", "teamId": t.id, "areaId": t.area_id, "managerId": t.manager_id}
                       for t in teams if t.manager_id and t.nombre not in con_hoja and t.area.formato != FORMATO_SUPPORT),
                      key=lambda x: x["texto"])
    return {"hojas": hojas, "seleccion": seleccion, "preapproved": preapproved, "equiposSinHoja": sin_hoja}



# ---------------------------------------------------------------------------
# Correcciones de nombres acordadas (30-sep-2026) para conectar Desempeño con los equipos de Parámetros.
# Se ven primero en vista previa y se aplican desde Parámetros (solo admins). Cada paso revisa el estado
# actual: aplicarlas otra vez no repite nada. Lo eliminado queda en la Papelera de Design.
# ---------------------------------------------------------------------------

CORRECCIONES_ACORDADAS = [
    {"op": "renombrar_fila", "hoja": "Face Juliana", "de": "DNIELA CAMACHO", "a": "DANIELA CAMACHO"},
    {"op": "renombrar_fila", "hoja": "DESIGN MANAGERS", "de": "MAURICIO FOLLIACO", "a": "MAURICIO FOLIACO"},
    {"op": "renombrar_fila", "hoja": "N3 Mauricio", "de": "CARLOS S. RAMIREZ", "a": "CARLOS SANTIAGO RAMIREZ"},
    {"op": "eliminar_fila", "hoja": "N6 Marlene", "nombre": "Ma Fernanda Olier", "motivo": "ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N2 Heiner", "nombre": "ANGIE DUQUE", "motivo": "ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N2 Samuel", "nombre": "LUIS BERMONT", "motivo": "ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N3 Vanesa", "nombre": "RAFAEL GARCIA", "motivo": "ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N3 Luisa", "nombre": "Anderson Maldonado", "motivo": "ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N3 Paula", "nombre": "JULIAN MORILLO", "motivo": "Julián Murillo ya no trabaja en Nuvia"},
    {"op": "eliminar_fila", "hoja": "N2 Heiner", "nombre": "GELIDER GARCÍA", "motivo": "Gleider García es manager de su equipo"},
    {"op": "unir_duplicado", "hoja": "N2 Daniel", "nombre": "Gabriel Jinete"},
    {"op": "eliminar_fila", "hoja": "N2 Daniel", "nombre": "Shirliana Rodriguez", "motivo": "pedido de Rosember (28-oct-2026)"},
    {"op": "agregar_a_equipo", "area": "N6 Material Changes", "manager": "Marlene Aguirre", "persona": "Juan Camilo Lopez Arboleda"},
    {"op": "agregar_a_equipo", "area": "N2 Demodenture", "manager": "Heiner Cañon", "persona": "Andres Julian Sierra Castañeda"},
    {"op": "crear_equipo", "area": "N3 Prosthetic", "manager": "Mauricio Foliaco", "desde_hoja": "N3 Mauricio"},
    {"op": "crear_equipo", "area": "N3 Prosthetic", "manager": "Leonardo Naranjo"},
]


def _hoja_por_nombre(db: Session, nombre: str) -> DesignPerfSheet | None:
    return db.query(DesignPerfSheet).filter(DesignPerfSheet.nombre == nombre).first()


def _filas_con_nombre(sheet: DesignPerfSheet, nombre: str) -> list[DesignPerfEmpleado]:
    n = _normalizar_texto(nombre)
    return sorted((e for e in sheet.empleados if _normalizar_texto(e.nombre) == n), key=lambda e: (e.orden, e.id))


def _snapshot_fila(e: DesignPerfEmpleado) -> dict:
    return {"sheet_id": e.sheet_id, "sheet": e.sheet.nombre, "nombre": e.nombre, "nota": e.nota, "orden": e.orden,
            "celdas": [{"criterio_id": c.criterio_id, "mes_indice": c.mes_indice, "nivel": c.nivel, "puntaje": c.puntaje}
                       for c in e.celdas]}


def _team_de_manager(db: Session, area_nombre: str, manager: Empleado) -> DesignTeam | None:
    return (db.query(DesignTeam).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter(DesignArea.nombre == area_nombre, DesignTeam.manager_id == manager.id).first())


def _correccion(db: Session, op: dict, aplicar: bool, eliminado_por: str) -> dict:
    """{"descripcion", "estado": pendiente|hecho|aplicado|no_aplica, "detalle"} de un paso."""
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    tipo = op["op"]
    if tipo in ("renombrar_fila", "eliminar_fila", "unir_duplicado"):
        sh = _hoja_por_nombre(db, op["hoja"])
        nombre = op.get("de") or op.get("nombre")
        desc = {"renombrar_fila": f'Hoja {op["hoja"]}: "{nombre}" → "{op.get("a")}"',
                "eliminar_fila": f'Hoja {op["hoja"]}: quitar "{nombre}" ({op.get("motivo", "")}) — queda en la Papelera',
                "unir_duplicado": f'Hoja {op["hoja"]}: dejar una sola fila de "{nombre}"'}[tipo]
        if not sh:
            return {"descripcion": desc, "estado": "no_aplica", "detalle": "No existe esa hoja."}
        filas = _filas_con_nombre(sh, nombre)
        if tipo == "renombrar_fila":
            if not filas:
                ya = _filas_con_nombre(sh, op["a"])
                return {"descripcion": desc, "estado": "hecho" if ya else "no_aplica", "detalle": "" if ya else "No está esa fila."}
            p = _buscar_empleado_por_nombre(op["a"], personas)
            detalle = f"Coincidirá con {p.nombre_completo}." if p else "Ojo: el nombre nuevo tampoco coincide con People."
            if aplicar:
                for f in filas:
                    f.nombre = op["a"]
                db.commit()
            return {"descripcion": desc, "estado": "aplicado" if aplicar else "pendiente", "detalle": detalle}
        if tipo == "eliminar_fila":
            if not filas:
                return {"descripcion": desc, "estado": "hecho", "detalle": ""}
            if aplicar:
                for f in filas:
                    _trash_registrar(db, "perf-emp", f"Desempeño {sh.nombre}: {f.nombre}", _snapshot_fila(f), eliminado_por)
                    db.delete(f)
                db.commit()
            return {"descripcion": desc, "estado": "aplicado" if aplicar else "pendiente",
                    "detalle": f"{sum(len(f.celdas) for f in filas)} calificaciones guardadas en la Papelera."}
        # unir_duplicado
        if len(filas) <= 1:
            return {"descripcion": desc, "estado": "hecho", "detalle": ""}
        queda = max(filas, key=lambda f: (sum(1 for c in f.celdas if c.nivel), -f.orden, -f.id))
        otras = [f for f in filas if f.id != queda.id]
        if aplicar:
            ya = {(c.criterio_id, c.mes_indice): c for c in queda.celdas}
            for o in otras:
                for c in o.celdas:  # lo que la fila que queda no tenga calificado se toma de la repetida
                    if c.nivel and not (ya.get((c.criterio_id, c.mes_indice)) and ya[(c.criterio_id, c.mes_indice)].nivel):
                        if (c.criterio_id, c.mes_indice) in ya:
                            ya[(c.criterio_id, c.mes_indice)].nivel, ya[(c.criterio_id, c.mes_indice)].puntaje = c.nivel, c.puntaje
                        else:
                            db.add(DesignPerfCelda(empleado_id=queda.id, criterio_id=c.criterio_id, mes_indice=c.mes_indice,
                                                   nivel=c.nivel, puntaje=c.puntaje))
                if (o.nota or "").strip() and (o.nota or "").strip() not in (queda.nota or ""):
                    queda.nota = ((queda.nota or "").strip() + "\n" + o.nota.strip()).strip()
                _trash_registrar(db, "perf-emp", f"Desempeño {sh.nombre}: {o.nombre} (repetida)", _snapshot_fila(o), eliminado_por)
                db.delete(o)
            db.commit()
        return {"descripcion": desc, "estado": "aplicado" if aplicar else "pendiente",
                "detalle": f"{len(filas)} filas; se conserva la que tiene más calificaciones y se completan los meses vacíos con la otra."}
    if tipo == "agregar_a_equipo":
        desc = f'Equipo de {op["manager"]} ({op["area"]}): agregar a {op["persona"]}'
        mgr = _buscar_empleado_por_nombre(op["manager"], personas)
        per = _buscar_empleado_por_nombre(op["persona"], personas)
        team = _team_de_manager(db, op["area"], mgr) if mgr else None
        if not team or not per:
            return {"descripcion": desc, "estado": "no_aplica", "detalle": "No se encontró el equipo o la persona."}
        if any(d.empleado_id == per.id for d in team.designers):
            return {"descripcion": desc, "estado": "hecho", "detalle": ""}
        if aplicar:
            db.add(DesignTeamDesigner(team_id=team.id, empleado_id=per.id, orden=len(team.designers) + 1))
            db.commit()
        return {"descripcion": desc, "estado": "aplicado" if aplicar else "pendiente", "detalle": f"{per.nombre_completo} → {team.nombre}"}
    if tipo == "crear_equipo":
        desde = op.get("desde_hoja")
        desc = f'{op["area"]}: equipo de {op["manager"]}' + (f' con las personas de la hoja {desde}' if desde else ' (vacío)')
        mgr = _buscar_empleado_por_nombre(op["manager"], personas)
        area = db.query(DesignArea).filter(DesignArea.nombre == op["area"]).first()
        if not mgr or not area:
            return {"descripcion": desc, "estado": "no_aplica", "detalle": "No se encontró el manager en People o el área."}
        team = _team_de_manager(db, op["area"], mgr)
        en_equipo = {d.empleado_id: d.team.nombre for d in db.query(DesignTeamDesigner).join(DesignTeam)
                     .filter(DesignTeam.activo == 1).all()}
        agregar, omitidos = [], []
        sh = _hoja_por_nombre(db, desde) if desde else None
        for f in (sh.empleados if sh else []):
            p = _buscar_empleado_por_nombre(f.nombre, personas)
            if not p or p.id == mgr.id:
                continue
            if team and any(d.empleado_id == p.id for d in team.designers):
                continue
            if p.id in en_equipo:
                omitidos.append(f"{p.nombre_completo} (ya está en {en_equipo[p.id]})")
            elif p.id not in {a.id for a in agregar}:
                agregar.append(p)
        if team and not agregar:
            return {"descripcion": desc, "estado": "hecho",
                    "detalle": ("No se movió: " + "; ".join(omitidos)) if omitidos else ""}
        if aplicar:
            if not team:
                team = DesignTeam(area_id=area.id, nombre=mgr.nombre_completo, manager_id=mgr.id,
                                  orden=db.query(DesignTeam).filter(DesignTeam.area_id == area.id).count() + 1)
                db.add(team)
                db.flush()
            base = len(team.designers)
            for i, p in enumerate(agregar, start=1):
                db.add(DesignTeamDesigner(team_id=team.id, empleado_id=p.id, orden=base + i))
            db.commit()
        det = (f"Manager: {mgr.nombre_completo}." + (f" Diseñadores: {', '.join(p.nombre_completo for p in agregar)}." if agregar else "")
               + (f" No se mueven (ya tienen equipo): {'; '.join(omitidos)}." if omitidos else ""))
        return {"descripcion": desc, "estado": "aplicado" if aplicar else "pendiente", "detalle": det}
    return {"descripcion": str(op), "estado": "no_aplica", "detalle": "Tipo de corrección desconocido."}


def correcciones_acordadas(db: Session, aplicar: bool = False, eliminado_por: str = "") -> list[dict]:
    return [_correccion(db, op, aplicar, eliminado_por) for op in CORRECCIONES_ACORDADAS]


def renombrar_fila_perf(db: Session, hoja: str, de: str, empleado_id: int) -> dict:
    """Sugerencia elegida en la revisión: la fila toma el nombre completo de la persona de People."""
    sh = _hoja_por_nombre(db, hoja)
    per = db.get(Empleado, empleado_id)
    filas = _filas_con_nombre(sh, de) if sh else []
    if not filas or not per:
        return {"ok": False, "detalle": "No se encontró la fila o la persona."}
    for f in filas:
        f.nombre = per.nombre_completo
    db.commit()
    return {"ok": True, "detalle": f'"{de}" ahora es {per.nombre_completo}.'}



def agregar_fila_al_equipo(db: Session, hoja: str, nombre: str) -> dict:
    """La persona de una fila de Desempeño pasa a ser diseñadora del equipo del manager de esa hoja."""
    sh = _hoja_por_nombre(db, hoja)
    mapeo = mapa_hojas(db).get(hoja)
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    per = _buscar_empleado_por_nombre(nombre, personas)
    mgr = _buscar_empleado_por_nombre(mapeo[1], personas) if mapeo else None
    team = _team_de_manager(db, mapeo[0], mgr) if mgr else None
    if not sh or not per or not team:
        return {"ok": False, "detalle": "No se encontró la persona o el equipo de esa hoja."}
    if not any(d.empleado_id == per.id for d in team.designers):
        db.add(DesignTeamDesigner(team_id=team.id, empleado_id=per.id, orden=len(team.designers) + 1))
        db.commit()
    return {"ok": True, "detalle": f"{per.nombre_completo} → {team.nombre}"}



# ---------------------------------------------------------------------------
# Acciones de Parámetros › Conexión con los equipos / Importar equipos (solo admins).
# Cada una corrige un dato puntual; lo que se quita va a la Papelera de Design.
# ---------------------------------------------------------------------------

def _team_de_hoja(db: Session, hoja: str) -> tuple[DesignTeam | None, Empleado | None, str | None]:
    mapeo = mapa_hojas(db).get(hoja)
    if not mapeo:
        return None, None, None
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    mgr = _buscar_empleado_por_nombre(mapeo[1], personas)
    return (_team_de_manager(db, mapeo[0], mgr) if mgr else None), mgr, mapeo[0]


def quitar_fila_perf(db: Session, hoja: str, nombre: str, eliminado_por: str) -> dict:
    sh = _hoja_por_nombre(db, hoja)
    filas = _filas_con_nombre(sh, nombre) if sh else []
    if not filas:
        return {"ok": False, "detalle": "No se encontró esa fila."}
    for f in filas:
        _trash_registrar(db, "perf-emp", f"Desempeño {sh.nombre}: {f.nombre}", _snapshot_fila(f), eliminado_por)
        db.delete(f)
    db.commit()
    return {"ok": True, "detalle": f'"{nombre}" quitada de {hoja} (queda en la Papelera).'}


def agregar_fila_perf(db: Session, hoja: str, nombre: str) -> dict:
    """Fila nueva en una hoja de Desempeño (meses vacíos para calificar)."""
    sh = _hoja_por_nombre(db, hoja)
    nombre = (nombre or "").strip()
    if not sh or sh.tipo != "eval" or not nombre:
        return {"ok": False, "detalle": "No se encontró la hoja."}
    pal = _palabras(nombre)
    if any(_palabras(e.nombre) and (_palabras(e.nombre) <= pal or pal <= _palabras(e.nombre)) for e in sh.empleados):
        return {"ok": True, "detalle": f"{nombre} ya tiene fila en {hoja}."}
    orden = max([e.orden or 0 for e in sh.empleados] or [0]) + 1
    db.add(DesignPerfEmpleado(sheet_id=sh.id, nombre=nombre, orden=orden))
    db.commit()
    return {"ok": True, "detalle": f"{nombre} agregada a {hoja}."}


def mover_al_equipo_de_hoja(db: Session, hoja: str, nombre: str) -> dict:
    """La persona deja los otros equipos activos y queda en el equipo del manager de la hoja."""
    team, _mgr, _area = _team_de_hoja(db, hoja)
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    per = _buscar_empleado_por_nombre(nombre, personas)
    if not team or not per:
        return {"ok": False, "detalle": "No se encontró la persona o el equipo de esa hoja."}
    salio = []
    for d in (db.query(DesignTeamDesigner).join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id)
              .filter(DesignTeamDesigner.empleado_id == per.id, DesignTeam.activo == 1, DesignTeam.id != team.id).all()):
        salio.append(d.team.nombre)
        db.delete(d)
    if not any(d.empleado_id == per.id for d in team.designers):
        db.add(DesignTeamDesigner(team_id=team.id, empleado_id=per.id, orden=len(team.designers) + 1))
    db.commit()
    return {"ok": True, "detalle": f"{per.nombre_completo} → {team.nombre}" + (f" (salió de {', '.join(salio)})" if salio else "")}


def crear_equipo_de_hoja(db: Session, hoja: str) -> dict:
    mapeo = mapa_hojas(db).get(hoja)
    if not mapeo:
        return {"ok": False, "detalle": "La hoja no está asociada a un manager."}
    r = _correccion(db, {"op": "crear_equipo", "area": mapeo[0], "manager": mapeo[1], "desde_hoja": hoja}, True, "")
    return {"ok": r["estado"] in ("aplicado", "hecho"), "detalle": r["detalle"]}


def renombrar_evaluador(db: Session, fila_id: int, empleado_id: int) -> dict:
    f = db.get(DesignPerfSeleccionFila, fila_id)
    per = db.get(Empleado, empleado_id)
    if not f or not per:
        return {"ok": False, "detalle": "No se encontró la fila o la persona."}
    antes = f.evaluador
    f.evaluador = per.nombre_completo
    db.commit()
    return {"ok": True, "detalle": f'"{antes}" ahora es {per.nombre_completo}.'}


def _guardar_regla(db: Session, tipo: str, clave: str, valor: str, creado_por: str) -> None:
    from .models_design import DesignConexionRegla
    reglas_conexion(db)  # asegura los valores iniciales
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == tipo, DesignConexionRegla.clave == clave).first()
    if r:
        r.valor, r.creado_por, r.creado_en = valor, creado_por, datetime.utcnow()
    else:
        db.add(DesignConexionRegla(tipo=tipo, clave=clave, valor=valor, creado_por=creado_por))
    db.commit()
    _reglas_invalidar()


def marcar_regla_persona(db: Session, tipo: str, nombre: str, motivo: str, creado_por: str) -> dict:
    nombre = (nombre or "").strip()
    if tipo not in ("historico", "aceptado_general") or not nombre:
        return {"ok": False, "detalle": "Dato inválido."}
    _guardar_regla(db, tipo, nombre, (motivo or "").strip()[:300], creado_por)
    return {"ok": True, "detalle": f"{nombre}: {'histórico' if tipo == 'historico' else 'aceptado'}."}


def asociar_hoja_manager(db: Session, hoja: str, area_id: int, empleado_id: int, creado_por: str) -> dict:
    sh = _hoja_por_nombre(db, hoja)
    area = db.get(DesignArea, area_id)
    per = db.get(Empleado, empleado_id)
    if not sh or sh.tipo != "eval" or _es_hoja_general(sh.nombre) or not area or not per:
        return {"ok": False, "detalle": "No se encontró la hoja, el área o la persona."}
    _guardar_regla(db, "hoja_manager", sh.nombre,
                   json.dumps({"area": area.nombre, "manager": per.nombre_completo, "managerId": per.id}, ensure_ascii=False), creado_por)
    return {"ok": True, "detalle": f"{sh.nombre} → {per.nombre_completo} ({area.nombre})."}


def asociar_pa_equipo(db: Session, sheet_id: int, team_id: int, creado_por: str) -> dict:
    sh = db.get(DesignPreApprovedSheet, sheet_id)
    t = db.get(DesignTeam, team_id)
    if not sh or not t or t.area_id != sh.area_id or not t.manager_id:
        return {"ok": False, "detalle": "El equipo debe ser de la misma área y tener manager."}
    _guardar_regla(db, "pa_manager", str(sh.id), str(t.id), creado_por)
    return {"ok": True, "detalle": f"Pre-Approved {sh.nombre} → {t.nombre}."}


def listar_reglas(db: Session) -> list[dict]:
    v = reglas_conexion(db)
    pa = {s.id: s for s in db.query(DesignPreApprovedSheet).all()}
    eq = {t.id: t for t in db.query(DesignTeam).all()}
    out = []
    for r in sorted(v["filas"], key=lambda r: (REGLA_TIPOS.index(r["tipo"]), r["clave"])):
        tipo, clave, valor = r["tipo"], r["clave"], r["valor"]
        if tipo == "historico":
            txt = f"{clave}: histórico (ya no es manager)"
        elif tipo == "aceptado_general":
            txt = f"{clave}: aceptado en DESIGN MANAGERS" + (f" — {valor}" if valor else "")
        elif tipo == "hoja_manager":
            try:
                d = json.loads(valor or "{}")
                txt = f"Hoja {clave} → {d.get('manager')} ({d.get('area')})"
            except ValueError:
                txt = f"Hoja {clave}"
        else:
            s_ = pa.get(int(clave)) if clave.isdigit() else None
            t_ = eq.get(int(valor)) if valor.isdigit() else None
            txt = f"Pre-Approved {s_.nombre if s_ else clave} → {t_.nombre if t_ else valor}"
        out.append({"id": r["id"], "tipo": tipo, "texto": txt, "por": r["creado_por"]})
    return out


def eliminar_regla(db: Session, regla_id: int) -> bool:
    from .models_design import DesignConexionRegla
    r = db.get(DesignConexionRegla, regla_id)
    if not r or r.tipo not in REGLA_TIPOS:
        return False
    db.delete(r)
    db.commit()
    _reglas_invalidar()
    return True



def personas_para_simular(db: Session) -> list[dict]:
    """Empleados activos con su rol, si tienen el módulo Design y su lugar en los equipos (para /design/simulacion)."""
    teams = db.query(DesignTeam).options(joinedload(DesignTeam.designers), joinedload(DesignTeam.area)).filter(DesignTeam.activo == 1).all()
    lugar: dict[int, list[str]] = {}
    for t in teams:
        if t.manager_id:
            lugar.setdefault(t.manager_id, []).append(f"Manager de {t.nombre} ({t.area.nombre})")
        for d in t.designers:
            lugar.setdefault(d.empleado_id, []).append(f"Diseñador en {t.nombre} ({t.area.nombre})")
    from .models_design import DesignRolUsuario
    rol_design = {r.empleado_id: r.rol for r in db.query(DesignRolUsuario).all()}
    # el rol de People se lee de la base (la persona que consulta puede tener su rol de Design aplicado en memoria)
    rol_people = {i: r for i, r in db.query(Empleado.id, Empleado.rol).filter(Empleado.activo == 1).all()}
    out = []
    for e in db.query(Empleado).filter(Empleado.activo == 1).all():
        rp = rol_people.get(e.id) or "empleado"
        rd = rol_design.get(e.id) if rp != "superadmin" else None
        efectivo = rd or rp
        out.append({"id": e.id, "nombre": e.nombre_completo, "rol": rp, "rolDesign": rd or "", "rolEfectivo": efectivo,
                    "empresa": e.empresa or "",
                    "design": rp == "superadmin" or ((e.empresa or "") == EMPRESA_DESIGN and (efectivo in ("admin", "superadmin") or "design_schedule" in e.modulos_lista)),
                    "lugar": lugar.get(e.id, []),
                    "esManager": any(x.startswith("Manager") for x in lugar.get(e.id, [])),
                    "esDisenador": any(x.startswith("Diseñador") for x in lugar.get(e.id, []))})
    return sorted(out, key=lambda x: _normalizar_texto(x["nombre"]))



# ---------------------------------------------------------------------------
# Openings (Parámetros): distribución de centros de Design. Se carga una sola vez desde
# app/seed_data/design_openings_2026.json (hoja 2026 del Excel) y luego se edita aquí.
# ---------------------------------------------------------------------------

def _openings_modelos():
    from .models_design import DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila
    return DesignOpeningsHoja, DesignOpeningsColumna, DesignOpeningsFila


def _openings_ordenar_por_numero_una_vez(db: Session, h) -> None:
    """Una sola vez (1-oct-2026): las filas quedan en el orden de la columna # (1, 2 … 60). Después el orden
    lo decide quien edita (no se vuelve a reordenar)."""
    from .models_design import DesignConexionRegla
    H, C, Fi = _openings_modelos()
    marca = "openings_orden_numero"
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
        return
    filas = db.query(Fi).filter(Fi.hoja_id == h.id).order_by(Fi.orden, Fi.id).all()

    def clave(f):
        n = (json.loads(f.datos or "{}").get("numero") or "").strip()
        return (0, int(n), f.orden) if n.isdigit() else (1, 0, f.orden)
    for i, f in enumerate(sorted(filas, key=clave), start=1):
        f.orden = i
    try:
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
        db.commit()
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()  # otra petición lo hizo al mismo tiempo


# Zona horaria de cada centro de Openings (1-oct-2026; Dublin = Ohio, Portland = Oregon, Richmond = Virginia,
# confirmados). Las diferencias con Colombia se calculan solas en la pantalla (Hoy y Desde el próximo cambio).
OPENINGS_ZONAS = {
    "Este": ["Hartford", "Bufallo", "Long Island", "Orlando", "Westbury", "Indianapolis", "Wellesley", "Cleveland", "Louisville",
             "Philadelphia", "Alpharetta", "Jacksonville", "Tampa", "Miami", "Fort lauderdale", "Moorestown", "Harrison", "Providence",
             "Marietta", "Reading", "Richmond", "Fort Mill", "Dublin", "Baltimore", "Parsippany", "Pittsburgh", "Detroit", "Fort Myers",
             "Chevy Chase", "Alexandria"],
    "Centro": ["San Antonio", "Austin", "Dallas", "Fort worth", "Saint Louis", "Houston", "Oklahoma", "Kansas", "Woodlands",
               "New Orleans", "Nashville", "Minneapolis", "Milwaukee", "Lemont", "Chicago"],
    "Montaña": ["Denver", "Salt Lake"],
    "Arizona": ["Phoenix"],
    "Pacífico": ["Fresno", "Sacramento", "Riverside", "Walnut creek", "Fremont", "Torrance", "Bellevue", "Fullerton", "Portland",
                 "Encino", "San Diego", "Las Vegas"],
}
OPENINGS_COLS_HORA_VIEJAS = ("dif_2025_10_26", "dif_actual", "dif_2026_03_08")


def _openings_zonas_una_vez(db: Session, h) -> None:
    from .models_design import DesignConexionRegla
    H, C, Fi = _openings_modelos()
    marca = "openings_zonas_horarias"
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
        return
    zona_de = {_normalizar_texto(c): z for z, cs in OPENINGS_ZONAS.items() for c in cs}
    cols = db.query(C).filter(C.hoja_id == h.id).order_by(C.orden, C.id).all()
    viejas = [c for c in cols if c.clave in OPENINGS_COLS_HORA_VIEJAS]
    if not any(c.clave == "zona_horaria" for c in cols):
        pos = min((c.orden for c in viejas), default=(max((c.orden for c in cols), default=0) + 1))
        db.add(C(hoja_id=h.id, clave="zona_horaria", titulo="Zona horaria", orden=pos))
        for f in db.query(Fi).filter(Fi.hoja_id == h.id).all():
            d = json.loads(f.datos or "{}")
            if not d.get("zona_horaria"):
                d["zona_horaria"] = zona_de.get(_normalizar_texto(d.get("centro", "")), "")
                f.datos = json.dumps(d, ensure_ascii=False)
        db.flush()
    for c in viejas:  # quedan en la Papelera con sus valores (se pueden restaurar)
        openings_eliminar_columna(db, c.id, "Sistema (reemplazadas por zona horaria)", commit=False)
    try:
        db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
        db.commit()
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()


def openings_hoja(db: Session):
    """La hoja de Openings; la primera vez se llena con el Excel."""
    H, C, Fi = _openings_modelos()
    h = db.query(H).order_by(H.id).first()
    if h:
        _openings_ordenar_por_numero_una_vez(db, h)
        _openings_zonas_una_vez(db, h)
        return h
    ruta = Path(__file__).resolve().parent / "seed_data" / "design_openings_2026.json"
    datos = json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {"columnas": [], "filas": []}
    try:
        h = H(nombre="2026", titulo=datos.get("titulo", ""), subtitulo=datos.get("subtitulo", ""))
        db.add(h)
        db.flush()
        for i, c in enumerate(datos.get("columnas", []), start=1):
            db.add(C(hoja_id=h.id, clave=c["clave"], titulo=c["titulo"], orden=i))
        for i, f in enumerate(datos.get("filas", []), start=1):
            db.add(Fi(hoja_id=h.id, orden=i, datos=json.dumps(f, ensure_ascii=False)))
        db.commit()
    except Exception:
        log.exception("Design: falló una actualización de datos; se deshace y queda registrado")
        db.rollback()  # otra petición la creó al mismo tiempo
    h = db.query(H).order_by(H.id).first()
    _openings_ordenar_por_numero_una_vez(db, h)
    _openings_zonas_una_vez(db, h)
    return h


def openings_detalle(db: Session) -> dict:
    H, C, Fi = _openings_modelos()
    h = openings_hoja(db)
    cols = db.query(C).filter(C.hoja_id == h.id).order_by(C.orden, C.id).all()
    filas = db.query(Fi).filter(Fi.hoja_id == h.id).order_by(Fi.orden, Fi.id).all()
    return {"id": h.id, "nombre": h.nombre, "titulo": h.titulo, "subtitulo": h.subtitulo,
            "actualizado": h.actualizado_en.isoformat() if h.actualizado_en else None,
            "columnas": [{"id": c.id, "clave": c.clave, "titulo": c.titulo} for c in cols],
            "filas": [{"id": f.id, "datos": json.loads(f.datos or "{}")} for f in filas]}


def _openings_tocar(h) -> None:
    h.actualizado_en = datetime.utcnow()
    _OPEN_CACHE["filas"] = None  # el desplegable Centro del Schedule toma el cambio al instante


def openings_guardar_celda(db: Session, fila_id: int, clave: str, valor: str) -> bool:
    H, C, Fi = _openings_modelos()
    f = db.get(Fi, fila_id)
    if not f or not db.query(C).filter(C.hoja_id == f.hoja_id, C.clave == clave).first():
        return False
    d = json.loads(f.datos or "{}")
    d[clave] = (valor or "").strip()[:500]
    f.datos = json.dumps(d, ensure_ascii=False)
    _openings_tocar(db.get(H, f.hoja_id))
    db.commit()
    return True


def openings_agregar_fila(db: Session, despues_de: int | None = None) -> dict:
    H, C, Fi = _openings_modelos()
    h = openings_hoja(db)
    filas = db.query(Fi).filter(Fi.hoja_id == h.id).order_by(Fi.orden, Fi.id).all()
    pos = len(filas)
    if despues_de:
        pos = next((i + 1 for i, f in enumerate(filas) if f.id == despues_de), pos)
    nueva = Fi(hoja_id=h.id, datos="{}")
    filas.insert(pos, nueva)
    db.add(nueva)
    for i, f in enumerate(filas, start=1):
        f.orden = i
    _openings_tocar(h)
    db.commit()
    return {"id": nueva.id, "datos": {}}


def openings_eliminar_fila(db: Session, fila_id: int, eliminado_por: str) -> bool:
    H, C, Fi = _openings_modelos()
    f = db.get(Fi, fila_id)
    if not f:
        return False
    d = json.loads(f.datos or "{}")
    _trash_registrar(db, "openings-fila", f"Openings: {d.get('centro') or ('fila ' + str(f.orden))}",
                     {"hoja_id": f.hoja_id, "orden": f.orden, "datos": d}, eliminado_por)
    _openings_tocar(db.get(H, f.hoja_id))
    db.delete(f)
    db.commit()
    return True


def openings_agregar_columna(db: Session, titulo: str) -> dict:
    H, C, Fi = _openings_modelos()
    h = openings_hoja(db)
    titulo = (titulo or "").strip()[:150] or "Nueva columna"
    base = re.sub(r"[^a-z0-9]+", "_", _normalizar_texto(titulo)).strip("_") or "columna"
    existentes = {c.clave for c in db.query(C).filter(C.hoja_id == h.id).all()}
    clave, n = base, 2
    while clave in existentes:
        clave, n = f"{base}_{n}", n + 1
    orden = (db.query(func.max(C.orden)).filter(C.hoja_id == h.id).scalar() or 0) + 1
    c = C(hoja_id=h.id, clave=clave, titulo=titulo, orden=orden)
    db.add(c)
    _openings_tocar(h)
    db.commit()
    return {"id": c.id, "clave": c.clave, "titulo": c.titulo}


def openings_renombrar_columna(db: Session, col_id: int, titulo: str) -> bool:
    H, C, Fi = _openings_modelos()
    c = db.get(C, col_id)
    titulo = (titulo or "").strip()[:150]
    if not c or not titulo:
        return False
    c.titulo = titulo
    _openings_tocar(db.get(H, c.hoja_id))
    db.commit()
    return True


def openings_eliminar_columna(db: Session, col_id: int, eliminado_por: str, commit: bool = True) -> bool:
    """La columna y sus valores van a la Papelera (se pueden restaurar)."""
    H, C, Fi = _openings_modelos()
    c = db.get(C, col_id)
    if not c:
        return False
    valores = {}
    for f in db.query(Fi).filter(Fi.hoja_id == c.hoja_id).all():
        d = json.loads(f.datos or "{}")
        if c.clave in d:
            valores[str(f.id)] = d.pop(c.clave)
            f.datos = json.dumps(d, ensure_ascii=False)
    _trash_registrar(db, "openings-col", f"Openings: columna {c.titulo}",
                     {"hoja_id": c.hoja_id, "clave": c.clave, "titulo": c.titulo, "orden": c.orden, "valores": valores},
                     eliminado_por)
    _openings_tocar(db.get(H, c.hoja_id))
    db.delete(c)
    if commit:
        db.commit()
    return True


def openings_mover_columna(db: Session, col_id: int, paso: int) -> bool:
    H, C, Fi = _openings_modelos()
    c = db.get(C, col_id)
    if not c:
        return False
    cols = db.query(C).filter(C.hoja_id == c.hoja_id).order_by(C.orden, C.id).all()
    i = cols.index(c)
    j = max(0, min(len(cols) - 1, i + (1 if paso > 0 else -1)))
    cols.insert(j, cols.pop(i))
    for k, x in enumerate(cols, start=1):
        x.orden = k
    db.commit()
    return True


def openings_actualizar_hoja(db: Session, titulo: str | None, subtitulo: str | None) -> None:
    h = openings_hoja(db)
    if titulo is not None:
        h.titulo = titulo.strip()[:200]
    if subtitulo is not None:
        h.subtitulo = subtitulo.strip()[:200]
    _openings_tocar(h)
    db.commit()


def _trash_restaurar_openings_fila(db: Session, payload: dict) -> bool:
    H, C, Fi = _openings_modelos()
    if not db.get(H, payload.get("hoja_id")):
        return False
    filas = db.query(Fi).filter(Fi.hoja_id == payload["hoja_id"]).order_by(Fi.orden, Fi.id).all()
    nueva = Fi(hoja_id=payload["hoja_id"], datos=json.dumps(payload.get("datos", {}), ensure_ascii=False))
    filas.insert(max(0, min(len(filas), (payload.get("orden") or len(filas) + 1) - 1)), nueva)
    db.add(nueva)
    for i, f in enumerate(filas, start=1):
        f.orden = i
    db.commit()
    return True


def _trash_restaurar_openings_col(db: Session, payload: dict) -> bool:
    H, C, Fi = _openings_modelos()
    if not db.get(H, payload.get("hoja_id")):
        return False
    if db.query(C).filter(C.hoja_id == payload["hoja_id"], C.clave == payload["clave"]).first():
        return False  # ya hay una columna con esa clave
    db.add(C(hoja_id=payload["hoja_id"], clave=payload["clave"], titulo=payload.get("titulo", ""), orden=payload.get("orden", 0)))
    valores = payload.get("valores", {})
    for f in db.query(Fi).filter(Fi.hoja_id == payload["hoja_id"]).all():
        if str(f.id) in valores:
            d = json.loads(f.datos or "{}")
            d[payload["clave"]] = valores[str(f.id)]
            f.datos = json.dumps(d, ensure_ascii=False)
    db.commit()
    return True


_TRASH_RESTAURADORES["openings-fila"] = _trash_restaurar_openings_fila
_TRASH_RESTAURADORES["openings-col"] = _trash_restaurar_openings_col



# ⚠️ ORIGEN DE DATOS DE DESIGN — validar con Rosember antes de cambiar (ver app/services_design_origenes.py y CLAUDE.md).
# ---------- Centro en el Schedule: los centros de Openings del manager del equipo ----------
# N3 / N2 / Face: los centros cuyo Manager N3 / N2 / Face es el manager del equipo. N6 y Support: todos.
# Al final siempre Training y Colaboracion (1-oct-2026). Si el manager no aparece en Openings, se usa el
# catálogo de Centros del área (como antes), para que nunca quede vacío.
OPENINGS_COL_MANAGER = {"N3 Prosthetic": "manager_n3", "N2 Demodenture": "manager_n2", "Face Design": "manager_face"}
CENTROS_EXTRA = ["Training", "Colaboracion"]
_OPEN_CACHE = {"t": 0.0, "filas": None}


def _openings_filas_cache(db: Session) -> list[dict]:
    import time as _t
    if _OPEN_CACHE["filas"] is not None and _t.monotonic() - _OPEN_CACHE["t"] < 30:
        return _OPEN_CACHE["filas"]
    H, C, Fi = _openings_modelos()
    h = db.query(H).order_by(H.id).first()
    filas = []
    if h:
        filas = [json.loads(f.datos or "{}") for f in db.query(Fi).filter(Fi.hoja_id == h.id).order_by(Fi.orden, Fi.id).all()]
    _OPEN_CACHE["t"], _OPEN_CACHE["filas"] = _t.monotonic(), filas
    return filas


def centros_de_equipo(db: Session, team: DesignTeam) -> list[str] | None:
    """Centros para el desplegable Centro de ese equipo; None = usar el catálogo del área."""
    filas = _openings_filas_cache(db)
    if not filas:
        return None
    todos = [f.get("centro", "").strip() for f in filas if f.get("centro", "").strip()]
    col = OPENINGS_COL_MANAGER.get(team.area.nombre)
    if team.area.formato == FORMATO_SUPPORT or team.area.nombre == "N6 Material Changes":
        base = todos
    elif col and team.manager:
        # se ignoran iniciales y puntos ("Julio E. Hernandez" = Julio Enrique Hernandez Florez)
        pal = lambda t: {w for w in re.sub(r"[^a-z0-9 ]", " ", _normalizar_texto(t)).split() if len(w) > 1}
        pm = pal(team.manager.nombre_completo)
        base = [f.get("centro", "").strip() for f in filas
                if f.get("centro", "").strip() and pal(f.get(col, "")) and pal(f.get(col, "")) <= pm]
        if not base:
            return None
    else:
        return None
    vistos, out = set(), []
    base = sorted(base, key=_normalizar_texto)  # en orden alfabético; Training y Colaboracion siempre al final
    for c in base + CENTROS_EXTRA:
        if _normalizar_texto(c) not in vistos:
            vistos.add(_normalizar_texto(c))
            out.append(c)
    return out
