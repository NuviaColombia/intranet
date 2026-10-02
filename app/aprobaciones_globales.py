"""Agrega las aprobaciones pendientes de todos los módulos, para el botón con contador
en la barra superior y la bandeja unificada en /mis-aprobaciones. Cada módulo aporta su
propia lista sin que los demás módulos necesiten conocerse entre sí."""
from datetime import datetime
from sqlalchemy.orm import Session
from .models import Empleado, Aprobacion, HoraExtra
from .models_custodia import CustodiaTraslado
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

    from .acceso_produccion import tiene_submodulo
    if tiene_submodulo(db, user, "custodia"):
        for t in sc.pendientes_entrada(db):
            if not sc.puede_firmar_recibido(user, t):  # solo lo que este usuario puede firmar
                continue
            items.append({
                "modulo": "Cambio de custodia", "tipo": "custodia", "id": t.id,
                "descripcion": f"Traslado #{t.id}: {t.colaborador} ({t.area_salida} → {t.area_entrada})",
                "fecha": t.fecha,
            })

    return {"items": items, "total": len(items)}


def historial_decisiones(db: Session, user: Empleado, limite: int = 30) -> list[dict]:
    """Últimas decisiones que este usuario tomó en cualquier módulo -- para la bandeja unificada
    en /mis-aprobaciones, igual que cada módulo ya muestra el historial propio de su aprobador."""
    items = []

    aps = (db.query(Aprobacion).filter(Aprobacion.aprobador_id == user.id, Aprobacion.decision != "pendiente")
           .order_by(Aprobacion.decidida_en.desc()).limit(limite).all())
    for a in aps:
        items.append({
            "modulo": "People", "descripcion": f"Permiso «{a.solicitud.tipo.nombre}» de {a.solicitud.empleado.nombre_completo}",
            "decision": a.decision, "fecha": a.decidida_en,
        })

    hes = (db.query(HoraExtra).filter(HoraExtra.decidida_por_id == user.id, HoraExtra.estado != "pendiente")
           .order_by(HoraExtra.decidida_en.desc()).limit(limite).all())
    for he in hes:
        items.append({
            "modulo": "Horas extra", "descripcion": f"{he.empleado.nombre_completo}: {he.horas:g}h ({he.motivo or 'sin motivo'})",
            "decision": he.estado, "fecha": he.decidida_en,
        })

    from .acceso_produccion import tiene_submodulo
    if tiene_submodulo(db, user, "custodia"):
        recibidos = (db.query(CustodiaTraslado).filter(CustodiaTraslado.confirmado_por_id == user.id)
                    .order_by(CustodiaTraslado.confirmado_en.desc()).limit(limite).all())
        for t in recibidos:
            items.append({
                "modulo": "Cambio de custodia",
                "descripcion": f"Traslado #{t.id}: {t.colaborador} ({t.area_salida} → {t.area_entrada}) -- recibido",
                "decision": "aprobada", "fecha": t.confirmado_en,
            })
        firmados_dir = (db.query(CustodiaTraslado).filter(CustodiaTraslado.dir_firmado_por_id == user.id)
                       .order_by(CustodiaTraslado.dir_firmado_en.desc()).limit(limite).all())
        for t in firmados_dir:
            items.append({
                "modulo": "Cambio de custodia",
                "descripcion": f"Traslado #{t.id}: {t.colaborador} -- firma DIR Producción",
                "decision": "aprobada", "fecha": t.dir_firmado_en,
            })

    items.sort(key=lambda it: it["fecha"] or datetime.min, reverse=True)
    return items[:limite]
