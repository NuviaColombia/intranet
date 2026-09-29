"""Lógica de negocio del módulo SST (inventario de EPP)."""
from datetime import date, datetime
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from .models import Empleado
from .models_sst import SstItem, SstAcceso, SstIngreso, SstSolicitud, SstSolicitudLinea


# ---------- Catálogo ----------

def catalogo(db: Session, solo_activos: bool = True) -> list[SstItem]:
    q = db.query(SstItem)
    if solo_activos:
        q = q.filter(SstItem.activo == 1)
    return q.order_by(SstItem.orden, SstItem.nombre).all()


def crear_item(db: Session, nombre: str, unidad_conteo: str, presentacion: int) -> SstItem | None:
    nombre = nombre.strip()
    if not nombre or db.query(SstItem).filter(SstItem.nombre == nombre).first():
        return None
    orden = (db.query(SstItem).count() or 0) + 1
    item = SstItem(nombre=nombre, unidad_conteo=unidad_conteo, presentacion=max(1, presentacion), orden=orden)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def editar_item(db: Session, item_id: int, nombre: str, unidad_conteo: str, presentacion: int) -> None:
    item = db.get(SstItem, item_id)
    if item:
        item.nombre = nombre.strip() or item.nombre
        item.unidad_conteo = unidad_conteo
        item.presentacion = max(1, presentacion)
        db.commit()


def toggle_item(db: Session, item_id: int) -> None:
    item = db.get(SstItem, item_id)
    if item:
        item.activo = 0 if item.activo else 1
        db.commit()


# ---------- Accesos (Compras / Coordinación SST) ----------

def accesos(db: Session) -> list[SstAcceso]:
    return (db.query(SstAcceso).options(joinedload(SstAcceso.empleado))
            .join(Empleado, SstAcceso.empleado_id == Empleado.id)
            .order_by(Empleado.apellidos).all())


def agregar_acceso(db: Session, empleado_id: int, rol_sst: str) -> bool:
    emp = db.get(Empleado, empleado_id)
    if not emp or emp.empresa != "Nuvia Smiles Colombia SAS":
        return False
    if not db.query(SstAcceso).filter_by(empleado_id=empleado_id, rol_sst=rol_sst).first():
        db.add(SstAcceso(empleado_id=empleado_id, rol_sst=rol_sst))
        db.commit()
    return True


def quitar_acceso(db: Session, acceso_id: int) -> None:
    acceso = db.get(SstAcceso, acceso_id)
    if acceso:
        db.delete(acceso)
        db.commit()


# ---------- Ingresos (Compras registra, Coordinación aprueba) ----------

def _normalizar_unidades(item: SstItem, cantidad: float, unidad_usada: str) -> float:
    if unidad_usada == "PACK" and item.unidad_conteo == "PACK":
        return cantidad * item.presentacion
    return cantidad


def crear_ingreso(db: Session, user: Empleado, item_id: int, cantidad: float, unidad_usada: str,
                  fecha: date, notas: str = "") -> SstIngreso | None:
    item = db.get(SstItem, item_id)
    if not item or cantidad <= 0:
        return None
    ingreso = SstIngreso(item_id=item_id, cantidad_ingresada=cantidad, unidad_usada=unidad_usada,
                         cantidad_unidades=_normalizar_unidades(item, cantidad, unidad_usada),
                         fecha=fecha, registrado_por_id=user.id, notas=notas.strip())
    db.add(ingreso)
    db.commit()
    db.refresh(ingreso)
    return ingreso


def ingresos_pendientes(db: Session) -> list[SstIngreso]:
    return (db.query(SstIngreso).options(joinedload(SstIngreso.item), joinedload(SstIngreso.registrado_por))
            .filter(SstIngreso.estado == "pendiente").order_by(SstIngreso.creado_en).all())


def aprobar_ingreso(db: Session, ingreso: SstIngreso, user: Empleado) -> None:
    ingreso.estado = "aprobado"
    ingreso.resuelto_por_id = user.id
    ingreso.resuelto_en = datetime.utcnow()
    db.commit()


def rechazar_ingreso(db: Session, ingreso: SstIngreso, user: Empleado, motivo: str) -> None:
    ingreso.estado = "rechazado"
    ingreso.resuelto_por_id = user.id
    ingreso.resuelto_en = datetime.utcnow()
    ingreso.motivo_rechazo = motivo.strip()
    db.commit()


# ---------- Solicitudes (Manager solicita, Coordinación entrega) ----------

def crear_solicitud(db: Session, user: Empleado, lineas: list[dict], notas: str = "") -> SstSolicitud | None:
    """`lineas`: [{"itemId": int, "cantidad": float, "unidadUsada": "PACK"|"UND"|"GALON"}, ...]"""
    if not lineas:
        return None
    solicitud = SstSolicitud(solicitante_id=user.id, fecha_solicitud=date.today(), notas=notas.strip())
    db.add(solicitud)
    db.flush()
    lineas_validas = 0
    for l in lineas:
        item = db.get(SstItem, l["itemId"])
        cantidad = float(l["cantidad"])
        if not item or cantidad <= 0:
            continue
        unidad_usada = l["unidadUsada"]
        db.add(SstSolicitudLinea(solicitud_id=solicitud.id, item_id=item.id, cantidad_solicitada=cantidad,
                                 unidad_usada=unidad_usada,
                                 cantidad_unidades=_normalizar_unidades(item, cantidad, unidad_usada)))
        lineas_validas += 1
    if lineas_validas == 0:
        db.rollback()
        return None
    db.commit()
    db.refresh(solicitud)
    return solicitud


def solicitudes_pendientes(db: Session) -> list[SstSolicitud]:
    return (db.query(SstSolicitud)
            .options(joinedload(SstSolicitud.solicitante), joinedload(SstSolicitud.lineas).joinedload(SstSolicitudLinea.item))
            .filter(SstSolicitud.estado == "pendiente").order_by(SstSolicitud.fecha_solicitud).all())


def solicitudes_de(db: Session, empleado_id: int) -> list[SstSolicitud]:
    return (db.query(SstSolicitud)
            .options(joinedload(SstSolicitud.lineas).joinedload(SstSolicitudLinea.item))
            .filter(SstSolicitud.solicitante_id == empleado_id)
            .order_by(SstSolicitud.fecha_solicitud.desc()).all())


def entregar_solicitud(db: Session, solicitud: SstSolicitud, user: Empleado) -> str | None:
    """Devuelve None si se entregó, o un mensaje de error si no hay stock suficiente para alguna línea."""
    stock = stock_a_fecha(db, date.today())
    for linea in solicitud.lineas:
        disponible = stock.get(linea.item_id, 0.0)
        if disponible < linea.cantidad_unidades:
            return (f"No hay suficiente stock de \"{linea.item.nombre}\": disponible {disponible:g}, "
                    f"solicitado {linea.cantidad_unidades:g}.")
    solicitud.estado = "entregada"
    solicitud.entregado_por_id = user.id
    solicitud.entregado_en = datetime.utcnow()
    db.commit()
    return None


def rechazar_solicitud(db: Session, solicitud: SstSolicitud, user: Empleado, motivo: str) -> None:
    solicitud.estado = "rechazada"
    solicitud.entregado_por_id = user.id
    solicitud.entregado_en = datetime.utcnow()
    solicitud.motivo_rechazo = motivo.strip()
    db.commit()


# ---------- Stock derivado y reportes ----------

def stock_a_fecha(db: Session, fecha: date) -> dict[int, float]:
    """{item_id: unidades en stock a `fecha` inclusive}. Sin tabla de saldo: se deriva sumando
    ingresos aprobados y restando líneas de solicitudes entregadas, igual que hace Custodia."""
    saldo: dict[int, float] = {}
    for item_id, total in (db.query(SstIngreso.item_id, func.coalesce(func.sum(SstIngreso.cantidad_unidades), 0.0))
                           .filter(SstIngreso.estado == "aprobado", SstIngreso.fecha <= fecha)
                           .group_by(SstIngreso.item_id).all()):
        saldo[item_id] = saldo.get(item_id, 0.0) + float(total)
    salidas = (db.query(SstSolicitudLinea.item_id, func.coalesce(func.sum(SstSolicitudLinea.cantidad_unidades), 0.0))
              .join(SstSolicitud, SstSolicitudLinea.solicitud_id == SstSolicitud.id)
              .filter(SstSolicitud.estado == "entregada", func.date(SstSolicitud.entregado_en) <= fecha)
              .group_by(SstSolicitudLinea.item_id).all())
    for item_id, total in salidas:
        saldo[item_id] = saldo.get(item_id, 0.0) - float(total)
    return saldo


def reporte_inventario(db: Session, fecha: date) -> list[dict]:
    saldo = stock_a_fecha(db, fecha)
    return [{"itemId": it.id, "nombre": it.nombre, "unidadConteo": it.unidad_conteo,
            "presentacion": it.presentacion, "stockUnidades": saldo.get(it.id, 0.0)}
           for it in catalogo(db, solo_activos=False)]


def reporte_movimientos(db: Session, fecha_desde: date, fecha_hasta: date) -> list[dict]:
    movimientos = []
    ingresos = (db.query(SstIngreso).options(joinedload(SstIngreso.item), joinedload(SstIngreso.registrado_por))
               .filter(SstIngreso.estado == "aprobado", SstIngreso.fecha >= fecha_desde, SstIngreso.fecha <= fecha_hasta)
               .all())
    for i in ingresos:
        movimientos.append({"fecha": i.fecha.isoformat(), "tipo": "Ingreso", "item": i.item.nombre,
                            "cantidadUnidades": i.cantidad_unidades,
                            "persona": i.registrado_por.nombre_completo if i.registrado_por else ""})
    entregas = (db.query(SstSolicitudLinea).join(SstSolicitud, SstSolicitudLinea.solicitud_id == SstSolicitud.id)
               .options(joinedload(SstSolicitudLinea.item), joinedload(SstSolicitudLinea.solicitud).joinedload(SstSolicitud.solicitante))
               .filter(SstSolicitud.estado == "entregada", func.date(SstSolicitud.entregado_en) >= fecha_desde,
                       func.date(SstSolicitud.entregado_en) <= fecha_hasta).all())
    for l in entregas:
        movimientos.append({"fecha": l.solicitud.entregado_en.date().isoformat(), "tipo": "Salida", "item": l.item.nombre,
                            "cantidadUnidades": -l.cantidad_unidades,
                            "persona": l.solicitud.solicitante.nombre_completo if l.solicitud.solicitante else ""})
    movimientos.sort(key=lambda m: m["fecha"])
    return movimientos
