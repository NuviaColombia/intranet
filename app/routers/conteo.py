"""Producción › Conteo inventario mensual: conteo del manager por área y mes, conteo de validación a ciegas,
comparación, evidencias y reportes. Sus parámetros (accesos, validadores, materiales, bodegas, ajustes) están en
Producción › Parámetros."""
import asyncio
import csv
import io
from fastapi import APIRouter, Request, Depends, HTTPException, Form, UploadFile, File, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db, engine
from ..models import Empleado
from ..models_conteo import (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoValidador, ConteoConfig, ConteoReporte,
                             ConteoLinea, ConteoEvidencia, ConteoAviso, BORRADOR, ENVIADO, VALIDADO)
from ..models_custodia import CustodiaArea
from ..auth import require_admin
from ..acceso_produccion import require_submodulo, ProduccionAcceso, MODULO_PRODUCCION
from ..formato import nombre_propio
from ..main_templates import templates
from .. import services_conteo as sc
from .. import acceso_secciones as acs

router = APIRouter()
SUB = "conteo"
COLUMNAS_NUEVAS = {  # por si la tabla ya existía de una versión anterior
    "conteo_reportes": {"estado": "VARCHAR(20) DEFAULT 'BORRADOR'", "enviado_en": "TIMESTAMP", "enviado_email": "VARCHAR(150)",
                        "validacion_por_id": "INTEGER REFERENCES empleados(id)", "validacion_guardada_en": "TIMESTAMP",
                        "validado_por_id": "INTEGER REFERENCES empleados(id)", "validado_en": "TIMESTAMP",
                        "validado_email": "VARCHAR(150)", "devuelto_por_id": "INTEGER REFERENCES empleados(id)",
                        "devuelto_en": "TIMESTAMP", "observacion": "TEXT"},
    "conteo_evidencias": {"etapa": "VARCHAR(12) DEFAULT 'MANAGER'"},
}


@router.on_event("startup")
def _tablas_conteo() -> None:
    from sqlalchemy import inspect, text
    for modelo in (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoValidador, ConteoConfig, ConteoReporte,
                   ConteoLinea, ConteoEvidencia, ConteoAviso):
        try:
            modelo.__table__.create(bind=engine, checkfirst=True)
        except Exception as e:  # otro proceso la acaba de crear
            print(f"Conteo: tabla {modelo.__tablename__} ({type(e).__name__}).")
    try:
        with engine.begin() as conn:
            for tabla, nuevas in COLUMNAS_NUEVAS.items():
                existentes = {c["name"] for c in inspect(engine).get_columns(tabla)}
                for nombre, tipo in nuevas.items():
                    if nombre not in existentes:
                        conn.execute(text(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo}"))
    except Exception as e:
        print(f"Conteo: columnas nuevas ({type(e).__name__}: {e}).")


@router.on_event("startup")
async def _recordatorios_conteo() -> None:
    """Cada hora: recordatorio por Cliq (una vez al día por persona) a las áreas que no han enviado el conteo."""
    async def ciclo():
        while True:
            await asyncio.sleep(3600)
            try:
                n = await run_in_threadpool(sc.enviar_recordatorios)
                if n:
                    print(f"Conteo: {n} recordatorio(s) enviados por Cliq.")
            except Exception as e:  # un fallo nunca debe detener la intranet
                print(f"Conteo: error enviando recordatorios: {e}")
    asyncio.create_task(ciclo())


def _areas(db: Session) -> list[str]:
    return [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]


def _secciones(db: Session, user: Empleado) -> list[str]:
    s = acs.secciones_de(db, user, SUB)
    return [x for x in s if x != "validacion" or sc.puede_validar(db, user)]


@router.get("/conteo")
def pagina(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_catalogo(db)
    secciones = _secciones(db, user)
    tab = request.query_params.get("tab")
    return templates.TemplateResponse(request, "conteo.html", {
        "user": user, "es_conteo": True, "secciones": secciones,
        "conteo_tab_inicial": tab if tab in secciones else (secciones[0] if secciones else "")})


@router.get("/conteo/api/datos")
def api_datos(user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_catalogo(db)
    por_mat = sc.areas_de_material(db)
    return {
        "bodegas": [{"id": b.id, "codigo": b.codigo, "nombre": b.nombre, "prefijo": b.prefijo} for b in sc.bodegas_activas(db)],
        "materiales": [{"id": m.id, "codigo": m.codigo, "descripcion": m.descripcion, "areas": por_mat.get(m.id, [])}
                       for m in sc.materiales_activos(db)],
        "areas": _areas(db), "areaAsignada": sc.area_de(user), "esAdmin": sc.es_admin(user),
        "puedeValidar": sc.puede_validar(db, user), "config": sc.config(db),
        "responsable": nombre_propio(user.nombre_completo), "correo": user.email or "", "usuarioId": user.id,
        "hoy": sc.hoy_colombia().isoformat(), "meses": sc.MESES,
    }


@router.get("/conteo/api/reporte")
def api_reporte(area: str, anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo", "reportes", "validacion")
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area.strip().upper(), ConteoReporte.anio == anio,
                                       ConteoReporte.mes == mes).first()
    return {"reporte": sc.serializar(db, r, user) if r else None, "puedeEditar": bool(r is None or sc.puede_editar(user, r)),
            "fechaLimite": sc.fecha_limite(db, anio, mes).strftime("%d/%m/%Y"),
            "vencido": sc.hoy_colombia() > sc.fecha_limite(db, anio, mes) and not sc.es_admin(user)}


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
    enviar: bool = False
    lineas: list[LineaIn] = []
    danados: list[DanadoIn] = []


@router.post("/conteo/api/reportes")
def api_guardar(payload: ReporteIn, tareas: BackgroundTasks, user: Empleado = Depends(require_submodulo(SUB)),
                db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo")
    datos = payload.model_dump()
    r = sc.guardar_reporte(db, user, datos, enviar=datos.pop("enviar"))
    if isinstance(r, str):
        raise HTTPException(400, r)
    if r.estado == ENVIADO:
        tareas.add_task(sc.notificar, r.id, "enviado")
    accion = "enviado a validación" if r.estado == ENVIADO else "guardado como borrador"
    return {"mensaje": f"✅ Conteo de {sc.MESES[r.mes - 1]} {r.anio} de {nombre_propio(r.area)} {accion}.",
            "reporte": sc.serializar(db, r, user)}


class ValidacionIn(BaseModel):
    lineas: list[LineaIn] | None = None
    danados: list[DanadoIn] | None = None
    decision: str = ""        # "" (guardar y comparar) | "validar" | "devolver"
    observacion: str = ""


def _reporte(db: Session, reporte_id: int) -> ConteoReporte:
    r = db.get(ConteoReporte, reporte_id)
    if not r:
        raise HTTPException(404, "Conteo no encontrado.")
    return r


@router.get("/conteo/api/validacion")
def api_para_validar(anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "validacion")
    if not sc.puede_validar(db, user):
        raise HTTPException(403, "Solo los validadores pueden ver esta sección.")
    reportes = (db.query(ConteoReporte).filter(ConteoReporte.anio == anio, ConteoReporte.mes == mes, ConteoReporte.estado != BORRADOR)
                .order_by(ConteoReporte.area).all())
    return {"data": [sc.serializar(db, r, user) for r in reportes]}


@router.post("/conteo/api/reportes/{reporte_id}/validacion")
def api_validar(reporte_id: int, payload: ValidacionIn, tareas: BackgroundTasks,
                user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "validacion")
    r = _reporte(db, reporte_id)
    datos = payload.model_dump()
    if datos["lineas"] is None:
        datos.pop("lineas")
    if datos["danados"] is None:
        datos.pop("danados")
    error = sc.guardar_validacion(db, user, r, datos, payload.decision)
    if error:
        raise HTTPException(400, error)
    db.refresh(r)
    if payload.decision == "validar":
        tareas.add_task(sc.notificar, r.id, "validado")
        msg = f"✅ Conteo de {nombre_propio(r.area)} validado y firmado."
    elif payload.decision == "devolver":
        tareas.add_task(sc.notificar, r.id, "devuelto")
        msg = f"↩️ Conteo de {nombre_propio(r.area)} devuelto al manager."
    else:
        c = sc.comparacion(db, r)
        msg = ("✅ Tu conteo coincide con el del manager." if not c["diferencias"]
               else f"⚠️ Hay {c['diferencias']} diferencia(s) con el conteo del manager.")
    return {"mensaje": msg, "reporte": sc.serializar(db, r, user)}


@router.post("/conteo/api/reportes/{reporte_id}/reabrir")
def api_reabrir(reporte_id: int, tareas: BackgroundTasks, user: Empleado = Depends(require_submodulo(SUB)),
                db: Session = Depends(get_db)):
    r = _reporte(db, reporte_id)
    error = sc.reabrir(db, user, r)
    if error:
        raise HTTPException(403, error)
    tareas.add_task(sc.notificar, r.id, "devuelto")
    return {"mensaje": "Conteo reabierto: el manager puede corregirlo y enviarlo de nuevo."}


@router.post("/conteo/api/reportes/{reporte_id}/evidencias")
async def api_evidencia(reporte_id: int, archivo: UploadFile = File(...), material_id: int = Form(0), etapa: str = Form("MANAGER"),
                        user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    etapa = "VALIDACION" if etapa.upper() == "VALIDACION" else "MANAGER"
    acs.exigir(db, user, SUB, "validacion" if etapa == "VALIDACION" else "nuevo")
    r = _reporte(db, reporte_id)
    datos = await archivo.read()
    e = sc.agregar_evidencia(db, user, r, material_id or None, archivo.filename or "evidencia",
                             (archivo.content_type or "").lower(), datos, etapa)
    if isinstance(e, str):
        raise HTTPException(400, e)
    return {"id": e.id, "nombre": e.nombre, "materialId": e.material_id, "etapa": e.etapa, "tipo": e.tipo_mime, "tamano": e.tamano}


@router.post("/conteo/api/evidencias/{evidencia_id}/quitar")
def api_quitar_evidencia(evidencia_id: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    e = db.get(ConteoEvidencia, evidencia_id)
    if not e:
        raise HTTPException(404, "Evidencia no encontrada.")
    error = sc.quitar_evidencia(db, user, e)
    if error:
        raise HTTPException(403, error)
    return {"mensaje": "Evidencia quitada."}


@router.get("/conteo/api/evidencias/{evidencia_id}")
def api_ver_evidencia(evidencia_id: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo", "reportes", "validacion")
    e = db.get(ConteoEvidencia, evidencia_id)
    if not e:
        raise HTTPException(404, "Evidencia no encontrada.")
    return Response(e.datos, media_type=e.tipo_mime,
                    headers={"Content-Disposition": f'inline; filename="{e.nombre}"', "Cache-Control": "private, max-age=3600"})


@router.get("/conteo/api/consolidado")
def api_consolidado(anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "reportes")
    return sc.consolidado(db, anio, mes, _areas(db), user)


@router.get("/conteo/api/consolidado/exportar")
def api_exportar(anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "reportes")
    c = sc.consolidado(db, anio, mes, _areas(db), user)
    salida = io.StringIO()
    salida.write("﻿")
    w = csv.writer(salida, delimiter=";")
    reportes = [r for r in c["reportes"] if not r["oculto"]]
    w.writerow([f"CONTEO INVENTARIO MENSUAL · {c['mesNombre'].upper()} {anio}"])
    w.writerow(["Bodega", "Material", *[f"{nombre_propio(r['area'])} ({r['estado'].title()})" for r in reportes], "Total"])
    for b in c["bodegas"]:
        for m in c["materiales"]:
            clave = f"{b['id']}:{m['id']}"
            w.writerow([f"{b['codigo']} {b['nombre']}", f"{b['prefijo']}-{m['codigo']}-{m['descripcion']}",
                        *[r["final"].get(clave, 0) for r in reportes], c["totales"].get(clave, 0)])
        w.writerow([f"{b['codigo']} {b['nombre']}", "Disco de zirconia - DAÑADOS",
                    *[r["finalDanados"].get(str(b["id"]), 0) for r in reportes], c["totales"].get(f"{b['id']}:danados", 0)])
    w.writerow([])
    w.writerow(["Área", "Estado", "Responsable", "Correo", "Enviado", "Validado por", "Validado", "Novedad"])
    for r in c["reportes"]:
        w.writerow([nombre_propio(r["area"]), r["estado"], r["responsable"], r["responsableEmail"], r["enviadoEn"],
                    r["validadoPor"], r["validadoEn"], r["novedad"]])
    if c["pendientes"]:
        w.writerow([])
        w.writerow(["Áreas sin enviar", ", ".join(nombre_propio(a) for a in c["pendientes"])])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="conteo_{anio}_{mes:02d}.csv"'})


# ---------------- Parámetros (Producción › Parámetros › Conteo inventario mensual) ----------------

def _volver(tab: str, msg: str) -> RedirectResponse:
    from urllib.parse import quote
    return RedirectResponse(f"/inventario/parametros?tab={tab}&msg={quote(msg)}", status_code=303)


def _texto(v: str) -> str:
    return " ".join((v or "").split())


def _dar_modulo(db: Session, e: Empleado) -> None:
    if MODULO_PRODUCCION not in e.modulos_lista:
        e.modulos = ",".join(e.modulos_lista + [MODULO_PRODUCCION])
    if not db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).first():
        db.add(ProduccionAcceso(empleado_id=e.id, submodulo=SUB))


@router.post("/inventario/parametros/conteo/accesos")
def agregar_acceso(user: Empleado = Depends(require_admin), db: Session = Depends(get_db), empleado_id: int = Form(...)):
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("n_accesos", "No se guardó: elige una persona de la lista.")
    _dar_modulo(db, e)
    db.commit()
    return _volver("n_accesos", f"Acceso a Conteo inventario mensual dado a {nombre_propio(e.nombre_completo)}.")


@router.post("/inventario/parametros/conteo/accesos/{empleado_id}/quitar")
def quitar_acceso(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    e = db.get(Empleado, empleado_id)
    if e:
        db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).delete()
        db.query(ConteoValidador).filter_by(empleado_id=e.id).delete()
        acs.quitar(db, e.id, SUB)
        if not db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == e.id).first():
            e.modulos = ",".join(m for m in e.modulos_lista if m != MODULO_PRODUCCION)
        db.commit()
    return _volver("n_accesos", "Acceso a Conteo inventario mensual quitado.")


@router.post("/inventario/parametros/conteo/validadores")
def agregar_validador(user: Empleado = Depends(require_admin), db: Session = Depends(get_db), empleado_id: int = Form(...)):
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("n_validadores", "No se guardó: elige una persona de la lista.")
    _dar_modulo(db, e)  # para validar también necesita entrar al submódulo
    if not db.query(ConteoValidador).filter_by(empleado_id=e.id).first():
        db.add(ConteoValidador(empleado_id=e.id))
    db.commit()
    return _volver("n_validadores", f"{nombre_propio(e.nombre_completo)} ahora valida los conteos.")


@router.post("/inventario/parametros/conteo/validadores/{empleado_id}/quitar")
def quitar_validador(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    db.query(ConteoValidador).filter_by(empleado_id=empleado_id).delete()
    db.commit()
    return _volver("n_validadores", "Validador quitado (conserva el acceso al submódulo).")


@router.post("/inventario/parametros/conteo/ajustes")
def guardar_ajustes(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                    tolerancia: str = Form("0"), dia_limite: str = Form("3")):
    try:
        tol = max(float(tolerancia.replace(",", ".")), 0)
        dia = min(max(int(dia_limite), 0), 28)
    except ValueError:
        return _volver("n_validadores", "No se guardó: la tolerancia y el día límite deben ser números.")
    for clave, valor in (("tolerancia", f"{tol:g}"), ("dia_limite", str(dia))):
        c = db.get(ConteoConfig, clave) or ConteoConfig(clave=clave)
        c.valor = valor
        db.add(c)
    db.commit()
    return _volver("n_validadores", "Ajustes guardados.")


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


@router.post("/inventario/parametros/conteo/materiales/{material_id}/areas")
def areas_material(material_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                   areas: list[str] = Form([])):
    m = db.get(ConteoMaterial, material_id)
    if m:
        db.query(ConteoMaterialArea).filter_by(material_id=m.id).delete()
        for a in dict.fromkeys(x.strip().upper() for x in areas if x.strip()):
            db.add(ConteoMaterialArea(material_id=m.id, area=a))
        db.commit()
    return _volver("n_materiales", f"Áreas de {m.codigo if m else 'el material'} guardadas." if areas
                   else "El material quedó para todas las áreas.")


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
