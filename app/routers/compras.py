"""Rutas del módulo Compras: inventario de Items, ingresos, solicitudes y reportes -- réplica de
app/routers/sst.py. Por ahora, acceso exclusivo de superadmin en todas las rutas (sin roles internos
tipo Compras/Coordinación de SST; se agregan si más adelante se pide abrir el acceso)."""
import zipfile
from typing import Literal
from datetime import date
from fastapi import APIRouter, Request, Depends, Form, HTTPException, UploadFile, File
from openpyxl.utils.exceptions import InvalidFileException
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_compras import CompraIngreso, CompraSolicitud, CATEGORIAS_COMPRAS
from ..auth import require_superadmin
from ..services import auditar
from ..main_templates import templates
from .. import services_compras as sc

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_IMPORT_BYTES = 10 * 1024 * 1024


# ---------- Páginas ----------

@router.get("/compras")
def pagina(request: Request, user: Empleado = Depends(require_superadmin)):
    return templates.TemplateResponse(request, "compras.html", {"user": user, "es_compras_mod": True})


@router.get("/compras/parametros")
def parametros(request: Request, user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "compras_parametros.html", {
        "user": user, "es_compras_mod": True, "items": sc.catalogo(db, solo_activos=False),
        "categorias": CATEGORIAS_COMPRAS,
        "msg": request.query_params.get("msg"),
        "resultado": request.session.pop("import_resultado_compras", None),
    })


# ---------- Parámetros: catálogo de ítems ----------

@router.post("/compras/parametros/items")
async def crear_item(user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db),
                     nombre: str = Form(...), sku: str = Form(""), categoria: str = Form("Otros"),
                     unidad_conteo: str = Form(...), presentacion: int = Form(1)):
    sc.crear_item(db, nombre, sku, categoria, unidad_conteo, presentacion)
    return RedirectResponse("/compras/parametros?msg=Ítem agregado.", status_code=303)


@router.get("/compras/parametros/items/plantilla")
def plantilla_items(user: Empleado = Depends(require_superadmin)):
    return Response(sc.generar_plantilla_items(), media_type=XLSX,
                    headers={"Content-Disposition": "attachment; filename=plantilla_items_compras.xlsx"})


@router.post("/compras/parametros/items/importar")
async def importar_items(request: Request, user: Empleado = Depends(require_superadmin),
                         db: Session = Depends(get_db), archivo: UploadFile = File(...)):
    # Rutas estáticas ("plantilla", "importar") deben registrarse ANTES de la dinámica
    # "/items/{item_id}" de abajo: Starlette empareja por orden de registro, así que si quedara
    # después, "/items/importar" caería en {item_id} e intentaría convertir "importar" a int (422).
    contenido = await archivo.read(MAX_IMPORT_BYTES + 1)
    if len(contenido) > MAX_IMPORT_BYTES:
        return RedirectResponse("/compras/parametros?msg=El archivo es demasiado grande (máximo 10 MB).",
                                status_code=303)
    try:
        resultado = sc.importar_items_excel(db, contenido)
    except (zipfile.BadZipFile, InvalidFileException, OSError):
        db.rollback()
        return RedirectResponse("/compras/parametros?msg=El archivo no es un Excel válido (.xlsx). Usa la plantilla.",
                                status_code=303)
    auditar(db, user.email, "Import de items (Compras)",
            f"creados={resultado['creados']} actualizados={resultado['actualizados']} "
            f"errores={len(resultado['errores'])}")
    db.commit()
    request.session["import_resultado_compras"] = resultado
    return RedirectResponse("/compras/parametros", status_code=303)


@router.post("/compras/parametros/items/{item_id}")
async def editar_item(item_id: int, user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db),
                      nombre: str = Form(...), sku: str = Form(""), categoria: str = Form("Otros"),
                      unidad_conteo: str = Form(...), presentacion: int = Form(1)):
    sc.editar_item(db, item_id, nombre, sku, categoria, unidad_conteo, presentacion)
    return RedirectResponse("/compras/parametros?msg=Ítem actualizado.", status_code=303)


@router.post("/compras/parametros/items/{item_id}/toggle")
async def toggle_item(item_id: int, user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    sc.toggle_item(db, item_id)
    return RedirectResponse("/compras/parametros", status_code=303)


# ---------- API: catálogo y stock ----------

@router.get("/compras/api/catalogo")
def api_catalogo(buscar: str = "", categoria: str = "", user: Empleado = Depends(require_superadmin),
                 db: Session = Depends(get_db)):
    return [{"id": it.id, "nombre": it.nombre, "sku": it.sku, "categoria": it.categoria,
            "unidadConteo": it.unidad_conteo, "presentacion": it.presentacion}
           for it in sc.catalogo(db, buscar=buscar, categoria=categoria)]


@router.get("/compras/api/stock")
def api_stock(fecha: str | None = None, user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    f = date.fromisoformat(fecha) if fecha else date.today()
    return sc.reporte_inventario(db, f)


# ---------- API: ingresos ----------

class IngresoIn(BaseModel):
    itemId: int
    cantidad: float
    unidadUsada: Literal["PACK", "UND", "GALON"]
    fecha: str
    notas: str = ""


@router.post("/compras/api/ingresos")
async def api_crear_ingreso(payload: IngresoIn, user: Empleado = Depends(require_superadmin),
                            db: Session = Depends(get_db)):
    ingreso = sc.crear_ingreso(db, user, payload.itemId, payload.cantidad, payload.unidadUsada,
                              date.fromisoformat(payload.fecha), payload.notas)
    if not ingreso:
        raise HTTPException(400, "Ítem o cantidad inválidos.")
    return {"id": ingreso.id}


@router.get("/compras/api/ingresos/pendientes")
def api_ingresos_pendientes(user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    return [{"id": i.id, "consecutivo": i.consecutivo, "item": i.item.nombre, "cantidadIngresada": i.cantidad_ingresada,
            "unidadUsada": i.unidad_usada, "cantidadUnidades": i.cantidad_unidades, "fecha": i.fecha.isoformat(),
            "registradoPor": i.registrado_por.nombre_completo if i.registrado_por else "", "notas": i.notas}
           for i in sc.ingresos_pendientes(db)]


class MotivoIn(BaseModel):
    motivo: str = ""


@router.post("/compras/api/ingresos/{ingreso_id}/aprobar")
async def api_aprobar_ingreso(ingreso_id: int, user: Empleado = Depends(require_superadmin),
                              db: Session = Depends(get_db)):
    ingreso = db.get(CompraIngreso, ingreso_id)
    if not ingreso:
        raise HTTPException(404, "Ingreso no encontrado.")
    sc.aprobar_ingreso(db, ingreso, user)
    return {"mensaje": "Aprobado."}


@router.post("/compras/api/ingresos/{ingreso_id}/rechazar")
async def api_rechazar_ingreso(ingreso_id: int, payload: MotivoIn, user: Empleado = Depends(require_superadmin),
                               db: Session = Depends(get_db)):
    ingreso = db.get(CompraIngreso, ingreso_id)
    if not ingreso:
        raise HTTPException(404, "Ingreso no encontrado.")
    sc.rechazar_ingreso(db, ingreso, user, payload.motivo)
    return {"mensaje": "Rechazado."}


# ---------- API: solicitudes ----------

class LineaSolicitudIn(BaseModel):
    itemId: int
    cantidad: float
    unidadUsada: Literal["PACK", "UND", "GALON"]


class SolicitudIn(BaseModel):
    lineas: list[LineaSolicitudIn]
    notas: str = ""


@router.post("/compras/api/solicitudes")
async def api_crear_solicitud(payload: SolicitudIn, user: Empleado = Depends(require_superadmin),
                              db: Session = Depends(get_db)):
    solicitud = sc.crear_solicitud(db, user, [l.model_dump() for l in payload.lineas], payload.notas)
    if not solicitud:
        raise HTTPException(400, "La solicitud debe tener al menos una línea válida.")
    return {"id": solicitud.id}


@router.get("/compras/api/solicitudes/mias")
def api_solicitudes_mias(user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    return [_serializar_solicitud(s) for s in sc.solicitudes_de(db, user.id)]


@router.get("/compras/api/solicitudes/pendientes")
def api_solicitudes_pendientes(user: Empleado = Depends(require_superadmin), db: Session = Depends(get_db)):
    return [_serializar_solicitud(s) for s in sc.solicitudes_pendientes(db)]


def _serializar_solicitud(s: CompraSolicitud) -> dict:
    return {"id": s.id, "consecutivo": s.consecutivo, "solicitante": s.solicitante.nombre_completo if s.solicitante else "",
           "fecha": s.fecha_solicitud.isoformat(), "estado": s.estado, "notas": s.notas,
           "motivoRechazo": s.motivo_rechazo,
           "lineas": [{"item": l.item.nombre, "cantidadSolicitada": l.cantidad_solicitada,
                      "unidadUsada": l.unidad_usada, "cantidadUnidades": l.cantidad_unidades} for l in s.lineas]}


@router.post("/compras/api/solicitudes/{solicitud_id}/entregar")
async def api_entregar_solicitud(solicitud_id: int, user: Empleado = Depends(require_superadmin),
                                 db: Session = Depends(get_db)):
    solicitud = db.get(CompraSolicitud, solicitud_id)
    if not solicitud:
        raise HTTPException(404, "Solicitud no encontrada.")
    error = sc.entregar_solicitud(db, solicitud, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "Entregada."}


@router.post("/compras/api/solicitudes/{solicitud_id}/rechazar")
async def api_rechazar_solicitud(solicitud_id: int, payload: MotivoIn, user: Empleado = Depends(require_superadmin),
                                 db: Session = Depends(get_db)):
    solicitud = db.get(CompraSolicitud, solicitud_id)
    if not solicitud:
        raise HTTPException(404, "Solicitud no encontrada.")
    sc.rechazar_solicitud(db, solicitud, user, payload.motivo)
    return {"mensaje": "Rechazada."}


# ---------- API: reportes ----------

@router.get("/compras/api/reportes/inventario")
def api_reporte_inventario(fecha: str | None = None, user: Empleado = Depends(require_superadmin),
                           db: Session = Depends(get_db)):
    f = date.fromisoformat(fecha) if fecha else date.today()
    return sc.reporte_inventario(db, f)


@router.get("/compras/api/reportes/movimientos")
def api_reporte_movimientos(desde: str, hasta: str, user: Empleado = Depends(require_superadmin),
                            db: Session = Depends(get_db)):
    return sc.reporte_movimientos(db, date.fromisoformat(desde), date.fromisoformat(hasta))
