"""Rutas del módulo SST: inventario de EPP, ingresos, solicitudes y reportes."""
from datetime import date
from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_sst import SstIngreso, SstSolicitud
from ..sst import (require_sst, require_sst_compras, require_sst_coordinador, require_sst_admin,
                   es_compras_sst, es_coordinador_sst, EMPRESA_SST)
from ..main_templates import templates
from .. import services_sst as ss

router = APIRouter()


# ---------- Páginas ----------

@router.get("/sst")
async def pagina(request: Request, user: Empleado = Depends(require_sst), db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "sst.html", {
        "user": user, "es_sst": True,
        "es_compras": es_compras_sst(db, user), "es_coordinador": es_coordinador_sst(db, user),
    })


@router.get("/sst/parametros")
async def parametros(request: Request, user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db)):
    candidatos = (db.query(Empleado).filter(Empleado.empresa == EMPRESA_SST, Empleado.activo == 1)
                 .order_by(Empleado.apellidos).all())
    return templates.TemplateResponse(request, "sst_parametros.html", {
        "user": user, "es_sst": True, "items": ss.catalogo(db, solo_activos=False),
        "accesos": ss.accesos(db), "candidatos": candidatos,
        "msg": request.query_params.get("msg"),
    })


# ---------- Parámetros: catálogo de ítems ----------

@router.post("/sst/parametros/items")
async def crear_item(user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db),
                     nombre: str = Form(...), unidad_conteo: str = Form(...), presentacion: int = Form(1)):
    ss.crear_item(db, nombre, unidad_conteo, presentacion)
    return RedirectResponse("/sst/parametros?msg=Ítem agregado.", status_code=303)


@router.post("/sst/parametros/items/{item_id}")
async def editar_item(item_id: int, user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db),
                      nombre: str = Form(...), unidad_conteo: str = Form(...), presentacion: int = Form(1)):
    ss.editar_item(db, item_id, nombre, unidad_conteo, presentacion)
    return RedirectResponse("/sst/parametros?msg=Ítem actualizado.", status_code=303)


@router.post("/sst/parametros/items/{item_id}/toggle")
async def toggle_item(item_id: int, user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db)):
    ss.toggle_item(db, item_id)
    return RedirectResponse("/sst/parametros", status_code=303)


# ---------- Parámetros: accesos (Compras / Coordinación SST) ----------

@router.post("/sst/parametros/accesos")
async def agregar_acceso(user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db),
                         empleado_id: int = Form(...), rol_sst: str = Form(...)):
    ss.agregar_acceso(db, empleado_id, rol_sst)
    return RedirectResponse("/sst/parametros?msg=Acceso agregado.", status_code=303)


@router.post("/sst/parametros/accesos/{acceso_id}/quitar")
async def quitar_acceso(acceso_id: int, user: Empleado = Depends(require_sst_admin), db: Session = Depends(get_db)):
    ss.quitar_acceso(db, acceso_id)
    return RedirectResponse("/sst/parametros?msg=Acceso quitado.", status_code=303)


# ---------- API: catálogo y stock ----------

@router.get("/sst/api/catalogo")
async def api_catalogo(user: Empleado = Depends(require_sst), db: Session = Depends(get_db)):
    return [{"id": it.id, "nombre": it.nombre, "unidadConteo": it.unidad_conteo, "presentacion": it.presentacion}
            for it in ss.catalogo(db)]


@router.get("/sst/api/stock")
async def api_stock(fecha: str | None = None, user: Empleado = Depends(require_sst), db: Session = Depends(get_db)):
    f = date.fromisoformat(fecha) if fecha else date.today()
    return ss.reporte_inventario(db, f)


# ---------- API: ingresos ----------

class IngresoIn(BaseModel):
    itemId: int
    cantidad: float
    unidadUsada: str
    fecha: str
    notas: str = ""


@router.post("/sst/api/ingresos")
async def api_crear_ingreso(payload: IngresoIn, user: Empleado = Depends(require_sst_compras),
                            db: Session = Depends(get_db)):
    ingreso = ss.crear_ingreso(db, user, payload.itemId, payload.cantidad, payload.unidadUsada,
                              date.fromisoformat(payload.fecha), payload.notas)
    if not ingreso:
        raise HTTPException(400, "Ítem o cantidad inválidos.")
    return {"id": ingreso.id}


@router.get("/sst/api/ingresos/pendientes")
async def api_ingresos_pendientes(user: Empleado = Depends(require_sst_coordinador), db: Session = Depends(get_db)):
    return [{"id": i.id, "item": i.item.nombre, "cantidadIngresada": i.cantidad_ingresada,
            "unidadUsada": i.unidad_usada, "cantidadUnidades": i.cantidad_unidades, "fecha": i.fecha.isoformat(),
            "registradoPor": i.registrado_por.nombre_completo if i.registrado_por else "", "notas": i.notas}
           for i in ss.ingresos_pendientes(db)]


class MotivoIn(BaseModel):
    motivo: str = ""


@router.post("/sst/api/ingresos/{ingreso_id}/aprobar")
async def api_aprobar_ingreso(ingreso_id: int, user: Empleado = Depends(require_sst_coordinador),
                              db: Session = Depends(get_db)):
    ingreso = db.get(SstIngreso, ingreso_id)
    if not ingreso:
        raise HTTPException(404, "Ingreso no encontrado.")
    ss.aprobar_ingreso(db, ingreso, user)
    return {"mensaje": "Aprobado."}


@router.post("/sst/api/ingresos/{ingreso_id}/rechazar")
async def api_rechazar_ingreso(ingreso_id: int, payload: MotivoIn, user: Empleado = Depends(require_sst_coordinador),
                               db: Session = Depends(get_db)):
    ingreso = db.get(SstIngreso, ingreso_id)
    if not ingreso:
        raise HTTPException(404, "Ingreso no encontrado.")
    ss.rechazar_ingreso(db, ingreso, user, payload.motivo)
    return {"mensaje": "Rechazado."}


# ---------- API: solicitudes ----------

class LineaSolicitudIn(BaseModel):
    itemId: int
    cantidad: float
    unidadUsada: str


class SolicitudIn(BaseModel):
    lineas: list[LineaSolicitudIn]
    notas: str = ""


@router.post("/sst/api/solicitudes")
async def api_crear_solicitud(payload: SolicitudIn, user: Empleado = Depends(require_sst), db: Session = Depends(get_db)):
    solicitud = ss.crear_solicitud(db, user, [l.model_dump() for l in payload.lineas], payload.notas)
    if not solicitud:
        raise HTTPException(400, "La solicitud debe tener al menos una línea válida.")
    return {"id": solicitud.id}


@router.get("/sst/api/solicitudes/mias")
async def api_solicitudes_mias(user: Empleado = Depends(require_sst), db: Session = Depends(get_db)):
    return [_serializar_solicitud(s) for s in ss.solicitudes_de(db, user.id)]


@router.get("/sst/api/solicitudes/pendientes")
async def api_solicitudes_pendientes(user: Empleado = Depends(require_sst_coordinador), db: Session = Depends(get_db)):
    return [_serializar_solicitud(s) for s in ss.solicitudes_pendientes(db)]


def _serializar_solicitud(s: SstSolicitud) -> dict:
    return {"id": s.id, "solicitante": s.solicitante.nombre_completo if s.solicitante else "",
           "fecha": s.fecha_solicitud.isoformat(), "estado": s.estado, "notas": s.notas,
           "motivoRechazo": s.motivo_rechazo,
           "lineas": [{"item": l.item.nombre, "cantidadSolicitada": l.cantidad_solicitada,
                      "unidadUsada": l.unidad_usada, "cantidadUnidades": l.cantidad_unidades} for l in s.lineas]}


@router.post("/sst/api/solicitudes/{solicitud_id}/entregar")
async def api_entregar_solicitud(solicitud_id: int, user: Empleado = Depends(require_sst_coordinador),
                                 db: Session = Depends(get_db)):
    solicitud = db.get(SstSolicitud, solicitud_id)
    if not solicitud:
        raise HTTPException(404, "Solicitud no encontrada.")
    error = ss.entregar_solicitud(db, solicitud, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "Entregada."}


@router.post("/sst/api/solicitudes/{solicitud_id}/rechazar")
async def api_rechazar_solicitud(solicitud_id: int, payload: MotivoIn, user: Empleado = Depends(require_sst_coordinador),
                                 db: Session = Depends(get_db)):
    solicitud = db.get(SstSolicitud, solicitud_id)
    if not solicitud:
        raise HTTPException(404, "Solicitud no encontrada.")
    ss.rechazar_solicitud(db, solicitud, user, payload.motivo)
    return {"mensaje": "Rechazada."}


# ---------- API: reportes ----------

@router.get("/sst/api/reportes/inventario")
async def api_reporte_inventario(fecha: str | None = None, user: Empleado = Depends(require_sst),
                                 db: Session = Depends(get_db)):
    f = date.fromisoformat(fecha) if fecha else date.today()
    return ss.reporte_inventario(db, f)


@router.get("/sst/api/reportes/movimientos")
async def api_reporte_movimientos(desde: str, hasta: str, user: Empleado = Depends(require_sst),
                                  db: Session = Depends(get_db)):
    return ss.reporte_movimientos(db, date.fromisoformat(desde), date.fromisoformat(hasta))
