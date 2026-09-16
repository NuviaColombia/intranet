from datetime import date, time
from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import Empleado
from ..models_custodia import CustodiaTraslado
from ..auth import require_modulo
from ..main_templates import templates
from .. import services_custodia as sc

router = APIRouter()


# ---------- Página ----------

@router.get("/custodia")
async def pagina(request: Request, user: Empleado = Depends(require_modulo("custodia")),
                 db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "custodia.html",
                                      {"user": user, "areas": sc.areas_disponibles(db),
                                       "motivos": sc.motivos_disponibles(db), "es_custodia": True})


# ---------- Esquemas ----------

class TrasladoLineaIn(BaseModel):
    areaCreacion: str
    fecha: date
    hora: str
    areaSalida: str
    areaEntrada: str
    motivo: str
    numeroOrden: str
    cantidadDiscos: float


class ResumenIn(BaseModel):
    orden: str = ""
    descripcion: str = ""
    paciente: str = ""
    total: float = 0
    verifSalida: bool = False
    verifEntrada: bool = False


class DiscosIn(BaseModel):
    detalle: str = ""
    cantPaciente: float = 0
    cantDiscos: float = 0


class OPIn(BaseModel):
    orden: str = ""
    op: str = ""
    descripcion: str = ""
    tipo: str = ""
    usuario: str = ""
    observaciones: str = ""


class RegistrarPayload(BaseModel):
    traslados: list[TrasladoLineaIn]
    resumen: list[ResumenIn] = []
    discos: list[DiscosIn] = []
    op: list[OPIn] = []


class VerificarOrdenIn(BaseModel):
    numeroOrden: str


# ---------- API ----------

@router.get("/custodia/api/areas")
async def api_areas(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    return sc.areas_disponibles(db)


@router.get("/custodia/api/motivos")
async def api_motivos(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    return sc.motivos_disponibles(db)


@router.get("/custodia/api/areas-alertas")
async def api_areas_alertas(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    return sc.alertas_por_area(db)


@router.get("/custodia/api/consecutivo-siguiente")
async def api_consecutivo(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    siguiente = (db.query(func.max(CustodiaTraslado.id)).scalar() or 0) + 1
    return {"consecutivo": siguiente}


@router.get("/custodia/api/ordenes-incompletas")
async def api_ordenes_incompletas(user: Empleado = Depends(require_modulo("custodia")),
                                  db: Session = Depends(get_db)):
    return sc.ordenes_incompletas(db)


@router.post("/custodia/api/verificar-orden")
async def api_verificar_orden(payload: VerificarOrdenIn, user: Empleado = Depends(require_modulo("custodia")),
                              db: Session = Depends(get_db)):
    return {"existe": sc.verificar_orden_existente(db, payload.numeroOrden)}


@router.post("/custodia/api/traslados")
async def api_registrar(payload: RegistrarPayload, user: Empleado = Depends(require_modulo("custodia")),
                        db: Session = Depends(get_db)):
    if not payload.traslados:
        raise HTTPException(400, "Sin datos de traslado.")
    primero = payload.traslados[0]
    try:
        hora_obj = time.fromisoformat(primero.hora)
    except ValueError:
        raise HTTPException(400, "Hora inválida.")
    if user.area_custodia and user.area_custodia.strip().upper() != "DIR PRODUCCIÓN":
        area_creacion = user.area_custodia.strip().upper()
    else:
        area_creacion = primero.areaCreacion.strip().upper()
    cabecera = {
        "colaborador": user.nombre_completo.strip().upper(), "id_colaborador": "",
        "area_creacion": area_creacion, "fecha": primero.fecha, "hora": hora_obj,
        "usuario": "", "area_salida": primero.areaSalida.strip().upper(),
        "area_entrada": primero.areaEntrada.strip().upper(), "motivo": primero.motivo.strip().upper(),
    }
    lineas = [{"numero_orden": t.numeroOrden.strip().upper(), "cantidad_discos": t.cantidadDiscos}
             for t in payload.traslados]
    resumen = [r.model_dump() for r in payload.resumen]
    error = sc.validar_lineas_traslado(db, lineas, resumen, cabecera["area_salida"])
    if error:
        raise HTTPException(400, error)
    traslado = sc.crear_traslado(db, user, cabecera, lineas, resumen,
                                 [d.model_dump() for d in payload.discos],
                                 [o.model_dump() for o in payload.op])
    return {"mensaje": f"✅ Guardado exitoso. Consecutivo #{traslado.id}", "id": traslado.id}


def _get_traslado(db: Session, traslado_id: int) -> CustodiaTraslado:
    traslado = db.get(CustodiaTraslado, traslado_id)
    if not traslado:
        raise HTTPException(404, "Traslado no encontrado.")
    return traslado


@router.post("/custodia/api/traslados/{traslado_id}/confirmar-entrada")
async def api_confirmar_entrada(traslado_id: int, user: Empleado = Depends(require_modulo("custodia")),
                                db: Session = Depends(get_db)):
    traslado = _get_traslado(db, traslado_id)
    error = sc.confirmar_entrada(db, traslado, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "✅ Entrada confirmada."}


@router.post("/custodia/api/traslados/{traslado_id}/anular")
async def api_anular(traslado_id: int, user: Empleado = Depends(require_modulo("custodia")),
                     db: Session = Depends(get_db)):
    traslado = _get_traslado(db, traslado_id)
    error = sc.anular_traslado(db, traslado, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ Se anuló correctamente el traslado #{traslado.id}."}


@router.get("/custodia/api/consultar")
async def api_consultar(tipo: str = "ultimos30", areaSalida: str = "TODAS", estado: str = "ACTIVOS",
                        fechaInicio: str = "", fechaFin: str = "",
                        user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    fi = date.fromisoformat(fechaInicio) if fechaInicio else None
    ff = date.fromisoformat(fechaFin) if fechaFin else None
    traslados = sc.consultar(db, tipo, areaSalida, estado, fi, ff)
    return {"data": [sc.serializar_traslado(t) for t in traslados]}


@router.get("/custodia/api/pendientes-entrada")
async def api_pendientes_entrada(user: Empleado = Depends(require_modulo("custodia")),
                                 db: Session = Depends(get_db)):
    traslados = sc.pendientes_entrada(db)
    return {"data": [sc.serializar_traslado(t) for t in traslados]}


@router.get("/custodia/api/estado-ordenes")
async def api_estado_ordenes(fechaDesde: str = "", fechaHasta: str = "",
                             user: Empleado = Depends(require_modulo("custodia")),
                             db: Session = Depends(get_db)):
    fd = date.fromisoformat(fechaDesde) if fechaDesde else None
    fh = date.fromisoformat(fechaHasta) if fechaHasta else None
    return sc.estado_ordenes(db, fd, fh)


@router.get("/custodia/api/consultar-orden/{numero_orden}")
async def api_consultar_orden(numero_orden: str, fechaDesde: str = "", fechaHasta: str = "",
                              user: Empleado = Depends(require_modulo("custodia")),
                              db: Session = Depends(get_db)):
    fd = date.fromisoformat(fechaDesde) if fechaDesde else None
    fh = date.fromisoformat(fechaHasta) if fechaHasta else None
    return sc.consultar_orden(db, numero_orden, fd, fh)


@router.get("/custodia/api/viaje/{numero_orden}")
async def api_viaje(numero_orden: str, user: Empleado = Depends(require_modulo("custodia")),
                    db: Session = Depends(get_db)):
    return sc.viaje_orden(db, numero_orden)


@router.get("/custodia/api/detalles/{traslado_id}")
async def api_detalles(traslado_id: int, user: Empleado = Depends(require_modulo("custodia")),
                       db: Session = Depends(get_db)):
    traslado = _get_traslado(db, traslado_id)
    return sc.detalles_por_traslado(traslado)


@router.get("/custodia/api/dashboard")
async def api_dashboard(fechaCorte: str = "", user: Empleado = Depends(require_modulo("custodia")),
                        db: Session = Depends(get_db)):
    fc = date.fromisoformat(fechaCorte) if fechaCorte else None
    return sc.dashboard(db, fc)


@router.get("/custodia/api/tickets-rango")
async def api_tickets_rango(inicio: int, fin: int, user: Empleado = Depends(require_modulo("custodia")),
                            db: Session = Depends(get_db)):
    if inicio > fin:
        raise HTTPException(400, "El consecutivo de inicio debe ser menor o igual al de fin.")
    traslados = sc.tickets_rango(db, inicio, fin)
    return {"tickets": [{"traslado": sc.serializar_traslado(t), "detalles": sc.detalles_por_traslado(t)}
                        for t in traslados]}


@router.get("/custodia/api/factores-discos")
async def api_factores_discos(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    return sc.catalogo_discos(db)
