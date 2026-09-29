"""Parámetros del módulo Producción (/inventario/parametros), para todos sus submódulos:
accesos al módulo (con el área asignada de cada persona) y, de Cambio de custodia, áreas de
producción, catálogo de discos y motivos. Solo administradores."""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_custodia import (CustodiaArea, CustodiaMotivo, CustodiaFactorDisco, CustodiaTraslado, CustodiaOrdenLinea,
                               CustodiaResumen, CustodiaDiscos, CustodiaOP)
from ..auth import require_admin
from ..database import SessionLocal, engine
from ..acceso_produccion import ProduccionAcceso, asegurar_tabla_y_migrar, MODULO_PRODUCCION
from ..produccion import SUBMODULOS_PRODUCCION
from ..main_templates import templates
from .. import services_custodia as sc

router = APIRouter()


@router.on_event("startup")
def _accesos_produccion() -> None:
    asegurar_tabla_y_migrar(engine, SessionLocal)
    # Cambio de custodia: órdenes asignadas desde Stock
    from sqlalchemy import inspect, text
    try:
        if inspect(engine).has_table("custodia_ordenes") and "orden_origen" not in {
                c["name"] for c in inspect(engine).get_columns("custodia_ordenes")}:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE custodia_ordenes ADD COLUMN orden_origen VARCHAR(50)"))
    except Exception as e:  # otro proceso la acaba de agregar
        print(f"Custodia: columna orden_origen ({type(e).__name__}).")
    try:
        if inspect(engine).has_table("custodia_ordenes") and "ingreso_directo" not in {
                c["name"] for c in inspect(engine).get_columns("custodia_ordenes")}:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE custodia_ordenes ADD COLUMN ingreso_directo BOOLEAN DEFAULT FALSE"))
            _marcar_ingresos_directos()
            _entradas_dir_a_stock()
    except Exception as e:
        print(f"Custodia: columna ingreso_directo ({type(e).__name__}: {e}).")


def _entradas_dir_a_stock() -> None:
    """Registros anteriores: lo que se entregó a DIR Producción con un número de orden pasa a ser su STOCK
    (en la salida se sigue descontando la orden original), igual que los traslados nuevos."""
    from ..models_custodia import CustodiaOrdenLinea
    db = SessionLocal()
    try:
        lineas = (db.query(CustodiaOrdenLinea).join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
                  .filter(CustodiaTraslado.area_entrada == sc.AREA_ORIGEN, CustodiaOrdenLinea.numero_orden != sc.ORDEN_STOCK,
                          CustodiaOrdenLinea.orden_origen.is_(None)).all())
        for linea in lineas:
            linea.orden_origen, linea.numero_orden = linea.numero_orden, sc.ORDEN_STOCK
        db.commit()
        if lineas:
            print(f"Custodia: {len(lineas)} entrega(s) anteriores a DIR Producción quedaron como Stock.")
    finally:
        db.close()


def _marcar_ingresos_directos() -> None:
    """Registros anteriores: el primer movimiento de cada orden, si salió de DIR Producción, fue una orden
    nueva: se marca para que también sume en DIR Producción y su existencia no quede en negativo."""
    from ..models_custodia import CustodiaOrdenLinea
    db = SessionLocal()
    try:
        filas = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
                 .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
                 .filter(CustodiaTraslado.anulado.is_(False))
                 .order_by(CustodiaTraslado.fecha, CustodiaTraslado.hora, CustodiaTraslado.id).all())
        vistas, marcadas = set(), 0
        for linea, t in filas:
            if linea.numero_orden in vistas:
                continue
            vistas.add(linea.numero_orden)
            if t.area_salida == sc.AREA_ORIGEN and not linea.orden_origen:
                linea.ingreso_directo = True
                marcadas += 1
        db.commit()
        if marcadas:
            print(f"Custodia: {marcadas} orden(es) nueva(s) de DIR Producción corregidas para que no quede en negativo.")
    finally:
        db.close()


NUVIA_SMILES = "Nuvia Smiles Colombia SAS"


@router.get("/custodia/parametros")
def parametros_antes(request: Request, user: Empleado = Depends(require_admin)):
    """Dirección anterior (cuando los parámetros estaban dentro de Cambio de custodia)."""
    return RedirectResponse("/inventario/parametros", status_code=303)


@router.get("/inventario/parametros")
def parametros(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    # Accesos por submódulo: {empleado_id: {slugs}}
    por_empleado: dict[int, set[str]] = {}
    for a in db.query(ProduccionAcceso).all():
        por_empleado.setdefault(a.empleado_id, set()).add(a.submodulo)
    con_custodia = {i for i, subs in por_empleado.items() if "custodia" in subs}
    managers = (db.query(Empleado).filter(Empleado.id.in_(con_custodia or [0]))
               .order_by(Empleado.apellidos).all())
    candidatos = (db.query(Empleado)
                 .filter(Empleado.empresa == NUVIA_SMILES, Empleado.activo == 1, ~Empleado.id.in_(con_custodia or [0]))
                 .order_by(Empleado.apellidos).all())
    resumen = (db.query(Empleado).filter(Empleado.id.in_(list(por_empleado) or [0]))
               .order_by(Empleado.apellidos).all())
    areas = db.query(CustodiaArea).order_by(CustodiaArea.orden).all()
    motivos = db.query(CustodiaMotivo).order_by(CustodiaMotivo.orden).all()
    discos = db.query(CustodiaFactorDisco).order_by(CustodiaFactorDisco.orden).all()
    return templates.TemplateResponse(request, "custodia_parametros.html",
                                      {"user": user, "managers": managers, "candidatos": candidatos,
                                       "areas": areas, "motivos": motivos, "discos": discos,
                                       "registros": {"traslados": db.query(CustodiaTraslado).count(),
                                                     "ordenes": db.query(CustodiaOrdenLinea).count(),
                                                     "ultimo": db.query(CustodiaTraslado.id).order_by(CustodiaTraslado.id.desc()).limit(1).scalar()},
                                       "saldos_cargados": sc.saldos_ya_cargados(db),
                                       "areas_config": [a.nombre for a in areas if a.activo],
                                       "texto_saldos": request.query_params.get("texto", ""),
                                       "conteo_panel": {"limpiar": db.query(CustodiaTraslado).count(),
                                                        "saldos": sc.saldos_ya_cargados(db),
                                                        "managers": len(managers), "areas": len(areas), "discos": len(discos),
                                                        "motivos": len(motivos)},
                                       "resumen": resumen, "por_empleado": por_empleado,
                                       "areas_activas": sc.areas_disponibles(db),
                                       "es_custodia": True, "msg": request.query_params.get("msg"),
                                       "cargo_coincide": {m.id: sc.cargo_coincide_con_area(m.cargo, m.area_custodia)
                                                          for m in managers},
                                       "custodia_pendientes": len(sc.pendientes_entrada(db))})


# ---------- Managers ----------

@router.post("/inventario/parametros/managers")
def agregar_manager(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                          empleado_id: int = Form(...), area_custodia: str = Form("")):
    emp = db.get(Empleado, empleado_id)
    if emp and emp.empresa == NUVIA_SMILES:
        modulos = set(emp.modulos_lista)
        modulos.add(MODULO_PRODUCCION)
        emp.modulos = ",".join(sorted(modulos))
        if not db.query(ProduccionAcceso).filter_by(empleado_id=emp.id, submodulo="custodia").first():
            db.add(ProduccionAcceso(empleado_id=emp.id, submodulo="custodia"))
        if emp.rol == "empleado":
            emp.rol = "aprobador"
        emp.area_custodia = area_custodia.strip().upper()
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Acceso a Cambio de custodia dado.", status_code=303)


@router.post("/inventario/parametros/managers/{empleado_id}")
def actualizar_manager(empleado_id: int, user: Empleado = Depends(require_admin),
                             db: Session = Depends(get_db), area_custodia: str = Form("")):
    emp = db.get(Empleado, empleado_id)
    if emp:
        emp.area_custodia = area_custodia.strip().upper()
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Área asignada actualizada.", status_code=303)


@router.post("/inventario/parametros/managers/{empleado_id}/quitar")
def quitar_manager(empleado_id: int, user: Empleado = Depends(require_admin),
                         db: Session = Depends(get_db)):
    emp = db.get(Empleado, empleado_id)
    msg = "Acceso a Cambio de custodia quitado."
    if emp:
        db.query(ProduccionAcceso).filter_by(empleado_id=emp.id, submodulo="custodia").delete()
        emp.area_custodia = ""
        # Sin ningún submódulo de Producción, pierde también el módulo
        if not db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == emp.id).first():
            emp.modulos = ",".join(m for m in emp.modulos_lista if m != MODULO_PRODUCCION)
        # Al agregarlo se subió a "aprobador"; si no aprueba a nadie en People, vuelve a "empleado".
        if emp.rol == "aprobador":
            aprueba_a_alguien = (db.query(Empleado.id)
                                 .filter((Empleado.aprobador1_id == emp.id) | (Empleado.aprobador2_id == emp.id))
                                 .first() is not None)
            if not aprueba_a_alguien:
                emp.rol = "empleado"
                msg = "Acceso a Cambio de custodia quitado. Volvió al rol empleado."
        db.commit()
    return RedirectResponse(f"/inventario/parametros?msg={msg}", status_code=303)


# ---------- Áreas de producción ----------

@router.post("/inventario/parametros/areas")
def crear_area(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                     nombre: str = Form(...), es_inventario: str = Form(""),
                     alerta_horas_advertencia: int = Form(24), alerta_horas_critica: int = Form(48)):
    nombre = nombre.strip().upper()
    if nombre and not db.query(CustodiaArea).filter(CustodiaArea.nombre == nombre).first():
        orden = (db.query(CustodiaArea).count() or 0) + 1
        db.add(CustodiaArea(nombre=nombre, orden=orden, es_inventario=1 if es_inventario else 0,
                            alerta_horas_advertencia=alerta_horas_advertencia,
                            alerta_horas_critica=alerta_horas_critica))
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Área agregada.", status_code=303)


@router.post("/inventario/parametros/areas/{area_id}/editar")
def editar_area(area_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      nombre: str = Form(...), es_inventario: str = Form(""),
                      alerta_horas_advertencia: int = Form(24), alerta_horas_critica: int = Form(48)):
    a = db.get(CustodiaArea, area_id)
    if a:
        anterior, nuevo = a.nombre, nombre.strip().upper()
        if nuevo and nuevo != anterior:
            if db.query(CustodiaArea).filter(CustodiaArea.nombre == nuevo, CustodiaArea.id != a.id).first():
                return RedirectResponse(f"/inventario/parametros?tab=areas&msg=No se guardó: ya existe un área llamada {nuevo}.",
                                        status_code=303)
            # Los registros guardan el nombre del área: se renombra en todos para no perder su historial
            for campo in (CustodiaTraslado.area_salida, CustodiaTraslado.area_entrada, CustodiaTraslado.area_creacion):
                db.query(CustodiaTraslado).filter(campo == anterior).update({campo: nuevo}, synchronize_session=False)
            db.query(Empleado).filter(Empleado.area_custodia == anterior).update({Empleado.area_custodia: nuevo},
                                                                                 synchronize_session=False)
        a.nombre = nuevo or anterior
        # EMPAQUE siempre cuenta como inventario (regla de negocio; también se aplica al arrancar la app)
        a.es_inventario = 1 if (es_inventario or a.nombre == "EMPAQUE") else 0
        a.alerta_horas_advertencia = alerta_horas_advertencia
        a.alerta_horas_critica = alerta_horas_critica
        db.commit()
    return RedirectResponse("/inventario/parametros?tab=areas&msg=Área actualizada.", status_code=303)


@router.post("/inventario/parametros/areas/{area_id}/toggle")
def toggle_area(area_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(CustodiaArea, area_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/inventario/parametros", status_code=303)


# ---------- Catálogo de discos ----------

@router.post("/inventario/parametros/discos")
def crear_disco(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      detalle: str = Form(...), factor: float = Form(...)):
    detalle = detalle.strip()
    if detalle and not db.query(CustodiaFactorDisco).filter(CustodiaFactorDisco.detalle == detalle).first():
        orden = (db.query(CustodiaFactorDisco).count() or 0) + 1
        db.add(CustodiaFactorDisco(detalle=detalle, factor=factor, orden=orden))
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Tipo de prótesis agregado.", status_code=303)


@router.post("/inventario/parametros/discos/{disco_id}/editar")
def editar_disco(disco_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       detalle: str = Form(...), factor: float = Form(...)):
    d = db.get(CustodiaFactorDisco, disco_id)
    if d:
        d.detalle = detalle.strip()
        d.factor = factor
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Catálogo actualizado.", status_code=303)


@router.post("/inventario/parametros/discos/{disco_id}/toggle")
def toggle_disco(disco_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(CustodiaFactorDisco, disco_id)
    if d:
        d.activo = 0 if d.activo else 1
        db.commit()
    return RedirectResponse("/inventario/parametros", status_code=303)


# ---------- Motivos ----------

@router.post("/inventario/parametros/motivos")
def crear_motivo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       nombre: str = Form(...)):
    nombre = nombre.strip().upper()
    if nombre and not db.query(CustodiaMotivo).filter(CustodiaMotivo.nombre == nombre).first():
        orden = (db.query(CustodiaMotivo).count() or 0) + 1
        db.add(CustodiaMotivo(nombre=nombre, orden=orden))
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Motivo agregado.", status_code=303)


@router.post("/inventario/parametros/motivos/{motivo_id}/editar")
def editar_motivo(motivo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                        nombre: str = Form(...), orden: int = Form(0)):
    m = db.get(CustodiaMotivo, motivo_id)
    if m:
        m.nombre = nombre.strip().upper()
        m.orden = orden
        db.commit()
    return RedirectResponse("/inventario/parametros?msg=Motivo actualizado.", status_code=303)


@router.post("/inventario/parametros/motivos/{motivo_id}/toggle")
def toggle_motivo(motivo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(CustodiaMotivo, motivo_id)
    if m:
        m.activo = 0 if m.activo else 1
        db.commit()
    return RedirectResponse("/inventario/parametros", status_code=303)


# ---------- Limpiar registros de prueba ----------

TABLAS_REGISTROS = [CustodiaOP, CustodiaDiscos, CustodiaResumen, CustodiaOrdenLinea, CustodiaTraslado]  # hijas primero
CONFIRMACION_LIMPIAR = "BORRAR TODO"


@router.post("/inventario/parametros/custodia/limpiar")
def limpiar_registros(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      confirmacion: str = Form("")):
    """Borra TODOS los registros de Cambio de custodia (traslados con sus órdenes, resúmenes, discos y OP) y
    reinicia el consecutivo en 1. No toca áreas, catálogo de discos, motivos ni accesos. Solo administradores."""
    from sqlalchemy import text
    if confirmacion.strip().upper() != CONFIRMACION_LIMPIAR:
        return RedirectResponse(f"/inventario/parametros?tab=limpiar&msg=No se borró nada: escribe {CONFIRMACION_LIMPIAR} para confirmar.",
                                status_code=303)
    total = db.query(CustodiaTraslado).count()
    for modelo in TABLAS_REGISTROS:
        db.query(modelo).delete(synchronize_session=False)
    # El consecutivo es el id del traslado: se reinicia el contador de la base para que el próximo sea el 1
    if db.bind.dialect.name == "postgresql":
        for modelo in TABLAS_REGISTROS:
            db.execute(text(f"SELECT setval(pg_get_serial_sequence('{modelo.__tablename__}', 'id'), 1, false)"))
    elif db.bind.dialect.name == "sqlite":
        try:
            nombres = ", ".join(f"'{m.__tablename__}'" for m in TABLAS_REGISTROS)
            db.execute(text(f"DELETE FROM sqlite_sequence WHERE name IN ({nombres})"))
        except Exception:
            pass  # sin AUTOINCREMENT: el siguiente id ya es max + 1
    db.commit()
    print(f"[Custodia] {user.email} borró {total} traslados de prueba y reinició el consecutivo.")
    return RedirectResponse(f"/inventario/parametros?tab=limpiar&msg=Listo: se borraron {total} traslados de prueba. "
                            "El próximo consecutivo es el 0001.", status_code=303)


# ---------- Saldos iniciales ----------

@router.post("/inventario/parametros/custodia/saldos")
def cargar_saldos_iniciales(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                            texto: str = Form(""), fecha_corte: str = Form("")):
    """Carga el inventario inicial: en qué área está cada orden y con qué cantidad (pegado desde Excel)."""
    from urllib.parse import quote
    if sc.saldos_ya_cargados(db):
        return RedirectResponse("/inventario/parametros?tab=saldos&msg=No se cargó: los saldos iniciales ya se cargaron. "
                                "Para volver a cargarlos, usa primero 🧹 Limpiar pruebas.", status_code=303)
    from datetime import date as _date
    try:
        corte = _date.fromisoformat(fecha_corte)
    except ValueError:
        return RedirectResponse(f"/inventario/parametros?tab=saldos&texto={quote(texto)}&msg=No se cargó nada: elige la fecha de corte.",
                                status_code=303)
    activas = [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]
    filas, errores = sc.leer_saldos(texto, activas)
    if errores or not filas:
        detalle = " · ".join(errores[:6]) if errores else "no hay filas para cargar."
        return RedirectResponse(f"/inventario/parametros?tab=saldos&texto={quote(texto)}&msg=No se cargó nada: {quote(detalle)}",
                                status_code=303)
    creados = sc.cargar_saldos(db, user, filas, corte)
    total = sum(f["cantidad"] for f in filas)
    print(f"[Custodia] {user.email} cargó saldos iniciales al {corte}: {len(filas)} órdenes en {len(creados)} áreas ({total:g} discos).")
    return RedirectResponse(f"/inventario/parametros?tab=saldos&msg=Listo: se cargaron {len(filas)} órdenes en {len(creados)} áreas "
                            f"({total:g} discos) con fecha de corte {corte.strftime('%d/%m/%Y')}. Ya aparecen en Estado órdenes y Dashboard.", status_code=303)
