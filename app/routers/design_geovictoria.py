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
def api_cruce(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        c = sgv.cruce(db, forzar=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo consultar GeoVictoria: {e}")
    return {"cruzados": len(c["pares"]), "sinGeoVictoria": c["sinGeoVictoria"], "sinPlataforma": c["sinPlataforma"]}


@router.get("/design/api/geovictoria/personas")
def api_personas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return sgv.personas(db)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo consultar GeoVictoria: {e}")


@router.post("/design/api/geovictoria/prueba")
def api_prueba(datos: dict, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Prueba con una persona: sus marcas de hoy al momento y un aviso push de prueba (a mí o a ella y su manager)."""
    try:
        return sgv.probar_persona(db, int(datos.get("empleadoId") or 0), datos.get("tipo") or "", datos.get("destino") or "yo", user,
                                  sd.ahora_colombia().replace(tzinfo=None))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo probar: {e}")


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
                      "enCurso": bool(m["entrada"] and not m["salida"]), **x})
    filas.sort(key=lambda f: (not f["faltas"], f["nombre"].lower()))
    return {"filas": filas, "error": sgv._hoy["error"], "tolerancia": tol}
