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


@router.get("/design/api/geovictoria/hoy")
def api_hoy(forzar: int = 0, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Las marcas de hoy de todo Design y lo que falta marcar (para revisar antes de activar los avisos)."""
    ahora = sd.ahora_colombia().replace(tzinfo=None)
    sgv.hoy(db, ahora, forzar=bool(forzar))
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_(list(sgv._hoy["datos"]) or [-1]))}
    tol = sgv.config(db)["tolerancia"]
    filas = []
    for eid in sgv._hoy["datos"]:
        x = sgv.para_seguimiento(eid, ahora, tol)
        if x:
            filas.append({"nombre": nombres.get(eid, ""), **x})
    filas.sort(key=lambda f: (not f["faltas"], f["nombre"].lower()))
    return {"filas": filas, "error": sgv._hoy["error"], "tolerancia": tol}
