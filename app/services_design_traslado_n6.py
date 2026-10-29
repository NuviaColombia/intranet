"""
Traslado adelantado de N6 al formato nuevo (Rosember, 28-oct-2026). SOLO LECTURA por ahora: muestra qué órdenes de N6 del
28-oct-2026 pasarían solas al 29 (Hold, Ready to design, Bite ready, Dr authorization, Changes) y cómo quedarían en el
formato de cuatro tablas, y el historial completo de una orden en todos los días. Nada de aquí cambia datos.

Reglas acordadas con Rosember (28-oct-2026):
- Solo N6.
- Dr authorization → Órdenes en espera.
- Changes → regla nueva: el tiempo anterior se guarda y la etapa se reabre con las horas limpias.
- Nightguards / TC con el producto Over Ti-bar (p. ej. la orden 243200) → se arma completa en Over Ti-bar con lo que tenga en
  los días anteriores.
"""
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .models_design import DesignArea, DesignOrden, DesignTeam
from . import services_design as sd

ORIGEN = date(2026, 10, 28)
DESTINO = sd.N6_SEPARADO_DESDE
_ESTADOS_PASAN = {"hold", "ready to design"}

_CAMPOS = ["orden", "centro", "producto", "designer_id", "designer_prestado", "estado", "etapa", "qc", "qc_reporte",
           "hora_inicio", "s_hold", "f_hold", "hold_minutos", "hora_fin",
           "z_hora_inicio", "z_s_hold", "z_f_hold", "z_hold_minutos", "z_hora_fin", "z_qc", "z_qc_reporte", "notas"]


def _fila(o) -> dict:
    d = {"id": o.id, "fecha": o.fecha.isoformat(), "equipo": o.team.nombre if o.team else "", "area": o.team.area.nombre if o.team else "",
         "tabla": o.tabla, "disenador": o.designer.nombre_completo if o.designer else ""}
    d.update({c: getattr(o, c) for c in _CAMPOS})
    return d


def _pasaria(o) -> bool:
    """Las mismas reglas que trasladar_holds para el 28 (formato viejo)."""
    e = sd._normalizar_texto(o.estado or "")
    if e in _ESTADOS_PASAN:
        return True
    if o.tabla == "nightguard" and e == sd._normalizar_texto(sd.ESTADO_BITE_READY):
        return True
    return o.tabla == sd.TABLA_MATERIAL and e in ("dr authorization", "changes")


def propuesta(o) -> list[str]:
    """Cómo quedaría la orden el 29, en palabras (para revisar antes de mover)."""
    e = sd._normalizar_texto(o.estado or "")
    p = sd._normalizar_texto(o.producto or "")
    tibar = p in {sd._normalizar_texto(x) for x in sd.PRODUCTOS_N6_TABLA[sd.TABLA_TIBAR]}
    if o.tabla == "principal":
        destino = sd.n6_tabla_de_producto("principal", o.producto)
        return [f"Pasa a {'Dummy' if destino == sd.TABLA_DUMMY else 'Cirugías'} con el mismo estado ({o.estado}) y sus horas."]
    if o.tabla == "nightguard":
        if tibar:
            return ["Producto Over Ti-bar en Nightguards / TC: se arma completa en Over Ti-bar con lo que tenga en los días anteriores "
                    "(ver «historial»)."]
        return [f"Se queda en Nightguards / TC ({o.estado}); el 29 esa sección aparece solo si tiene órdenes."]
    # Material Change (formato viejo: un estado para la etapa activa, en `etapa`)
    tabla = "Over Ti-bar" if tibar else "Material Change"
    zir = sd.es_etapa_zirconia(o.etapa)
    out = [f"Pasa a {tabla}."]
    if zir:
        out.append("Ya iba en Zirconia design: Bite design queda " + ("Dr authorization (tenía su QC)" if o.qc else "Approved") +
                   f"; el diseñador ({o.designer.nombre_completo if o.designer else 'sin asignar'}) queda también en Zirconia design.")
    etapa = "Zirconia design" if zir else "Bite design"
    if e == "dr authorization":
        out.append(f"Dr authorization en {etapa} → Órdenes en espera (la etapa queda aprobada).")
    elif e == "changes":
        out.append(f"Changes en {etapa} → regla nueva: su tiempo de diseño se guarda y la etapa se reabre con las horas limpias.")
    else:
        out.append(f"{o.estado} en {etapa}: queda igual en esa etapa, con sus horas.")
    return out


def revisar(db: Session, orden: str = "") -> dict:
    """Solo lectura: las órdenes de N6 del 28 que pasarían al 29 con su propuesta, y el historial de `orden` (todos los días)."""
    n6 = db.query(DesignArea).filter(DesignArea.nombre == sd.AREA_N6).first()
    equipos = [t.id for t in db.query(DesignTeam).filter(DesignTeam.area_id == n6.id)] if n6 else []
    filas = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
             .filter(DesignOrden.team_id.in_(equipos or [-1]), DesignOrden.fecha == ORIGEN)
             .order_by(DesignOrden.team_id, DesignOrden.tabla, DesignOrden.orden_visual, DesignOrden.id).all())
    pasan = [{**_fila(o), "propuesta": propuesta(o)} for o in filas if _pasaria(o)]
    out = {"origen": ORIGEN.isoformat(), "destino": DESTINO.isoformat(), "total": len(pasan), "ordenes": pasan,
           "yaEnDestino": db.query(func.count(DesignOrden.id)).filter(DesignOrden.team_id.in_(equipos or [-1]), DesignOrden.fecha == DESTINO).scalar()}
    if orden.strip():
        hist = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area), joinedload(DesignOrden.designer))
                .filter(func.upper(func.trim(DesignOrden.orden)) == orden.strip().upper())
                .order_by(DesignOrden.fecha, DesignOrden.id).all())
        out["historial"] = {"orden": orden.strip().upper(), "filas": [_fila(o) for o in hist]}
    return out
