"""Aprobaciones lentas (Dashboard › Aprobaciones lentas, solo admin, 13-oct-2026).

Mide cuánto tarda el manager en aprobar una orden: desde que queda en "Approved" (el diseñador terminó) hasta que se marca
el QC. El sistema no guardaba esas horas, así que desde esta fecha se anotan solas en la orden (aprobada_en y qc_en, en UTC)
con un solo punto de control que cubre cualquier forma de editarla. Las órdenes anteriores a esta fecha no tienen el dato.
"""
from datetime import date, datetime, timedelta

from sqlalchemy import event
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import get_history

from .models_design import DesignOrden, DesignTeam

UMBRAL_MIN = 30
RANGO_MAX_DIAS = 215   # un semestre completo: jun–dic son 214 días y ene–jun 181 (igual que Cambios digitales)


def _es_approved(estado: str) -> bool:
    return (estado or "").strip().lower() == "approved"


def _qc_final(o: DesignOrden) -> bool:
    """El QC que cierra la orden: en Material Change es el de Zirconia (z_qc); en el resto, el de siempre."""
    return bool(o.z_qc) if o.tabla == "material" else bool(o.qc)


@event.listens_for(Session, "before_flush")
def _anotar_tiempos(session, contexto, instancias):
    """Anota la hora en que la orden pasa a Approved y la hora en que se marca su QC (y las borra si se revierten)."""
    ahora = datetime.utcnow()
    for o in list(session.new) + list(session.dirty):
        if not isinstance(o, DesignOrden):
            continue
        nuevo = o in session.new
        if nuevo or get_history(o, "estado").has_changes():
            if _es_approved(o.estado):
                if not o.aprobada_en:
                    o.aprobada_en = ahora
            else:
                o.aprobada_en = None
        if nuevo or get_history(o, "qc").has_changes() or get_history(o, "z_qc").has_changes() or get_history(o, "tabla").has_changes():
            if _qc_final(o):
                if not o.qc_en:
                    o.qc_en = ahora
            else:
                o.qc_en = None


def _min(a: datetime, b: datetime) -> int:
    return int((b - a).total_seconds() // 60)


def lentas(db: Session, desde: date, hasta: date, area_id: int | None = None, team_id: int | None = None,
           umbral: int = UMBRAL_MIN) -> dict:
    """Órdenes en las que el manager tardó más de `umbral` minutos en aprobar (QC marcado) o que siguen sin QC pasado ese
    tiempo. Ordenadas de la más larga a la más corta."""
    q = (db.query(DesignOrden).options(joinedload(DesignOrden.designer), joinedload(DesignOrden.team).joinedload(DesignTeam.manager))
         .join(DesignTeam, DesignOrden.team_id == DesignTeam.id)
         .filter(DesignOrden.aprobada_en.isnot(None), DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta))
    if team_id:
        q = q.filter(DesignOrden.team_id == team_id)
    elif area_id:
        q = q.filter(DesignTeam.area_id == area_id)
    ahora = datetime.utcnow()
    items = []
    for o in q.all():
        fin = o.qc_en or ahora
        m = _min(o.aprobada_en, fin)
        if m <= umbral:
            continue
        t = o.team
        items.append({"id": o.id, "fecha": o.fecha.isoformat(), "orden": o.orden or "", "paciente": o.paciente or "",
                      "centro": o.centro or "", "producto": o.producto or "", "equipo": t.nombre if t else "",
                      "manager": t.manager.nombre_completo if t and t.manager else "",
                      "disenador": o.designer.nombre_completo if o.designer else (o.designer_prestado or ""),
                      "aprobadaEn": o.aprobada_en.isoformat() + "Z", "qcEn": (o.qc_en.isoformat() + "Z") if o.qc_en else "",
                      "minutos": m, "pendiente": o.qc_en is None})
    items.sort(key=lambda x: -x["minutos"])
    cerradas = [x["minutos"] for x in items if not x["pendiente"]]
    kpis = {"total": len(items), "pendientes": sum(1 for x in items if x["pendiente"]),
            "promedio": round(sum(x["minutos"] for x in items) / len(items)) if items else 0,
            "maxima": items[0]["minutos"] if items else 0, "cerradas": len(cerradas)}
    return {"umbral": umbral, "items": items[:2000], "total": len(items), "kpis": kpis}
