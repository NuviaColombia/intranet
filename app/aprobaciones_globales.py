"""Agrega las aprobaciones pendientes de todos los módulos, para el botón con contador
en la barra superior y la bandeja unificada en /mis-aprobaciones. Cada módulo aporta su
propia lista sin que los demás módulos necesiten conocerse entre sí."""
from sqlalchemy.orm import Session
from .models import Empleado, HoraExtra
from .services import pendientes_de
from .auth import empresa_filtro
from . import services_custodia as sc


def resumen_pendientes(db: Session, user: Empleado) -> dict:
    items = []

    for a in pendientes_de(db, user):
        items.append({
            "modulo": "People", "tipo": "permiso", "id": a.id,
            "descripcion": f"Permiso «{a.solicitud.tipo.nombre}» de {a.solicitud.empleado.nombre_completo}",
            "fecha": a.solicitud.fecha_inicio,
        })

    if user.rol in ("admin", "superadmin"):
        q_he = db.query(HoraExtra).filter(HoraExtra.estado == "pendiente")
        empresa_propia = empresa_filtro(user)
        if empresa_propia is not None:
            ids_propios = [e.id for e in db.query(Empleado.id)
                          .filter(Empleado.empresa == empresa_propia).all()]
            q_he = q_he.filter(HoraExtra.empleado_id.in_(ids_propios))
        for he in q_he.order_by(HoraExtra.creada_en).all():
            items.append({
                "modulo": "Horas extra", "tipo": "horas_extra", "id": he.id,
                "descripcion": f"{he.empleado.nombre_completo}: {he.horas:g}h ({he.motivo or 'sin motivo'})",
                "fecha": he.fecha,
            })

    if user.tiene_modulo("custodia"):
        for t in sc.pendientes_entrada(db):
            items.append({
                "modulo": "Cambio de custodia", "tipo": "custodia", "id": t.id,
                "descripcion": f"Traslado #{t.id}: {t.colaborador} ({t.area_salida} → {t.area_entrada})",
                "fecha": t.fecha,
            })

    return {"items": items, "total": len(items)}
