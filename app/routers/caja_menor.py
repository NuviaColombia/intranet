"""Caja menor Nuvia: páginas, API y parámetros. Todos los endpoints son síncronos (FastAPI los ejecuta en
un hilo aparte), para que una consulta no detenga el resto de la intranet."""
import csv
import io
from pathlib import Path
from datetime import date
from fastapi import APIRouter, Request, Depends, HTTPException, Form, BackgroundTasks, UploadFile, File
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse, StreamingResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..formato import nombre_propio
from ..database import SessionLocal, get_db
from ..models import Empleado
from ..models_caja import (CajaMenor, CajaAcceso, CajaAutorizador, CajaSupervisor, CajaRecibo, CajaFM, CajaArqueo,
                           CajaObservacion, CajaAdjunto)
from ..auth import require_modulo, get_current_user
from ..main_templates import templates
from .. import services_caja as sc
from .. import acceso_secciones as acs

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py
MODULO = "caja_menor"


def _caja(db: Session, user: Empleado, caja_id: int) -> CajaMenor:
    caja = db.get(CajaMenor, caja_id)
    if not caja or (not caja.activo and not sc.es_admin(user)):
        raise HTTPException(404, "Caja no encontrada.")
    if not sc.puede_usar_caja(db, user, caja):
        raise HTTPException(403, "No tienes acceso a esta caja.")
    if sc.es_firmante_de_caja(db, user, caja):
        raise HTTPException(403, "Eres firmante de esta caja: solo puedes consultar y firmar.")
    return caja


def _caja_o_firmas(db: Session, user: Empleado, caja_id: int) -> tuple[CajaMenor, bool]:
    """(caja, solo_firmas): quien no tiene acceso pero autoriza en la caja entra solo a ver y firmar."""
    caja = db.get(CajaMenor, caja_id)
    if not caja or (not caja.activo and not sc.es_admin(user)):
        raise HTTPException(404, "Caja no encontrada.")
    if sc.es_firmante_de_caja(db, user, caja):
        return caja, True  # firmante: consulta y firma
    if sc.puede_usar_caja(db, user, caja):
        return caja, False
    if sc.autoriza_en_caja(db, user, caja):
        return caja, True
    raise HTTPException(403, "No tienes acceso a esta caja.")


def _solo_lo_suyo(db: Session, user: Empleado, caja: CajaMenor, solo_firmas: bool) -> bool:
    """Ya no es firmante de la caja pero tiene documentos asignados: ve únicamente los suyos."""
    return solo_firmas and not sc.es_firmante_de_caja(db, user, caja)


def _solo_admin(user: Empleado):
    if not sc.es_admin(user):
        raise HTTPException(403, "Requiere rol de administrador.")


# ---------------- Páginas ----------------

@router.get("/caja-menor")
def entrada(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    sc.asegurar_cajas_iniciales(db)
    cajas = sc.cajas_de_usuario(db, user)
    pendientes = sc.pendientes_de_firma(db, user)
    con_acceso = {c.id for c in cajas}
    solo_firmas = [c for c in db.query(CajaMenor).filter(CajaMenor.activo == 1).order_by(CajaMenor.orden, CajaMenor.nombre)
                   if c.id not in con_acceso and (c.id in sc.ids_cajas_que_autoriza(db, user)
                                                  or c.id in sc.ids_cajas_que_supervisa(db, user) or c.id in pendientes)]
    return templates.TemplateResponse(request, "caja_menor_entrada.html",
                                      {"user": user, "es_portal": True, "es_caja_entrada": True, "cajas": cajas + solo_firmas,
                                       "solo_firmas": {c.id for c in solo_firmas}, "pendientes": pendientes})


@router.get("/caja-menor/firmas")
def pagina_firmas(user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Enlaces antiguos de Cliq: lleva a la pestaña Firmas de la caja con pendientes (o a la entrada)."""
    pendientes = sc.pendientes_de_firma(db, user)
    destino = f"/caja-menor/{min(pendientes)}?tab=firmas" if pendientes else "/caja-menor"
    return RedirectResponse(destino, status_code=303)


@router.get("/caja-menor/parametros")
def parametros(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    sc.asegurar_cajas_iniciales(db)
    cajas = db.query(CajaMenor).order_by(CajaMenor.orden, CajaMenor.nombre).all()
    accesos = db.query(CajaAcceso).all()
    por_empleado: dict[int, set[int]] = {}
    for a in accesos:
        por_empleado.setdefault(a.empleado_id, set()).add(a.caja_id)
    activos = db.query(Empleado).filter(Empleado.activo == 1).order_by(Empleado.apellidos, Empleado.nombres).all()
    autoriza_por_empleado: dict[int, set[int]] = {}
    for a in db.query(CajaAutorizador).all():
        autoriza_por_empleado.setdefault(a.empleado_id, set()).add(a.caja_id)
    supervisa_por_empleado: dict[int, set[int]] = {}
    for a in db.query(CajaSupervisor).all():
        supervisa_por_empleado.setdefault(a.empleado_id, set()).add(a.caja_id)
    # Los administradores siguen entrando a todas las cajas; se relacionan aquí para poder ser responsables.
    # Quien solo autoriza tiene el módulo (para firmar) pero no aparece en Accesos hasta que se le den cajas.
    relacionados = {e.id for e in activos if e.id in por_empleado
                    or (MODULO in e.modulos_lista and e.id not in autoriza_por_empleado and e.id not in supervisa_por_empleado)}
    usuarios = [e for e in activos if e.id in relacionados]
    candidatos = [e for e in activos if e.id not in relacionados]
    # Responsable de cada caja: se elige entre quienes tienen acceso a ella
    con_acceso = {c.id: [e for e in usuarios if c.id in por_empleado.get(e.id, set())] for c in cajas}
    autorizadores = [e for e in activos if e.id in autoriza_por_empleado]
    supervisores = [e for e in activos if e.id in supervisa_por_empleado]
    # Por caja: quién opera (accesos), quién autoriza y quién supervisa (lista "Caja" de Parámetros)
    miembros = {rol: {c.id: [e for e in activos if c.id in mapa.get(e.id, set())] for c in cajas}
                for rol, mapa in (("accesos", por_empleado), ("autorizan", autoriza_por_empleado),
                                  ("supervisan", supervisa_por_empleado))}
    responsables = {c.responsable_id for c in cajas if c.responsable_id}
    resumen = [e for e in activos if e.id in por_empleado or e.id in autoriza_por_empleado
               or e.id in supervisa_por_empleado or e.id in responsables]
    return templates.TemplateResponse(request, "caja_menor_parametros.html", {
        "miembros": miembros, "resumen": resumen, "secciones_cfg": acs.configuracion(db, "caja"),
        "administradores": [e for e in activos if e.rol in ("admin", "superadmin")],
        "user": user, "es_caja": True, "caja": None, "cajas": cajas, "usuarios": usuarios, "candidatos": candidatos, "con_acceso": con_acceso,
        "autorizadores": autorizadores, "autoriza_por_empleado": autoriza_por_empleado, "activos": activos,
        "supervisores": supervisores, "supervisa_por_empleado": supervisa_por_empleado,
        "tab": request.query_params.get("tab", ""),
        "por_empleado": por_empleado, "msg": request.query_params.get("msg")})


def _responsable_es_admin(db: Session, caja) -> bool:
    r = sc.responsable_de_caja(db, caja)
    return bool(r and sc.es_admin(r))


def _recibo_para_recibido(db: Session, user: Empleado, recibo_id: int) -> CajaRecibo:
    r = db.get(CajaRecibo, recibo_id)
    if not r or not (r.recibido_por_id == user.id or sc.es_admin(user)):
        raise HTTPException(404, "Este recibo no está a tu nombre.")
    return r


@router.get("/caja-menor/recibido/{recibo_id}")
def pagina_recibido(recibo_id: int, request: Request, user: Empleado = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    """Resumen del recibo para que el colaborador firme que recibió el dinero (no necesita el módulo de caja)."""
    r = _recibo_para_recibido(db, user, recibo_id)
    return templates.TemplateResponse(request, "caja_recibido.html", {
        "user": user, "es_portal": True, "r": sc.serializar_recibo(r),
        "es_quien_recibe": r.recibido_por_id == user.id, "msg": request.query_params.get("msg", "")})


@router.post("/caja-menor/recibido/{recibo_id}/firmar")
def firmar_recibido(recibo_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    from urllib.parse import quote
    r = _recibo_para_recibido(db, user, recibo_id)
    error = sc.firmar_recibido(db, r, user)
    msg = error or "✅ Listo: firmaste el recibido. Gracias."
    return RedirectResponse(f"/caja-menor/recibido/{r.id}?msg={quote(msg)}", status_code=303)


# ---- Firma de recibido desde el enlace de Cliq, sin iniciar sesión (colaboradores de People sin acceso a la caja) ----
def _recibo_por_enlace(db: Session, recibo_id: int, token: str) -> CajaRecibo:
    r = db.get(CajaRecibo, recibo_id)
    if not r or not sc.token_recibido_valido(r, token):
        raise HTTPException(404, "Este enlace no es válido o ya no corresponde a este recibo.")
    return r


@router.get("/caja-menor/firmar-recibido/{recibo_id}/{token}")
def pagina_firma_enlace(recibo_id: int, token: str, request: Request, db: Session = Depends(get_db)):
    """Detalle del recibo y botón para firmar el recibido. No requiere iniciar sesión: el enlace es personal y firmado."""
    r = _recibo_por_enlace(db, recibo_id, token)
    return templates.TemplateResponse(request, "caja_recibido_enlace.html", {
        "r": sc.serializar_recibo(r), "token": token, "msg": request.query_params.get("msg", ""),
        "quien": nombre_propio(r.recibido_por.nombre_completo) if r.recibido_por else "",
        "correo": r.recibido_por.email if r.recibido_por else "",
        "logo": "/static/logos/nuvia-smiles.png"})


@router.post("/caja-menor/firmar-recibido/{recibo_id}/{token}")
def firmar_por_enlace(recibo_id: int, token: str, request: Request, db: Session = Depends(get_db)):
    from urllib.parse import quote
    r = _recibo_por_enlace(db, recibo_id, token)
    msg = sc.firmar_recibido_enlace(db, r, request.client.host if request.client else "")
    msg = msg or "✅ Listo: firmaste el recibido. Gracias."
    return RedirectResponse(f"/caja-menor/firmar-recibido/{r.id}/{token}?msg={quote(msg)}", status_code=303)


@router.get("/caja-menor/{caja_id}")
def pagina_caja(caja_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    return templates.TemplateResponse(request, "caja_menor.html", {
        "user": user, "es_caja": True, "caja": caja,
        # Los administradores pueden autorizar sus propios recibos y ser responsable y supervisor a la vez
        "autorizadores": [n for n in sc.autorizadores_de_caja(db, caja)
                          if sc.es_admin(user) or n != user.nombre_completo.strip().upper()],
        "solo_yo_autorizo": not sc.es_admin(user) and sc.autorizadores_de_caja(db, caja) == [user.nombre_completo.strip().upper()],
        "supervisores": [n for n in sc.supervisores_de_caja(db, caja)
                         if n != (caja.responsable or "").strip().upper() or _responsable_es_admin(db, caja)],
        "solo_firmas": solo_firmas, "puede_consultar": sc.es_firmante_de_caja(db, user, caja),
        "secciones": None if solo_firmas else acs.secciones_de(db, user, "caja"),
        "tab_inicial": (request.query_params.get("tab") if request.query_params.get("tab") in ("consulta", "fms", "firmas") else "firmas")
                       if solo_firmas else request.query_params.get("tab", ""),
        "caja_por_firmar": sc.pendientes_de_firma(db, user).get(caja.id, 0),
        "denominaciones_monedas": sc.MONEDAS,
        "denominaciones_billetes": sc.BILLETES})


# ---------------- API: recibos ----------------

class ReciboIn(BaseModel):
    ciudad: str = ""
    fecha: str
    identificacion: str
    pagado_a: str
    valor: float
    concepto: str
    numero_factura: str = ""
    anexo: bool = False
    autorizado_por: str = ""
    confirmar: list[str] = []   # avisos que la persona ya confirmó (fecha_antigua, factura_repetida)


class MotivoIn(BaseModel):
    motivo: str = ""


@router.get("/caja-menor/api/{caja_id}/resumen")
def api_resumen(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    return {"siguienteRecibo": sc.siguiente_consecutivo(db, caja), "siguienteFM": caja.fm_siguiente,
            "siguienteArqueo": sc.siguiente_arqueo(db, caja), "pendiente": sc.total_pendiente(db, caja),
            "sinReembolsar": sc.total_sin_reembolsar(db, caja),
            "fondo": caja.fondo, "responsable": caja.responsable, "ciudad": caja.ciudad, "prefijo": caja.prefijo}


@router.get("/caja-menor/api/{caja_id}/recibos")
def api_recibos(caja_id: int, estado: str = "", desde: str = "", hasta: str = "",
                user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    recibos = sc.recibos_de_caja(db, caja, estado.upper(), date.fromisoformat(desde) if desde else None,
                                 date.fromisoformat(hasta) if hasta else None)
    if _solo_lo_suyo(db, user, caja, solo_firmas):  # sin rol actual: solo los recibos que le asignaron
        recibos = [r for r in recibos if r.autorizado_por_id == user.id]
    return {"data": [sc.serializar_recibo(r) for r in recibos], "truncado": len(recibos) >= 2000}


@router.get("/caja-menor/api/{caja_id}/recibos/{consecutivo}")
def api_recibo(caja_id: int, consecutivo: int, user: Empleado = Depends(require_modulo(MODULO)),
               db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    r = db.query(CajaRecibo).filter(CajaRecibo.caja_id == caja.id, CajaRecibo.consecutivo == consecutivo).first()
    if not r or (_solo_lo_suyo(db, user, caja, solo_firmas) and r.autorizado_por_id != user.id):
        raise HTTPException(404, f"No existe el recibo {caja.prefijo}-{consecutivo:04d}.")
    return sc.serializar_recibo(r)


@router.post("/caja-menor/api/{caja_id}/recibos")
def api_crear_recibo(caja_id: int, payload: ReciboIn, tareas: BackgroundTasks, user: Empleado = Depends(require_modulo(MODULO)),
                     db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'recibo')
    r = sc.crear_recibo(db, caja, user, payload.model_dump())
    if isinstance(r, dict):
        raise HTTPException(409, r)  # hay que confirmar (fecha antigua / factura repetida)
    if isinstance(r, str):
        raise HTTPException(400, r)
    if sc.necesita_aviso_firma(r):
        tareas.add_task(sc.notificar_firma_pendiente, r.id)
    if sc.necesita_aviso_recibido(r):  # el No. identificación es de un colaborador: firma el recibido desde Cliq
        tareas.add_task(sc.notificar_recibido_pendiente, r.id)
    return {"mensaje": f"✅ Recibo {caja.prefijo}-{r.consecutivo:04d} guardado.", "recibo": sc.serializar_recibo(r)}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/editar")
def api_editar_recibo(caja_id: int, recibo_id: int, payload: ReciboIn, tareas: BackgroundTasks,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'recibo', 'consulta')
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.editar_recibo(db, r, user, payload.model_dump())
    if isinstance(error, dict):
        raise HTTPException(409, error)
    if error:
        raise HTTPException(400, error)
    if sc.necesita_aviso_firma(r):  # tras editar, quien autoriza debe firmar de nuevo
        tareas.add_task(sc.notificar_firma_pendiente, r.id)
    if sc.necesita_aviso_recibido(r) and not r.recibido_aviso_en:  # cambió quien recibe: se le avisa
        tareas.add_task(sc.notificar_recibido_pendiente, r.id)
    return {"mensaje": "✅ Recibo actualizado.", "recibo": sc.serializar_recibo(r)}


# ---------------- API: adjuntos del recibo (documentos y fotos) ----------------

@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/adjuntos")
async def api_subir_adjunto(caja_id: int, recibo_id: int, archivo: UploadFile = File(...),
                            user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", "recibo", "consulta")
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    datos = await archivo.read()
    a = sc.agregar_adjunto(db, user, r, archivo.filename or "adjunto", (archivo.content_type or "").lower(), datos)
    if isinstance(a, str):
        raise HTTPException(400, a)
    return {"id": a.id, "nombre": a.nombre, "tipo": a.tipo_mime, "tamano": a.tamano}


@router.post("/caja-menor/api/{caja_id}/adjuntos/{adjunto_id}/quitar")
def api_quitar_adjunto(caja_id: int, adjunto_id: int, user: Empleado = Depends(require_modulo(MODULO)),
                       db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    a = db.get(CajaAdjunto, adjunto_id)
    if not a or a.recibo.caja_id != caja.id:
        raise HTTPException(404, "Documento no encontrado.")
    error = sc.quitar_adjunto(db, user, a)
    if error:
        raise HTTPException(403, error)
    return {"mensaje": "Documento quitado."}


@router.get("/caja-menor/api/{caja_id}/adjuntos/{adjunto_id}")
def api_ver_adjunto(caja_id: int, adjunto_id: int, user: Empleado = Depends(require_modulo(MODULO)),
                    db: Session = Depends(get_db)):
    """Lo ven quienes ven el recibo, incluido quien lo firma (para revisar el soporte antes de firmar)."""
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    a = db.get(CajaAdjunto, adjunto_id)
    if not a or a.recibo.caja_id != caja.id:
        raise HTTPException(404, "Documento no encontrado.")
    fm = a.recibo.fm
    firma_el_fm = bool(fm and user.id in (fm.supervisado_por_id, fm.elaborado_por_id))
    if _solo_lo_suyo(db, user, caja, solo_firmas) and a.recibo.autorizado_por_id != user.id and not firma_el_fm:
        raise HTTPException(404, "Documento no encontrado.")
    return Response(a.datos, media_type=a.tipo_mime,
                    headers={"Content-Disposition": f'inline; filename="{a.nombre}"', "Cache-Control": "private, max-age=3600"})


class IdsIn(BaseModel):
    ids: list[int] = []


@router.post("/caja-menor/api/{caja_id}/recibos/firmar-varios")
def api_firmar_varios(caja_id: int, payload: IdsIn, tareas: BackgroundTasks,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Firma de una vez los recibos marcados (solo los asignados a quien firma)."""
    caja, _ = _caja_o_firmas(db, user, caja_id)
    firmados, errores = [], []
    for rid in dict.fromkeys(payload.ids):
        r = db.get(CajaRecibo, rid)
        if not r or r.caja_id != caja.id:
            continue
        error = sc.firmar_recibo(db, r, user)
        numero = f"{caja.prefijo}-{r.consecutivo:04d}"
        if error:
            errores.append(f"{numero}: {error}")
        else:
            firmados.append(numero)
            tareas.add_task(sc.notificar_firmado, r.id)
    if not firmados:
        raise HTTPException(400, "No se firmó ningún recibo. " + " ".join(errores))
    return {"mensaje": f"✅ Firmaste {len(firmados)} recibo(s): {', '.join(firmados)}." + (f" No se pudo: {' '.join(errores)}" if errores else "")}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/reenviar-recibido")
def api_reenviar_recibido(caja_id: int, recibo_id: int, user: Empleado = Depends(require_modulo(MODULO)),
                          db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    if not sc.necesita_aviso_recibido(r):
        raise HTTPException(400, "Este recibo no tiene una firma de recibido pendiente.")
    sc.notificar_recibido_pendiente(r.id)
    db.refresh(r)
    return {"mensaje": "✅ Aviso de firma de recibido reenviado por Cliq." if r.recibido_aviso_ok else
            "⚠️ No se pudo enviar el aviso por Cliq. Verifica que la persona esté suscrita a Nuvia Colombia Bot.",
            "recibo": sc.serializar_recibo(r)}


@router.get("/caja-menor/api/{caja_id}/colaborador")
def api_colaborador(caja_id: int, identificacion: str = "", user: Empleado = Depends(require_modulo(MODULO)),
                    db: Session = Depends(get_db)):
    """¿El No. identificación es de un colaborador de People? (para avisar que firmará el recibido por Cliq)."""
    _caja(db, user, caja_id)
    e = sc.colaborador_por_identificacion(db, identificacion)
    return {"encontrado": bool(e), "nombre": nombre_propio(e.nombre_completo) if e else ""}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/reenviar-aviso")
def api_reenviar_aviso_recibo(caja_id: int, recibo_id: int, user: Empleado = Depends(require_modulo(MODULO)),
                              db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    if not sc.necesita_aviso_firma(r):
        raise HTTPException(400, "Este recibo no tiene una firma pendiente.")
    sc.notificar_firma_pendiente(r.id)
    db.refresh(r)
    return {"mensaje": "✅ Aviso reenviado por Cliq." if r.aviso_ok else
            "⚠️ No se pudo enviar el aviso por Cliq. Verifica que la persona esté suscrita a Nuvia Colombia Bot.",
            "recibo": sc.serializar_recibo(r)}


class TextoIn(BaseModel):
    texto: str = ""


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/observar")
def api_observar_recibo(caja_id: int, recibo_id: int, payload: TextoIn, tareas: BackgroundTasks,
                        user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Quien debe firmar no está de acuerdo: deja una observación y el bot avisa al responsable para corregir."""
    caja, _ = _caja_o_firmas(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.observar_recibo(db, r, user, payload.texto)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_observacion, recibo_id=r.id)
    return {"mensaje": "📝 Observación enviada. Se le avisó por Cliq al responsable para que corrija el recibo.",
            "recibo": sc.serializar_recibo(r)}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/firmar")
def api_firmar_recibo(caja_id: int, recibo_id: int, tareas: BackgroundTasks,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Firma desde la pestaña Firmas de la caja (solo la persona asignada como "Autorizado por")."""
    caja, _ = _caja_o_firmas(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.firmar_recibo(db, r, user)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_firmado, r.id)
    return {"mensaje": f"✅ Firmaste el recibo {caja.prefijo}-{r.consecutivo:04d}.", "recibo": sc.serializar_recibo(r)}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/anular")
def api_anular_recibo(caja_id: int, recibo_id: int, payload: MotivoIn, tareas: BackgroundTasks,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'consulta', 'recibo')
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.anular_recibo(db, r, user, payload.motivo)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_anulado, r.id)
    return {"mensaje": f"✅ Recibo {caja.prefijo}-{r.consecutivo:04d} anulado.", "recibo": sc.serializar_recibo(r)}


@router.get("/caja-menor/api/{caja_id}/exportar")
def api_exportar(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)  # los firmantes también pueden consultar y exportar
    if not solo_firmas:
        acs.exigir(db, user, "caja", "consulta")
    if _solo_lo_suyo(db, user, caja, solo_firmas):
        raise HTTPException(403, "No tienes acceso a esta caja.")
    salida = io.StringIO()
    salida.write("﻿")
    w = csv.writer(salida, delimiter=";")
    w.writerow(["No. recibo", "Fecha", "Ciudad", "No. identificación", "Pagado a", "Valor", "Valor en letras",
                "Concepto", "Factura / cuenta de cobro", "Estado", "FM", "Registrado por", "Registrado en",
                "Anulado por", "Motivo anulación"])
    for r in sc.recibos_de_caja(db, caja, limite=1_000_000):
        s = sc.serializar_recibo(r)
        w.writerow([s["noRecibo"], s["fecha"], s["ciudad"], s["identificacion"], s["pagadoA"], s["valor"],
                    s["valorLetras"], s["concepto"], s["factura"], s["estado"], s["fm"], s["creadoPor"],
                    s["creadoEn"], s["anuladoPor"], s["motivoAnulacion"]])
    salida.seek(0)
    nombre = f"Caja_menor_{caja.nombre.title()}_{date.today().isoformat()}.csv"
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


# ---------------- API: legalización (FM) ----------------

class LegalizarIn(BaseModel):
    recibos: list[int]
    responsable: str = ""
    desglose: dict = {}
    ajuste: float = 0
    supervisado_por: str = ""


@router.post("/caja-menor/api/{caja_id}/legalizar")
def api_legalizar(caja_id: int, payload: LegalizarIn, tareas: BackgroundTasks, user: Empleado = Depends(require_modulo(MODULO)),
                  db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'legalizar')
    fm = sc.legalizar(db, caja, user, payload.recibos, payload.responsable, payload.desglose, payload.ajuste,
                      payload.supervisado_por)
    if isinstance(fm, str):
        raise HTTPException(400, fm)
    if fm.elaborado_por_id and not fm.elaborado_en:
        tareas.add_task(sc.notificar_elaboracion_pendiente, fm.id)  # otra persona legalizó: firma el responsable
    elif fm.supervisado_por_id:
        tareas.add_task(sc.notificar_supervision_pendiente, fm.id)
    return {"mensaje": f"✅ Se legalizó el FM{fm.numero}.", "fm": sc.serializar_fm(fm, con_recibos=True)}


@router.get("/caja-menor/api/{caja_id}/fms")
def api_fms(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    q = db.query(CajaFM).filter(CajaFM.caja_id == caja.id)
    if _solo_lo_suyo(db, user, caja, solo_firmas):  # sin rol actual: solo los FM que le asignaron
        q = q.filter((CajaFM.supervisado_por_id == user.id) | (CajaFM.elaborado_por_id == user.id))
    fms = q.order_by(CajaFM.numero.desc()).all()
    return {"data": [sc.serializar_fm(f) for f in fms]}


@router.get("/caja-menor/api/{caja_id}/fms/{fm_id}")
def api_fm(caja_id: int, fm_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja, solo_firmas = _caja_o_firmas(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id or (_solo_lo_suyo(db, user, caja, solo_firmas)
                                           and user.id not in (fm.supervisado_por_id, fm.elaborado_por_id)):
        raise HTTPException(404, "FM no encontrado.")
    return sc.serializar_fm(fm, con_recibos=True)


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/reembolsado")
def api_fm_reembolsado(caja_id: int, fm_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Tesorería reembolsó el FM: su valor deja de contar como pendiente en el arqueo."""
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'fms')
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.marcar_reembolsado(db, fm, user)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ FM{fm.numero} marcado como reembolsado.", "fm": sc.serializar_fm(fm, con_recibos=True)}


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/reenviar-aviso")
def api_reenviar_aviso_fm(caja_id: int, fm_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id or fm.estado != "VIGENTE":
        raise HTTPException(404, "FM no encontrado.")
    if not ((fm.elaborado_por_id and not fm.elaborado_en) or (fm.supervisado_por_id and not fm.supervisado_en)):
        raise HTTPException(400, "Este FM no tiene firmas pendientes.")
    sc.reenviar_aviso_fm(fm.id)
    db.refresh(fm)
    return {"mensaje": "✅ Aviso reenviado por Cliq." if fm.aviso_ok else
            "⚠️ No se pudo enviar el aviso por Cliq. Verifica que la persona esté suscrita a Nuvia Colombia Bot.",
            "fm": sc.serializar_fm(fm, con_recibos=True)}


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/observar")
def api_observar_fm(caja_id: int, fm_id: int, payload: TextoIn, tareas: BackgroundTasks,
                    user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja, _ = _caja_o_firmas(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.observar_fm(db, fm, user, payload.texto)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_observacion, fm_id=fm.id)
    return {"mensaje": "📝 Observación enviada. Se le avisó por Cliq al responsable para que corrija el FM.",
            "fm": sc.serializar_fm(fm, con_recibos=True)}


class CorregirFMIn(BaseModel):
    desglose: dict = {}
    ajuste: float = 0


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/corregir")
def api_corregir_fm(caja_id: int, fm_id: int, payload: CorregirFMIn, tareas: BackgroundTasks,
                    user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """El responsable corrige el conteo y el ajuste del FM; el bot vuelve a pedir el visto bueno."""
    caja = _caja(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.corregir_fm(db, fm, user, payload.desglose, payload.ajuste)
    if error:
        raise HTTPException(400, error)
    if fm.supervisado_por_id:
        tareas.add_task(sc.notificar_supervision_pendiente, fm.id)
    return {"mensaje": f"✅ FM{fm.numero} corregido. Se le avisó por Cliq a quien supervisa para que dé el visto bueno.",
            "fm": sc.serializar_fm(fm, con_recibos=True)}


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/elaboracion")
def api_firmar_elaboracion(caja_id: int, fm_id: int, tareas: BackgroundTasks, user: Empleado = Depends(require_modulo(MODULO)),
                           db: Session = Depends(get_db)):
    """Firma "Elaborado por" desde la pestaña Firmas (solo el responsable de la caja asignado al FM)."""
    caja, _ = _caja_o_firmas(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.firmar_elaboracion(db, fm, user)
    if error:
        raise HTTPException(400, error)
    if fm.supervisado_por_id:
        tareas.add_task(sc.notificar_supervision_pendiente, fm.id)  # ahora le toca al supervisor
    return {"mensaje": f"✅ Firmaste la elaboración del FM{fm.numero}.", "fm": sc.serializar_fm(fm)}


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/visto-bueno")
def api_visto_bueno(caja_id: int, fm_id: int, tareas: BackgroundTasks, user: Empleado = Depends(require_modulo(MODULO)),
                    db: Session = Depends(get_db)):
    """Visto bueno del FM desde la pestaña Firmas (solo la persona asignada como "Supervisado por")."""
    caja, _ = _caja_o_firmas(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.dar_visto_bueno(db, fm, user)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_supervisado, fm.id)
    return {"mensaje": f"✅ Diste el visto bueno al FM{fm.numero}.", "fm": sc.serializar_fm(fm)}


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/anular")
def api_anular_fm(caja_id: int, fm_id: int, payload: MotivoIn, tareas: BackgroundTasks,
                  user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'fms')
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.anular_fm(db, fm, user, payload.motivo)
    if error:
        raise HTTPException(400, error)
    tareas.add_task(sc.notificar_fm_anulado, fm.id)
    return {"mensaje": f"✅ FM{fm.numero} anulado. Sus recibos volvieron a ACTIVO."}


# ---------------- API: arqueo rápido ----------------

class ArqueoIn(BaseModel):
    responsable: str = ""
    desglose: dict = {}


@router.get("/caja-menor/api/{caja_id}/arqueos")
def api_arqueos(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'arqueo')
    arqueos = (db.query(CajaArqueo).filter(CajaArqueo.caja_id == caja.id)
               .order_by(CajaArqueo.consecutivo.desc()).limit(2000).all())
    return {"data": [sc.serializar_arqueo(a) for a in arqueos]}


@router.post("/caja-menor/api/{caja_id}/arqueos")
def api_crear_arqueo(caja_id: int, payload: ArqueoIn, user: Empleado = Depends(require_modulo(MODULO)),
                     db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    acs.exigir(db, user, "caja", 'arqueo')
    a = sc.crear_arqueo(db, caja, user, "", payload.desglose)  # responsable: el de la caja
    if isinstance(a, str):
        raise HTTPException(400, a)
    return {"mensaje": f"✅ Arqueo ARQ-{a.consecutivo:04d} guardado.", "arqueo": sc.serializar_arqueo(a)}


# ---------------- Parámetros (solo administradores) ----------------

def _texto(v: str) -> str:
    return (v or "").strip().upper()


@router.post("/caja-menor/parametros/cajas")
def crear_caja(user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db),
               nombre: str = Form(...), prefijo: str = Form(...), ciudad: str = Form("GALAPA"),
               fondo: float = Form(1000000), responsable: str = Form(""), consecutivo_inicial: int = Form(1),
               fm_siguiente: int = Form(1), icono: str = Form("💵")):
    _solo_admin(user)
    if db.query(CajaMenor).filter(CajaMenor.nombre == _texto(nombre)).first():
        return RedirectResponse("/caja-menor/parametros?msg=Ya existe una caja con ese nombre.", status_code=303)
    db.add(CajaMenor(nombre=_texto(nombre), prefijo=_texto(prefijo)[:10], ciudad=_texto(ciudad), fondo=fondo,
                     responsable=_texto(responsable), consecutivo_inicial=max(consecutivo_inicial, 1),
                     fm_siguiente=max(fm_siguiente, 1), icono=(icono or "💵")[:4],
                     orden=db.query(CajaMenor).count() + 1))
    db.commit()
    return RedirectResponse("/caja-menor/parametros?msg=Caja creada.", status_code=303)


@router.post("/caja-menor/parametros/cajas/{caja_id}")
def editar_caja(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db),
                nombre: str = Form(...), prefijo: str = Form(...), ciudad: str = Form(""), fondo: float = Form(0),
                responsable: str = Form(""), consecutivo_inicial: int = Form(1), fm_siguiente: int = Form(1),
                icono: str = Form("💵")):
    _solo_admin(user)
    caja = db.get(CajaMenor, caja_id)
    if caja:
        # El nombre es único: si ya lo usa otra caja se avisa (antes daba error 500).
        if db.query(CajaMenor).filter(CajaMenor.nombre == _texto(nombre), CajaMenor.id != caja.id).first():
            return RedirectResponse(f"/caja-menor/parametros?msg=Ya existe otra caja con ese nombre.&tab=caja{caja_id}-datos",
                                    status_code=303)
        caja.nombre, caja.prefijo, caja.ciudad = _texto(nombre), _texto(prefijo)[:10], _texto(ciudad)
        caja.fondo, caja.icono = fondo, (icono or "💵")[:4]
        if responsable.isdigit():  # la lista envía el id de la persona (con acceso a la caja o administrador)
            persona = db.get(Empleado, int(responsable))
            choque = persona and _conflicto(db, persona.id, {caja.id}, "acceso")
            if choque:
                db.rollback()
                return RedirectResponse(f"/caja-menor/parametros?msg={choque}", status_code=303)
            if persona:
                caja.responsable_id, caja.responsable = persona.id, persona.nombre_completo.strip().upper()
        elif responsable == "":
            caja.responsable_id, caja.responsable = None, ""
        # "__actual__": se conserva el que ya tenía
        caja.consecutivo_inicial = max(consecutivo_inicial, 1)
        # El siguiente FM nunca puede quedar por debajo de uno ya usado
        maximo = max([f.numero for f in db.query(CajaFM).filter(CajaFM.caja_id == caja.id)] or [0])
        caja.fm_siguiente = max(fm_siguiente, maximo + 1)
        db.commit()
    return RedirectResponse(f"/caja-menor/parametros?msg=Caja actualizada.&tab=caja{caja_id}-datos", status_code=303)


@router.post("/caja-menor/parametros/cajas/{caja_id}/toggle")
def toggle_caja(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    caja = db.get(CajaMenor, caja_id)
    if caja:
        caja.activo = 0 if caja.activo else 1
        db.commit()
    return RedirectResponse("/caja-menor/parametros", status_code=303)


def _conflicto(db: Session, empleado_id: int, cajas: set[int], como: str) -> str | None:
    """Una persona no puede operar (Accesos / responsable) y firmar (Autorizan / Supervisan) la misma caja.
    Los administradores sí pueden tener ambos papeles (en cada documento sigue sin poder firmar lo propio)."""
    if not cajas:
        return None
    empleado = db.get(Empleado, empleado_id)
    if empleado and sc.es_admin(empleado):
        return None
    quien = nombre_propio(empleado.nombre_completo) if empleado else "Esa persona"
    nombres = {c.id: nombre_propio(c.nombre) for c in db.query(CajaMenor).filter(CajaMenor.id.in_(cajas))}
    if como == "acceso":
        firma = {a.caja_id for a in db.query(CajaAutorizador).filter(CajaAutorizador.empleado_id == empleado_id)}
        firma |= {a.caja_id for a in db.query(CajaSupervisor).filter(CajaSupervisor.empleado_id == empleado_id)}
        choque = sorted(nombres[c] for c in cajas & firma)
        if choque:
            return (f"No se guardó: {quien} firma en {', '.join(choque)} (Autorizan / Supervisan). "
                    "Quien firma solo consulta y firma; no puede tener acceso para operar la misma caja.")
    else:
        opera = {a.caja_id for a in db.query(CajaAcceso).filter(CajaAcceso.empleado_id == empleado_id)}
        opera |= {c.id for c in db.query(CajaMenor).filter(CajaMenor.responsable_id == empleado_id)}
        choque = sorted(nombres[c] for c in cajas & opera)
        if choque:
            return (f"No se guardó: {quien} opera {', '.join(choque)} (tiene acceso o es responsable). "
                    "Quien firma no puede operar la misma caja: quítale primero el acceso a esa caja.")
    return None


def _dar_modulo(empleado: Empleado) -> None:
    if MODULO not in empleado.modulos_lista:
        empleado.modulos = ",".join(empleado.modulos_lista + [MODULO])


@router.post("/caja-menor/parametros/accesos/agregar")
async def agregar_acceso(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Da el módulo Caja menor a una persona y le asigna sus cajas, sin pasar por People."""
    _solo_admin(user)
    form = await request.form()
    empleado = db.get(Empleado, int(form.get("empleado_id") or 0))
    if not empleado or not empleado.activo:
        return RedirectResponse("/caja-menor/parametros?msg=Elige una persona de la lista.", status_code=303)
    elegidas = {int(v) for v in form.getlist("cajas")}
    if not elegidas:
        return RedirectResponse("/caja-menor/parametros?msg=Marca al menos una caja para esa persona.", status_code=303)
    choque = _conflicto(db, empleado.id, elegidas, "acceso")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=accesos", status_code=303)
    _dar_modulo(empleado)
    db.query(CajaAcceso).filter(CajaAcceso.empleado_id == empleado.id).delete()
    for caja_id in elegidas:
        db.add(CajaAcceso(caja_id=caja_id, empleado_id=empleado.id))
    db.commit()
    return RedirectResponse(f"/caja-menor/parametros?msg=Acceso dado a {nombre_propio(empleado.nombre_completo)}.", status_code=303)


@router.post("/caja-menor/parametros/accesos/{empleado_id}/quitar")
def quitar_acceso(empleado_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Quita el módulo Caja menor y todas sus cajas a esa persona (los recibos que hizo se conservan)."""
    _solo_admin(user)
    empleado = db.get(Empleado, empleado_id)
    if empleado:
        empleado.modulos = ",".join(m for m in empleado.modulos_lista if m != MODULO)
        db.query(CajaAcceso).filter(CajaAcceso.empleado_id == empleado_id).delete()
        db.commit()
    return RedirectResponse("/caja-menor/parametros?msg=Acceso quitado.", status_code=303)


@router.post("/caja-menor/parametros/accesos/{empleado_id}")
async def guardar_accesos(empleado_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                          db: Session = Depends(get_db)):
    _solo_admin(user)
    form = await request.form()
    elegidas = {int(v) for v in form.getlist("cajas")}
    choque = _conflicto(db, empleado_id, elegidas, "acceso")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=accesos", status_code=303)
    db.query(CajaAcceso).filter(CajaAcceso.empleado_id == empleado_id).delete()
    for caja_id in elegidas:
        db.add(CajaAcceso(caja_id=caja_id, empleado_id=empleado_id))
    db.commit()
    return RedirectResponse("/caja-menor/parametros?msg=Accesos guardados.", status_code=303)


ROLES_CAJA = {"accesos": CajaAcceso, "autorizan": CajaAutorizador, "supervisan": CajaSupervisor}
NOMBRE_ROL = {"accesos": "acceso", "autorizan": "quién autoriza", "supervisan": "quién supervisa"}


@router.post("/caja-menor/parametros/cajas/{caja_id}/personas/{rol}/agregar")
async def agregar_persona_caja(caja_id: int, rol: str, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                               db: Session = Depends(get_db)):
    """Da a una persona un papel en UNA caja: operar (accesos), autorizar recibos o supervisar FM."""
    _solo_admin(user)
    modelo, caja = ROLES_CAJA.get(rol), db.get(CajaMenor, caja_id)
    volver = f"/caja-menor/parametros?tab=caja{caja_id}-{rol}"
    if not modelo or not caja:
        raise HTTPException(404, "No encontrado.")
    form = await request.form()
    empleado = db.get(Empleado, int(form.get("empleado_id") or 0))
    if not empleado or not empleado.activo:
        return RedirectResponse(f"{volver}&msg=Elige una persona de la lista.", status_code=303)
    choque = _conflicto(db, empleado.id, {caja_id}, "acceso" if rol == "accesos" else "firma")
    if choque:
        return RedirectResponse(f"{volver}&msg={choque}", status_code=303)
    if not db.query(modelo).filter(modelo.caja_id == caja_id, modelo.empleado_id == empleado.id).first():
        db.add(modelo(caja_id=caja_id, empleado_id=empleado.id))
    _dar_modulo(empleado)
    db.commit()
    return RedirectResponse(f"{volver}&msg={nombre_propio(empleado.nombre_completo)} agregado en {NOMBRE_ROL[rol]} de "
                            f"{nombre_propio(caja.nombre)}.", status_code=303)


@router.post("/caja-menor/parametros/cajas/{caja_id}/personas/{rol}/{empleado_id}/quitar")
def quitar_persona_caja(caja_id: int, rol: str, empleado_id: int, user: Empleado = Depends(require_modulo(MODULO)),
                        db: Session = Depends(get_db)):
    _solo_admin(user)
    modelo, caja = ROLES_CAJA.get(rol), db.get(CajaMenor, caja_id)
    volver = f"/caja-menor/parametros?tab=caja{caja_id}-{rol}"
    if not modelo or not caja:
        raise HTTPException(404, "No encontrado.")
    if rol == "accesos" and caja.responsable_id == empleado_id:
        return RedirectResponse(f"{volver}&msg=Es el responsable de la caja: elige primero otro responsable en la pestaña Datos.",
                                status_code=303)
    db.query(modelo).filter(modelo.caja_id == caja_id, modelo.empleado_id == empleado_id).delete()
    db.commit()
    _quitar_modulo_si_no_usa(db, empleado_id)
    return RedirectResponse(f"{volver}&msg=Quitado. Los documentos que ya registró o firmó se conservan.", status_code=303)


def _guardar_autorizaciones(db: Session, empleado_id: int, cajas: set[int]) -> None:
    db.query(CajaAutorizador).filter(CajaAutorizador.empleado_id == empleado_id).delete()
    for caja_id in cajas:
        db.add(CajaAutorizador(caja_id=caja_id, empleado_id=empleado_id))
    db.commit()


@router.post("/caja-menor/parametros/autorizadores/agregar")
async def agregar_autorizador(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Agrega a alguien de People como autorizador ("Aprobado por") de los recibos de las cajas marcadas."""
    _solo_admin(user)
    form = await request.form()
    empleado = db.get(Empleado, int(form.get("empleado_id") or 0))
    if not empleado or not empleado.activo:
        return RedirectResponse("/caja-menor/parametros?msg=Elige una persona de la lista.&tab=autorizan", status_code=303)
    elegidas = {int(v) for v in form.getlist("cajas")}
    if not elegidas:
        return RedirectResponse("/caja-menor/parametros?msg=Marca al menos una caja que autorice esa persona.&tab=autorizan",
                                status_code=303)
    choque = _conflicto(db, empleado.id, elegidas, "firma")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=autorizan", status_code=303)
    _dar_modulo(empleado)
    _guardar_autorizaciones(db, empleado.id, elegidas)
    return RedirectResponse(f"/caja-menor/parametros?msg={nombre_propio(empleado.nombre_completo)} ya puede autorizar recibos.&tab=autorizan",
                            status_code=303)


@router.post("/caja-menor/parametros/autorizadores/{empleado_id}/quitar")
def quitar_autorizador(empleado_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    _guardar_autorizaciones(db, empleado_id, set())
    _quitar_modulo_si_no_usa(db, empleado_id)
    return RedirectResponse("/caja-menor/parametros?msg=Ya no autoriza recibos (los recibos que firmó conservan su nombre).&tab=autorizan",
                            status_code=303)


@router.post("/caja-menor/parametros/autorizadores/{empleado_id}")
async def guardar_autorizador(empleado_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                              db: Session = Depends(get_db)):
    _solo_admin(user)
    form = await request.form()
    elegidas = {int(v) for v in form.getlist("cajas")}
    choque = _conflicto(db, empleado_id, elegidas, "firma")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=autorizan", status_code=303)
    _guardar_autorizaciones(db, empleado_id, elegidas)
    return RedirectResponse("/caja-menor/parametros?msg=Autorizaciones guardadas.&tab=autorizan", status_code=303)


def _quitar_modulo_si_no_usa(db: Session, empleado_id: int) -> None:
    """Retira el módulo a quien ya no tiene acceso a cajas, ni autoriza, ni supervisa."""
    empleado = db.get(Empleado, empleado_id)
    if not empleado:
        return
    for modelo in (CajaAcceso, CajaAutorizador, CajaSupervisor):
        if db.query(modelo).filter(modelo.empleado_id == empleado_id).first():
            return
    empleado.modulos = ",".join(m for m in empleado.modulos_lista if m != MODULO)
    db.commit()


def _guardar_supervisiones(db: Session, empleado_id: int, cajas: set[int]) -> None:
    db.query(CajaSupervisor).filter(CajaSupervisor.empleado_id == empleado_id).delete()
    for caja_id in cajas:
        db.add(CajaSupervisor(caja_id=caja_id, empleado_id=empleado_id))
    db.commit()


@router.post("/caja-menor/parametros/supervisores/agregar")
async def agregar_supervisor(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    """Agrega a alguien de People como supervisor ("Supervisado por") de los FM de las cajas marcadas."""
    _solo_admin(user)
    form = await request.form()
    empleado = db.get(Empleado, int(form.get("empleado_id") or 0))
    if not empleado or not empleado.activo:
        return RedirectResponse("/caja-menor/parametros?msg=Elige una persona de la lista.&tab=supervisan", status_code=303)
    elegidas = {int(v) for v in form.getlist("cajas")}
    if not elegidas:
        return RedirectResponse("/caja-menor/parametros?msg=Marca al menos una caja que supervise esa persona.&tab=supervisan",
                                status_code=303)
    choque = _conflicto(db, empleado.id, elegidas, "firma")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=supervisan", status_code=303)
    _dar_modulo(empleado)
    _guardar_supervisiones(db, empleado.id, elegidas)
    return RedirectResponse(f"/caja-menor/parametros?msg={nombre_propio(empleado.nombre_completo)} ya puede supervisar los FM.&tab=supervisan",
                            status_code=303)


@router.post("/caja-menor/parametros/supervisores/{empleado_id}/quitar")
def quitar_supervisor(empleado_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    _guardar_supervisiones(db, empleado_id, set())
    _quitar_modulo_si_no_usa(db, empleado_id)
    return RedirectResponse("/caja-menor/parametros?msg=Ya no supervisa FMs (los FM que firmó conservan su nombre).&tab=supervisan",
                            status_code=303)


@router.post("/caja-menor/parametros/supervisores/{empleado_id}")
async def guardar_supervisor(empleado_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                             db: Session = Depends(get_db)):
    _solo_admin(user)
    form = await request.form()
    elegidas = {int(v) for v in form.getlist("cajas")}
    choque = _conflicto(db, empleado_id, elegidas, "firma")
    if choque:
        return RedirectResponse(f"/caja-menor/parametros?msg={choque}&tab=supervisan", status_code=303)
    _guardar_supervisiones(db, empleado_id, elegidas)
    return RedirectResponse("/caja-menor/parametros?msg=Supervisiones guardadas.&tab=supervisan", status_code=303)


# Los recordatorios de firmas pendientes ya no se mandan uno por documento: van en el mensaje único cada 2 horas
# (app/routers/recordatorio_firmas.py), junto con lo pendiente de Producción.


ARCHIVO_INICIAL = Path(__file__).resolve().parent.parent / "seed_data" / "caja_menor_inicial.xlsx"


@router.on_event("startup")
def cargar_datos_iniciales() -> None:
    """Al arrancar: crea las tablas del módulo, agrega columnas nuevas a las que ya existían y carga una sola vez
    los recibos, FMs y arqueos de la app anterior (seed_data/caja_menor_inicial.xlsx), si ese archivo existe."""
    from sqlalchemy import inspect, text
    from ..database import engine  # este evento corre antes del create_all general: crea aquí sus tablas
    # Sus tablas apuntan a empleados: en una base nueva (vacía) hay que crearla antes, si no el arranque fallaba.
    # En una base existente no hace nada (checkfirst).
    Empleado.__table__.create(bind=engine, checkfirst=True)
    for modelo in (CajaMenor, CajaAcceso, CajaAutorizador, CajaSupervisor, CajaFM, CajaRecibo, CajaArqueo, CajaObservacion,
                   CajaAdjunto):
        try:
            modelo.__table__.create(bind=engine, checkfirst=True)
        except Exception as e:  # otro proceso la acaba de crear al mismo tiempo
            print(f"Caja menor: tabla {modelo.__tablename__} ya creada ({type(e).__name__}).")
    columnas = {c["name"] for c in inspect(engine).get_columns("caja_menor_recibos")}
    nuevas = {"autorizado_por": "VARCHAR(150) DEFAULT ''",
              "autorizado_por_id": "INTEGER REFERENCES empleados(id)",
              "firma_email": "VARCHAR(150)", "firmado_en": "TIMESTAMP"}
    columnas_fm = {c["name"] for c in inspect(engine).get_columns("caja_menor_fms")}
    nuevas_fm = {"supervisado_por": "VARCHAR(150) DEFAULT ''", "supervisado_por_id": "INTEGER REFERENCES empleados(id)",
                 "supervision_email": "VARCHAR(150)", "supervisado_en": "TIMESTAMP",
                 "elaborado_por_id": "INTEGER REFERENCES empleados(id)", "elaboracion_email": "VARCHAR(150)",
                 "elaborado_en": "TIMESTAMP", "reembolsado_en": "TIMESTAMP",
                 "reembolsado_por_id": "INTEGER REFERENCES empleados(id)", "aviso_ok": "INTEGER", "aviso_en": "TIMESTAMP"}
    nuevas.update({"aviso_ok": "INTEGER", "aviso_en": "TIMESTAMP",
                   "recibido_por_id": "INTEGER REFERENCES empleados(id)", "recibido_email": "VARCHAR(150)",
                   "recibido_en": "TIMESTAMP", "recibido_aviso_ok": "INTEGER", "recibido_aviso_en": "TIMESTAMP",
                   "recibido_via": "VARCHAR(20)"})
    columnas_cajas = {c["name"] for c in inspect(engine).get_columns("caja_menor_cajas")}
    with engine.begin() as conn:
        for nombre, tipo in nuevas.items():
            if nombre not in columnas:
                conn.execute(text(f"ALTER TABLE caja_menor_recibos ADD COLUMN {nombre} {tipo}"))
        for nombre, tipo in nuevas_fm.items():
            if nombre not in columnas_fm:
                conn.execute(text(f"ALTER TABLE caja_menor_fms ADD COLUMN {nombre} {tipo}"))
        if "responsable_id" not in columnas_cajas:
            conn.execute(text("ALTER TABLE caja_menor_cajas ADD COLUMN responsable_id INTEGER REFERENCES empleados(id)"))
    # Responsable guardado antes solo como nombre: se enlaza con la persona de People
    db = SessionLocal()
    try:
        for caja in db.query(CajaMenor).filter(CajaMenor.responsable_id.is_(None), CajaMenor.responsable != "").all():
            persona = sc.responsable_de_caja(db, caja)
            if persona:
                caja.responsable_id = persona.id
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Caja menor: no se pudo enlazar el responsable de las cajas: {e}")
    finally:
        db.close()
    if not ARCHIVO_INICIAL.exists():
        return
    db = SessionLocal()
    try:
        sc.asegurar_cajas_iniciales(db)
        if db.query(CajaRecibo).count() == 0:
            r = sc.importar_hoja_google(db, ARCHIVO_INICIAL.read_bytes(), None)
            print(f"Caja menor: datos iniciales cargados ({r['recibos']} recibos, {r['fms']} FMs, {r['arqueos']} arqueos).")
    except Exception as e:
        db.rollback()
        print(f"Caja menor: no se pudieron cargar los datos iniciales: {e}")
    finally:
        db.close()
