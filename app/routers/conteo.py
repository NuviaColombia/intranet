"""Producción › Conteo inventario mensual: conteo por área y mes, evidencias y consolidado.
Sus parámetros (accesos, bodegas, materiales) están en Producción › Parámetros."""
import csv
import io
from fastapi import APIRouter, Request, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import RedirectResponse, StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db, engine
from ..models import Empleado
from ..models_conteo import ConteoBodega, ConteoMaterial, ConteoReporte, ConteoLinea, ConteoEvidencia
from ..models_custodia import CustodiaArea
from ..auth import require_admin
from ..acceso_produccion import require_submodulo, ProduccionAcceso, MODULO_PRODUCCION
from ..formato import nombre_propio
from ..main_templates import templates
from .. import services_conteo as sc
from .. import acceso_secciones as acs

router = APIRouter()
SUB = "conteo"


@router.on_event("startup")
def _tablas_conteo() -> None:
    for modelo in (ConteoBodega, ConteoMaterial, ConteoReporte, ConteoLinea, ConteoEvidencia):
        try:
            modelo.__table__.create(bind=engine, checkfirst=True)
        except Exception as e:  # otro proceso la acaba de crear
            print(f"Conteo: tabla {modelo.__tablename__} ({type(e).__name__}).")


def _areas(db: Session) -> list[str]:
    return [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]


@router.get("/conteo")
def pagina(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_catalogo(db)
    secciones = acs.secciones_de(db, user, SUB)
    return templates.TemplateResponse(request, "conteo.html", {
        "user": user, "es_conteo": True, "secciones": secciones, "conteo_tab_inicial": secciones[0] if secciones else ""})


@router.get("/conteo/api/datos")
def api_datos(user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_catalogo(db)
    hoy = sc.hoy_colombia()
    return {
        "bodegas": [{"id": b.id, "codigo": b.codigo, "nombre": b.nombre, "prefijo": b.prefijo} for b in sc.bodegas_activas(db)],
        "materiales": [{"id": m.id, "codigo": m.codigo, "descripcion": m.descripcion} for m in sc.materiales_activos(db)],
        "areas": _areas(db), "areaAsignada": sc.area_de(user), "esAdmin": sc.es_admin(user),
        "responsable": nombre_propio(user.nombre_completo), "correo": user.email or "",
        "hoy": hoy.isoformat(), "meses": sc.MESES,
    }


@router.get("/conteo/api/reporte")
def api_reporte(area: str, anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo", "reportes")
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area.strip().upper(), ConteoReporte.anio == anio,
                                       ConteoReporte.mes == mes).first()
    return {"reporte": sc.serializar(r) if r else None, "puedeEditar": bool(r and sc.puede_editar(user, r))}


class LineaIn(BaseModel):
    bodega_id: int
    material_id: int
    cantidad: float = 0


class DanadoIn(BaseModel):
    bodega_id: int
    cantidad: float = 0


class ReporteIn(BaseModel):
    fecha: str
    anio: int
    mes: int
    area: str = ""
    novedad: str = ""
    lineas: list[LineaIn] = []
    danados: list[DanadoIn] = []


@router.post("/conteo/api/reportes")
def api_guardar(payload: ReporteIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo")
    r = sc.guardar_reporte(db, user, payload.model_dump())
    if isinstance(r, str):
        raise HTTPException(400, r)
    return {"mensaje": f"✅ Conteo de {sc.MESES[r.mes - 1]} {r.anio} de {nombre_propio(r.area)} guardado.",
            "reporte": sc.serializar(r)}


def _reporte(db: Session, reporte_id: int) -> ConteoReporte:
    r = db.get(ConteoReporte, reporte_id)
    if not r:
        raise HTTPException(404, "Conteo no encontrado.")
    return r


@router.post("/conteo/api/reportes/{reporte_id}/evidencias")
async def api_evidencia(reporte_id: int, archivo: UploadFile = File(...), material_id: int = Form(0),
                        user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo")
    r = _reporte(db, reporte_id)
    datos = await archivo.read()
    e = sc.agregar_evidencia(db, user, r, material_id or None, archivo.filename or "evidencia",
                             (archivo.content_type or "").lower(), datos)
    if isinstance(e, str):
        raise HTTPException(400, e)
    return {"id": e.id, "nombre": e.nombre, "materialId": e.material_id, "tipo": e.tipo_mime, "tamano": e.tamano}


@router.post("/conteo/api/evidencias/{evidencia_id}/quitar")
def api_quitar_evidencia(evidencia_id: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo")
    e = db.get(ConteoEvidencia, evidencia_id)
    if not e:
        raise HTTPException(404, "Evidencia no encontrada.")
    if not sc.puede_editar(user, e.reporte):
        raise HTTPException(403, "No puedes quitar evidencias de este conteo.")
    db.delete(e)
    db.commit()
    return {"mensaje": "Evidencia quitada."}


@router.get("/conteo/api/evidencias/{evidencia_id}")
def api_ver_evidencia(evidencia_id: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo", "reportes")
    e = db.get(ConteoEvidencia, evidencia_id)
    if not e:
        raise HTTPException(404, "Evidencia no encontrada.")
    return Response(e.datos, media_type=e.tipo_mime,
                    headers={"Content-Disposition": f'inline; filename="{e.nombre}"', "Cache-Control": "private, max-age=3600"})


@router.get("/conteo/api/consolidado")
def api_consolidado(anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "reportes")
    return sc.consolidado(db, anio, mes, _areas(db))


@router.get("/conteo/api/consolidado/exportar")
def api_exportar(anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "reportes")
    c = sc.consolidado(db, anio, mes, _areas(db))
    salida = io.StringIO()
    salida.write("﻿")
    w = csv.writer(salida, delimiter=";")
    areas = [r["area"] for r in c["reportes"]]
    w.writerow([f"CONTEO INVENTARIO MENSUAL · {c['mesNombre'].upper()} {anio}"])
    w.writerow(["Bodega", "Material", *[nombre_propio(a) for a in areas], "Total"])
    for b in c["bodegas"]:
        for m in c["materiales"]:
            clave = f"{b['id']}:{m['id']}"
            w.writerow([f"{b['codigo']} {b['nombre']}", f"{b['prefijo']}-{m['codigo']}-{m['descripcion']}",
                        *[r["conteo"].get(clave, 0) for r in c["reportes"]], c["totales"].get(clave, 0)])
        w.writerow([f"{b['codigo']} {b['nombre']}", "Disco de zirconia - DAÑADOS",
                    *[r["danados"].get(str(b["id"]), 0) for r in c["reportes"]], c["totales"].get(f"{b['id']}:danados", 0)])
    w.writerow([])
    w.writerow(["Área", "Responsable", "Correo", "Fecha reporte", "Novedad"])
    for r in c["reportes"]:
        w.writerow([nombre_propio(r["area"]), r["responsable"], r["responsableEmail"], r["fechaReporte"], r["novedad"]])
    if c["pendientes"]:
        w.writerow([])
        w.writerow(["Áreas sin reportar", ", ".join(nombre_propio(a) for a in c["pendientes"])])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="conteo_{anio}_{mes:02d}.csv"'})


# ---------------- Parámetros (Producción › Parámetros › Conteo inventario mensual) ----------------

def _volver(tab: str, msg: str) -> RedirectResponse:
    from urllib.parse import quote
    return RedirectResponse(f"/inventario/parametros?tab={tab}&msg={quote(msg)}", status_code=303)


def _texto(v: str) -> str:
    return " ".join((v or "").split())


@router.post("/inventario/parametros/conteo/accesos")
def agregar_acceso(user: Empleado = Depends(require_admin), db: Session = Depends(get_db), empleado_id: int = Form(...)):
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("n_accesos", "No se guardó: elige una persona de la lista.")
    if MODULO_PRODUCCION not in e.modulos_lista:
        e.modulos = ",".join(e.modulos_lista + [MODULO_PRODUCCION])
    if not db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).first():
        db.add(ProduccionAcceso(empleado_id=e.id, submodulo=SUB))
    db.commit()
    return _volver("n_accesos", f"Acceso a Conteo inventario mensual dado a {nombre_propio(e.nombre_completo)}.")


@router.post("/inventario/parametros/conteo/accesos/{empleado_id}/quitar")
def quitar_acceso(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    e = db.get(Empleado, empleado_id)
    if e:
        db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).delete()
        acs.quitar(db, e.id, SUB)
        if not db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == e.id).first():
            e.modulos = ",".join(m for m in e.modulos_lista if m != MODULO_PRODUCCION)
        db.commit()
    return _volver("n_accesos", "Acceso a Conteo inventario mensual quitado.")


@router.post("/inventario/parametros/conteo/materiales")
def crear_material(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                   codigo: str = Form(...), descripcion: str = Form(...)):
    codigo, descripcion = _texto(codigo).upper(), _texto(descripcion)
    if not codigo or not descripcion:
        return _volver("n_materiales", "No se guardó: escribe el código y la descripción.")
    db.add(ConteoMaterial(codigo=codigo, descripcion=descripcion, orden=db.query(ConteoMaterial).count() + 1))
    db.commit()
    return _volver("n_materiales", f"Material {codigo} agregado.")


@router.post("/inventario/parametros/conteo/materiales/{material_id}")
def editar_material(material_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                    codigo: str = Form(...), descripcion: str = Form(...), orden: int = Form(0)):
    m = db.get(ConteoMaterial, material_id)
    if m and _texto(codigo) and _texto(descripcion):
        m.codigo, m.descripcion, m.orden = _texto(codigo).upper(), _texto(descripcion), orden
        db.commit()
    return _volver("n_materiales", "Material actualizado.")


@router.post("/inventario/parametros/conteo/materiales/{material_id}/toggle")
def toggle_material(material_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(ConteoMaterial, material_id)
    if m:
        m.activo = not m.activo
        db.commit()
    return _volver("n_materiales", "Material actualizado (lo ya contado se conserva).")


@router.post("/inventario/parametros/conteo/bodegas")
def crear_bodega(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                 codigo: str = Form(...), nombre: str = Form(...), prefijo: str = Form(...)):
    codigo, nombre, prefijo = _texto(codigo), _texto(nombre).upper(), _texto(prefijo).upper()
    if not (codigo and nombre and prefijo):
        return _volver("n_bodegas", "No se guardó: escribe código, nombre y prefijo.")
    db.add(ConteoBodega(codigo=codigo, nombre=nombre, prefijo=prefijo, orden=db.query(ConteoBodega).count() + 1))
    db.commit()
    return _volver("n_bodegas", f"Bodega {codigo} {nombre} agregada.")


@router.post("/inventario/parametros/conteo/bodegas/{bodega_id}")
def editar_bodega(bodega_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                  codigo: str = Form(...), nombre: str = Form(...), prefijo: str = Form(...)):
    b = db.get(ConteoBodega, bodega_id)
    if b and _texto(codigo) and _texto(nombre) and _texto(prefijo):
        b.codigo, b.nombre, b.prefijo = _texto(codigo), _texto(nombre).upper(), _texto(prefijo).upper()
        db.commit()
    return _volver("n_bodegas", "Bodega actualizada.")


@router.post("/inventario/parametros/conteo/bodegas/{bodega_id}/toggle")
def toggle_bodega(bodega_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    b = db.get(ConteoBodega, bodega_id)
    if b:
        b.activo = not b.activo
        db.commit()
    return _volver("n_bodegas", "Bodega actualizada.")
