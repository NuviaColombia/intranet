from datetime import date, time
from fastapi import APIRouter, Request, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from ..concurrencia import RutaGeneral
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import Empleado
from ..models_custodia import CustodiaTraslado, CustodiaArea, CustodiaMotivo
from ..auth import require_modulo
from ..acceso_produccion import require_submodulo
from ..main_templates import templates
from ..formato import nombre_propio
from .. import services_custodia as sc
from .. import acceso_secciones as acs

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py


# ---------- Página ----------

@router.get("/custodia")
def pagina(request: Request, user: Empleado = Depends(require_submodulo("custodia")),
                 db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "custodia.html",
                                      {"user": user, "areas": sc.areas_disponibles(db),
                                       "motivos": sc.motivos_disponibles(db), "es_custodia": True,
                                       "custodia_pendientes": sum(1 for t in sc.pendientes_entrada(db)
                                                                  if sc.puede_firmar_algo(user, t)),
                                       # Todas (incluidas inactivas), para dar formato a nombres de registros viejos.
                                       "formato_areas": [a.nombre for a in db.query(CustodiaArea.nombre)],
                                       "formato_motivos": [m.nombre for m in db.query(CustodiaMotivo.nombre)],
                                       # Pestañas que puede usar (Producción › Parámetros › Accesos › Secciones)
                                       "secciones": acs.secciones_de(db, user, "custodia")})


# ---------- Esquemas ----------

class TrasladoLineaIn(BaseModel):
    fecha: date
    hora: str
    areaSalida: str
    areaEntrada: str
    motivo: str
    numeroOrden: str
    cantidadDiscos: float
    ordenOrigen: str = ""   # "STOCK" cuando se toma del Stock del área de salida y se le asigna numeroOrden
    ordenNueva: bool = False  # registrada con "Registrar orden nueva"


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


class StockDescripcionIn(BaseModel):
    descripcion: str = ""
    cantidad: float = 0


class RegistrarPayload(BaseModel):
    stockDescripciones: list[StockDescripcionIn] = []  # de qué descripciones sale lo que se toma del Stock
    traslados: list[TrasladoLineaIn]
    resumen: list[ResumenIn] = []
    discos: list[DiscosIn] = []
    op: list[OPIn] = []


class VerificarOrdenIn(BaseModel):
    numeroOrden: str


# ---------- API ----------

@router.get("/custodia/api/areas")
def api_areas(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    return sc.areas_disponibles(db)


@router.get("/custodia/api/motivos")
def api_motivos(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    return sc.motivos_disponibles(db)


@router.get("/custodia/api/areas-alertas")
def api_areas_alertas(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    return sc.alertas_por_area(db)


@router.get("/custodia/api/consecutivo-siguiente")
def api_consecutivo(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    siguiente = (db.query(func.max(CustodiaTraslado.id)).scalar() or 0) + 1
    return {"consecutivo": siguiente}


@router.get("/custodia/api/ordenes-incompletas")
def api_ordenes_incompletas(user: Empleado = Depends(require_submodulo("custodia")),
                                  db: Session = Depends(get_db)):
    return sc.ordenes_incompletas(db)


@router.post("/custodia/api/verificar-orden")
def api_verificar_orden(payload: VerificarOrdenIn, user: Empleado = Depends(require_submodulo("custodia")),
                              db: Session = Depends(get_db)):
    return {"existe": sc.verificar_orden_existente(db, payload.numeroOrden)}


@router.post("/custodia/api/traslados")
def api_registrar(payload: RegistrarPayload, tareas: BackgroundTasks,
                  user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    if not payload.traslados:
        raise HTTPException(400, "Sin datos de traslado.")
    acs.exigir(db, user, "custodia", "nueva-orden" if any(t.ordenNueva for t in payload.traslados) else "registro")
    primero = payload.traslados[0]
    try:
        hora_obj = time.fromisoformat(primero.hora)
    except ValueError:
        raise HTTPException(400, "Hora inválida.")
    area_entrada = primero.areaEntrada.strip().upper()
    cabecera = {
        "colaborador": user.nombre_completo.strip().upper(), "id_colaborador": "",
        "area_creacion": area_entrada, "fecha": primero.fecha, "hora": hora_obj,
        "usuario": "", "area_salida": primero.areaSalida.strip().upper(),
        "area_entrada": area_entrada, "motivo": primero.motivo.strip().upper(),
    }
    lineas = [{"numero_orden": t.numeroOrden.strip().upper(), "cantidad_discos": t.cantidadDiscos,
               "orden_origen": (t.ordenOrigen or "").strip().upper() or None,
               # Orden nueva desde DIR Producción: entra y sale de ahí en el mismo registro
               "ingreso_directo": bool(t.ordenNueva and cabecera["area_salida"] == sc.AREA_ORIGEN and not t.ordenOrigen)}
             for t in payload.traslados]
    sc.a_stock_si_entra_a_origen(lineas, area_entrada)  # lo que llega a Dir Producción queda como Stock
    resumen = [r.model_dump() for r in payload.resumen]
    error = sc.validar_lineas_traslado(db, lineas, resumen, cabecera["area_salida"])
    if error:
        raise HTTPException(400, error)
    error, elegidas = sc.validar_stock_descripciones(db, cabecera["area_salida"], lineas,
                                                     [d.model_dump() for d in payload.stockDescripciones])
    if error:
        raise HTTPException(400, error)
    traslado = sc.crear_traslado(db, user, cabecera, lineas, resumen,
                                 [d.model_dump() for d in payload.discos],
                                 [o.model_dump() for o in payload.op], elegidas)
    tareas.add_task(sc.notificar_traslado_pendiente, traslado.id)
    if traslado.requiere_firma_dir:
        tareas.add_task(sc.notificar_firma_dir_pendiente, traslado.id)
    return {"mensaje": f"✅ Guardado exitoso. Consecutivo #{traslado.id}", "id": traslado.id}


def _con_permiso(t: CustodiaTraslado, user: Empleado) -> dict:
    d = sc.serializar_traslado(t)
    d["puedeFirmar"] = sc.puede_firmar_recibido(user, t)
    d["puedeFirmarDir"] = t.pendiente_dir and sc.puede_firmar_dir(user)
    return d


def _get_traslado(db: Session, traslado_id: int) -> CustodiaTraslado:
    traslado = db.get(CustodiaTraslado, traslado_id)
    if not traslado:
        raise HTTPException(404, "Traslado no encontrado.")
    return traslado


@router.post("/custodia/api/traslados/{traslado_id}/confirmar-entrada")
def api_confirmar_entrada(traslado_id: int, user: Empleado = Depends(require_submodulo("custodia")),
                                db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'aprobaciones')
    traslado = _get_traslado(db, traslado_id)
    error = sc.confirmar_entrada(db, traslado, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "✅ Entrada confirmada."}


@router.post("/custodia/api/traslados/{traslado_id}/firmar-dir")
def api_firmar_dir(traslado_id: int, user: Empleado = Depends(require_submodulo("custodia")),
                   db: Session = Depends(get_db)):
    """Firma obligatoria de DIR PRODUCCIÓN en las salidas de QC FINAL."""
    acs.exigir(db, user, "custodia", "aprobaciones")
    traslado = _get_traslado(db, traslado_id)
    error = sc.firmar_dir(db, traslado, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "✅ Firma de DIR Producción registrada."}


@router.post("/custodia/api/traslados/{traslado_id}/reenviar-aviso")
def api_reenviar_aviso(traslado_id: int, user: Empleado = Depends(require_submodulo("custodia")),
                       db: Session = Depends(get_db)):
    """Reenvía por Cliq el aviso de las firmas que faltan: el recibido del área de entrada y/o DIR Producción."""
    acs.exigir(db, user, "custodia", "aprobaciones", "consulta")
    t = _get_traslado(db, traslado_id)
    if t.anulado:
        raise HTTPException(400, "Este traslado está anulado.")
    if t.completo:
        raise HTTPException(400, "Este traslado ya tiene todas las firmas.")
    enviados, fallidos = [], []
    if not t.confirmado_entrada:
        destino = f"{nombre_propio(t.area_entrada)} (recibido)"
        (enviados if sc.notificar_traslado_pendiente(t.id, recordatorio=True) else fallidos).append(destino)
    if t.pendiente_dir:
        (enviados if sc.notificar_firma_dir_pendiente(t.id, recordatorio=True) else fallidos).append("DIR Producción")
    partes = []
    if enviados:
        partes.append("✅ Aviso reenviado por Cliq a " + " y ".join(enviados) + ".")
    if fallidos:
        partes.append("⚠️ No se pudo avisar a " + " y ".join(fallidos) + ": revisa que alguien tenga esa área asignada "
                      "(Parámetros › Accesos) y esté suscrito a Nuvia Colombia Bot.")
    return {"mensaje": " ".join(partes), "enviado": bool(enviados) and not fallidos}


class AnularIn(BaseModel):
    motivo: str = ""


@router.post("/custodia/api/traslados/{traslado_id}/anular")
def api_anular(traslado_id: int, payload: AnularIn | None = None,
               user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'consulta', 'activas')
    traslado = _get_traslado(db, traslado_id)
    error = sc.anular_traslado(db, traslado, user, payload.motivo if payload else "")
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ Se anuló correctamente el traslado #{traslado.id}."}


@router.get("/custodia/api/consultar")
def api_consultar(tipo: str = "ultimos50", areaSalida: str = "TODAS", areaEntrada: str = "TODAS", estado: str = "ACTIVOS",
                        fechaInicio: str = "", fechaFin: str = "",
                        user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'consulta')
    fi = date.fromisoformat(fechaInicio) if fechaInicio else None
    ff = date.fromisoformat(fechaFin) if fechaFin else None
    traslados = sc.consultar(db, tipo, areaSalida, estado, fi, ff, area_entrada=areaEntrada)
    return {"data": [_con_permiso(t, user) for t in traslados],
            "truncado": tipo == "rango" and len(traslados) >= sc.LIMITE_CONSULTA_RANGO,
            "limite": sc.LIMITE_CONSULTA_RANGO}


@router.get("/custodia/api/pendientes-entrada")
def api_pendientes_entrada(user: Empleado = Depends(require_submodulo("custodia")),
                                 db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'aprobaciones')
    traslados = sc.pendientes_entrada(db)
    return {"data": [_con_permiso(t, user) for t in traslados]}


@router.get("/custodia/api/estado-ordenes")
def api_estado_ordenes(fechaDesde: str = "", fechaHasta: str = "",
                             user: Empleado = Depends(require_submodulo("custodia")),
                             db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'activas')
    fd = date.fromisoformat(fechaDesde) if fechaDesde else None
    fh = date.fromisoformat(fechaHasta) if fechaHasta else None
    return sc.estado_ordenes(db, fd, fh)


# ---------- Conteos mensuales (solo consulta de Producción › Conteo inventario mensual) ----------

@router.get("/custodia/api/conteos")
def api_conteos(anio: int, mes: int, user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    """Los conteos del mes por área (sin borradores), solo para consultar: no se edita, firma ni anula desde aquí."""
    acs.exigir(db, user, "custodia", "conteos")
    from .. import services_conteo as sct
    from ..models_custodia import CustodiaArea
    sct.asegurar_catalogo(db)
    areas = [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]
    c = sct.consolidado(db, anio, mes, areas, user)
    c["reportes"] = [r for r in c["reportes"] if not r["oculto"]]
    for r in c["reportes"]:  # los soportes (fotos) se ven en el submódulo del conteo
        r["soportes"] = len(r.pop("evidencias", []))
    c["areasMaterial"] = {str(k): v for k, v in sct.areas_de_material(db).items()}
    return c


@router.get("/custodia/api/conteos/{reporte_id}/pdf")
def api_conteo_pdf(reporte_id: int, user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    """PDF en firme del conteo de un área (el que ya se guardó al quedar en firme)."""
    acs.exigir(db, user, "custodia", "conteos")
    from ..models_conteo import ConteoDocumento
    doc = db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=reporte_id).first()
    if not doc:
        raise HTTPException(404, "Este conteo todavía no tiene PDF en firme.")
    return Response(doc.datos, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{doc.nombre}"'})


@router.get("/custodia/api/conteos-mes/pdf")
def api_conteos_mes_pdf(anio: int, mes: int, user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    """Consolidado firmado del mes, si ya existe (no se genera desde aquí)."""
    acs.exigir(db, user, "custodia", "conteos")
    from ..models_conteo import ConteoDocumento
    doc = db.query(ConteoDocumento).filter_by(tipo="CONSOLIDADO", anio=anio, mes=mes).first()
    if not doc:
        raise HTTPException(404, "Este mes todavía no tiene consolidado en firme.")
    return Response(doc.datos, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{doc.nombre}"'})


@router.get("/custodia/api/consultar-orden/{numero_orden}")
def api_consultar_orden(numero_orden: str, fechaDesde: str = "", fechaHasta: str = "",
                              user: Empleado = Depends(require_submodulo("custodia")),
                              db: Session = Depends(get_db)):
    fd = date.fromisoformat(fechaDesde) if fechaDesde else None
    fh = date.fromisoformat(fechaHasta) if fechaHasta else None
    return sc.consultar_orden(db, numero_orden, fd, fh)


@router.get("/custodia/api/viaje/{numero_orden}")
def api_viaje(numero_orden: str, user: Empleado = Depends(require_submodulo("custodia")),
                    db: Session = Depends(get_db)):
    return sc.viaje_orden(db, numero_orden)


@router.get("/custodia/api/detalles/{traslado_id}")
def api_detalles(traslado_id: int, user: Empleado = Depends(require_submodulo("custodia")),
                       db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'consulta', 'activas', 'aprobaciones')
    traslado = _get_traslado(db, traslado_id)
    return sc.detalles_por_traslado(traslado)


@router.get("/custodia/api/stock-descripciones")
def api_stock_descripciones(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    """Inventario del Stock por área y descripción (Dashboard y «Tomar del Stock» en el registro)."""
    acs.exigir(db, user, "custodia", "registro", "nueva-orden", "existencias")
    from ..models_custodia import CustodiaResumen, CustodiaStockDescripcion
    sugerencias = sorted({sc._descripcion(d) for (d,) in db.query(CustodiaResumen.descripcion).distinct().limit(3000) if (d or "").strip()}
                         | {d for (d,) in db.query(CustodiaStockDescripcion.descripcion).distinct()})
    return {"areas": sc.inventario_stock(db), "sugerencias": sugerencias[:2000], "sinDescripcion": sc.SIN_DESCRIPCION}


@router.get("/custodia/api/dashboard")
def api_dashboard(fechaDesde: str = "", fechaHasta: str = "",
                        user: Empleado = Depends(require_submodulo("custodia")),
                        db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'existencias')
    fd = date.fromisoformat(fechaDesde) if fechaDesde else None
    fh = date.fromisoformat(fechaHasta) if fechaHasta else None
    return sc.dashboard(db, fd, fh)


@router.get("/custodia/api/tickets-rango")
def api_tickets_rango(inicio: int, fin: int, user: Empleado = Depends(require_submodulo("custodia")),
                            db: Session = Depends(get_db)):
    acs.exigir(db, user, "custodia", 'consulta')
    if inicio > fin:
        raise HTTPException(400, "El consecutivo de inicio debe ser menor o igual al de fin.")
    if fin - inicio + 1 > sc.LIMITE_TICKETS_RANGO:
        raise HTTPException(400, f"Puedes imprimir máximo {sc.LIMITE_TICKETS_RANGO} consecutivos por vez.")
    traslados = sc.tickets_rango(db, inicio, fin)
    return {"tickets": [{"traslado": sc.serializar_traslado(t), "detalles": sc.detalles_por_traslado(t)}
                        for t in traslados]}


@router.get("/custodia/api/factores-discos")
def api_factores_discos(user: Empleado = Depends(require_submodulo("custodia")), db: Session = Depends(get_db)):
    return sc.catalogo_discos(db)
