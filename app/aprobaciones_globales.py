"""Agrega las aprobaciones pendientes de todos los módulos, para el botón con contador
en la barra superior y la bandeja unificada en /mis-aprobaciones. Cada módulo aporta su
propia lista sin que los demás módulos necesiten conocerse entre sí."""
from sqlalchemy.orm import Session
from .models import Empleado, HoraExtra
from .services import pendientes_de
from . import services_custodia as sc


def resumen_pendientes(db: Session, user: Empleado) -> dict:
    items = []

    for a in pendientes_de(db, user):
        items.append({
            "modulo": "People", "tipo": "permiso", "id": a.id,
            "descripcion": f"Permiso «{a.solicitud.tipo.nombre}» de {a.solicitud.empleado.nombre_completo}",
            "fecha": a.solicitud.fecha_inicio,
        })

    if user.rol == "admin":
        for he in db.query(HoraExtra).filter(HoraExtra.estado == "pendiente").order_by(HoraExtra.creada_en).all():
            items.append({
                "modulo": "Horas extra", "tipo": "horas_extra", "id": he.id,
                "descripcion": f"{he.empleado.nombre_completo}: {he.horas:g}h ({he.motivo or 'sin motivo'})",
                "fecha": he.fecha,
            })

    if user.tiene_modulo("custodia"):
        for t in sc.pendientes_entrada(db):
            items.append({
                "modulo": "Custodia", "tipo": "custodia", "id": t.id,
                "descripcion": f"Traslado #{t.id}: {t.colaborador} ({t.area_salida} → {t.area_entrada})",
                "fecha": t.fecha,
            })

    return {"items": items, "total": len(items)}
