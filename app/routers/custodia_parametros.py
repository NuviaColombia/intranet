"""Parámetros del módulo Producción (/inventario/parametros), para todos sus submódulos:
accesos al módulo (con el área asignada de cada persona) y, de Cambio de custodia, áreas de
producción, catálogo de discos y motivos. Solo administradores."""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_custodia import CustodiaArea, CustodiaMotivo, CustodiaFactorDisco, CustodiaTraslado, CustodiaOrdenLinea
from ..auth import require_admin
from ..database import SessionLocal, engine
from ..acceso_produccion import ProduccionAcceso, asegurar_tabla_y_migrar, MODULO_PRODUCCION
from ..produccion import SUBMODULOS_PRODUCCION
from ..main_templates import templates
from ..formato import nombre_propio
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
    try:  # Firma obligatoria de DIR PRODUCCIÓN en las salidas de QC FINAL
        if inspect(engine).has_table("custodia_traslados"):
            columnas = {c["name"] for c in inspect(engine).get_columns("custodia_traslados")}
            with engine.begin() as conn:
                if "dir_firmado_por_id" not in columnas:
                    conn.execute(text("ALTER TABLE custodia_traslados ADD COLUMN dir_firmado_por_id INTEGER REFERENCES empleados(id)"))
                if "dir_firmado_en" not in columnas:
                    conn.execute(text("ALTER TABLE custodia_traslados ADD COLUMN dir_firmado_en TIMESTAMP"))
    except Exception as e:
        print(f"Custodia: columnas de firma DIR ({type(e).__name__}: {e}).")


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


def _stock_iniciales(db: Session) -> list:
    from ..models_custodia import CustodiaStockDescripcion
    return (db.query(CustodiaStockDescripcion).filter(CustodiaStockDescripcion.tipo == "INICIAL")
            .order_by(CustodiaStockDescripcion.area, CustodiaStockDescripcion.descripcion).all())


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
    # Seguimiento de consumo
    from ..models_consumo import ConsumoMateria, ConsumoTipo, ConsumoTecnico, ConsumoManager
    from .. import services_consumo as scc
    scc.asegurar_tipos(db)
    con_consumo = {i for i, subs in por_empleado.items() if "consumo" in subs}
    consumo = {
        "accesos": db.query(Empleado).filter(Empleado.id.in_(con_consumo or [0])).order_by(Empleado.apellidos).all(),
        "area_de": {m.empleado_id: m.area for m in db.query(ConsumoManager).all()},
        "tecnicos": sorted(db.query(ConsumoTecnico).all(), key=lambda t: (not t.activo, t.area, t.empleado.nombre_completo)),
        "materias": db.query(ConsumoMateria).order_by(ConsumoMateria.activo.desc(), ConsumoMateria.area, ConsumoMateria.orden).all(),
        "tipos": db.query(ConsumoTipo).order_by(ConsumoTipo.orden).all(),
        "personas": db.query(Empleado).filter(Empleado.activo == 1).order_by(Empleado.apellidos, Empleado.nombres).all(),
    }
    tecnicos_ids = {t.empleado_id for t in consumo["tecnicos"] if t.activo}
    from .. import acceso_secciones as acs
    secciones_cfg = {m: acs.configuracion(db, m) for m in ("custodia", "consumo", "conteo")}
    # Conteo inventario mensual
    from ..models_conteo import ConteoBodega, ConteoMaterial, ConteoValidador, ConteoManagerArea
    from .. import services_conteo as sct
    sct.asegurar_catalogo(db)
    con_conteo = {i for i, subs in por_empleado.items() if "conteo" in subs}
    inv_conteo = {
        "accesos": db.query(Empleado).filter(Empleado.id.in_(con_conteo or [0])).order_by(Empleado.apellidos).all(),
        "personas": consumo["personas"],
        "materiales": db.query(ConteoMaterial).order_by(ConteoMaterial.activo.desc(), ConteoMaterial.orden).all(),
        "bodegas": db.query(ConteoBodega).order_by(ConteoBodega.activo.desc(), ConteoBodega.orden).all(),
        "validadores": [v.empleado for v in db.query(ConteoValidador).all() if v.empleado],
        "managers_area": {x.area: x.empleado for x in db.query(ConteoManagerArea).all() if x.empleado},
        "areas_material": sct.areas_de_material(db), "config": sct.config(db), "workdrive": sct.estado_workdrive(db),
    }
    administradores = (db.query(Empleado).filter(Empleado.activo == 1, Empleado.rol.in_(["admin", "superadmin"]))
                       .order_by(Empleado.nombres, Empleado.apellidos).all())
    return templates.TemplateResponse(request, "custodia_parametros.html",
                                      {"user": user, "managers": managers, "candidatos": candidatos, "consumo": consumo,
                                       "inv_conteo": inv_conteo,
                                       "secciones_cfg": secciones_cfg, "administradores": administradores,
                                       "tecnicos_ids": tecnicos_ids,
                                       "areas": areas, "motivos": motivos, "discos": discos,
                                       "saldos_cargados": sc.saldos_ya_cargados(db),
                                       "stock_inventario": sc.inventario_stock(db),
                                       "stock_iniciales": _stock_iniciales(db),
                                       "stock_area": request.query_params.get("stock_area", ""),
                                       "stock_texto": request.query_params.get("stock_texto", ""),
                                       "saldos_existentes": sorted(f"{o}|{a}" for o, a in sc.saldos_existentes(db)),
                                       "fecha_corte_anterior": (sc.ultima_fecha_corte(db) or "") and sc.ultima_fecha_corte(db).isoformat(),
                                       "areas_config": [a.nombre for a in areas if a.activo],
                                       "texto_saldos": request.query_params.get("texto", ""),
                                       "conteo_panel": {"saldos": sc.saldos_ya_cargados(db),
                                                        "managers": len(managers), "areas": len(areas), "discos": len(discos),
                                                        "motivos": len(motivos),
                                                        "c_accesos": len(consumo["accesos"]),
                                                        "c_tecnicos": len([t for t in consumo["tecnicos"] if t.activo]),
                                                        "c_materias": len([m for m in consumo["materias"] if m.activo]),
                                                        "c_tipos": len([t for t in consumo["tipos"] if t.activo]),
                                                        "n_accesos": len(inv_conteo["accesos"]),
                                                        "n_validadores": len(inv_conteo["validadores"]),
                                                        "n_managers": len(inv_conteo["managers_area"]),
                                                        "n_materiales": len([m for m in inv_conteo["materiales"] if m.activo]),
                                                        "n_bodegas": len([b for b in inv_conteo["bodegas"] if b.activo])},
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
        from .. import acceso_secciones as acs
        acs.quitar(db, emp.id, "custodia")  # también su configuración de secciones
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


# ---------- Stock por descripción (inicial) ----------

@router.post("/inventario/parametros/custodia/stock-descripciones")
def asignar_stock_descripciones(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                                area: str = Form(""), texto: str = Form("")):
    """Le asigna descripciones (las del Resumen general) al Stock que ya tiene un área."""
    from urllib.parse import quote
    area = area.strip().upper()
    filas, errores = sc.leer_stock_inicial(texto)
    if not area:
        errores = ["elige el área"] + errores
    if errores or not filas:
        detalle = " · ".join(errores[:6]) if errores else "no hay filas para asignar."
        return RedirectResponse(f"/inventario/parametros?tab=saldos&stock_area={quote(area)}&stock_texto={quote(texto)}"
                                f"&msg=No se guardó: {quote(detalle)}", status_code=303)
    error = sc.asignar_stock_inicial(db, user, area, filas)
    if error:
        return RedirectResponse(f"/inventario/parametros?tab=saldos&stock_area={quote(area)}&stock_texto={quote(texto)}"
                                f"&msg={quote(error)}", status_code=303)
    total = sum(c for _, c in filas)
    return RedirectResponse(f"/inventario/parametros?tab=saldos&msg={quote(f'Listo: {total:g} disco(s) del Stock de {nombre_propio(area)} quedaron con su descripción.')}",
                            status_code=303)


@router.post("/inventario/parametros/custodia/stock-descripciones/{mov_id}/quitar")
def quitar_stock_descripcion(mov_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    from ..models_custodia import CustodiaStockDescripcion
    from urllib.parse import quote
    m = db.get(CustodiaStockDescripcion, mov_id)
    if m and m.tipo == "INICIAL":
        actual = sc.stock_por_descripcion(db).get(m.area, {}).get(m.descripcion, 0)
        if actual - m.cantidad < -1e-6:  # ya salieron discos de esa descripción
            msg = (f"No se quitó: del Stock de {nombre_propio(m.area)} ya salieron discos de {m.descripcion} "
                   f"(quedan {actual:g} de {m.cantidad:g}).")
            return RedirectResponse(f"/inventario/parametros?tab=saldos&msg={quote(msg)}", status_code=303)
        db.delete(m)
        db.commit()
    return RedirectResponse("/inventario/parametros?tab=saldos&msg=Asignación quitada: esos discos vuelven a quedar sin descripción.",
                            status_code=303)


# ---------- Saldos iniciales ----------

@router.post("/inventario/parametros/custodia/saldos")
def cargar_saldos_iniciales(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                            texto: str = Form(""), fecha_corte: str = Form("")):
    """Carga el inventario inicial: en qué área está cada orden y con qué cantidad (pegado desde Excel).
    Se puede volver a usar para agregar las órdenes que quedaron por fuera: no deja repetir una orden en la misma área."""
    from urllib.parse import quote
    from datetime import date as _date
    try:
        corte = _date.fromisoformat(fecha_corte)
    except ValueError:
        return RedirectResponse(f"/inventario/parametros?tab=saldos&texto={quote(texto)}&msg=No se cargó nada: elige la fecha de corte.",
                                status_code=303)
    activas = [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]
    filas, errores = sc.leer_saldos(texto, activas)
    if not errores and filas:
        errores = sc.saldos_repetidos(db, filas)
    if errores or not filas:
        detalle = " · ".join(errores[:6]) if errores else "no hay filas para cargar."
        return RedirectResponse(f"/inventario/parametros?tab=saldos&texto={quote(texto)}&msg=No se cargó nada: {quote(detalle)}",
                                status_code=303)
    adicionales = bool(sc.saldos_ya_cargados(db))
    creados = sc.cargar_saldos(db, user, filas, corte)
    total = sum(f["cantidad"] for f in filas)
    print(f"[Custodia] {user.email} cargó saldos iniciales al {corte}: {len(filas)} órdenes en {len(creados)} áreas ({total:g} discos).")
    return RedirectResponse(f"/inventario/parametros?tab=saldos&msg=Listo: se cargaron {len(filas)} órdenes{' adicionales' if adicionales else ''} en {len(creados)} áreas "
                            f"({total:g} discos) con fecha de corte {corte.strftime('%d/%m/%Y')}. Ya aparecen en Estado órdenes y Dashboard.", status_code=303)
