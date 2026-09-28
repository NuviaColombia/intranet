"""Caja menor Nuvia: páginas, API y parámetros. Todos los endpoints son síncronos (FastAPI los ejecuta en
un hilo aparte), para que una consulta no detenga el resto de la intranet."""
import csv
import io
from pathlib import Path
from datetime import date
from fastapi import APIRouter, Request, Depends, HTTPException, Form, BackgroundTasks
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..formato import nombre_propio
from ..database import SessionLocal, get_db
from ..models import Empleado
from ..models_caja import CajaMenor, CajaAcceso, CajaAutorizador, CajaRecibo, CajaFM, CajaArqueo
from ..auth import require_modulo, get_current_user
from ..main_templates import templates
from .. import services_caja as sc

router = APIRouter()
MODULO = "caja_menor"


def _caja(db: Session, user: Empleado, caja_id: int) -> CajaMenor:
    caja = db.get(CajaMenor, caja_id)
    if not caja or (not caja.activo and not sc.es_admin(user)):
        raise HTTPException(404, "Caja no encontrada.")
    if not sc.puede_usar_caja(db, user, caja):
        raise HTTPException(403, "No tienes acceso a esta caja.")
    return caja


def _solo_admin(user: Empleado):
    if not sc.es_admin(user):
        raise HTTPException(403, "Requiere rol de administrador.")


# ---------------- Páginas ----------------

@router.get("/caja-menor")
def entrada(request: Request, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    sc.asegurar_cajas_iniciales(db)
    cajas = sc.cajas_de_usuario(db, user)
    por_firmar = db.query(CajaRecibo).filter(CajaRecibo.autorizado_por_id == user.id, CajaRecibo.firmado_en.is_(None),
                                             CajaRecibo.estado != "ANULADO").count()
    es_autorizador = db.query(CajaAutorizador).filter(CajaAutorizador.empleado_id == user.id).first() is not None
    return templates.TemplateResponse(request, "caja_menor_entrada.html",
                                      {"user": user, "es_portal": True, "es_caja_entrada": True, "cajas": cajas,
                                       "por_firmar": por_firmar, "es_autorizador": es_autorizador or por_firmar > 0})


@router.get("/caja-menor/firmas")
def pagina_firmas(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    pendientes, firmados = sc.recibos_por_firmar(db, user)
    return templates.TemplateResponse(request, "caja_menor_firmas.html", {
        "user": user, "es_portal": True, "es_caja_entrada": True,
        "pendientes": [sc.serializar_recibo(r) for r in pendientes],
        "firmados": [sc.serializar_recibo(r) for r in firmados], "msg": request.query_params.get("msg")})


@router.post("/caja-menor/firmas/{recibo_id}")
def firmar(recibo_id: int, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    r = db.get(CajaRecibo, recibo_id)
    if not r:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.firmar_recibo(db, r, user)
    msg = error or f"✅ Firmaste el recibo {r.caja.prefijo}-{r.consecutivo:04d}."
    return RedirectResponse(f"/caja-menor/firmas?msg={msg}", status_code=303)


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
    usuarios = [e for e in activos if MODULO in e.modulos_lista and not sc.es_admin(e)]
    candidatos = [e for e in activos if MODULO not in e.modulos_lista and not sc.es_admin(e)]
    # Responsable de cada caja: se elige entre quienes tienen acceso a ella
    con_acceso = {c.id: [e for e in usuarios if c.id in por_empleado.get(e.id, set())] for c in cajas}
    autoriza_por_empleado: dict[int, set[int]] = {}
    for a in db.query(CajaAutorizador).all():
        autoriza_por_empleado.setdefault(a.empleado_id, set()).add(a.caja_id)
    autorizadores = [e for e in activos if e.id in autoriza_por_empleado]
    return templates.TemplateResponse(request, "caja_menor_parametros.html", {
        "user": user, "es_caja": True, "caja": None, "cajas": cajas, "usuarios": usuarios, "candidatos": candidatos, "con_acceso": con_acceso,
        "autorizadores": autorizadores, "autoriza_por_empleado": autoriza_por_empleado, "activos": activos,
        "tab": request.query_params.get("tab", ""),
        "por_empleado": por_empleado, "msg": request.query_params.get("msg")})


@router.get("/caja-menor/{caja_id}")
def pagina_caja(caja_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    return templates.TemplateResponse(request, "caja_menor.html", {
        "user": user, "es_caja": True, "caja": caja, "autorizadores": sc.autorizadores_de_caja(db, caja),
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


class MotivoIn(BaseModel):
    motivo: str = ""


@router.get("/caja-menor/api/{caja_id}/resumen")
def api_resumen(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    return {"siguienteRecibo": sc.siguiente_consecutivo(db, caja), "siguienteFM": caja.fm_siguiente,
            "siguienteArqueo": sc.siguiente_arqueo(db, caja), "pendiente": sc.total_pendiente(db, caja),
            "fondo": caja.fondo, "responsable": caja.responsable, "ciudad": caja.ciudad, "prefijo": caja.prefijo}


@router.get("/caja-menor/api/{caja_id}/recibos")
def api_recibos(caja_id: int, estado: str = "", desde: str = "", hasta: str = "",
                user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    recibos = sc.recibos_de_caja(db, caja, estado.upper(), date.fromisoformat(desde) if desde else None,
                                 date.fromisoformat(hasta) if hasta else None)
    return {"data": [sc.serializar_recibo(r) for r in recibos], "truncado": len(recibos) >= 2000}


@router.get("/caja-menor/api/{caja_id}/recibos/{consecutivo}")
def api_recibo(caja_id: int, consecutivo: int, user: Empleado = Depends(require_modulo(MODULO)),
               db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = db.query(CajaRecibo).filter(CajaRecibo.caja_id == caja.id, CajaRecibo.consecutivo == consecutivo).first()
    if not r:
        raise HTTPException(404, f"No existe el recibo {caja.prefijo}-{consecutivo:04d}.")
    return sc.serializar_recibo(r)


@router.post("/caja-menor/api/{caja_id}/recibos")
def api_crear_recibo(caja_id: int, payload: ReciboIn, tareas: BackgroundTasks, user: Empleado = Depends(require_modulo(MODULO)),
                     db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = sc.crear_recibo(db, caja, user, payload.model_dump())
    if isinstance(r, str):
        raise HTTPException(400, r)
    if sc.necesita_aviso_firma(r):
        tareas.add_task(sc.notificar_firma_pendiente, r.id)
    return {"mensaje": f"✅ Recibo {caja.prefijo}-{r.consecutivo:04d} guardado.", "recibo": sc.serializar_recibo(r)}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/editar")
def api_editar_recibo(caja_id: int, recibo_id: int, payload: ReciboIn, tareas: BackgroundTasks,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.editar_recibo(db, r, user, payload.model_dump())
    if error:
        raise HTTPException(400, error)
    if sc.necesita_aviso_firma(r):  # tras editar, quien autoriza debe firmar de nuevo
        tareas.add_task(sc.notificar_firma_pendiente, r.id)
    return {"mensaje": "✅ Recibo actualizado.", "recibo": sc.serializar_recibo(r)}


@router.post("/caja-menor/api/{caja_id}/recibos/{recibo_id}/anular")
def api_anular_recibo(caja_id: int, recibo_id: int, payload: MotivoIn,
                      user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    r = db.get(CajaRecibo, recibo_id)
    if not r or r.caja_id != caja.id:
        raise HTTPException(404, "Recibo no encontrado.")
    error = sc.anular_recibo(db, r, user, payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ Recibo {caja.prefijo}-{r.consecutivo:04d} anulado.", "recibo": sc.serializar_recibo(r)}


@router.get("/caja-menor/api/{caja_id}/exportar")
def api_exportar(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
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


@router.post("/caja-menor/api/{caja_id}/legalizar")
def api_legalizar(caja_id: int, payload: LegalizarIn, user: Empleado = Depends(require_modulo(MODULO)),
                  db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    fm = sc.legalizar(db, caja, user, payload.recibos, payload.responsable, payload.desglose, payload.ajuste)
    if isinstance(fm, str):
        raise HTTPException(400, fm)
    return {"mensaje": f"✅ Se legalizó el FM{fm.numero}.", "fm": sc.serializar_fm(fm, con_recibos=True)}


@router.get("/caja-menor/api/{caja_id}/fms")
def api_fms(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    fms = db.query(CajaFM).filter(CajaFM.caja_id == caja.id).order_by(CajaFM.numero.desc()).all()
    return {"data": [sc.serializar_fm(f) for f in fms]}


@router.get("/caja-menor/api/{caja_id}/fms/{fm_id}")
def api_fm(caja_id: int, fm_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    return sc.serializar_fm(fm, con_recibos=True)


@router.post("/caja-menor/api/{caja_id}/fms/{fm_id}/anular")
def api_anular_fm(caja_id: int, fm_id: int, payload: MotivoIn, user: Empleado = Depends(require_modulo(MODULO)),
                  db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    fm = db.get(CajaFM, fm_id)
    if not fm or fm.caja_id != caja.id:
        raise HTTPException(404, "FM no encontrado.")
    error = sc.anular_fm(db, fm, user, payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ FM{fm.numero} anulado. Sus recibos volvieron a ACTIVO."}


# ---------------- API: arqueo rápido ----------------

class ArqueoIn(BaseModel):
    responsable: str = ""
    desglose: dict = {}


@router.get("/caja-menor/api/{caja_id}/arqueos")
def api_arqueos(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    arqueos = (db.query(CajaArqueo).filter(CajaArqueo.caja_id == caja.id)
               .order_by(CajaArqueo.consecutivo.desc()).limit(2000).all())
    return {"data": [sc.serializar_arqueo(a) for a in arqueos]}


@router.post("/caja-menor/api/{caja_id}/arqueos")
def api_crear_arqueo(caja_id: int, payload: ArqueoIn, user: Empleado = Depends(require_modulo(MODULO)),
                     db: Session = Depends(get_db)):
    caja = _caja(db, user, caja_id)
    a = sc.crear_arqueo(db, caja, user, payload.responsable, payload.desglose)
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
        caja.nombre, caja.prefijo, caja.ciudad = _texto(nombre), _texto(prefijo)[:10], _texto(ciudad)
        caja.fondo, caja.responsable, caja.icono = fondo, _texto(responsable), (icono or "💵")[:4]
        caja.consecutivo_inicial = max(consecutivo_inicial, 1)
        # El siguiente FM nunca puede quedar por debajo de uno ya usado
        maximo = max([f.numero for f in db.query(CajaFM).filter(CajaFM.caja_id == caja.id)] or [0])
        caja.fm_siguiente = max(fm_siguiente, maximo + 1)
        db.commit()
    return RedirectResponse("/caja-menor/parametros?msg=Caja actualizada.", status_code=303)


@router.post("/caja-menor/parametros/cajas/{caja_id}/toggle")
def toggle_caja(caja_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    caja = db.get(CajaMenor, caja_id)
    if caja:
        caja.activo = 0 if caja.activo else 1
        db.commit()
    return RedirectResponse("/caja-menor/parametros", status_code=303)


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
    db.query(CajaAcceso).filter(CajaAcceso.empleado_id == empleado_id).delete()
    for caja_id in elegidas:
        db.add(CajaAcceso(caja_id=caja_id, empleado_id=empleado_id))
    db.commit()
    return RedirectResponse("/caja-menor/parametros?msg=Accesos guardados.", status_code=303)


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
    _guardar_autorizaciones(db, empleado.id, elegidas)
    return RedirectResponse(f"/caja-menor/parametros?msg={nombre_propio(empleado.nombre_completo)} ya puede autorizar recibos.&tab=autorizan",
                            status_code=303)


@router.post("/caja-menor/parametros/autorizadores/{empleado_id}/quitar")
def quitar_autorizador(empleado_id: int, user: Empleado = Depends(require_modulo(MODULO)), db: Session = Depends(get_db)):
    _solo_admin(user)
    _guardar_autorizaciones(db, empleado_id, set())
    return RedirectResponse("/caja-menor/parametros?msg=Ya no autoriza recibos (los recibos que firmó conservan su nombre).&tab=autorizan",
                            status_code=303)


@router.post("/caja-menor/parametros/autorizadores/{empleado_id}")
async def guardar_autorizador(empleado_id: int, request: Request, user: Empleado = Depends(require_modulo(MODULO)),
                              db: Session = Depends(get_db)):
    _solo_admin(user)
    form = await request.form()
    _guardar_autorizaciones(db, empleado_id, {int(v) for v in form.getlist("cajas")})
    return RedirectResponse("/caja-menor/parametros?msg=Autorizaciones guardadas.&tab=autorizan", status_code=303)


ARCHIVO_INICIAL = Path(__file__).resolve().parent.parent / "seed_data" / "caja_menor_inicial.xlsx"


@router.on_event("startup")
def cargar_datos_iniciales() -> None:
    """Al arrancar: crea las tablas del módulo, agrega columnas nuevas a las que ya existían y carga una sola vez
    los recibos, FMs y arqueos de la app anterior (seed_data/caja_menor_inicial.xlsx), si ese archivo existe."""
    from sqlalchemy import inspect, text
    from ..database import engine  # este evento corre antes del create_all general: crea aquí sus tablas
    for modelo in (CajaMenor, CajaAcceso, CajaAutorizador, CajaFM, CajaRecibo, CajaArqueo):
        modelo.__table__.create(bind=engine, checkfirst=True)
    columnas = {c["name"] for c in inspect(engine).get_columns("caja_menor_recibos")}
    nuevas = {"autorizado_por": "VARCHAR(150) DEFAULT ''",
              "autorizado_por_id": "INTEGER REFERENCES empleados(id)",
              "firma_email": "VARCHAR(150)", "firmado_en": "TIMESTAMP"}
    with engine.begin() as conn:
        for nombre, tipo in nuevas.items():
            if nombre not in columnas:
                conn.execute(text(f"ALTER TABLE caja_menor_recibos ADD COLUMN {nombre} {tipo}"))
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
