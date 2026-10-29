"""GeoVictoria (Rosember, 22-oct-2026): Parámetros › GeoVictoria (credenciales, cruce, marcas de hoy). Ver
services_design_geovictoria. Solo admins. Se incluye desde routers/design_schedule.py."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import services_design as sd
from .. import services_design_geovictoria as sgv
from ..database import get_db
from ..main_templates import templates
from ..models import Empleado
from .design_schedule import require_admin

router = APIRouter()


@router.get("/design/parametros/geovictoria")
def pagina(request: Request, user: Empleado = Depends(require_admin)):
    return templates.TemplateResponse(request, "design_geovictoria.html", {"user": user, "es_design": True})


@router.get("/design/reportes/geovictoria")
def pagina_reporte(request: Request, mes: str = "", actualizar: int = 0, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Dashboard › Reportes › Reportes GeoVictoria: quienes llegaron tarde en el mes (imprimible como PDF)."""
    from .. import services_design_reportes as sr
    meses = sr.meses_disponibles()
    mes = mes if mes in meses else meses[1] if len(meses) > 1 else meses[0]   # por defecto el mes que ya cerró
    ahora = sd.ahora_colombia().replace(tzinfo=None)
    error = ""
    try:
        r = sgv.reporte_mes(db, mes, ahora, forzar=bool(actualizar))   # «Actualizar»: ya, sin esperar
    except Exception as e:  # noqa: BLE001
        r, error = None, f"No se pudo consultar GeoVictoria: {e}"
    return templates.TemplateResponse(request, "design_reporte_geovictoria.html", {
        "user": user, "r": r, "mes": mes, "meses": meses, "error": error,
        "mesTxt": sr.MESES["es"][int(mes[5:]) - 1] + " " + mes[:4], "generado": ahora.strftime("%d/%m/%Y %H:%M"),
        "MESES": sr.MESES["es"], "consultado": _hora_colombia((r or {}).get("generado"))})


@router.get("/design/reportes/geovictoria/persona")
def pagina_reporte_persona(request: Request, id: int = 0, mes: str = "", imprimir: int = 0, user: Empleado = Depends(require_admin),
                           db: Session = Depends(get_db)):
    """Historial de llegadas tarde de una persona en el mes (por defecto el en curso), para descargar en PDF."""
    from .. import services_design_reportes as sr
    meses = sr.meses_disponibles()
    mes = mes if mes in meses else meses[0]
    ahora = sd.ahora_colombia().replace(tzinfo=None)
    r, error, personas = None, "", []
    try:
        personas = sgv.personas_reporte(db)
        r = sgv.historial_persona(db, id, mes, ahora)
    except ValueError as e:
        error = str(e)
    except Exception as e:  # noqa: BLE001
        error = f"No se pudo consultar GeoVictoria: {e}"
    return templates.TemplateResponse(request, "design_reporte_geovictoria_persona.html", {
        "user": user, "r": r, "id": id, "mes": mes, "meses": meses, "personas": personas, "error": error, "imprimir": bool(imprimir and r),
        "mesTxt": sr.MESES["es"][int(mes[5:]) - 1] + " " + mes[:4], "generado": ahora.strftime("%d/%m/%Y %H:%M"),
        "MESES": sr.MESES["es"], "consultado": _hora_colombia((r or {}).get("generado"))})


@router.get("/design/api/geovictoria/personas")
def api_personas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Personas de Design en GeoVictoria, para elegir de quién descargar el historial de llegadas tarde."""
    try:
        return {"personas": sgv.personas_reporte(db)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo consultar GeoVictoria: {e}")


def _hora_colombia(iso_utc: str | None) -> str:
    """'2026-10-28T20:15:00Z' (UTC) → '28/10 15:15' (Colombia)."""
    from datetime import datetime, timedelta
    try:
        return (datetime.fromisoformat(str(iso_utc).rstrip("Z")) - timedelta(hours=5)).strftime("%d/%m %H:%M")
    except ValueError:
        return ""


@router.get("/design/api/geovictoria/config")
def api_config(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sgv.publico(db)


@router.post("/design/api/geovictoria/config")
def api_guardar(datos: dict, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return sgv.guardar(db, datos, user)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/design/api/geovictoria/probar")
def api_probar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return sgv.probar(db)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo conectar: {e}")


@router.get("/design/api/geovictoria/cruce")
def api_cruce(forzar: int = 0, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        c = sgv.cruce(db, forzar=bool(forzar))   # sin forzar usa la lista de usuarios en memoria (se renueva cada hora)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo consultar GeoVictoria: {e}")
    return {"cruzados": len(c["pares"]), "sinGeoVictoria": c["sinGeoVictoria"], "sinPlataforma": c["sinPlataforma"]}


@router.get("/design/api/geovictoria/hoy")
def api_hoy(forzar: int = 0, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Las marcas de hoy de todo Design y lo que falta marcar (para revisar antes de activar los avisos)."""
    ahora = sd.ahora_colombia().replace(tzinfo=None)
    sgv.hoy(db, ahora, forzar=bool(forzar))
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_(list(sgv._hoy["datos"]) or [-1]))}
    tol = sgv.config(db)["tolerancia"]
    # equipo y área de cada persona (para filtrar como en GeoVictoria) y horas trabajadas hasta ahora
    from ..models_design import DesignArea, DesignTeam, DesignTeamDesigner
    eq: dict[int, dict] = {}
    for eid, tnom, anom in (db.query(DesignTeamDesigner.empleado_id, DesignTeam.nombre, DesignArea.nombre)
                            .join(DesignTeam, DesignTeam.id == DesignTeamDesigner.team_id).join(DesignArea, DesignArea.id == DesignTeam.area_id)
                            .filter(DesignTeam.activo == 1, DesignTeamDesigner.empleado_id.in_(list(nombres) or [-1]))):
        x = eq.setdefault(eid, {"equipos": [], "areas": []})
        if tnom not in x["equipos"]:
            x["equipos"].append(tnom)
        if anom not in x["areas"]:
            x["areas"].append(anom)
    almuerzos = sgv.estado_almuerzo(db, ahora.date(), sgv._hoy["datos"], sgv.config(db)["almuerzo"])   # ¿llegó al Schedule?
    filas = []
    for eid, info in sgv._hoy["datos"].items():
        x = sgv.para_seguimiento(eid, ahora, tol)
        if not x:
            continue
        m = info["marcas"]
        trab = None
        if m["entrada"]:
            fin = m["salida"] or min(ahora, info["turno"]["fin"]) if info["turno"] else (m["salida"] or ahora)
            alm = ((m["regresoAlm"] or (ahora if not m["salida"] else m["salidaAlm"])) - m["salidaAlm"]) if m["salidaAlm"] else None
            mins = int(((fin - m["entrada"]).total_seconds() - (alm.total_seconds() if alm else 0)) // 60)
            trab = f"{max(0, mins) // 60:02d}:{max(0, mins) % 60:02d}"
        filas.append({"id": eid, "nombre": nombres.get(eid, ""), **eq.get(eid, {"equipos": [], "areas": []}), "trabajado": trab,
                      "enCurso": bool(m["entrada"] and not m["salida"]), "almuerzoSchedule": almuerzos.get(eid), **x})
    filas.sort(key=lambda f: (not f["faltas"], f["nombre"].lower()))
    return {"filas": filas, "error": sgv._hoy["error"], "tolerancia": tol}
