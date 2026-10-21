"""Dashboard › Reportes (Rosember, 21-oct-2026): reporte mensual para la Directora de producción (ES/EN, imprimible como
PDF) y reportes en PDF subidos a mano. Solo admins de Design. Ver services_design_reportes."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import services_design_reportes as sr
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from ..models_design import DesignReporte
from .design_schedule import _RutaDesign, require_admin

router = APIRouter(route_class=_RutaDesign)

T = {
    "es": {"titulo": "Reporte de producción", "sub": "Design Colombia · N3 Cirugías y cambios adicionales", "del": "del", "al": "al",
           "medidas": "cirugías medidas", "cambiosN": "cambios adicionales",
           "soloProblemas": "Solo lo que tiene problemas: lo que está dentro del tiempo no sale. Sin nombres de pacientes.",
           "kMedidas": "Cirugías medidas", "kMedidasS": "con START y RTD", "kTarde": "Pasaron de", "kTardeS": "de las cirugías",
           "kCentros": "Centros con demoras", "kDe": "de", "kCentrosS": "centros con cirugías", "kCambios": "Cambios adicionales",
           "hallazgos": "Hallazgos clave", "hallazgosS": "Ordenados por impacto. Cada uno dice qué revisar para corregirlo.",
           "centrosT": "Centros que demoran las cirugías", "centrosS": "Cada barra es un centro; el número dice «cirugías que pasaron de {lim} de las que tuvo en el mes».",
           "sinCentros": "Ninguna cirugía pasó de {lim} de articulación este mes.",
           "tabCentro": "Centro", "tabManager": "Manager", "tabCirugias": "Cirugías", "tabTarde": "Pasaron de {lim}", "tabPct": "%",
           "tabProm": "Promedio", "tabMax": "Más larga", "prom": "promedio",
           "tendT": "Tendencia: % de cirugías que pasaron de {lim}, por semana", "tendS": "Semanas que empiezan el lunes. La última puede estar incompleta.",
           "camT": "Cambios adicionales por diseñador", "camS": "Quién hizo el caso que después necesitó un cambio. LAB = lo pidió el laboratorio; DOC = lo pidió el doctor.",
           "sinCambios": "No hubo cambios adicionales este mes.", "tabDis": "Diseñador", "tabCambios": "Cambios", "tabCasosC": "Casos con cambio",
           "tabCasosM": "Casos del mes", "tabTipos": "Más frecuentes", "cambios": "cambios", "casos": "casos",
           "origenT": "Qué significa cada origen", "tabOrigen": "Origen", "tabQue": "Qué es", "tabRevisar": "Qué revisar",
           "labQue": "El laboratorio pidió corregir el diseño.", "labRev": "Error del diseño: revisar el caso y el QC con el diseñador.",
           "docQue": "El doctor pidió un cambio sobre el diseño.", "docRev": "Puede ser preferencia del doctor; si se repite con el mismo diseñador, revisarlo.",
           "tiposT": "Cambios más pedidos", "tabTipo": "Tipo de cambio", "tabCant": "Cantidad",
           "casosT": "Cada cirugía que pasó de {lim}", "casosS": "Con el número de orden para buscar el caso.",
           "tabFecha": "Fecha", "tabOrden": "Orden", "tabTiempo": "Tiempo",
           "filasT": "Cada cambio adicional del mes", "tabDetalle": "Detalle", "sinDis": "Sin cruce con el Schedule",
           "metodoT": "Método y límites",
           "m1": "<b>Articulación:</b> RTD − START de cada orden de N3 › Cirugías del Schedule (órdenes completas: centro, producto y diseñador). No cuentan las canceladas ni las que no tienen START o RTD. El tiempo esperado es de {lim}.",
           "m2": "<b>Cambios adicionales:</b> registro de Dashboard › Cambios digitales. Cada cambio se cruza con su número de orden en el Schedule para saber qué diseñador hizo el caso (la orden más reciente hasta la fecha del cambio). No se cuentan las copias de Removable Denture ni los equipos de Support.",
           "m3": "<b>Sin cruce ({n}):</b> cambios del mes cuya orden no está en el Schedule (o no tiene diseñador); no se le asignan a nadie.",
           "m4": "<b>% de sus casos:</b> casos con cambio entre los casos que ese diseñador hizo en el mes.",
           "generado": "Generado el", "descargar": "Descargar PDF", "volver": "Volver al Dashboard", "mes": "Mes"},
    "en": {"titulo": "Production report", "sub": "Design Colombia · N3 Surgeries and additional changes", "del": "from", "al": "to",
           "medidas": "surgeries measured", "cambiosN": "additional changes",
           "soloProblemas": "Only what has issues: anything within the expected time is left out. No patient names.",
           "kMedidas": "Surgeries measured", "kMedidasS": "with START and RTD", "kTarde": "Took longer than", "kTardeS": "of surgeries",
           "kCentros": "Centers with delays", "kDe": "of", "kCentrosS": "centers with surgeries", "kCambios": "Additional changes",
           "hallazgos": "Key findings", "hallazgosS": "Ordered by impact. Each item says what to review to fix it.",
           "centrosT": "Centers delaying surgeries", "centrosS": "Each bar is a center; the number reads “surgeries over {lim} of those it had this month”.",
           "sinCentros": "No surgery took longer than {lim} to articulate this month.",
           "tabCentro": "Center", "tabManager": "Manager", "tabCirugias": "Surgeries", "tabTarde": "Over {lim}", "tabPct": "%",
           "tabProm": "Average", "tabMax": "Longest", "prom": "average",
           "tendT": "Trend: % of surgeries over {lim}, by week", "tendS": "Weeks start on Monday. The last one may be incomplete.",
           "camT": "Additional changes by designer", "camS": "Who designed the case that later needed a change. LAB = requested by the lab; DOC = requested by the doctor.",
           "sinCambios": "There were no additional changes this month.", "tabDis": "Designer", "tabCambios": "Changes", "tabCasosC": "Cases with a change",
           "tabCasosM": "Cases this month", "tabTipos": "Most frequent", "cambios": "changes", "casos": "cases",
           "origenT": "What each origin means", "tabOrigen": "Origin", "tabQue": "What it is", "tabRevisar": "What to review",
           "labQue": "The lab asked to correct the design.", "labRev": "Design error: review the case and the QC with the designer.",
           "docQue": "The doctor asked for a change to the design.", "docRev": "May be the doctor's preference; if it repeats with the same designer, review it.",
           "tiposT": "Most requested changes", "tabTipo": "Change type", "tabCant": "Count",
           "casosT": "Every surgery over {lim}", "casosS": "With the order number, to look up the case.",
           "tabFecha": "Date", "tabOrden": "Order", "tabTiempo": "Time",
           "filasT": "Every additional change this month", "tabDetalle": "Detail", "sinDis": "No match in the Schedule",
           "metodoT": "Method and limits",
           "m1": "<b>Articulation:</b> RTD − START of each N3 › Surgeries order in the Schedule (complete orders: center, product and designer). Canceled orders and orders without START or RTD are not counted. The expected time is {lim}.",
           "m2": "<b>Additional changes:</b> the Dashboard › Digital changes log. Each change is matched to its order number in the Schedule to know which designer made the case (the latest order up to the change date). Removable Denture copies and Support teams are not counted.",
           "m3": "<b>No match ({n}):</b> changes this month whose order is not in the Schedule (or has no designer); they are not assigned to anyone.",
           "m4": "<b>% of their cases:</b> cases with a change among the cases that designer made this month.",
           "generado": "Generated on", "descargar": "Download PDF", "volver": "Back to the Dashboard", "mes": "Month"},
}


@router.get("/design/reportes/mensual")
def pagina_reporte(request: Request, mes: str = "", lang: str = "es", user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    mes = mes or sr.meses_disponibles(1)[0]
    try:
        d = sr.reporte_mensual(db, user, mes, lang)
    except ValueError as e:
        raise HTTPException(400, str(e))
    t = {k: v.replace("{lim}", d["durLim"]) for k, v in T[d["lang"]].items()}
    t["m3"] = t["m3"].replace("{n}", str(d["cam"]["sinCruce"]))
    return templates.TemplateResponse(request, "design_reporte_mensual.html", {
        "user": user, "r": d, "t": t, "meses": sr.meses_disponibles(), "mesesTxt": sr.MESES})


@router.get("/design/api/reportes")
def api_reportes(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return {"meses": sr.meses_disponibles(), "subidos": sr.listar_subidos(db)}


@router.post("/design/api/reportes/subir")
async def api_subir(archivo: UploadFile = File(...), titulo: str = Form(""), mes: str = Form(...),
                    user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    datos = await archivo.read(sr.TAM_MAX + 1)
    try:
        sr.subir(db, titulo, mes, archivo.filename or "reporte.pdf", datos, user.nombre_completo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"subidos": sr.listar_subidos(db)}


@router.get("/design/reportes/archivo/{reporte_id}")
def api_archivo(reporte_id: int, descargar: int = 0, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(DesignReporte, reporte_id)
    if not r:
        raise HTTPException(404, "Ese reporte ya no existe.")
    modo = "attachment" if descargar else "inline"
    return Response(r.datos, media_type="application/pdf",
                    headers={"Content-Disposition": f"{modo}; filename*=UTF-8''{quote(r.nombre_archivo or 'reporte.pdf')}"})


@router.post("/design/api/reportes/{reporte_id}/eliminar")
def api_eliminar(reporte_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not sr.eliminar(db, reporte_id):
        raise HTTPException(404, "Ese reporte ya no existe.")
    return {"subidos": sr.listar_subidos(db)}
