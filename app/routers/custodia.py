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
async def pagina(request: Request, user: Empleado = Depends(require_modulo("custodia"))):
    return templates.TemplateResponse(request, "custodia.html",
                                      {"user": user, "areas": sc.AREAS_ESTANDAR, "motivos": sc.MOTIVOS,
                                       "es_custodia": True})


# ---------- Esquemas ----------

class TrasladoLineaIn(BaseModel):
    colaborador: str
    idColaborador: str = ""
    areaCreacion: str
    fecha: date
    hora: str
    usuario: str = ""
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


@router.get("/custodia/api/consecutivo-siguiente")
async def api_consecutivo(user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    siguiente = (db.query(func.max(CustodiaTraslado.id)).scalar() or 0) + 1
    return {"consecutivo": siguiente}


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
    cabecera = {
        "colaborador": primero.colaborador.strip().upper(), "id_colaborador": primero.idColaborador.strip().upper(),
        "area_creacion": primero.areaCreacion.strip().upper(), "fecha": primero.fecha, "hora": hora_obj,
        "usuario": primero.usuario.strip().upper(), "area_salida": primero.areaSalida.strip().upper(),
        "area_entrada": primero.areaEntrada.strip().upper(), "motivo": primero.motivo.strip().upper(),
    }
    lineas = [{"numero_orden": t.numeroOrden.strip().upper(), "cantidad_discos": t.cantidadDiscos}
             for t in payload.traslados]
    traslado = sc.crear_traslado(db, user, cabecera, lineas,
                                 [r.model_dump() for r in payload.resumen],
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
    data = []
    for t in traslados:
        data.append({
            "id": t.id, "colaborador": t.colaborador, "idColaborador": t.id_colaborador,
            "areaCreacion": t.area_creacion, "ordenes": ", ".join(o.numero_orden for o in t.ordenes),
            "cantidad": sum(o.cantidad_discos for o in t.ordenes), "fecha": t.fecha.isoformat(),
            "hora": t.hora.strftime("%H:%M") if t.hora else "", "usuario": t.usuario,
            "areaSalida": t.area_salida, "areaEntrada": t.area_entrada, "motivo": t.motivo,
            "estado": t.estado_texto, "anulado": t.anulado, "confirmadoEntrada": t.confirmado_entrada,
        })
    return {"data": data}


@router.get("/custodia/api/estado-ordenes")
async def api_estado_ordenes(fechaCorte: str = "", user: Empleado = Depends(require_modulo("custodia")),
                             db: Session = Depends(get_db)):
    fc = date.fromisoformat(fechaCorte) if fechaCorte else None
    return sc.estado_ordenes(db, fc)


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
async def api_dashboard(fechaInicio: str, fechaFin: str, area: str = "TODAS",
                        user: Empleado = Depends(require_modulo("custodia")), db: Session = Depends(get_db)):
    fi = date.fromisoformat(fechaInicio)
    ff = date.fromisoformat(fechaFin)
    return sc.dashboard(db, fi, ff, area)
