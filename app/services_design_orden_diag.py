"""Diagnóstico de una orden (admins, /design/diagnostico/orden?orden=...): muestra los datos que el Schedule no enseña
(tiempo en Hold acumulado, día en que se creó, cuándo se aprobó) y explica cómo sale su Total. Solo lee.
Creado el 19-oct-2026 para la orden 242472 del Schedule de Samuel, cuyo Total salía 0h 0m."""
from sqlalchemy.orm import Session, joinedload

from .models_design import DesignOrden, DesignTeam
from . import services_design as sd


def _fmt(m) -> str:
    m = max(0, round(m or 0))
    return f"{int(m // 60)}h {int(m % 60)}m"


def diagnosticar(db: Session, numero: str) -> dict:
    numero = (numero or "").strip()
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
             .filter(DesignOrden.orden == numero).order_by(DesignOrden.fecha.desc()).limit(20).all())
    out = []
    for o in filas:
        formato = o.team.area.formato if o.team and o.team.area else ""
        nuevo = sd.horas_por_estado(formato, o.fecha, o.tabla)
        inicio = o.hora_inicio if (nuevo or formato == sd.FORMATO_N2) else o.hora_inicio_diseno
        tf = sd._entre(inicio, o.hora_fin) if inicio and o.hora_fin else None
        hold_actual = sd._entre(o.s_hold, o.f_hold) if o.s_hold and o.f_hold else 0
        hold = (o.hold_minutos or 0) + hold_actual
        total = sd.duracion_orden_min(o, formato)
        dias = (o.fecha - o.fecha_creada).days if o.fecha_creada else None
        notas = []
        if not inicio or not o.hora_fin:
            notas.append("Falta el Inicio o el Fin: el Total queda vacío o en 0.")
        elif tf is not None and hold >= tf:
            if total > 0:
                notas.append(f"El tiempo en Hold ({_fmt(hold)}) es mayor que Fin − Inicio ({_fmt(tf)}) porque el caso pasó noches en Hold: "
                             f"el Total suma los días que faltan (máximo los que lleva desde que se creó) y da {_fmt(total)}.")
            else:
                notas.append(f"El tiempo en Hold ({_fmt(hold)}) es igual o mayor que Fin − Inicio ({_fmt(tf)}): por eso el Total sale 0h 0m.")
            if dias:
                notas.append(f"La orden se creó el {o.fecha_creada:%d/%m/%Y} y está el {o.fecha:%d/%m/%Y} ({dias} día(s) después). Las horas se guardan "
                             "sin fecha: si pasó más de una noche en Hold, «Fin − Inicio» pierde días enteros mientras cada Hold sí los cuenta.")
            if o.s_hold and not dias and sd._entre(inicio, o.s_hold) > tf:
                notas.append("El Start hold quedó antes del Inicio diseño: el caso se puso en Hold antes de empezar a diseñarlo.")
        if o.diseno_min is not None:
            notas.append("Esta orden se mide con hora real: el Total es la suma de los tramos en Initiated (" + _fmt(o.diseno_min) +
                         "), sin contar el Hold.")
        out.append({
            "id": o.id, "equipo": o.team.nombre if o.team else "", "area": o.team.area.nombre if o.team and o.team.area else "",
            "manager": o.team.manager.nombre_completo if o.team and o.team.manager else "", "fecha": o.fecha, "fechaCreada": o.fecha_creada,
            "tabla": o.tabla, "estado": o.estado, "disenador": o.designer.nombre_completo if o.designer else (o.designer_prestado or ""),
            "paciente": o.paciente, "centro": o.centro, "producto": o.producto,
            "inicio": inicio or "", "sHold": o.s_hold or "", "fHold": o.f_hold or "", "fin": o.hora_fin or "",
            "disenoReal": _fmt(o.diseno_min) if o.diseno_min is not None else "", "tramoAbierto": bool(o.diseno_desde),
            "holdAnteriores": _fmt(o.hold_minutos), "holdActual": _fmt(hold_actual), "holdTotal": _fmt(hold),
            "finMenosInicio": _fmt(tf) if tf is not None else "—", "total": _fmt(total),
            "aprobadaEn": o.aprobada_en, "creadaEn": o.creado_en, "actualizadaEn": o.actualizado_en, "notas": notas,
        })
    return {"numero": numero, "filas": out}
