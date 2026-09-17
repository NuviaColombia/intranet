"""Parámetros del módulo Custodia: managers -> área fija, áreas de producción,
catálogo de discos y motivos. Solo administradores."""
from fastapi import APIRouter, Request, Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_custodia import CustodiaArea, CustodiaMotivo, CustodiaFactorDisco
from ..auth import require_admin
from ..main_templates import templates

router = APIRouter()


NUVIA_SMILES = "Nuvia Smiles Colombia SAS"


@router.get("/custodia/parametros")
async def parametros(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    managers = (db.query(Empleado).filter(Empleado.modulos.contains("custodia"))
               .order_by(Empleado.apellidos).all())
    candidatos = (db.query(Empleado)
                 .filter(Empleado.empresa == NUVIA_SMILES, Empleado.activo == 1,
                         ~Empleado.modulos.contains("custodia"))
                 .order_by(Empleado.apellidos).all())
    areas = db.query(CustodiaArea).order_by(CustodiaArea.orden).all()
    motivos = db.query(CustodiaMotivo).order_by(CustodiaMotivo.orden).all()
    discos = db.query(CustodiaFactorDisco).order_by(CustodiaFactorDisco.orden).all()
    return templates.TemplateResponse(request, "custodia_parametros.html",
                                      {"user": user, "managers": managers, "candidatos": candidatos,
                                       "areas": areas, "motivos": motivos, "discos": discos,
                                       "es_custodia": True, "msg": request.query_params.get("msg")})


# ---------- Managers ----------

@router.post("/custodia/parametros/managers")
async def agregar_manager(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                          empleado_id: int = Form(...)):
    emp = db.get(Empleado, empleado_id)
    if emp and emp.empresa == NUVIA_SMILES:
        modulos = set(emp.modulos_lista)
        modulos.add("custodia")
        emp.modulos = ",".join(sorted(modulos))
        if emp.rol == "empleado":
            emp.rol = "aprobador"
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Manager agregado.", status_code=303)


@router.post("/custodia/parametros/managers/{empleado_id}/quitar")
async def quitar_manager(empleado_id: int, user: Empleado = Depends(require_admin),
                         db: Session = Depends(get_db)):
    emp = db.get(Empleado, empleado_id)
    if emp:
        emp.modulos = ",".join(m for m in emp.modulos_lista if m != "custodia")
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Manager retirado.", status_code=303)


# ---------- Áreas de producción ----------

@router.post("/custodia/parametros/areas")
async def crear_area(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                     nombre: str = Form(...), es_inventario: str = Form(""),
                     alerta_horas_advertencia: int = Form(24), alerta_horas_critica: int = Form(48)):
    nombre = nombre.strip().upper()
    if nombre and not db.query(CustodiaArea).filter(CustodiaArea.nombre == nombre).first():
        orden = (db.query(CustodiaArea).count() or 0) + 1
        db.add(CustodiaArea(nombre=nombre, orden=orden, es_inventario=1 if es_inventario else 0,
                            alerta_horas_advertencia=alerta_horas_advertencia,
                            alerta_horas_critica=alerta_horas_critica))
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Área agregada.", status_code=303)


@router.post("/custodia/parametros/areas/{area_id}/editar")
async def editar_area(area_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      nombre: str = Form(...), es_inventario: str = Form(""),
                      alerta_horas_advertencia: int = Form(24), alerta_horas_critica: int = Form(48)):
    a = db.get(CustodiaArea, area_id)
    if a:
        a.nombre = nombre.strip().upper()
        a.es_inventario = 1 if es_inventario else 0
        a.alerta_horas_advertencia = alerta_horas_advertencia
        a.alerta_horas_critica = alerta_horas_critica
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Área actualizada.", status_code=303)


@router.post("/custodia/parametros/areas/{area_id}/toggle")
async def toggle_area(area_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(CustodiaArea, area_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/custodia/parametros", status_code=303)


# ---------- Catálogo de discos ----------

@router.post("/custodia/parametros/discos")
async def crear_disco(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      detalle: str = Form(...), factor: float = Form(...)):
    detalle = detalle.strip()
    if detalle and not db.query(CustodiaFactorDisco).filter(CustodiaFactorDisco.detalle == detalle).first():
        orden = (db.query(CustodiaFactorDisco).count() or 0) + 1
        db.add(CustodiaFactorDisco(detalle=detalle, factor=factor, orden=orden))
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Tipo de prótesis agregado.", status_code=303)


@router.post("/custodia/parametros/discos/{disco_id}/editar")
async def editar_disco(disco_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       detalle: str = Form(...), factor: float = Form(...)):
    d = db.get(CustodiaFactorDisco, disco_id)
    if d:
        d.detalle = detalle.strip()
        d.factor = factor
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Catálogo actualizado.", status_code=303)


@router.post("/custodia/parametros/discos/{disco_id}/toggle")
async def toggle_disco(disco_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(CustodiaFactorDisco, disco_id)
    if d:
        d.activo = 0 if d.activo else 1
        db.commit()
    return RedirectResponse("/custodia/parametros", status_code=303)


# ---------- Motivos ----------

@router.post("/custodia/parametros/motivos")
async def crear_motivo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       nombre: str = Form(...)):
    nombre = nombre.strip().upper()
    if nombre and not db.query(CustodiaMotivo).filter(CustodiaMotivo.nombre == nombre).first():
        orden = (db.query(CustodiaMotivo).count() or 0) + 1
        db.add(CustodiaMotivo(nombre=nombre, orden=orden))
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Motivo agregado.", status_code=303)


@router.post("/custodia/parametros/motivos/{motivo_id}/editar")
async def editar_motivo(motivo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                        nombre: str = Form(...), orden: int = Form(0)):
    m = db.get(CustodiaMotivo, motivo_id)
    if m:
        m.nombre = nombre.strip().upper()
        m.orden = orden
        db.commit()
    return RedirectResponse("/custodia/parametros?msg=Motivo actualizado.", status_code=303)


@router.post("/custodia/parametros/motivos/{motivo_id}/toggle")
async def toggle_motivo(motivo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(CustodiaMotivo, motivo_id)
    if m:
        m.activo = 0 if m.activo else 1
        db.commit()
    return RedirectResponse("/custodia/parametros", status_code=303)
