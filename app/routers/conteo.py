"""Producción › Conteo inventario mensual: conteo del manager por área y mes con soportes, 3 firmas (manager,
Director de Producción y testigo) y reportes. Sus parámetros (accesos, Director y testigos, materiales, bodegas) están
en Producción › Parámetros."""
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
from ..models_conteo import (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoConfig, ConteoReporte, ConteoLinea,
                             ConteoEvidencia, ConteoAviso, ConteoDocumento, ConteoTestigo, ENVIADO)
from ..models_custodia import CustodiaArea
from ..auth import require_admin, get_current_user
from ..acceso_produccion import require_submodulo, ProduccionAcceso, MODULO_PRODUCCION
from ..formato import nombre_propio
from ..main_templates import templates
from .. import services_conteo as sc
from .. import acceso_secciones as acs

router = APIRouter()
SUB = "conteo"
ESTADOS = {"BORRADOR": "Borrador", "ENVIADO": "Esperando firmas", "DEVUELTO": "Devuelto", "VALIDADO": "En firme"}
COLUMNAS_NUEVAS = {  # por si la tabla ya existía de una versión anterior
    "conteo_reportes": {"estado": "VARCHAR(20) DEFAULT 'BORRADOR'", "enviado_en": "TIMESTAMP", "enviado_email": "VARCHAR(150)",
                        "validado_en": "TIMESTAMP", "devuelto_por_id": "INTEGER REFERENCES empleados(id)",
                        "devuelto_en": "TIMESTAMP", "observacion": "TEXT",
                        "manager_firma_id": "INTEGER REFERENCES empleados(id)", "manager_firma_email": "VARCHAR(150)",
                        "manager_firmado_en": "TIMESTAMP", "testigo_id": "INTEGER REFERENCES empleados(id)",
                        "testigo_email": "VARCHAR(150)", "testigo_firmado_en": "TIMESTAMP"},
    "conteo_evidencias": {"workdrive_estado": "VARCHAR(12) DEFAULT 'PENDIENTE'",
                          "workdrive_id": "VARCHAR(100)", "workdrive_error": "VARCHAR(300)", "workdrive_en": "TIMESTAMP"},
}


@router.on_event("startup")
def _tablas_conteo() -> None:
    from sqlalchemy import inspect, text
    for modelo in (ConteoBodega, ConteoMaterial, ConteoMaterialArea, ConteoConfig, ConteoReporte, ConteoLinea, ConteoEvidencia, ConteoAviso, ConteoDocumento, ConteoTestigo):
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
            try:
                n = await run_in_threadpool(sc.reintentar_workdrive)
                if n:
                    print(f"Conteo: {n} evidencia(s) copiadas a WorkDrive.")
            except Exception as e:
                print(f"Conteo: error copiando a WorkDrive: {e}")
    asyncio.create_task(ciclo())


def _areas(db: Session) -> list[str]:
    return [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).order_by(CustodiaArea.orden)]


@router.get("/conteo")
def pagina(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_catalogo(db)
    secciones = acs.secciones_de(db, user, SUB)
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
        "puedeAnular": sc.puede_anular(db, user),
        "responsable": nombre_propio(user.nombre_completo), "correo": user.email or "", "usuarioId": user.id,
        "hoy": sc.hoy_colombia().isoformat(), "meses": sc.MESES,
        "personas": [{"id": e.id, "nombre": nombre_propio(e.nombre_completo), "cargo": e.cargo or ""} for e in sc.testigos(db)],
        "director": ({"id": d.id, "nombre": nombre_propio(d.nombre_completo)} if (d := sc.director_produccion(db)) else None),
    }


@router.get("/conteo/api/reporte")
def api_reporte(area: str, anio: int, mes: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo", "reportes")
    r = db.query(ConteoReporte).filter(ConteoReporte.area == area.strip().upper(), ConteoReporte.anio == anio,
                                       ConteoReporte.mes == mes).first()
    return {"reporte": sc.serializar(db, r, user) if r else None, "puedeEditar": bool(r is None or sc.puede_editar(user, r))}


class LineaIn(BaseModel):  # cantidades con decimales (12.5)
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
    testigo_id: int = 0       # testigo del conteo (tercera firma), se elige al enviar
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
    accion = ("enviado con tu firma: se les avisó al Director de Producción y al testigo para que firmen"
              if r.estado == ENVIADO else "guardado como borrador")
    return {"mensaje": f"✅ Conteo de {sc.MESES[r.mes - 1]} {r.anio} de {nombre_propio(r.area)} {accion}.",
            "reporte": sc.serializar(db, r, user)}


def _reporte(db: Session, reporte_id: int) -> ConteoReporte:
    r = db.get(ConteoReporte, reporte_id)
    if not r:
        raise HTTPException(404, "Conteo no encontrado.")
    return r


def _reporte_para_firmar(db: Session, user: Empleado, reporte_id: int) -> ConteoReporte:
    r = _reporte(db, reporte_id)
    if user.id not in (r.manager_firma_id, r.testigo_id, r.responsable_id) and not sc.es_admin(user):
        raise HTTPException(404, "Este conteo no tiene una firma a tu nombre.")
    return r


@router.get("/conteo/firma/{reporte_id}")
def pagina_firma(reporte_id: int, request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    """Resumen del conteo para que el Director de Producción o el testigo lo firme (no necesita el módulo)."""
    r = _reporte_para_firmar(db, user, reporte_id)
    datos = sc.serializar(db, r)
    bodegas = sc.bodegas_activas(db)
    materiales = sc.materiales_activos(db, r.area)
    filas = []
    for b in bodegas:
        for m in materiales:
            filas.append({"bodega": f"{b.nombre} - Bodega {b.codigo}", "material": f"{b.prefijo}-{m.codigo}-{m.descripcion}",
                          "cantidad": datos["conteo"].get(f"{b.id}:{m.id}", 0),
                          "evidencias": [e for e in datos["evidencias"] if e["materialId"] == m.id]})
        filas.append({"bodega": f"{b.nombre} - Bodega {b.codigo}", "material": "Disco de zirconia - DAÑADOS", "danado": True,
                      "cantidad": datos["danados"].get(str(b.id), 0),
                      "evidencias": [e for e in datos["evidencias"] if not e["materialId"]]})
    return templates.TemplateResponse(request, "conteo_firma.html", {
        "user": user, "es_portal": True, "r": datos, "filas": filas, "rol": sc.rol_firmante(user, r),
        "puede_anular": sc.puede_anular(db, user),
        "msg": request.query_params.get("msg", "")})


@router.post("/conteo/firma/{reporte_id}/firmar")
def firmar(reporte_id: int, tareas: BackgroundTasks, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    from urllib.parse import quote
    r = _reporte_para_firmar(db, user, reporte_id)
    error = sc.firmar_conteo(db, user, r)
    if not error and r.estado == sc.EN_FIRME:
        tareas.add_task(sc.notificar, r.id, "en_firme")
        tareas.add_task(sc.documentos_en_firme, r.id, _areas(db))  # PDF del reporte + consolidado a la carpeta
    msg = error or ("✅ Listo: firmaste el conteo. Con las 3 firmas quedó en firme." if r.estado == sc.EN_FIRME
                    else "✅ Listo: firmaste el conteo. Gracias.")
    return RedirectResponse(f"/conteo/firma/{r.id}?msg={quote(msg)}", status_code=303)


@router.post("/conteo/firma/{reporte_id}/rechazar")
def rechazar(reporte_id: int, tareas: BackgroundTasks, observacion: str = Form(""), user: Empleado = Depends(get_current_user),
             db: Session = Depends(get_db)):
    from urllib.parse import quote
    r = _reporte_para_firmar(db, user, reporte_id)
    error = sc.rechazar_firma(db, user, r, observacion)
    if not error:
        tareas.add_task(sc.notificar, r.id, "devuelto")
    msg = error or "↩️ Listo: el conteo volvió a quien lo cargó con tu observación."
    return RedirectResponse(f"/conteo/firma/{r.id}?msg={quote(msg)}", status_code=303)


@router.post("/conteo/firma/{reporte_id}/anular")
def anular_desde_firma(reporte_id: int, tareas: BackgroundTasks, motivo: str = Form(""),
                       user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    from urllib.parse import quote
    r = _reporte(db, reporte_id)
    error = sc.anular_firmas(db, user, r, motivo)
    if not error:
        tareas.add_task(sc.notificar, r.id, "devuelto")
        tareas.add_task(sc.actualizar_consolidado, r.anio, r.mes, _areas(db))
    msg = error or "↩️ Firmas anuladas: el conteo volvió al manager para corregirlo y firmarlo de nuevo."
    return RedirectResponse(f"/conteo/firma/{r.id}?msg={quote(msg)}", status_code=303)


@router.post("/inventario/parametros/conteo/director")
def guardar_director(user: Empleado = Depends(require_admin), db: Session = Depends(get_db), empleado_id: str = Form("")):
    e = db.get(Empleado, int(empleado_id)) if empleado_id.isdigit() else None
    c = db.get(ConteoConfig, "director_id") or ConteoConfig(clave="director_id")
    c.valor = str(e.id) if e and e.activo else ""
    db.add(c)
    if e:
        _dar_modulo(db, e)  # el director también entra al submódulo
    db.commit()
    return _volver("n_director", f"{nombre_propio(e.nombre_completo)} es el Director de Producción del conteo." if e
                   else "Director de Producción quitado.")


@router.post("/inventario/parametros/conteo/testigos")
def agregar_testigo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db), empleado_id: int = Form(...)):
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("n_director", "No se guardó: elige una persona de la lista.")
    if not db.query(ConteoTestigo).filter_by(empleado_id=e.id).first():
        db.add(ConteoTestigo(empleado_id=e.id))
    db.commit()
    return _volver("n_director", f"{nombre_propio(e.nombre_completo)} puede firmar como testigo del conteo.")


@router.post("/inventario/parametros/conteo/testigos/{empleado_id}/quitar")
def quitar_testigo(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    db.query(ConteoTestigo).filter_by(empleado_id=empleado_id).delete()
    db.commit()
    return _volver("n_director", "Testigo quitado de la lista.")


def _pdf(doc: ConteoDocumento) -> Response:
    return Response(doc.datos, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc.nombre}"'})


@router.get("/conteo/api/reportes/{reporte_id}/acta.pdf")
def api_acta(reporte_id: int, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    """PDF firmado del área (se genera cuando queda en firme con las 3 firmas)."""
    acs.exigir(db, user, SUB, "nuevo", "reportes")
    r = _reporte(db, reporte_id)
    if r.estado != sc.EN_FIRME:
        raise HTTPException(400, "El PDF del reporte se genera cuando el conteo queda en firme (3 firmas).")
    if not sc.puede_editar(user, r) and "reportes" not in acs.secciones_de(db, user, SUB):
        raise HTTPException(403, "No puedes ver el acta de esta área.")
    doc = db.query(ConteoDocumento).filter_by(tipo="ACTA", reporte_id=r.id).first() or sc.generar_acta(db, r)
    return _pdf(doc)


@router.get("/conteo/api/consolidado/pdf")
def api_consolidado_pdf(anio: int, mes: int, tareas: BackgroundTasks, user: Empleado = Depends(require_submodulo(SUB)),
                        db: Session = Depends(get_db)):
    """Consolidado firmado del mes (con las áreas en firme hasta ahora); se actualiza y se copia a WorkDrive."""
    acs.exigir(db, user, SUB, "reportes")
    doc = sc.generar_consolidado(db, anio, mes, _areas(db))
    tareas.add_task(sc.copiar_documento_workdrive, doc.id)
    return _pdf(doc)


class AnularIn(BaseModel):
    motivo: str = ""


@router.post("/conteo/api/reportes/{reporte_id}/anular")
def api_anular(reporte_id: int, payload: AnularIn, tareas: BackgroundTasks, user: Empleado = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Solo el Director de Producción o un administrador: anula las firmas para corregir y volver a firmar."""
    r = _reporte(db, reporte_id)
    error = sc.anular_firmas(db, user, r, payload.motivo)
    if error:
        raise HTTPException(403 if not sc.puede_anular(db, user) else 400, error)
    tareas.add_task(sc.notificar, r.id, "devuelto")
    tareas.add_task(sc.actualizar_consolidado, r.anio, r.mes, _areas(db))
    return {"mensaje": f"🔓 Firmas anuladas: el conteo de {nombre_propio(r.area)} volvió para corregirlo y firmarlo de nuevo.",
            "reporte": sc.serializar(db, r, user)}


@router.post("/conteo/api/reportes/{reporte_id}/evidencias")
async def api_evidencia(reporte_id: int, tareas: BackgroundTasks, archivo: UploadFile = File(...), material_id: int = Form(0),
                        user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, SUB, "nuevo")
    r = _reporte(db, reporte_id)
    datos = await archivo.read()
    e = sc.agregar_evidencia(db, user, r, material_id or None, archivo.filename or "evidencia",
                             (archivo.content_type or "").lower(), datos)
    if isinstance(e, str):
        raise HTTPException(400, e)
    tareas.add_task(sc.copiar_a_workdrive, e.id)  # copia en la carpeta de WorkDrive (si está configurada)
    return {"id": e.id, "nombre": e.nombre, "materialId": e.material_id, "tipo": e.tipo_mime, "tamano": e.tamano}


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
def api_ver_evidencia(evidencia_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    from ..acceso_produccion import tiene_submodulo
    e = db.get(ConteoEvidencia, evidencia_id)
    if not e:
        raise HTTPException(404, "Evidencia no encontrada.")
    firmante = user.id in (e.reporte.manager_firma_id, e.reporte.testigo_id)
    if not firmante:
        if not tiene_submodulo(db, user, SUB):
            raise HTTPException(403, "No tienes acceso a esta evidencia.")
        acs.exigir(db, user, SUB, "nuevo", "reportes")
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
    w.writerow(["Bodega", "Material", *[f"{nombre_propio(r['area'])} ({ESTADOS.get(r['estado'], r['estado'])})" for r in reportes], "Total"])
    for b in c["bodegas"]:
        for m in c["materiales"]:
            clave = f"{b['id']}:{m['id']}"
            w.writerow([f"{b['codigo']} {b['nombre']}", f"{b['prefijo']}-{m['codigo']}-{m['descripcion']}",
                        *[r["final"].get(clave, 0) for r in reportes], c["totales"].get(clave, 0)])
        w.writerow([f"{b['codigo']} {b['nombre']}", "Disco de zirconia - DAÑADOS",
                    *[r["finalDanados"].get(str(b["id"]), 0) for r in reportes], c["totales"].get(f"{b['id']}:danados", 0)])
    w.writerow([])
    w.writerow(["Área", "Estado", "Responsable", "Correo", "Enviado", "Director de Producción", "Firmó", "Testigo", "Firmó",
                "En firme", "Novedad"])
    for r in c["reportes"]:
        w.writerow([nombre_propio(r["area"]), ESTADOS.get(r["estado"], r["estado"]), r["responsable"], r["responsableEmail"],
                    r["enviadoEn"], r["managerFirma"]["nombre"], r["managerFirma"]["en"], r["testigo"]["nombre"],
                    r["testigo"]["en"], r["enFirmeEn"], r["novedad"]])
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
        acs.quitar(db, e.id, SUB)
        if not db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == e.id).first():
            e.modulos = ",".join(m for m in e.modulos_lista if m != MODULO_PRODUCCION)
        db.commit()
    return _volver("n_accesos", "Acceso a Conteo inventario mensual quitado.")


@router.post("/inventario/parametros/conteo/workdrive/reintentar")
def workdrive_reintentar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    from .. import zoho_workdrive as wd
    if not wd.configurado():
        return _volver("n_director", "No se copió nada: falta configurar WorkDrive en Render (ver la ayuda).")
    n = sc.reintentar_workdrive(limite=200)
    return _volver("n_director", f"Listo: {n} archivo(s) copiados a WorkDrive.")


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
