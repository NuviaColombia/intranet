"""Rutas del módulo Design Schedule: horario del equipo de diseño y su administración."""
import json
from urllib.parse import quote
import logging
import os
import re
from datetime import date, datetime
from typing import Literal
from fastapi import APIRouter, Request, Depends, Form, HTTPException, Query, UploadFile, File
from ..concurrencia import clase_con_cupo
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import EMPRESA_DESIGN, Empleado
from ..models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo, DesignOrden,
                             DesignPerfSheet, DesignPerfEmpleado, DesignPerfSeleccionFila, FORMATO_SUPPORT)
from ..auth import get_current_user
from ..main_templates import templates
from .. import services_design_ayuda as say
from .. import services_design_permisos as sperm
from .. import services_design_push as spush
from .. import services_design as sd
from .. import services_design_accesos as sacc  # también activa el acceso automático de los equipos
from .. import services_design_planificacion as spl
from .. import services_design_aprobacion as sap   # también registra la hora de aprobación y de QC de cada orden
from .. import services_design_support as ss
from .. import services_design_cliq as sc
from .. import services_design_qc as sq
from .. import services_design_produccion as sprod  # Seguimiento › N3/N2 Producción
from .. import services_design_pa_excel as spx
from .. import services_design_openings_historial as soh  # historial de Openings (también instala el registro)
from .. import services_design_protocolos_edicion as spe  # Protocols: editar en Nuvia Office y publicar  # Pre-Approved N3 desde el Excel (12-oct-2026)
from .. import services_design_origenes as so  # ⚠️ Openings / Equipos = origen de datos de Design: validar con Rosember


# ---------- Simulación (solo Design): un admin ve y usa Design como otra persona ----------
# El admin elige a alguien en /design/simulacion y, mientras dure, TODAS las rutas de Design lo tratan como esa
# persona (lo que ve y lo que guarda queda a su nombre). Cada cambio hecho simulando queda en el log del servidor
# con el admin real. Fuera de Design la intranet sigue igual: el inicio de sesión no cambia.
from ..auth import SIM_KEY, puede_simular_a  # la misma simulación vale en toda la intranet (fuera de Design, solo lectura)
_log_sim = logging.getLogger("design.simulacion")


ROLES_DESIGN = ("empleado", "aprobador", "admin")


def _aplicar_rol_design(db: Session, e: Empleado | None) -> Empleado | None:
    """Rol solo de Design: si la persona tiene uno, reemplaza su rol de People en esta petición (en memoria, sin
    guardarlo: set_committed_value no marca cambios). Un superadmin de People siempre es superadmin."""
    if e is None or e.rol == "superadmin" or getattr(e, "_rol_design_ok", False):
        return e
    from sqlalchemy.orm.attributes import set_committed_value
    from ..models_design import DesignRolUsuario
    r = db.get(DesignRolUsuario, e.id)
    if r and r.rol in ROLES_DESIGN and r.rol != e.rol:
        e._rol_people = e.rol
        set_committed_value(e, "rol", r.rol)
    e._rol_design_ok = True
    return e


def _usuario_efectivo(request: Request, user: Empleado, db: Session) -> Empleado:
    user = _aplicar_rol_design(db, user)
    sid = request.session.get(SIM_KEY)
    if not sid:
        return user
    otro = db.get(Empleado, sid)
    # Misma regla que en el resto de la intranet (auth.puede_simular_a): un admin no simula a un superadmin ni a otra empresa
    sim = _aplicar_rol_design(db, otro) if user.rol in ("admin", "superadmin") and puede_simular_a(db, user, otro) else None
    if not sim or not sim.activo:
        request.session.pop(SIM_KEY, None)
        return user
    request.state.design_real = user
    if request.method != "GET":
        _log_sim.warning("SIMULACION %s (%s) como %s (%s): %s %s", user.email, user.id, sim.email, sim.id,
                         request.method, request.url.path)
    return sim


def _sin_acceso_simulando(request: Request, sim: Empleado):
    if getattr(request.state, "design_real", None):
        # Simulando a alguien sin Design: se ve la intranet como esa persona (portal), sin entrar en bucle
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})


def require_modulo(modulo: str):
    def checker(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
        u = _usuario_efectivo(request, user, db)
        if not u.tiene_modulo(modulo):
            _sin_acceso_simulando(request, u)
            raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
        return u
    return checker


def require_comments(tab: str):
    """Comments: N3 para N3/N6, N2 / Face Design para N2/Face; Support y admins, las dos."""
    base = require_modulo("design_schedule")

    def checker(user: Empleado = Depends(base), db: Session = Depends(get_db)) -> Empleado:
        if not sd.comments_permitidos(db, user).get(tab):
            raise HTTPException(403, "Estos comentarios son de otra área.")
        return user
    return checker


def require_admin(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
    u = _usuario_efectivo(request, user, db)
    if u.rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de administrador.")
    return u


def require_design_manager(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)) -> Empleado:
    """Dashboard: aprobadores y admins (igual que app.auth.require_design_manager)."""
    u = _usuario_efectivo(request, user, db)
    if not u.tiene_modulo("design_schedule"):
        _sin_acceso_simulando(request, u)
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    if not sd.es_gestor_efectivo(db, u):   # quien está a cargo hoy del equipo cuenta como aprobador (13-oct-2026)
        raise HTTPException(403, "Requiere rol de aprobador o administrador.")
    return u

# Tope de peticiones de Design usando la base a la vez (ver app/concurrencia.py). Se puede ajustar con la
# variable de entorno DESIGN_CONCURRENCIA (debe quedar por debajo del tamaño del pool junto con el resto).
DESIGN_CONCURRENCIA = max(1, int(os.getenv("DESIGN_CONCURRENCIA", "8")))
_RutaDesign = clase_con_cupo(DESIGN_CONCURRENCIA)


router = APIRouter(route_class=_RutaDesign, dependencies=[Depends(soh.marcar_quien)])  # quién: historial de Openings

NUVIA_DESIGN = EMPRESA_DESIGN


# ---------- Páginas ----------

@router.get("/design/simulacion")
def pagina_simulacion(request: Request):
    """Simulación vive ahora en Parámetros (tarjeta Simulación)."""
    msg = request.query_params.get("msg")
    return RedirectResponse("/design/parametros?sim=1" + (f"&msg={msg}" if msg else ""), status_code=303)


@router.post("/design/simulacion/iniciar")
def iniciar_simulacion(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db),
                       empleado_id: int = Form(...)):
    if _aplicar_rol_design(db, user).rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de administrador.")
    p = db.get(Empleado, empleado_id)
    if not p or not p.activo:
        return RedirectResponse("/design/parametros?sim=1&msg=Esa persona no existe o está inactiva.", status_code=303)
    if p.id == user.id:
        request.session.pop(SIM_KEY, None)
        return RedirectResponse("/design", status_code=303)
    if sacc.esta_inhabilitado(db, p.id):
        return RedirectResponse("/design/parametros?sim=1&msg=" + quote(f"{p.nombre_completo} tiene el acceso inhabilitado."), status_code=303)
    if not puede_simular_a(db, user, p):
        motivo = "No puedes simular a un superadmin." if p.rol == "superadmin" else "Solo puedes simular a personas de tu empresa."
        return RedirectResponse("/design/parametros?sim=1&msg=" + quote(motivo), status_code=303)
    request.session[SIM_KEY] = p.id
    _log_sim.warning("SIMULACION inicia %s (%s) como %s (%s)", user.email, user.id, p.email, p.id)
    # Con Design entra a Design; sin Design, al portal: ve la intranet como esa persona (solo lectura fuera de Design)
    return RedirectResponse("/design" if p.tiene_modulo("design_schedule") else "/", status_code=303)


@router.post("/design/simulacion/salir")
def salir_simulacion(request: Request, user: Empleado = Depends(get_current_user), db: Session = Depends(get_db)):
    if request.session.pop(SIM_KEY, None):
        _log_sim.warning("SIMULACION termina %s (%s)", user.email, user.id)
    es_adm = _aplicar_rol_design(db, user).rol in ("admin", "superadmin")
    return RedirectResponse("/design/parametros?sim=1" if es_adm else "/design", status_code=303)


class RolDesignIn(BaseModel):
    empleadoId: int
    rol: Literal["", "empleado", "aprobador", "admin"]


def _motivo_rol(actor_id: int, rp_actor: str | None, empresa_actor: str, obj_id: int, rp_obj: str | None,
                empresa_obj: str) -> str | None:
    """Mismas reglas que People: nadie se cambia a sí mismo; un superadmin no se cambia; un admin solo cambia
    personas de su empresa y no a otros admins. Devuelve el motivo si no se puede (roles de People, no de Design)."""
    if obj_id == actor_id:
        return "No puedes cambiar tu propio rol."
    if rp_obj == "superadmin":
        return "Un superadmin siempre es admin en Design."
    if rp_actor != "superadmin":
        if rp_obj == "admin":
            return "Solo un superadmin puede cambiar el rol de un admin."
        if (empresa_obj or "") != (empresa_actor or ""):
            return "Solo puedes cambiar personas de tu empresa."
    return None


def _rol_people(db: Session, empleado_id: int) -> str | None:
    return db.query(Empleado.rol).filter(Empleado.id == empleado_id).scalar()


@router.post("/design/api/parametros/rol-design")
def api_rol_design(payload: RolDesignIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    from ..models_design import DesignRolUsuario
    obj = db.get(Empleado, payload.empleadoId)
    if not obj or not obj.activo:
        raise HTTPException(404, "Esa persona no existe o está inactiva.")
    rp_actor = _rol_people(db, user.id)
    rol_people = _rol_people(db, obj.id) or "empleado"
    motivo = _motivo_rol(user.id, rp_actor, user.empresa, obj.id, rol_people, obj.empresa)
    if motivo:
        raise HTTPException(403, motivo)
    if payload.rol == "admin" and rp_actor != "superadmin":
        raise HTTPException(403, "Solo un superadmin puede dar el rol admin de Design.")
    r = db.get(DesignRolUsuario, obj.id)
    if not payload.rol or payload.rol == rol_people:
        if r:
            db.delete(r)
    elif r:
        r.rol, r.asignado_por, r.asignado_en = payload.rol, user.nombre_completo, datetime.utcnow()
    else:
        db.add(DesignRolUsuario(empleado_id=obj.id, rol=payload.rol, asignado_por=user.nombre_completo))
    db.commit()
    _log_sim.warning("ROL DESIGN %s (%s) pone a %s (%s): %s", user.email, user.id, obj.email, obj.id, payload.rol or "igual que People")
    efectivo = payload.rol or rol_people
    return {"ok": True, "rolEfectivo": efectivo, "rolDesign": "" if payload.rol in ("", rol_people) else payload.rol,
            "detalle": f"{obj.nombre_completo}: en Design es {efectivo}" + (" (igual que en People)." if efectivo == rol_people else ".")}


# /design/inicio (página principal con editor): rutas en routers/design_inicio.py


@router.get("/design")
def pagina(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                 db: Session = Depends(get_db)):
    sacc.revisar_una_vez(db)   # una sola vez: da el acceso que falte a los que ya están en equipos
    sd.trash_purgar(db)        # Papelera: lo de más de 15 días se borra (una vez al día)
    # Áreas y tipos de ausencia van dentro de la página: son 2 peticiones menos por persona al abrir el horario.
    areas = sd.areas_disponibles(db)
    inicio = {"areas": [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in areas],
              "ausencias": sd.ausencias_disponibles(db),
              "misEquipos": sd.mis_equipos(db, user),  # empleados y aprobadores entran directo a su schedule
              "comments": sd.comments_permitidos(db, user),
              "miPreapproved": sd.preapproved_hoja_de(db, user)}  # Pre-Approved abre la hoja de su equipo
    pr_areas = sd.pr_areas_permitidas(db, user)  # Protocols: su área y la pareja (None = todas)
    inicio["prAreas"] = sorted(pr_areas) if pr_areas is not None else None
    inicio["miEquipo"] = ({"areaId": inicio["misEquipos"][0]["areaId"], "teamId": inicio["misEquipos"][0]["teamId"]}
                          if inicio["misEquipos"] else None)
    # `areas` también llena el filtro de Área del Dashboard (desde que Design es una sola página salía vacío).
    # Un aprobador solo filtra sus equipos (los que maneja): mismas áreas y equipos que el servidor le deja ver.
    dash_teams = None
    if not sd.es_admin(user):
        propios = [t for t in db.query(DesignTeam).filter(DesignTeam.id.in_(sd.equipos_dash_ids(db, user)), DesignTeam.activo == 1).all()]
        dash_teams = [t.id for t in propios]
        areas = [a for a in areas if a.id in {t.area_id for t in propios}]
    # Un aprobador con un solo equipo abre el Dashboard directo con su equipo (área y equipo ya elegidos).
    dash_inicial = {"areaId": propios[0].area_id, "teamId": propios[0].id} if dash_teams and len(dash_teams) == 1 else None
    return templates.TemplateResponse(request, "design_schedule.html",
                                      {"user": user, "es_design": True, "ds_inicio": inicio, "areas": areas,
                                       "dash_teams": dash_teams, "dash_inicial": dash_inicial, "dsv": _version_estaticos(),
                                       "ver_dashboard": sd.es_gestor_efectivo(db, user)})


_dsv_cache: dict = {}


def _version_estaticos() -> str:
    """Marca de versión del código y los estilos del Schedule (static/design): cambia con su contenido, así el
    navegador los guarda en caché y descarga los nuevos apenas se publica una versión."""
    if "v" not in _dsv_cache:
        import hashlib
        from pathlib import Path
        base = Path(__file__).resolve().parent.parent / "static" / "design"
        h = hashlib.md5()
        for n in ("schedule.js", "schedule.css"):
            try:
                h.update((base / n).read_bytes())
            except OSError:
                pass
        _dsv_cache["v"] = h.hexdigest()[:10]
    return _dsv_cache["v"]


def _redirigir_a_panel(request: Request, panel: str) -> RedirectResponse:
    """Las antiguas páginas independientes (Dashboard, Comments, etc.) ahora son paneles
    superpuestos dentro de /design, igual que en la herramienta original. Se conservan estas
    rutas como redirects (por si hay enlaces guardados) que abren el panel correspondiente."""
    qs = request.url.query
    destino = f"/design?panel={panel}" + (f"&{qs}" if qs else "")
    return RedirectResponse(destino, status_code=303)


@router.get("/design/dashboard")
def pagina_dashboard(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "dashboard")


@router.get("/design/comments")
def pagina_comments(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "comments")


@router.get("/design/parametros")
def parametros(request: Request, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    sacc.revisar_una_vez(db)
    if not sd.es_admin(user):
        # Aprobadores: solo la tarjeta Openings (la ven y la editan); el resto de Parámetros es de admins
        return templates.TemplateResponse(request, "design_parametros.html",
                                          {"user": user, "es_design": True, "solo_openings": True, "areas": [], "teams": [],
                                           "msg": request.query_params.get("msg")})
    areas = sd.ordenar_areas(db.query(DesignArea).all())
    teams = (db.query(DesignTeam).order_by(DesignTeam.orden).all())
    candidatos = (db.query(Empleado).filter(Empleado.empresa == NUVIA_DESIGN, Empleado.activo == 1)
                 .order_by(Empleado.apellidos).all())
    inhabilitados = sacc.listar_inhabilitados(db)
    _ids_inh = {i["id"] for i in inhabilitados}
    candidatos = [c for c in candidatos if c.id not in _ids_inh]   # quien ya no está no se ofrece en los desplegables
    ausencias = db.query(DesignAusenciaTipo).order_by(DesignAusenciaTipo.orden).all()
    sd.festivos(db)  # asegura los festivos iniciales
    sd.ordenar_estados_n3_n6_una_vez(db)
    from ..models_design import DesignFestivo
    festivos = db.query(DesignFestivo).order_by(DesignFestivo.fecha).all()
    catalogos = (db.query(DesignCatalogo).order_by(DesignCatalogo.area_id, DesignCatalogo.tipo,
                                                   DesignCatalogo.orden).all())
    return templates.TemplateResponse(request, "design_parametros.html",
                                      {"user": user, "areas": areas, "teams": teams, "candidatos": candidatos, "inhabilitados": inhabilitados,
                                       "permisos_edicion": sperm.listar(db),
                                       "op_managers": [[t.area.nombre, t.manager.nombre_completo] for t in teams if t.activo and t.manager and t.area],
                                       "candidatos_az": sorted(candidatos, key=lambda e: sd._normalizar_texto(e.nombre_completo)),
                                       "con_ordenes": {tid for (tid,) in db.query(DesignOrden.team_id).distinct()},
                                       "ausencias": ausencias, "catalogos": catalogos, "es_design": True,
                                       "festivos": festivos, "hoy": sd.ahora_colombia().date(),
                                       "support_time": ss.estado(db, sd.ahora_colombia().date()),
                                       "cliq": {"configurado": sc.configurado(), "canal": sc.canal_support(), "bot": sc.bot()},
                                       "sim_personas": _personas_simulacion(db, user), "sim_abrir": request.query_params.get("sim") == "1",
                                       "msg": request.query_params.get("msg")})


def _personas_simulacion(db: Session, actor: Empleado) -> list[dict]:
    rp_actor = _rol_people(db, actor.id)
    personas = sd.personas_para_simular(db)
    for p in personas:  # p["rol"] y p["empresa"] ya vienen de la base
        p["motivoRol"] = _motivo_rol(actor.id, rp_actor, actor.empresa, p["id"], p["rol"], p["empresa"])
        p["puedeAdmin"] = rp_actor == "superadmin"
    return personas


# ---------- Parámetros: Openings (distribución de centros) ----------

class OpCeldaIn(BaseModel):
    filaId: int
    clave: str = Field(max_length=60)
    valor: str = Field("", max_length=500)


class OpFilaIn(BaseModel):
    despuesDe: int | None = None


class OpColumnaIn(BaseModel):
    titulo: str = Field("", max_length=150)


class OpHojaIn(BaseModel):
    titulo: str | None = Field(None, max_length=200)
    subtitulo: str | None = Field(None, max_length=200)


class OpMoverIn(BaseModel):
    paso: int


@router.get("/design/api/openings")
def api_openings(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return sd.openings_detalle(db)


OP_COLS_PA = ("centro",) + tuple(so.PA_OPENINGS_COL.values())  # columnas de Openings que ordenan Pre-Approved


@router.post("/design/api/openings/celda")
def api_openings_celda(payload: OpCeldaIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    viejo = None
    if payload.clave == "centro":
        f = db.get(sd._openings_modelos()[2], payload.filaId)
        viejo = json.loads(f.datos or "{}").get("centro", "") if f else None
    if not sd.openings_guardar_celda(db, payload.filaId, payload.clave, payload.valor):
        raise HTTPException(404, "No se encontró la fila o la columna.")
    pa = None
    if payload.clave in OP_COLS_PA:
        if viejo is not None:
            so.renombrar_centro_en_pa(db, viejo, payload.valor)
        pa = so.tras_cambio_openings(db, user.nombre_completo)
    return {"ok": True, "pa": _pa_resumen(pa)}


def _pa_resumen(r: dict | None) -> list[str] | None:
    """Lo que cambió en Pre-Approved por un cambio en Openings (para avisarlo en pantalla)."""
    if not r:
        return None
    return [a for x in r["areas"] for a in x["acciones"]]


@router.get("/design/api/parametros/pa-openings")
def api_pa_openings(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return so.pa_sync_openings(db, aplicar=False)


@router.post("/design/api/parametros/pa-openings/aplicar")
def api_pa_openings_aplicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    hecho = so.pa_sync_openings(db, aplicar=True, por=user.nombre_completo)
    despues = so.pa_sync_openings(db, aplicar=False)
    despues["aplicadas"] = hecho["total"]
    return despues


# Pre-Approved N3 desde el Excel "Pre-Approved changes Design N3 Copy" (services_design_pa_excel): vista previa y aplicar.
@router.get("/design/api/parametros/pa-excel")
def api_pa_excel(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return spx.vista_previa(db)


@router.post("/design/api/parametros/pa-excel/aplicar")
def api_pa_excel_aplicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return spx.aplicar(db, user.nombre_completo)


class PlanMoverIn(BaseModel):
    filaId: int
    clave: str = Field(max_length=40)
    valor: str = Field(default="", max_length=600)


class PlanPublicarIn(BaseModel):
    confirmar: bool = False


@router.get("/design/api/planificacion")
def api_plan_leer(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Borrador de la planificación: {fila: {columna: {antes, nuevo}}}."""
    return {"cambios": spl.leer(db)}


@router.post("/design/api/planificacion/mover")
def api_plan_mover(payload: PlanMoverIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return {"cambios": spl.mover(db, payload.filaId, payload.clave, payload.valor, user.nombre_completo)}
    except KeyError:
        raise HTTPException(404, "No se encontró el centro.")
    except ValueError as ex:
        raise HTTPException(400, str(ex))


@router.post("/design/api/planificacion/descartar")
def api_plan_descartar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return {"cambios": spl.descartar(db, user.nombre_completo)}


@router.post("/design/api/planificacion/publicar")
def api_plan_publicar(payload: PlanPublicarIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Publica el borrador en Openings (solo si la persona confirmó en pantalla)."""
    if not payload.confirmar:
        raise HTTPException(400, "Confirma la publicación para aplicar los cambios.")
    return spl.publicar(db, user.nombre_completo)


@router.get("/design/api/openings/historial")
def api_openings_historial(q: str = Query("", max_length=100), antes_de: int | None = None,
                           user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Historial de cambios de Openings (no se borra): quién cambió qué y cuándo."""
    return soh.listar(db, q, 300, antes_de)


@router.post("/design/api/openings/filas")
def api_openings_agregar_fila(payload: OpFilaIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return sd.openings_agregar_fila(db, payload.despuesDe)


@router.post("/design/api/openings/filas/{fila_id}/eliminar")
def api_openings_eliminar_fila(fila_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    if not sd.openings_eliminar_fila(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No se encontró la fila.")
    return {"ok": True, "pa": _pa_resumen(so.tras_cambio_openings(db, user.nombre_completo))}


@router.post("/design/api/openings/columnas")
def api_openings_agregar_columna(payload: OpColumnaIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return sd.openings_agregar_columna(db, payload.titulo)


@router.post("/design/api/openings/columnas/{col_id}")
def api_openings_renombrar_columna(col_id: int, payload: OpColumnaIn, user: Empleado = Depends(require_design_manager),
                                   db: Session = Depends(get_db)):
    if not sd.openings_renombrar_columna(db, col_id, payload.titulo):
        raise HTTPException(404, "No se encontró la columna o el título está vacío.")
    return {"ok": True}


@router.post("/design/api/openings/columnas/{col_id}/mover")
def api_openings_mover_columna(col_id: int, payload: OpMoverIn, user: Empleado = Depends(require_design_manager),
                               db: Session = Depends(get_db)):
    if not sd.openings_mover_columna(db, col_id, payload.paso):
        raise HTTPException(404, "No se encontró la columna.")
    return {"ok": True}


@router.post("/design/api/openings/columnas/{col_id}/eliminar")
def api_openings_eliminar_columna(col_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    if not sd.openings_eliminar_columna(db, col_id, user.nombre_completo):
        raise HTTPException(404, "No se encontró la columna.")
    return {"ok": True}


@router.post("/design/api/openings/hoja")
def api_openings_hoja(payload: OpHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sd.openings_actualizar_hoja(db, payload.titulo, payload.subtitulo)
    return {"ok": True}


# ---------- Parámetros: importar equipos desde Desempeño ----------

@router.get("/design/api/parametros/importar-equipos-preview")
def api_importar_equipos_preview(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.importar_equipos_desde_desempeno(db, aplicar=False)


@router.get("/design/api/parametros/auditoria-conexiones")
def api_auditoria_conexiones(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Solo lectura: qué hojas de Desempeño, filas de Selección y hojas de Pre-Approved no coinciden con los
    equipos y personas de Parámetros/People."""
    return sd.auditar_conexiones(db)


@router.get("/design/api/parametros/correcciones")
def api_correcciones_vista(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Vista previa de las correcciones de nombres acordadas (no cambia nada)."""
    return sd.correcciones_acordadas(db, aplicar=False)


@router.post("/design/api/parametros/correcciones/aplicar")
def api_correcciones_aplicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.correcciones_acordadas(db, aplicar=True, eliminado_por=user.nombre_completo)


class RenombrarFilaIn(BaseModel):
    hoja: str
    de: str
    empleadoId: int


@router.post("/design/api/parametros/renombrar-fila")
def api_parametros_renombrar_fila_perf(payload: RenombrarFilaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = sd.renombrar_fila_perf(db, payload.hoja, payload.de, payload.empleadoId)
    if not r["ok"]:
        raise HTTPException(404, r["detalle"])
    return r


class FilaHojaIn(BaseModel):
    hoja: str = Field(max_length=150)
    nombre: str = Field(max_length=150)


class HojaIn(BaseModel):
    hoja: str = Field(max_length=150)


class EvaluadorIn(BaseModel):
    filaId: int
    empleadoId: int


class MarcarIn(BaseModel):
    tipo: Literal["historico", "aceptado_general"]
    nombre: str = Field(max_length=150)
    motivo: str = Field("", max_length=300)


class AsociarHojaIn(BaseModel):
    hoja: str = Field(max_length=150)
    areaId: int
    empleadoId: int


class AsociarPaIn(BaseModel):
    sheetId: int
    teamId: int


def _resp(r: dict) -> dict:
    if not r["ok"]:
        raise HTTPException(404, r["detalle"])
    return r


@router.get("/design/api/foto/{empleado_id}")
def api_foto_perfil(empleado_id: int, request: Request, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Foto de perfil de Zoho de un empleado de Design (404 si no hay: se muestran las iniciales)."""
    f = db.get(sd.DesignFotoPerfil, empleado_id)
    if not f or not f.datos:
        raise HTTPException(404, "Sin foto.")
    return sd.respuesta_foto(request, f.datos, f.tipo)


@router.get("/design/api/parametros/fotos")
def api_fotos_estado(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: qué fotos de perfil se guardaron y, si no, por qué (para revisar la conexión con Zoho)."""
    out = []
    for f in db.query(sd.DesignFotoPerfil).order_by(sd.DesignFotoPerfil.actualizado_en.desc()).all():
        e = db.get(Empleado, f.empleado_id)
        out.append({"empleado": e.nombre_completo if e else f.empleado_id, "tieneFoto": bool(f.origen),
                    "origen": f.origen, "error": f.error, "actualizado": f.actualizado_en.isoformat() if f.actualizado_en else ""})
    return out


class IdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=5000)


@router.get("/design/api/parametros/ready-movidas")
def api_ready_movidas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Órdenes en Ready to design de días anteriores que ya se pasaron a mano a un día posterior (mismo número y equipo)."""
    return sd.ready_movidas_a_mano(db)


@router.post("/design/api/parametros/ready-movidas/borrar")
def api_ready_movidas_borrar(payload: IdsIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Borra las elegidas, solo si siguen cumpliendo la regla (Ready to design, día anterior y repetida después)."""
    validas = {x["id"] for x in sd.ready_movidas_a_mano(db)}
    n = 0
    for oid in payload.ids:
        if oid in validas and sd.eliminar_orden(db, oid):
            n += 1
    logging.getLogger("design").info("Ready movidas a mano: %s borró %d órdenes (%s)", user.email, n, payload.ids[:50])
    return {"borradas": n}


@router.get("/design/api/parametros/personas")
def api_parametros_personas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    return sorted(({"id": e.id, "nombre": e.nombre_completo} for e in personas), key=lambda x: sd._normalizar_texto(x["nombre"]))


@router.get("/design/api/parametros/accesos-equipos")
def api_accesos_equipos(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Acceso automático de los equipos: qué hizo la revisión inicial y quién sigue sin acceso."""
    return sacc.estado(db)


@router.post("/design/api/parametros/accesos-equipos/revisar")
def api_accesos_equipos_revisar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Revisa ahora a todos los diseñadores y managers de los equipos activos y da el acceso que falte."""
    res = sacc.revisar(db, user.nombre_completo)
    return {**res, **sacc.estado(db)}


@router.post("/design/api/parametros/quitar-fila")
def api_parametros_quitar_fila(payload: FilaHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.quitar_fila_perf(db, payload.hoja, payload.nombre, user.nombre_completo))


@router.post("/design/api/parametros/agregar-fila")
def api_parametros_agregar_fila(payload: FilaHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.agregar_fila_perf(db, payload.hoja, payload.nombre))


@router.post("/design/api/parametros/mover-al-equipo")
def api_parametros_mover_al_equipo(payload: FilaHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.mover_al_equipo_de_hoja(db, payload.hoja, payload.nombre))


@router.post("/design/api/parametros/crear-equipo-hoja")
def api_parametros_crear_equipo_hoja(payload: HojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.crear_equipo_de_hoja(db, payload.hoja))


@router.post("/design/api/parametros/renombrar-evaluador")
def api_parametros_renombrar_evaluador(payload: EvaluadorIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.renombrar_evaluador(db, payload.filaId, payload.empleadoId))


@router.post("/design/api/parametros/marcar")
def api_parametros_marcar(payload: MarcarIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.marcar_regla_persona(db, payload.tipo, payload.nombre, payload.motivo, user.nombre_completo))


@router.post("/design/api/parametros/asociar-hoja")
def api_parametros_asociar_hoja(payload: AsociarHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.asociar_hoja_manager(db, payload.hoja, payload.areaId, payload.empleadoId, user.nombre_completo))


@router.post("/design/api/parametros/asociar-pa")
def api_parametros_asociar_pa(payload: AsociarPaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return _resp(sd.asociar_pa_equipo(db, payload.sheetId, payload.teamId, user.nombre_completo))


@router.get("/design/api/parametros/reglas")
def api_parametros_reglas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.listar_reglas(db)


@router.post("/design/api/parametros/reglas/{regla_id}/eliminar")
def api_parametros_regla_eliminar(regla_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not sd.eliminar_regla(db, regla_id):
        raise HTTPException(404, "La regla no existe.")
    return {"ok": True}


@router.post("/design/api/parametros/agregar-al-equipo")
def api_parametros_agregar_al_equipo(payload: FilaHojaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = sd.agregar_fila_al_equipo(db, payload.hoja, payload.nombre)
    if not r["ok"]:
        raise HTTPException(404, r["detalle"])
    return r


@router.post("/design/api/parametros/importar-equipos")
def api_importar_equipos_aplicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return sd.importar_equipos_desde_desempeno(db, aplicar=True)


# ---------- Parámetros: equipos ----------

def _param_invalido(msg: str) -> RedirectResponse:
    """Dato de Parámetros que no existe (área, equipo, persona): aviso en la página en vez de error 500."""
    return RedirectResponse(f"/design/parametros?msg={msg}", status_code=303)


@router.post("/design/parametros/equipos")
def crear_equipo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                       area_id: int = Form(...), nombre: str = Form(...), manager_id: str = Form("")):
    if not db.get(DesignArea, area_id):
        return _param_invalido("El área elegida no existe.")
    mid = int(manager_id) if manager_id.strip().isdigit() else None
    if manager_id.strip() and (mid is None or not db.get(Empleado, mid)):
        return _param_invalido("El manager elegido no existe.")
    orden = db.query(DesignTeam).filter(DesignTeam.area_id == area_id).count() + 1
    db.add(DesignTeam(area_id=area_id, nombre=nombre.strip(), orden=orden, manager_id=mid))
    db.commit()
    return RedirectResponse("/design/parametros?msg=Equipo creado.", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/toggle")
def toggle_equipo(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    t = db.get(DesignTeam, team_id)
    msg = ""
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
        if not t.activo and t.manager:  # Equipos → Openings: sus centros quedan sin manager
            cambiados = so.openings_por_cambio_de_equipo(db, t, t.manager, None)
            if cambiados:
                msg = (f"?msg=Equipo {t.nombre} desactivado. Openings: {len(cambiados)} centros quedaron sin manager "
                       f"({', '.join(cambiados)}): asígnalos en Openings.")
    return RedirectResponse("/design/parametros" + msg, status_code=303)


@router.post("/design/parametros/equipos/{team_id}/designers")
def agregar_designer(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                           empleado_id: int = Form(...)):
    if not db.get(DesignTeam, team_id) or not db.get(Empleado, empleado_id):
        return _param_invalido("El equipo o la persona elegida no existe.")
    if sacc.esta_inhabilitado(db, empleado_id):
        return _param_invalido("Esa persona tiene el acceso inhabilitado: reactívala primero en «Inhabilitados».")
    ya_existe = (db.query(DesignTeamDesigner)
                .filter(DesignTeamDesigner.team_id == team_id, DesignTeamDesigner.empleado_id == empleado_id)
                .first())
    if not ya_existe:
        orden = db.query(DesignTeamDesigner).filter(DesignTeamDesigner.team_id == team_id).count() + 1
        db.add(DesignTeamDesigner(team_id=team_id, empleado_id=empleado_id, orden=orden))
        db.commit()
    return RedirectResponse("/design/parametros?msg=Diseñador agregado.", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/editar")
def editar_equipo(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                  nombre: str = Form(...), area_id: int = Form(...), manager_id: str = Form("")):
    t = db.get(DesignTeam, team_id)
    if not t:
        return _param_invalido("El equipo no existe.")
    if not nombre.strip():
        return _param_invalido("El nombre del equipo no puede quedar vacío.")
    if not db.get(DesignArea, area_id):
        return _param_invalido("El área elegida no existe.")
    mid = int(manager_id) if manager_id.strip().isdigit() else None
    if manager_id.strip() and (mid is None or not db.get(Empleado, mid)):
        return _param_invalido("El manager elegido no existe.")
    if area_id != t.area_id:
        # las órdenes del equipo se verían en el schedule de la otra área: solo se cambia si no tiene órdenes
        if db.query(DesignOrden).filter(DesignOrden.team_id == t.id).first():
            return _param_invalido(f"El equipo {t.nombre} ya tiene órdenes: no se puede cambiar de área (se moverían a otro schedule).")
        t.area_id = area_id
        t.orden = db.query(DesignTeam).filter(DesignTeam.area_id == area_id).count() + 1
    anterior = t.manager if t.manager_id != mid else None
    if anterior:  # la hoja de Pre-Approved sigue siendo del equipo aunque cambie el nombre del manager
        so.fijar_hoja_pa_de_equipo(db, t, user.nombre_completo)
    t.nombre = nombre.strip()
    t.manager_id = mid
    db.commit()
    msg = "Equipo actualizado."
    if anterior:  # Equipos → Openings: los centros del manager anterior pasan al nuevo (o quedan sin manager)
        db.refresh(t)
        cambiados = so.openings_por_cambio_de_equipo(db, t, anterior, t.manager)
        if cambiados:
            msg += (f" Openings: {len(cambiados)} centros pasaron a {t.manager.nombre_completo}." if t.manager else
                    f" Openings: {len(cambiados)} centros quedaron sin manager ({', '.join(cambiados)}): asígnalos en Openings.")
            so.tras_cambio_openings(db, user.nombre_completo)
    return RedirectResponse(f"/design/parametros?msg={msg}", status_code=303)


class MoverDesignerIn(BaseModel):
    teamId: int


@router.post("/design/api/parametros/designers/{registro_id}/mover")
def api_mover_designer(registro_id: int, payload: MoverDesignerIn, user: Empleado = Depends(require_admin),
                       db: Session = Depends(get_db)):
    """Arrastrar un diseñador a otro equipo = quitarlo del equipo de origen y agregarlo al de destino.
    Sus órdenes y breaks no cambian (guardan su propio equipo)."""
    r = db.get(DesignTeamDesigner, registro_id)
    destino = db.get(DesignTeam, payload.teamId)
    if not r or not destino:
        raise HTTPException(404, "El diseñador o el equipo no existe.")
    origen = r.team
    if origen.id == destino.id:
        return {"ok": True, "registroId": r.id, "origenId": origen.id, "origen": origen.nombre, "destino": destino.nombre,
                "nombre": r.empleado.nombre_completo}
    ya = (db.query(DesignTeamDesigner)
          .filter(DesignTeamDesigner.team_id == destino.id, DesignTeamDesigner.empleado_id == r.empleado_id).first())
    nombre = r.empleado.nombre_completo
    if ya:
        nuevo = ya
    else:
        orden = db.query(DesignTeamDesigner).filter(DesignTeamDesigner.team_id == destino.id).count() + 1
        nuevo = DesignTeamDesigner(team_id=destino.id, empleado_id=r.empleado_id, orden=orden)
        db.add(nuevo)
    db.delete(r)
    db.commit()
    return {"ok": True, "registroId": nuevo.id, "origenId": origen.id, "origen": origen.nombre, "destino": destino.nombre,
            "nombre": nombre}


class InhabIn(BaseModel):
    motivo: str = ""


@router.get("/design/api/parametros/personas/{empleado_id}/inhabilitar-resumen")
def api_inhab_resumen(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        return sacc.resumen_baja(db, empleado_id)
    except KeyError:
        raise HTTPException(404, "La persona no existe.")


@router.post("/design/api/parametros/personas/{empleado_id}/inhabilitar")
def api_inhabilitar(empleado_id: int, payload: InhabIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        r = sacc.inhabilitar(db, empleado_id, user.nombre_completo, payload.motivo)
    except KeyError:
        raise HTTPException(404, "La persona no existe.")
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"ok": True, "nombre": r["nombre"], "equipos": r["equipos"]}


class PermisoEdicionIn(BaseModel):
    empleadoId: int
    desde: str
    hasta: str
    venceEn: str
    motivo: str = ""


@router.post("/design/api/parametros/permisos-edicion")
def api_permiso_edicion(payload: PermisoEdicionIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Abre a una persona días ya cerrados de su Schedule por un tiempo (Parámetros › Equipos)."""
    try:
        vence = datetime.fromisoformat(payload.venceEn)
        r = sperm.crear(db, payload.empleadoId, _fecha(payload.desde), _fecha(payload.hasta), vence.replace(tzinfo=None),
                        user.nombre_completo, payload.motivo)
    except ValueError as ex:
        raise HTTPException(400, str(ex) if "Invalid isoformat" not in str(ex) else "Revisa las fechas.")
    return r


@router.post("/design/api/parametros/permisos-edicion/{permiso_id}/quitar")
def api_permiso_edicion_quitar(permiso_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not sperm.quitar(db, permiso_id):
        raise HTTPException(404, "Ese permiso ya no está vigente.")
    return {"ok": True}


@router.post("/design/api/parametros/personas/{empleado_id}/reactivar")
def api_reactivar(empleado_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not sacc.reactivar(db, empleado_id, user.nombre_completo):
        raise HTTPException(404, "Esa persona no está inhabilitada.")
    return {"ok": True}


@router.post("/design/parametros/designers/{registro_id}/quitar")
def quitar_designer(registro_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(DesignTeamDesigner, registro_id)
    if r:
        db.delete(r)
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- Parámetros: catálogos ----------

# Tipos de catálogo que usa el schedule de cada área (columnas con desplegable)
CATALOGO_TIPOS = ("centro", "producto", "estado")
CATALOGO_TIPOS_SUPPORT = ("centro", "producto", "etapa", "soporte", "clasificacion")


@router.post("/design/parametros/catalogos")
def crear_valor_catalogo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                               area_id: int = Form(...), tipo: str = Form(...), valor: str = Form(...)):
    area = db.get(DesignArea, area_id)
    if not area:
        return _param_invalido("El área elegida no existe.")
    tipos = CATALOGO_TIPOS_SUPPORT if area.formato == FORMATO_SUPPORT else CATALOGO_TIPOS
    if tipo not in tipos:
        return _param_invalido(f"El tipo elegido no aplica para {area.nombre}.")
    if len(valor.strip()) > 150:
        return _param_invalido("El valor no puede tener más de 150 caracteres.")
    sd.agregar_valor_catalogo(db, area_id, tipo, valor)
    return RedirectResponse("/design/parametros?msg=Valor agregado.", status_code=303)


@router.post("/design/parametros/catalogos/{cat_id}/toggle")
def toggle_catalogo(cat_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    c = db.get(DesignCatalogo, cat_id)
    if c:
        c.activo = 0 if c.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/ausencias")
def crear_ausencia(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                         nombre: str = Form(...)):
    nombre = nombre.strip()
    if len(nombre) > 100:
        return _param_invalido("El nombre no puede tener más de 100 caracteres.")
    existe = db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.nombre == nombre).first()
    if existe and not existe.activo:  # como en Catálogos: si ya existía desactivado, se vuelve a activar
        existe.activo = 1
        db.commit()
    if nombre and not existe:
        orden = db.query(DesignAusenciaTipo).count() + 1
        db.add(DesignAusenciaTipo(nombre=nombre, orden=orden))
        db.commit()
    return RedirectResponse("/design/parametros?msg=Tipo de ausencia agregado.", status_code=303)


@router.post("/design/parametros/ausencias/{aus_id}/toggle")
def toggle_ausencia(aus_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.get(DesignAusenciaTipo, aus_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


# ---------- Parámetros: festivos de la empresa (las órdenes en Hold no pasan a estos días) ----------

@router.post("/design/parametros/festivos")
def crear_festivo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                  fecha: str = Form(...), nombre: str = Form("")):
    from ..models_design import DesignFestivo
    try:
        f = date.fromisoformat(fecha.strip())
    except ValueError:
        return _param_invalido("Fecha inválida.")
    nombre = nombre.strip()[:100]
    sd.festivos(db)
    if f.weekday() >= 5:
        return RedirectResponse(f"/design/parametros?msg=El {f.strftime('%d/%m/%Y')} es fin de semana: ya se salta.", status_code=303)
    x = db.get(DesignFestivo, f)
    if x:
        x.nombre = nombre or x.nombre
    else:
        db.add(DesignFestivo(fecha=f, nombre=nombre, creado_por=user.nombre_completo))
    db.commit()
    sd.festivos_invalidar()
    return RedirectResponse(f"/design/parametros?msg=Festivo agregado: {f.strftime('%d/%m/%Y')}.", status_code=303)


@router.post("/design/parametros/festivos/{fecha}/eliminar")
def eliminar_festivo(fecha: str, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    from ..models_design import DesignFestivo
    try:
        x = db.get(DesignFestivo, date.fromisoformat(fecha))
    except ValueError:
        x = None
    if x:
        db.delete(x)
        db.commit()
        sd.festivos_invalidar()
    return RedirectResponse("/design/parametros?msg=Festivo quitado.", status_code=303)


# ---------- API: lectura ----------

def _verificar_equipo(db: Session, user: Empleado, team_id: int) -> DesignTeam:
    team = db.get(DesignTeam, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado.")
    if not sd.gestiona_equipo(user, team) and team_id not in sd.equipos_como_designer(db, user):
        raise HTTPException(403, "No tienes acceso a este equipo.")
    return team


def _verificar_equipo_ver(db: Session, user: Empleado, team_id: int) -> DesignTeam:
    """Para VER un día: igual que _verificar_equipo, pero el Schedule de Training lo ve todo el mundo."""
    team = db.get(DesignTeam, team_id)
    if team and sd.es_training(team):
        return team
    return _verificar_equipo(db, user, team_id)


SOLO_MANAGER = "Solo el manager del equipo o un administrador puede crear o eliminar órdenes."


@router.get("/design/api/areas")
def api_areas(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return _areas_json(db)


def _areas_json(db: Session) -> list[dict]:
    return [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in sd.areas_disponibles(db)]


@router.get("/design/api/teams")
def api_teams(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    ids_designer = sd.equipos_como_designer(db, user)
    equipos = [t for t in sd.equipos_de_area(db, area_id) if sd.puede_ver_equipo(user, t, ids_designer)]

    def designers(t):
        ds = t.designers if (sd.gestiona_equipo(user, t) or sd.es_training(t)) else [d for d in t.designers if d.empleado_id == user.id]
        return [{"id": d.empleado_id, "nombre": d.empleado.nombre_completo} for d in ds]
    return [{"id": t.id, "nombre": t.nombre, "manager": t.manager.nombre_completo if t.manager else "",
            "designers": designers(t)} for t in equipos]


@router.get("/design/api/catalogo")
def api_catalogo(area_id: int, tipo: str, user: Empleado = Depends(require_modulo("design_schedule")),
                       db: Session = Depends(get_db)):
    return sd.catalogo(db, area_id, tipo)


@router.get("/design/api/catalogos")
def api_catalogos(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    """Todos los catálogos del área en una sola petición ({tipo: [valores]}); antes era una por columna."""
    return sd.catalogos_de_area(db, area_id)


@router.get("/design/api/ausencias")
def api_ausencias(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.ausencias_disponibles(db)


def _fecha(texto: str) -> date:
    try:
        return date.fromisoformat(str(texto)[:10])
    except ValueError:
        raise HTTPException(400, "Fecha inválida.")


@router.get("/design/api/mis-asignaciones")
def api_mis_asignaciones(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Casos de la persona en Ready to design o Hold (número junto a "Design Schedule" en la barra)."""
    return sd.mis_asignaciones(db, user)


@router.get("/design/api/dia")
def api_dia(team_id: int, fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    team = _verificar_equipo_ver(db, user, team_id)
    gest, es_tr = sd.gestiona_equipo(user, team), sd.es_training(team)
    miembro = team.id in sd.equipos_como_designer(db, user)
    dia = sd.datos_dia(db, team, _fecha(fecha), None if (gest or es_tr) else user.id)
    dia["miId"] = user.id
    dia["ayudas"] = say.ayudas_del_equipo(db, team.id, _fecha(fecha))   # diseñadores enviados como ayuda a este equipo hoy
    dia["puedeAyuda"] = say.puede_pedir_en_orden(db, user, team.id, _fecha(fecha))   # «Pedir ayuda…» al final de la lista de Diseñador
    # Permiso para editar días cerrados (Parámetros › Equipos): ese día se abre solo para esta persona
    if dia["cerrado"]:
        hasta = sperm.permiso_para(db, user, _fecha(fecha))
        if hasta:
            dia["cerrado"], dia["permisoEdicionHasta"] = False, hasta.isoformat(timespec="minutes")
    if es_tr and not gest:   # Training: todos ven todos los casos; solo edita la entrenadora, los admins y cada entrenado lo suyo
        dia["soloLectura"] = not miembro
        dia["soloPropias"] = miembro
        dia["soloEditaPropias"] = miembro
    # Diseñador a cargo: el manager lo ve y lo cambia; el que está a cargo ve hasta cuándo.
    dg = sd.delegacion_de(db, team)
    dia["puedeDelegar"] = sd.puede_delegar(user, team) and team.area.formato != sd.FORMATO_SUPPORT
    dia["aCargo"] = dict(dg, esYo=dg["empleadoId"] == user.id) if dg and (dia["puedeDelegar"] or dg["empleadoId"] == user.id) else None
    dia["version"] = sd.version_dia(db, team, _fecha(fecha), user.id, solo_propias=not (gest or es_tr),
                                    extra=_huella_extra(db, user, team, _fecha(fecha)))  # huella para el Schedule en vivo
    dia["puedeQc"] = sd.puede_qc(user, team)  # el QC lo marcan aprobadores, admins y el diseñador a cargo
    dia["creaProducto"] = None if sd.gestiona_equipo(user, team) else sd.producto_que_crea(user, team)  # p. ej. Maxilar Print
    dia["copiasPendientes"] = sd.copias_pendientes_dia(db, team, _fecha(fecha))  # N2: QC desmarcado en Face, esperando decisión
    import time as _t
    col = _colores_equipo(db, team.id)
    dia["colores"] = col[0] if col else None             # colores de diseñadores y centros del equipo (del manager)
    dia["puedeColores"] = bool(gest)
    dia["ahoraMs"] = int(_t.time() * 1000)  # hora del servidor: el descanso se marca con la hora de Colombia, no la del computador
    return dia


def _huella_extra(db: Session, user: Empleado, team: DesignTeam, fecha: date):
    """Lo del día que depende de la persona y no son órdenes: el permiso para editar un día cerrado y las ayudas recibidas."""
    permiso = sperm.permiso_para(db, user, fecha) if sd.dia_cerrado(fecha) else None
    ayudas = tuple(a["id"] for a in say.ayudas_del_equipo(db, team.id, fecha))
    col = _colores_equipo(db, team.id)
    colores = col[1] if col else ""   # cambian los colores del equipo: las pantallas abiertas se repintan solas
    return (permiso.isoformat() if permiso else "", ayudas, colores) if (permiso or ayudas or colores) else None


def _colores_equipo(db: Session, team_id: int):
    """(datos, huella) de los colores de diseñadores y centros del equipo, o None si el manager no ha puesto."""
    from ..models_design import DesignTeamColores
    def leer():
        c = db.get(DesignTeamColores, team_id)
        if not c:
            return None
        try:
            datos = json.loads(c.datos or "{}")
        except ValueError:
            datos = {}
        return ({"d": datos.get("d") or {}, "c": datos.get("c") or {}, "p": datos.get("p") or {}, "e": datos.get("e") or {}}, c.actualizado_en.isoformat() if c.actualizado_en else "1")
    return sd.memo_sesion(db, ("colores", team_id), leer)


class ColoresIn(BaseModel):
    d: dict[str, str] = {}   # diseñadores (por id)
    c: dict[str, str] = {}   # centros
    p: dict[str, str] = {}   # productos (N2)
    e: dict[str, str] = {}   # estados


@router.post("/design/api/teams/{team_id}/colores")
def api_colores_equipo(team_id: int, payload: ColoresIn, user: Empleado = Depends(require_modulo("design_schedule")),
                       db: Session = Depends(get_db)):
    """Guarda los colores del equipo (manager, admin o quien está a cargo). Los ven todos los que abren ese Schedule."""
    from ..models_design import DesignTeamColores
    team = db.get(DesignTeam, team_id)
    if not team or not sd.gestiona_equipo(user, team):
        raise HTTPException(403, "Solo el manager del equipo puede cambiar sus colores.")
    validos = {"rojo", "naranja", "amarillo", "lima", "verde", "turquesa", "celeste", "azul", "morado", "rosado", "cafe", "gris"}
    limpio = lambda m: {str(k)[:150]: v for k, v in list(m.items())[:400] if v in validos}   # noqa: E731
    datos = {"d": limpio(payload.d), "c": limpio(payload.c), "p": limpio(payload.p), "e": limpio(payload.e)}
    c = db.get(DesignTeamColores, team_id) or DesignTeamColores(team_id=team_id)
    c.datos, c.actualizado_por, c.actualizado_en = json.dumps(datos, ensure_ascii=False), user.nombre_completo, datetime.utcnow()
    db.add(c)
    db.commit()
    from .. import services_design_vivo as sv
    sv.publicar_dia(team.id, "*", {d.empleado_id for d in team.designers})   # sus diseñadores también se repintan
    return {"ok": True}


@router.get("/design/api/dia/version")
def api_dia_version(team_id: int, fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    """Huella del día: la pantalla la consulta cada pocos segundos y, si cambió, vuelve a pedir el día (en vivo)."""
    team = _verificar_equipo_ver(db, user, team_id)
    solo = not (sd.gestiona_equipo(user, team) or sd.es_training(team))
    return {"v": sd.version_dia(db, team, _fecha(fecha), user.id, solo_propias=solo, extra=_huella_extra(db, user, team, _fecha(fecha)))}


class DelegacionIn(BaseModel):
    empleadoId: int
    desde: date
    hasta: date


def _equipo_delegable(db: Session, user: Empleado, team_id: int) -> DesignTeam:
    team = db.get(DesignTeam, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado.")
    if not sd.puede_delegar(user, team):
        raise HTTPException(403, "Solo el manager del equipo (o un admin) puede dejar a alguien a cargo.")
    return team


@router.post("/design/api/teams/{team_id}/delegacion")
def api_delegacion_guardar(team_id: int, payload: DelegacionIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    team = _equipo_delegable(db, user, team_id)
    err = sd.guardar_delegacion(db, team, payload.empleadoId, payload.desde, payload.hasta, user.nombre_completo)
    if err:
        raise HTTPException(400, err)
    logging.getLogger("design.delegacion").info("%s deja a cargo de %s a %s (%s a %s)", user.nombre_completo, team.nombre,
                                                payload.empleadoId, payload.desde, payload.hasta)
    return {"ok": True, "aCargo": sd.delegacion_de(db, team)}


@router.post("/design/api/teams/{team_id}/delegacion/quitar")
def api_delegacion_quitar(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    sd.quitar_delegacion(db, _equipo_delegable(db, user, team_id))
    return {"ok": True}


@router.get("/design/api/todas-areas/version")
def api_todas_areas_version(fecha: str, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Huella de la vista "todas las áreas": si no cambió, la pantalla no vuelve a pedir los datos."""
    return {"v": sd.version_todas_areas(db, _fecha(fecha))}


@router.get("/design/api/todas-areas")
def api_todas_areas(fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    return sd.resumen_todas_areas(db, user, _fecha(fecha))


# ---------- API: escritura ----------

class OrdenIn(BaseModel):
    teamId: int
    fecha: str
    tabla: Literal["principal", "nightguard", "material"] = "principal"
    orden: str = ""
    paciente: str = ""
    centro: str = ""
    producto: str = ""
    designerId: int | None = None
    designerPrestado: str = ""
    horaInicio: str = ""
    horaInicioDiseno: str = ""
    horaFin: str = ""
    holdMinutos: float = 0
    esferas: str = ""
    critico: str = ""
    sHold: str = ""
    fHold: str = ""
    etapa: str = ""
    solicitadoPor: str = ""
    situacion: str = ""
    solucion: str = ""
    clasificacion: str = ""
    soporte: str = ""
    estado: str = ""
    qc: bool = False
    qcReporte: str = ""
    notas: str = ""
    # N6 · Material Change: horas y QC de la etapa Zirconia design
    zHoraInicio: str = ""
    zSHold: str = ""
    zFHold: str = ""
    zHoldMinutos: float = 0
    zHoraFin: str = ""
    zQc: bool = False
    zQcReporte: str = ""
    # N3 · Cirugías: tiempo de articulación
    artStart: str = ""
    artRtd: str = ""


def _datos_desde_in(payload: OrdenIn) -> dict:
    return {
        "orden": payload.orden.strip().upper(), "paciente": payload.paciente.strip(),
        "centro": payload.centro.strip(), "producto": payload.producto.strip(),
        "designer_id": payload.designerId, "designer_prestado": payload.designerPrestado.strip(),
        "hora_inicio": payload.horaInicio, "hora_inicio_diseno": payload.horaInicioDiseno,
        "hora_fin": payload.horaFin, "hold_minutos": payload.holdMinutos,
        "esferas": payload.esferas, "critico": payload.critico,
        "s_hold": payload.sHold, "f_hold": payload.fHold,
        "etapa": payload.etapa, "solicitado_por": payload.solicitadoPor, "situacion": payload.situacion,
        "solucion": payload.solucion, "clasificacion": payload.clasificacion, "soporte": payload.soporte,
        "estado": payload.estado, "qc": payload.qc, "qc_reporte": payload.qcReporte, "notas": payload.notas,
        "z_hora_inicio": payload.zHoraInicio, "z_s_hold": payload.zSHold, "z_f_hold": payload.zFHold,
        "z_hold_minutos": payload.zHoldMinutos, "z_hora_fin": payload.zHoraFin, "z_qc": payload.zQc,
        "z_qc_reporte": payload.zQcReporte, "art_start": payload.artStart, "art_rtd": payload.artRtd,
    }


# Campo de la pantalla → columna. Al editar una orden solo se cambian los campos que llegan, así dos personas que
# editan campos distintos de la misma orden a la vez no se pisan (Schedule en vivo).
CAMPO_COLUMNA = {"orden": "orden", "paciente": "paciente", "centro": "centro", "producto": "producto",
                 "designerId": "designer_id", "designerPrestado": "designer_prestado", "horaInicio": "hora_inicio",
                 "horaInicioDiseno": "hora_inicio_diseno", "horaFin": "hora_fin", "holdMinutos": "hold_minutos",
                 "esferas": "esferas", "critico": "critico", "sHold": "s_hold", "fHold": "f_hold", "etapa": "etapa",
                 "solicitadoPor": "solicitado_por", "situacion": "situacion", "solucion": "solucion",
                 "clasificacion": "clasificacion", "soporte": "soporte", "estado": "estado", "qc": "qc",
                 "qcReporte": "qc_reporte", "notas": "notas",
                 "zHoraInicio": "z_hora_inicio", "zSHold": "z_s_hold", "zFHold": "z_f_hold", "zHoldMinutos": "z_hold_minutos",
                 "zHoraFin": "z_hora_fin", "zQc": "z_qc", "zQcReporte": "z_qc_reporte",
                 "artStart": "art_start", "artRtd": "art_rtd"}

DIA_CERRADO = "Este día ya se cerró (5:00 am del día siguiente) y no se puede editar."
SOLO_QC = "Solo los aprobadores (o el diseñador a cargo del equipo) marcan el QC."


def _verificar_qc(user: Empleado, team: DesignTeam, payload: "OrdenIn", existente: DesignOrden | None) -> None:
    """Cambiar el QC (casilla o reporte) solo lo hacen aprobadores, admins y el diseñador a cargo."""
    if sd.puede_qc(user, team):
        return
    cambia = any(  # QC de Bite (o de la orden) y QC de Zirconia (Material Change)
        (chk in payload.model_fields_set and bool(getattr(payload, chk)) != bool(getattr(existente, col_chk) if existente else False)) or
        (rep in payload.model_fields_set and (getattr(payload, rep) or "") != ((getattr(existente, col_rep) if existente else "") or ""))
        for chk, col_chk, rep, col_rep in (("qc", "qc", "qcReporte", "qc_reporte"), ("zQc", "z_qc", "zQcReporte", "z_qc_reporte")))
    if cambia:
        raise HTTPException(403, SOLO_QC)


@router.post("/design/api/ordenes")
def api_crear_orden(payload: OrdenIn, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    equipo = _verificar_equipo(db, user, payload.teamId)
    solo_producto = None
    if not sd.gestiona_equipo(user, equipo):
        # quien puede crear órdenes de un solo producto (sd.CREAN_PRODUCTO): el producto queda fijo y la orden es suya
        solo_producto = sd.producto_que_crea(user, equipo)
        if not solo_producto or payload.tabla != "principal":
            raise HTTPException(403, SOLO_MANAGER)
        payload.producto = solo_producto
        if not payload.designerId and not payload.designerPrestado.strip():
            payload.designerId = user.id
    if sperm.dia_cerrado_para(db, user, _fecha(payload.fecha)):
        raise HTTPException(403, DIA_CERRADO)
    _verificar_qc(user, db.get(DesignTeam, payload.teamId), payload, None)
    datos = _datos_desde_in(payload)
    t_face = db.get(DesignTeam, payload.teamId)
    _verificar_tabla(t_face, payload.tabla)
    if payload.tabla == sd.TABLA_MATERIAL and not datos.get("etapa"):
        datos["etapa"] = sd.ETAPA_BITE
    if datos.get("estado") and sd.horas_por_estado(t_face.area.formato, _fecha(payload.fecha), payload.tabla):
        datos.update(sd.horas_de_estado(payload.tabla, datos, datos["estado"]))
    if sd.orden_repetida(db, payload.teamId, _fecha(payload.fecha), datos["orden"]):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    o = sd.crear_orden(db, user, payload.teamId, _fecha(payload.fecha), payload.tabla, datos)
    return sd.serializar_orden(o)


def _verificar_tabla(team: DesignTeam, tabla: str) -> None:
    """El panel Material Change existe solo en N6."""
    if tabla == sd.TABLA_MATERIAL and not (team and team.area and team.area.nombre == sd.AREA_N6):
        raise HTTPException(400, "Material Change solo existe en el Schedule de N6.")


def _msg_repetida(orden: str) -> str:
    return f'El número de orden "{orden}" ya está {sd.MAX_REPETICIONES_ORDEN} veces en este día (es el máximo).'


@router.get("/design/api/prestables")
def api_prestables(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                   db: Session = Depends(get_db)):
    """Diseñador prestado ("Others"): los otros equipos de la misma área con sus diseñadores."""
    team = _verificar_equipo(db, user, team_id)
    if not sd.gestiona_equipo(user, team):
        raise HTTPException(403, "Solo el manager del equipo asigna diseñadores.")
    return sd.equipos_prestables(db, team)


@router.get("/design/api/support/autocompletar")
def api_support_autocompletar(team_id: int, orden: str, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    """Support: paciente, centro, producto y diseñador del caso, tomados del horario donde ya existe la orden."""
    team = _verificar_equipo(db, user, team_id)
    if team.area.formato != "support":
        raise HTTPException(400, "Solo disponible en Support.")
    return sd.autocompletar_support(db, orden) or {}


class LoteIn(BaseModel):
    teamId: int
    fecha: str
    tabla: Literal["principal", "nightguard", "material"] = "principal"
    filas: list[dict] = []  # cada fila con los mismos campos de OrdenIn (vacía = orden en blanco)


MAX_LOTE = 100


# Va antes de /design/api/ordenes/{orden_id} para que "lote" no se tome como un id.
@router.post("/design/api/ordenes/lote")
def api_crear_ordenes_lote(payload: LoteIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    """Crea varias órdenes de una vez: "+ Agregar orden" con cantidad, pegar un bloque con filas nuevas y
    deshacer una eliminación. Devuelve las órdenes creadas en el mismo orden."""
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, payload.teamId)):
        raise HTTPException(403, SOLO_MANAGER)
    fecha = _fecha(payload.fecha)
    if sperm.dia_cerrado_para(db, user, fecha):
        raise HTTPException(403, DIA_CERRADO)
    _verificar_tabla(db.get(DesignTeam, payload.teamId), payload.tabla)
    if not 1 <= len(payload.filas) <= MAX_LOTE:
        raise HTTPException(400, f"Se pueden crear entre 1 y {MAX_LOTE} órdenes por vez.")
    try:
        validadas = [OrdenIn.model_validate({**fila, "teamId": payload.teamId, "fecha": payload.fecha, "tabla": payload.tabla})
                     for fila in payload.filas]
    except ValueError as e:
        raise HTTPException(400, f"Hay filas con datos inválidos: {str(e)[:200]}")
    vistos: dict[str, int] = {}
    for datos in validadas:  # número repetido (máximo 5 por día): contra el día y dentro del mismo lote
        n = datos.orden.strip().upper()
        if n and sd.orden_repetida(db, payload.teamId, fecha, n, mas=vistos.get(n, 0)):
            raise HTTPException(400, _msg_repetida(n))
        vistos[n] = vistos.get(n, 0) + 1
    # M9 (13-oct-2026): todo o nada. Se guardan todas en una sola operación; si una falla, no se guarda ninguna.
    try:
        nuevas = [sd.crear_orden(db, user, payload.teamId, fecha, payload.tabla, _datos_desde_in(datos), guardar=False)
                  for datos in validadas]
        db.commit()
    except Exception:
        db.rollback()
        raise
    return [sd.serializar_orden(o) for o in nuevas]


# Horas que un diseñador no cambia a mano cuando el estado las llena solas (services_design.horas_por_estado).
CAMPOS_HORAS = ("hora_inicio", "hora_inicio_diseno", "hora_fin", "s_hold", "f_hold", "hold_minutos",
                "z_hora_inicio", "z_s_hold", "z_f_hold", "z_hold_minutos", "z_hora_fin")

# ---------- Catálogo de hallazgos de QC (títulos y hallazgos preestablecidos por área) ----------

class QcTituloIn(BaseModel):
    areaId: int
    titulo: str = Field(max_length=300)
    tabla: str = ""
    producto: str = ""


class QcHallazgoIn(QcTituloIn):
    texto: str = Field(max_length=300)


@router.get("/design/api/qc-catalogo")
def api_qc_catalogo(area_id: int, tabla: str = "", producto: str = "", user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    return {"titulos": sq.catalogo(db, area_id, tabla, producto), "puedeAgregar": sq.puede_agregar(user), "puedeBorrar": sq.puede_borrar(user)}


@router.post("/design/api/qc-catalogo/titulo")
def api_qc_titulo(payload: QcTituloIn, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    if not sq.puede_agregar(user):
        raise HTTPException(403, "Solo aprobadores y admins agregan títulos.")
    try:
        sq.agregar_titulo(db, payload.areaId, payload.titulo, payload.tabla)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"titulos": sq.catalogo(db, payload.areaId, payload.tabla, payload.producto)}


@router.post("/design/api/qc-catalogo/hallazgo")
def api_qc_hallazgo(payload: QcHallazgoIn, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    if not sq.puede_agregar(user):
        raise HTTPException(403, "Solo aprobadores y admins agregan hallazgos.")
    try:
        sq.agregar_hallazgo(db, payload.areaId, payload.titulo, payload.texto)
    except KeyError:
        raise HTTPException(404, "El título no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"titulos": sq.catalogo(db, payload.areaId, payload.tabla, payload.producto)}


@router.post("/design/api/qc-catalogo/{item_id}/eliminar")
def api_qc_eliminar(item_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    if not sq.puede_borrar(user):
        raise HTTPException(403, "Solo los admins borran hallazgos de la lista.")
    if not sq.eliminar(db, item_id):
        raise HTTPException(404, "El hallazgo no existe.")
    return {"ok": True}


# Columnas de la orden que un diseñador (sin gestionar el equipo) no puede cambiar.
CAMPOS_SOLO_MANAGER = ("orden", "paciente", "centro", "producto")
# En N3 y N6 el diseñador sí edita orden, paciente y producto de sus órdenes (pedido por Rosember el 12-oct-2026);
# centro y diseñador siguen siendo del manager. Igual que DS_AREAS_DISENADOR_EDITA en static/design/schedule.js.
AREAS_DISENADOR_EDITA = {"N3 Prosthetic", "N6 Material Changes", "Training"}
CAMPOS_DISENADOR_EDITA = ("orden", "paciente", "producto")


def campos_solo_manager(team: DesignTeam) -> tuple:
    if team.area and team.area.nombre in AREAS_DISENADOR_EDITA:
        return tuple(c for c in CAMPOS_SOLO_MANAGER if c not in CAMPOS_DISENADOR_EDITA)
    return CAMPOS_SOLO_MANAGER


@router.post("/design/api/ordenes/{orden_id}/training")
def api_orden_a_training(orden_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Pasa un caso de N3 › Cirugías al Schedule de Training (opción "Training" en el diseñador)."""
    o = db.get(DesignOrden, orden_id)
    if not o:
        raise HTTPException(404, "Orden no encontrada.")
    try:
        destino = sd.mover_a_training(db, o, user)
    except PermissionError as ex:
        raise HTTPException(403, str(ex))
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return {"ok": True, "equipo": destino.nombre}


def _push_llego_a_n2(db: Session, o: DesignOrden, aviso: dict, user: Empleado) -> None:
    """Aviso push (fijo hasta que lo cierren) al manager del equipo de N2 y a quien está a cargo hoy: llegó una orden
    aprobada en Face. Si falla, no afecta el guardado de la orden."""
    try:
        team = db.get(DesignTeam, aviso["equipoId"])
        if not team:
            return
        ids = {team.manager_id}
        dg = sd.delegacion_de(db, team)
        if dg and dg["activa"]:
            ids.add(dg["empleadoId"])
        ids.discard(None)
        ids.discard(user.id)   # quien marcó el QC no necesita el aviso
        if not ids:
            return
        cuerpo = " · ".join(x for x in ((o.orden or "").strip(), (o.paciente or "").strip(), (o.centro or "").strip(),
                                        (o.producto or "").strip()) if x)
        spush.enviar_en_segundo_plano(sorted(ids), "Nueva orden aprobada en Face",
                                      f"{cuerpo}\nYa está en tu Schedule de N2 de hoy ({team.nombre}).",
                                      url=f"/design?area_id={team.area_id}&team_id={team.id}",
                                      etiqueta=f"face-n2-{aviso.get('n2OrdenId', o.id)}", fijo=True)
    except Exception:  # noqa: BLE001
        logging.getLogger("design.face_n2").exception("Face → N2: no se pudo enviar el aviso push")


def _con_copia_n2(db: Session, user: Empleado, o: DesignOrden, qc_antes: bool, datos: dict) -> dict:
    """Face: al marcar el QC de una orden, su número, paciente, centro y producto pasan a N2 (al día de hoy)
    (copiar_face_a_n2). Si después se desmarca, las copias quedan pendientes de decisión del manager de N2."""
    if not qc_antes and o.qc:
        aviso = sd.copiar_face_a_n2(db, o, user)
        if aviso is not None:
            datos["copiaN2"] = aviso
            if aviso.get("ok") and not aviso.get("ya"):
                _push_llego_a_n2(db, o, aviso, user)
    elif qc_antes and not o.qc:
        pendientes = sd.copia_face_desmarcada(db, o)
        if pendientes:
            datos["copiaN2Pendiente"] = pendientes
    return datos


class CopiaDecisionIn(BaseModel):
    accion: Literal["borrar", "mantener"]


@router.post("/design/api/copias-face/{n2_orden_id}/decidir")
def api_copia_face_decidir(n2_orden_id: int, payload: CopiaDecisionIn,
                           user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """El manager de N2 (o un admin) decide qué pasa con una orden copiada desde Face cuyo QC se desmarcó."""
    o = db.get(DesignOrden, n2_orden_id)
    if not o:
        raise HTTPException(404, "Orden no encontrada.")
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, o.team_id)):
        raise HTTPException(403, SOLO_MANAGER)
    try:
        return sd.decidir_copia_face(db, n2_orden_id, payload.accion, user)
    except ValueError as ex:
        raise HTTPException(400, str(ex))


@router.get("/design/diagnostico/face-n2")
def diagnostico_face_n2(request: Request, orden: str = Query("", max_length=50), user: Empleado = Depends(require_admin),
                        db: Session = Depends(get_db)):
    """Admins: revisa paso a paso por qué una orden de Face se copió (o no) a N2 y si se pudo avisar por push."""
    from .. import services_design_face_diag as sfd
    d = sfd.diagnosticar(db, orden) if orden.strip() else None
    return templates.TemplateResponse(request, "design_diag_face_n2.html", {"user": user, "es_design": True, "d": d, "orden": orden})


@router.get("/design/diagnostico/orden")
def diagnostico_orden(request: Request, orden: str = Query("", max_length=50), user: Empleado = Depends(require_admin),
                      db: Session = Depends(get_db)):
    """Admins: datos internos de una orden (Hold acumulado, día de creación) y cómo sale su Total."""
    from .. import services_design_orden_diag as sod
    d = sod.diagnosticar(db, orden) if orden.strip() else None
    return templates.TemplateResponse(request, "design_diag_orden.html", {"user": user, "es_design": True, "d": d})


@router.get("/design/diagnostico/acceso")
def diagnostico_acceso(request: Request, persona: str = Query("", max_length=80), id: int | None = None,
                       user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: por qué alguien entra o no a Design y qué Schedules ve (empresa, módulo, rol de People vs. rol de Design)."""
    from .. import services_design_acceso_diag as sad
    candidatos = sad.buscar(db, persona) if persona.strip() and not id else []
    elegido = db.get(Empleado, id) if id else (candidatos[0] if len(candidatos) == 1 else None)
    d = sad.diagnosticar(db, elegido) if elegido else None
    return templates.TemplateResponse(request, "design_diag_acceso.html", {"user": user, "es_design": True, "d": d, "persona": persona,
                                                                          "candidatos": candidatos if not d else []})


@router.get("/design/diagnostico/rendimiento")
def diagnostico_rendimiento(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Admins: demora real hacia la base, conexiones en vivo, pool, memoria y CPU (simulación de 150 personas, 19-oct-2026)."""
    from .. import services_design_rendimiento as srend
    return templates.TemplateResponse(request, "design_diag_rendimiento.html", {"user": user, "es_design": True, "d": srend.medir(db)})


@router.post("/design/api/ordenes/{orden_id}")
def api_actualizar_orden(orden_id: int, payload: OrdenIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    team = db.get(DesignTeam, orden_existente.team_id)
    qc_antes = bool(orden_existente.qc)   # para saber si ahora se marcó el QC (copia a N2, abajo)
    solo_propia = not sd.gestiona_equipo(user, team)
    if solo_propia:
        # Un diseñador edita sus órdenes: las de su equipo y las de otro equipo que se lo pidió prestado.
        propia = orden_existente.designer_id == user.id and (
            team.id in sd.equipos_como_designer(db, user) or sd.es_orden_prestada_a(db, orden_existente, user))
        if not propia:
            raise HTTPException(403, "Solo puedes editar las órdenes que tienes asignadas.")
    _verificar_qc(user, team, payload, orden_existente)
    if sperm.dia_cerrado_para(db, user, orden_existente.fecha):
        # Día cerrado (y sin permiso para editarlo): solo el QC (checkbox + reporte de hallazgos), y solo hasta las 5:00 am de D+2.
        # El resto de campos se ignora.
        if not sd.qc_editable(orden_existente.fecha):
            raise HTTPException(403, DIA_CERRADO)
        # solo lo que llegó: si no se envió el checkbox (no cambió), no se desmarca
        qc = {c: v for k, c, v in (("qc", "qc", payload.qc), ("qcReporte", "qc_reporte", payload.qcReporte),
                                    ("zQc", "z_qc", payload.zQc), ("zQcReporte", "z_qc_reporte", payload.zQcReporte))
              if k in payload.model_fields_set}
        o = sd.actualizar_orden(db, orden_id, qc) if qc else orden_existente
        return _con_copia_n2(db, user, o, qc_antes, sd.serializar_orden(o))
    enviados = {CAMPO_COLUMNA[k] for k in payload.model_fields_set if k in CAMPO_COLUMNA}
    datos = {k: v for k, v in _datos_desde_in(payload).items() if k in enviados}
    if ("orden" in datos and datos["orden"] != (orden_existente.orden or "").strip().upper()
            and sd.orden_repetida(db, orden_existente.team_id, orden_existente.fecha, datos["orden"], orden_id)):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    if solo_propia and sd.horas_por_estado(team.area.formato, orden_existente.fecha, orden_existente.tabla):
        # Un diseñador no escribe las horas a mano: se registran solas con el estado (Initiated, Hold, Approved).
        # Si hay que corregir una hora, la cambia el manager.
        for c in CAMPOS_HORAS:
            datos.pop(c, None)
    if solo_propia and orden_existente.tabla == sd.TABLA_MATERIAL:
        datos.pop("etapa", None)  # la etapa cambia sola al aprobar Bite; corregirla a mano es del manager
    if ("hora_inicio_diseno" in datos and orden_existente.tabla == "principal"
            and sd.es_face_nuevo(team.area.formato, orden_existente.fecha)):
        # Página abierta desde antes del formato nuevo: su "Inicio diseño" llega en el campo viejo → va a Inicio diseño (hora_inicio)
        viejo = datos.pop("hora_inicio_diseno")
        if viejo:
            datos["hora_inicio"] = viejo
    if ("estado" in datos and datos["estado"] != (orden_existente.estado or "")
            and sd.horas_por_estado(team.area.formato, orden_existente.fecha, orden_existente.tabla)):
        # Face: el estado llena solo las horas (Initiated → Inicio diseño / Re-initiated, Hold → Start hold, Approved → Fin)
        actual = {c: datos.get(c, getattr(orden_existente, c)) for c in ("hora_inicio", "s_hold", "f_hold", "hora_fin", "hold_minutos",
                                                                           "etapa", "z_hora_inicio", "z_s_hold", "z_f_hold",
                                                                           "z_hora_fin", "z_hold_minutos")}
        datos.update(sd.horas_de_estado(orden_existente.tabla, actual, datos["estado"]))
    if solo_propia:  # un diseñador edita horas, estado, notas, esferas y crítico (y en N3/N6 orden, paciente y producto)
        bloqueados = campos_solo_manager(team)
        prod = sd.producto_que_crea(user, team)
        if prod and sd._normalizar_texto(orden_existente.producto or "") == sd._normalizar_texto(prod):
            # sus órdenes del producto que puede crear (Maxilar Print): corrige orden, paciente y centro; el producto no
            bloqueados = ("producto",)
        for c in bloqueados:
            datos.pop(c, None)
        datos["designer_id"] = orden_existente.designer_id
        datos["designer_prestado"] = orden_existente.designer_prestado
    o = sd.actualizar_orden(db, orden_id, datos)
    return _con_copia_n2(db, user, o, qc_antes, sd.serializar_orden(o))


@router.post("/design/api/ordenes/{orden_id}/eliminar")
def api_eliminar_orden(orden_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, orden_existente.team_id)):
        raise HTTPException(403, SOLO_MANAGER)
    if sperm.dia_cerrado_para(db, user, orden_existente.fecha):
        raise HTTPException(403, DIA_CERRADO)
    sd.eliminar_orden(db, orden_id)
    return {"mensaje": "Eliminada."}


class BreakIn(BaseModel):
    teamId: int
    empleadoId: int
    fecha: str
    tipoAusencia: str = ""
    almuerzoInicio: str = ""
    almuerzoFin: str = ""
    break1Inicio: str = ""
    break1Fin: str = ""
    break2Inicio: str = ""
    break2Fin: str = ""


@router.post("/design/api/breaks")
def api_guardar_break(payload: BreakIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    team = _verificar_equipo(db, user, payload.teamId)
    if not sd.gestiona_equipo(user, team) and payload.empleadoId != user.id:
        raise HTTPException(403, "Solo puedes registrar tus propios tiempos libres.")
    if sperm.dia_cerrado_para(db, user, _fecha(payload.fecha)):
        raise HTTPException(403, DIA_CERRADO)
    b = sd.guardar_break(db, payload.teamId, payload.empleadoId, _fecha(payload.fecha), {
        "tipo_ausencia": payload.tipoAusencia,
        "almuerzo_inicio": payload.almuerzoInicio, "almuerzo_fin": payload.almuerzoFin,
        "break1_inicio": payload.break1Inicio, "break1_fin": payload.break1Fin,
        "break2_inicio": payload.break2Inicio, "break2_fin": payload.break2Fin,
    })
    return sd.serializar_break(b)


# ---------- API: Dashboard ----------

@router.get("/design/api/dashboard")
def api_dashboard(area_id: int | None = None, team_id: int | None = None, designer_id: int | None = None,
                        producto: str = "", estado: str = "", qc: str = "",
                        fecha_desde: str = "", fecha_hasta: str = "", designer_nombre: str = "",
                        user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    if not area_id and not team_id:
        raise HTTPException(400, "Elige un área para ver el Dashboard.")
    if not fecha_desde or not fecha_hasta:
        raise HTTPException(400, "Indica el periodo (desde y hasta).")
    fd, fh = _fecha(fecha_desde), _fecha(fecha_hasta)
    if fh < fd or (fh - fd).days >= sd.DASH_RANGO_MAX_DIAS:
        raise HTTPException(400, f"El periodo debe ser de un año o menos (desde {fd:%d/%m/%Y} hasta {fh:%d/%m/%Y}).")
    r = sd.dashboard_query(db, area_id, team_id, designer_id, producto, estado, qc, fd, fh, user, designer_nombre)
    # Casos por producto (14-oct-2026): la lista de casos de cada producto ya no viaja aquí; se pide al abrir el
    # producto (api_dashboard_producto_casos), así el Dashboard no carga miles de filas que nadie está mirando.
    for p in r["porProducto"]:
        p.pop("lista", None)
    return r


@router.get("/design/api/dashboard/producto-casos")
def api_dashboard_producto_casos(prod: str = Query("", max_length=150), todos: int = 0,
                                 area_id: int | None = None, team_id: int | None = None, designer_id: int | None = None,
                                 producto: str = "", estado: str = "", qc: str = "",
                                 fecha_desde: str = "", fecha_hasta: str = "", designer_nombre: str = "",
                                 user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Casos de UN producto (o de todos con todos=1, para la descarga) con los mismos filtros del Dashboard."""
    if not area_id and not team_id:
        raise HTTPException(400, "Elige un área para ver el Dashboard.")
    if not fecha_desde or not fecha_hasta:
        raise HTTPException(400, "Indica el periodo (desde y hasta).")
    fd, fh = _fecha(fecha_desde), _fecha(fecha_hasta)
    if fh < fd or (fh - fd).days >= sd.DASH_RANGO_MAX_DIAS:
        raise HTTPException(400, f"El periodo debe ser de un año o menos (desde {fd:%d/%m/%Y} hasta {fh:%d/%m/%Y}).")
    if not todos and prod and producto and producto != prod:
        return {"producto": prod, "lista": []}
    filtro = producto if (todos or not prod) else prod   # un solo producto: la consulta se limita a ese producto
    r = sd.dashboard_query(db, area_id, team_id, designer_id, filtro, estado, qc, fd, fh, user, designer_nombre)
    if todos:
        return {"productos": {p["producto"] or "": p["lista"] for p in r["porProducto"]}}
    lista = next((p["lista"] for p in r["porProducto"] if (p["producto"] or "") == prod), [])
    return {"producto": prod, "lista": lista}


# ---------- Dashboard › Cambios digitales (13-oct-2026) ----------
from ..services_design_cambios import (traduccion_detalle, listar as cd_listar, crear as cd_crear, actualizar as cd_actualizar,
                                       eliminar as cd_eliminar, importar_xlsx as cd_importar, exportar_csv as cd_csv, CAMPOS as CD_CAMPOS)


class CambioCampoIn(BaseModel):
    campo: str = Field(max_length=20)
    valor: str | None = Field(default="", max_length=4000)


def _cd_fila(r) -> dict:
    return {"id": r.id, "fecha": r.fecha.isoformat() if r.fecha else "", "orden": r.orden or "", "paciente": r.paciente or "",
            "centro": r.centro or "", "doctor": r.doctor or "", "producto": r.producto or "", "tipo_cambio": r.tipo_cambio or "",
            "detalle": r.detalle or "", "detalleEs": traduccion_detalle(r.detalle), "origen": r.origen or ""}


def _cd_fecha(texto: str):
    return _fecha(texto) if texto else None


@router.get("/design/api/cambios-digitales")
def api_cambios_listar(q: str = Query("", max_length=200), desde: str = "", hasta: str = "", origen: str = "", tipo: str = "",
                       centro: str = "", orden: str = Query("fecha", max_length=20), dir: str = Query("desc", max_length=4),
                       limite: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                       user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return cd_listar(db, q=q, desde=_cd_fecha(desde), hasta=_cd_fecha(hasta), origen=origen, tipo=tipo, centro=centro,
                     orden=orden, dir_=dir, limite=limite, offset=offset)


@router.post("/design/api/cambios-digitales")
def api_cambios_crear(payload: dict, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    datos = {c: payload.get(c, "") for c in CD_CAMPOS}
    try:
        return _cd_fila(cd_crear(db, datos, user.nombre_completo))
    except ValueError as ex:
        raise HTTPException(400, str(ex))


@router.post("/design/api/cambios-digitales/{id_:int}")
def api_cambios_editar(id_: int, payload: CambioCampoIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    if payload.campo not in CD_CAMPOS:
        raise HTTPException(400, "Ese campo no se puede editar.")
    try:
        r = cd_actualizar(db, id_, payload.campo, payload.valor)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if not r:
        raise HTTPException(404, "El cambio no existe.")
    return _cd_fila(r)


@router.post("/design/api/cambios-digitales/{id_:int}/eliminar")
def api_cambios_eliminar(id_: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not cd_eliminar(db, id_):
        raise HTTPException(404, "El cambio no existe.")
    return {"ok": True}


def _equipos_visibles(db: Session, user: Empleado) -> set[int] | None:
    """None = todos los equipos (admins); si no, los que el Dashboard de la persona ve (los que maneja o tiene a cargo)."""
    return None if sd.es_admin(user) else sd.equipos_dash_ids(db, user)


@router.get("/design/api/cambios-digitales/buscar-orden")
def api_cambios_buscar_orden(orden: str = Query("", max_length=40), user: Empleado = Depends(require_design_manager),
                             db: Session = Depends(get_db)):
    """Datos de la orden del Schedule para el formulario de Cambio digital (13-oct-2026)."""
    from ..services_design_cambios import buscar_orden
    return buscar_orden(db, orden, _equipos_visibles(db, user))


@router.get("/design/api/cambios-digitales/doctores")
def api_cambios_doctores(centro: str = Query("", max_length=150), user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Doctores de Pre-Approved del centro, para elegir en el Cambio digital (13-oct-2026)."""
    from ..services_design_cambios import doctores_de_centro
    return {"doctores": doctores_de_centro(db, centro)}


class CambioDesdeOrdenIn(BaseModel):
    orden: str = Field(max_length=40)
    doctor: str = Field(default="", max_length=200)
    tipo_cambio: str = Field(default="", max_length=120)
    detalle: str = Field(default="", max_length=4000)
    origen: str = Field(default="", max_length=10)


@router.post("/design/api/cambios-digitales/desde-orden")
def api_cambios_desde_orden(payload: CambioDesdeOrdenIn, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Guarda un cambio digital: el número de orden trae fecha, paciente, centro y producto del Schedule."""
    from ..services_design_cambios import crear_desde_orden, _fila_a_dict
    if payload.origen.strip().upper() not in ("DOC", "LAB"):
        raise HTTPException(400, "El origen debe ser DOC (doctor) o LAB (laboratorio).")
    try:
        r = crear_desde_orden(db, payload.orden, payload.model_dump(), _equipos_visibles(db, user), user.nombre_completo)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    return _cd_fila(r)


@router.post("/design/api/cambios-digitales/importar")
async def api_cambios_importar(archivo: UploadFile = File(...), user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    datos = await archivo.read(10 * 1024 * 1024 + 1)
    if len(datos) > 10 * 1024 * 1024:
        raise HTTPException(400, "El Excel pesa más de 10 MB.")
    try:
        return cd_importar(db, datos, user.nombre_completo)
    except ValueError as ex:
        raise HTTPException(400, str(ex))


@router.get("/design/api/cambios-digitales/csv")
def api_cambios_csv(q: str = Query("", max_length=200), desde: str = "", hasta: str = "", origen: str = "", tipo: str = "",
                    centro: str = "", orden: str = Query("fecha", max_length=20), dir: str = Query("desc", max_length=4),
                    user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    texto = cd_csv(db, q=q, desde=_cd_fecha(desde), hasta=_cd_fecha(hasta), origen=origen, tipo=tipo, centro=centro, orden=orden, dir_=dir)
    return Response(texto.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="cambios_digitales.csv"'})


@router.get("/design/api/dashboard/aprobaciones-lentas")
def api_aprobaciones_lentas(desde: str, hasta: str, area_id: int | None = None, team_id: int | None = None,
                            user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Solo admin: órdenes en las que el manager tardó más de 1 h 30 min entre Approved y marcar el QC (o siguen sin QC)."""
    fd, fh = _fecha(desde), _fecha(hasta)
    if fh < fd or (fh - fd).days >= sap.RANGO_MAX_DIAS:
        raise HTTPException(400, f"El periodo debe ser de {sap.RANGO_MAX_DIAS} días o menos.")
    return sap.lentas(db, fd, fh, area_id, team_id)


@router.get("/design/api/dashboard/tendencia")
def api_dashboard_tendencia(desde: str, hasta: str, area_id: int | None = None, team_id: int | None = None,
                            user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Gráfica comparativa por equipos en el periodo elegido (A8)."""
    if not area_id and not team_id:
        raise HTTPException(400, "Elige un área para ver la tendencia.")
    fd, fh = _fecha(desde), _fecha(hasta)
    if fh < fd or (fh - fd).days >= sd.DASH_RANGO_MAX_DIAS:
        raise HTTPException(400, "El periodo debe ser de un año o menos.")
    return sd.dashboard_tendencia(db, user, area_id, team_id, fd, fh)


@router.get("/design/api/dashboard/productos")
def api_dashboard_productos(anio: int = 0, area_id: int | None = None, team_id: int | None = None,
                            user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Dashboard › Productos: órdenes de cada producto por mes del año."""
    anio = anio or sd.ahora_colombia().year
    if not 2000 <= anio <= 2100:
        raise HTTPException(400, "Año inválido.")
    return sd.dashboard_productos(db, user, anio, area_id, team_id)


@router.get("/design/api/dashboard/articulacion")
def api_dashboard_articulacion(desde: str = "", hasta: str = "", area_id: int | None = None, team_id: int | None = None,
                               user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """Dashboard › Articulación: tiempo de articulación (RTD − START) de N3 › Cirugías por centro; los que pasan de 2 h."""
    hoy = sd.ahora_colombia().date()
    try:
        d = date.fromisoformat(desde) if desde else hoy.replace(day=1)
        h = date.fromisoformat(hasta) if hasta else hoy
    except ValueError:
        raise HTTPException(400, "Fecha inválida.")
    if d > h:
        d, h = h, d
    return sd.dashboard_articulacion(db, user, d, h, area_id, team_id)


class QcHallazgosIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=5000)
    # Deshacer: {id: texto} vuelve a poner el hallazgo que se borró
    restaurar: dict[int, str] | None = None


@router.post("/design/api/dashboard/qc-hallazgos/borrar")
def api_qc_hallazgos_borrar(payload: QcHallazgosIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Solo admins: borra el hallazgo de QC (el texto de "Con hallazgos") de las órdenes indicadas. El QC sigue
    marcado y la orden queda "Sin hallazgos"; las Notas y el resto de la orden no cambian. Sirve también en días
    cerrados (es una corrección del admin). Devuelve los textos borrados para poder deshacer."""
    if payload.restaurar:
        n = 0
        for oid, texto in payload.restaurar.items():
            o = db.get(DesignOrden, int(oid))
            if o is not None:
                o.qc_reporte = texto or ""
                n += 1
        db.commit()
        return {"restaurados": n}
    borrados: dict[int, str] = {}
    for o in db.query(DesignOrden).filter(DesignOrden.id.in_(payload.ids or [-1])).all():
        if (o.qc_reporte or "").strip():
            borrados[o.id] = o.qc_reporte
            o.qc_reporte = ""
    db.commit()
    return {"borrados": borrados}


@router.get("/design/api/buscar")
def api_buscar(q: str, user: Empleado = Depends(require_modulo("design_schedule")),
                     db: Session = Depends(get_db)):
    return sd.buscar_ordenes(db, q, user)


# ---------- API: Comments N3 (historial) ----------

@router.get("/design/api/comentarios/historial")
def api_historial_comentarios(user: Empleado = Depends(require_comments("n3")),
                                    db: Session = Depends(get_db)):
    return sd.historial_comentarios(db)


class HistorialComentarioIn(BaseModel):
    paciente: str = ""
    orden: str = ""
    campos: dict


@router.post("/design/api/comentarios/historial")
def api_guardar_historial(payload: HistorialComentarioIn,
                                user: Empleado = Depends(require_comments("n3")),
                                db: Session = Depends(get_db)):
    sd.guardar_historial_comentario(db, user, payload.paciente, payload.orden, payload.campos)
    return {"mensaje": "Guardado en historial."}


@router.post("/design/api/comentarios/historial/{historial_id}/eliminar")
def api_eliminar_historial(historial_id: int, user: Empleado = Depends(require_comments("n3")),
                                 db: Session = Depends(get_db)):
    if not sd.eliminar_historial_comentario(db, historial_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


# ---------- API: Comments N3 (opciones de Bar adapt) ----------
# Las 4 fijas más las que agreguen (catálogo de N3 Prosthetic, tipo "cmt_bar_adapt"; no aparece en Parámetros).
BAR_ADAPT_FIJAS = ["0.1mm", "1mm", "0.1mm on Upper and 1mm on lower", "1mm on Upper and 0.1mm on lower"]


def _area_n3(db: Session) -> DesignArea:
    a = db.query(DesignArea).filter(DesignArea.nombre == "N3 Prosthetic").first()
    if not a:
        raise HTTPException(404, "No existe el área N3 Prosthetic.")
    return a


@router.get("/design/api/comentarios/bar-adapt")
def api_bar_adapt(user: Empleado = Depends(require_comments("n3")), db: Session = Depends(get_db)):
    extra = [v for v in sd.catalogo(db, _area_n3(db).id, "cmt_bar_adapt") if v not in BAR_ADAPT_FIJAS]
    return BAR_ADAPT_FIJAS + extra


class BarAdaptIn(BaseModel):
    valor: str = Field(..., max_length=150)


@router.post("/design/api/comentarios/bar-adapt")
def api_bar_adapt_agregar(payload: BarAdaptIn, user: Empleado = Depends(require_comments("n3")), db: Session = Depends(get_db)):
    valor = " ".join(payload.valor.split())
    if not valor:
        raise HTTPException(400, "Escribe la opción.")
    if valor not in BAR_ADAPT_FIJAS:
        area = _area_n3(db)
        if valor not in sd.catalogo(db, area.id, "cmt_bar_adapt"):
            n = db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "cmt_bar_adapt").count()
            existe = (db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id, DesignCatalogo.tipo == "cmt_bar_adapt",
                                                      DesignCatalogo.valor == valor).first())
            if existe:
                existe.activo = 1
            else:
                db.add(DesignCatalogo(area_id=area.id, tipo="cmt_bar_adapt", valor=valor, orden=n + 1, activo=1))
            db.commit()
    return {"valor": valor}


# ---------- API: Comments N3 (plantillas de notas personalizadas) ----------

@router.get("/design/api/comentarios/templates")
def api_cmt_templates_listar(user: Empleado = Depends(require_comments("n3")),
                                   db: Session = Depends(get_db)):
    return [{"id": t.id, "nombre": t.nombre, "texto": t.texto, "esFija": bool(t.es_fija)}
           for t in sd.cmt_templates_listar(db)]


class CmtTemplateIn(BaseModel):
    nombre: str
    texto: str


@router.post("/design/api/comentarios/templates")
def api_cmt_template_crear(payload: CmtTemplateIn, user: Empleado = Depends(require_comments("n3")),
                                 db: Session = Depends(get_db)):
    t = sd.cmt_template_crear(db, payload.nombre, payload.texto, user.nombre_completo)
    return {"id": t.id, "nombre": t.nombre, "texto": t.texto}


@router.post("/design/api/comentarios/templates/{template_id}")
def api_cmt_template_editar(template_id: int, payload: CmtTemplateIn,
                                  user: Empleado = Depends(require_comments("n3")),
                                  db: Session = Depends(get_db)):
    t = sd.cmt_template_editar(db, template_id, payload.nombre, payload.texto)
    if not t:
        raise HTTPException(404, "No encontrada.")
    return {"id": t.id, "nombre": t.nombre, "texto": t.texto}


@router.post("/design/api/comentarios/templates/{template_id}/eliminar")
def api_cmt_template_eliminar(template_id: int, user: Empleado = Depends(require_comments("n3")),
                                    db: Session = Depends(get_db)):
    if not sd.cmt_template_eliminar(db, template_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


@router.post("/design/api/favoritos/cmt-template/{template_id}/toggle")
def api_favorito_toggle_cmt_template(template_id: int,
                                           user: Empleado = Depends(require_modulo("design_schedule")),
                                           db: Session = Depends(get_db)):
    _exigir_para_marcar(db, user, "cmtTemplates", template_id, sd.DesignComentarioTemplate, "Plantilla no encontrada.")
    return {"favorito": sd.favorito_toggle_cmt_template(db, user.id, template_id)}


# ---------- API: FAQ (Comments N2 / Face): hojas ----------
# Leen todos los del módulo; editan solo los roles por encima del diseñador.

FAQ_ROLES_EDITAN = ("aprobador", "admin", "superadmin")


def _faq_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden editar esta información.")


@router.get("/design/api/faq/hojas")
def api_faq_hojas(user: Empleado = Depends(require_comments("faq")), db: Session = Depends(get_db)):
    return {"hojas": sd.faq_hojas(db), "puedeEditar": user.rol in FAQ_ROLES_EDITAN}


@router.get("/design/api/faq/hojas/{hoja_id}")
def api_faq_hoja(hoja_id: int, user: Empleado = Depends(require_comments("faq")),
                       db: Session = Depends(get_db)):
    d = sd.faq_hoja_detalle(db, hoja_id)
    if not d:
        raise HTTPException(404, "Hoja no encontrada.")
    return d


class FaqHojaIn(BaseModel):
    nombre: str = ""
    duplicarDe: int | None = None


@router.post("/design/api/faq/hojas")
def api_faq_hoja_crear(payload: FaqHojaIn, user: Empleado = Depends(require_comments("faq")),
                             db: Session = Depends(get_db)):
    _faq_editor(user)
    h = sd.faq_hoja_crear(db, payload.nombre, payload.duplicarDe)
    if not h:
        raise HTTPException(404, "Hoja no encontrada.")
    return {"id": h.id}


@router.post("/design/api/faq/hojas/{hoja_id}/renombrar")
def api_faq_hoja_renombrar(hoja_id: int, payload: FaqHojaIn,
                                 user: Empleado = Depends(require_comments("faq")),
                                 db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_hoja_renombrar(db, hoja_id, payload.nombre):
        raise HTTPException(400, "Escribe un nombre.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/faq/hojas/{hoja_id}/eliminar")
def api_faq_hoja_eliminar(hoja_id: int, user: Empleado = Depends(require_comments("faq")),
                                db: Session = Depends(get_db)):
    _faq_editor(user)
    r = sd.faq_hoja_eliminar(db, hoja_id, user.nombre_completo)
    if r == "ultima":
        raise HTTPException(400, "Debe quedar al menos una hoja.")
    if r != "ok":
        raise HTTPException(404, "Hoja no encontrada.")
    return {"mensaje": "Enviada a la Papelera."}


class FaqColumnaIn(BaseModel):
    titulo: str


@router.post("/design/api/faq/hojas/{hoja_id}/columnas")
def api_faq_columna_agregar(hoja_id: int, payload: FaqColumnaIn,
                                  user: Empleado = Depends(require_comments("faq")),
                                  db: Session = Depends(get_db)):
    _faq_editor(user)
    col = sd.faq_columna_agregar(db, hoja_id, payload.titulo)
    if not col:
        raise HTTPException(400, "Escribe un nombre para la columna.")
    return col


@router.post("/design/api/faq/hojas/{hoja_id}/columnas/{clave}")
def api_faq_columna_renombrar(hoja_id: int, clave: str, payload: FaqColumnaIn,
                                    user: Empleado = Depends(require_comments("faq")),
                                    db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_columna_renombrar(db, hoja_id, clave, payload.titulo):
        raise HTTPException(400, "No se pudo renombrar la columna.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/faq/hojas/{hoja_id}/columnas/{clave}/eliminar")
def api_faq_columna_eliminar(hoja_id: int, clave: str, user: Empleado = Depends(require_comments("faq")),
                                   db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_columna_eliminar(db, hoja_id, clave, user.nombre_completo):
        raise HTTPException(404, "Columna no encontrada.")
    return {"mensaje": "Enviada a la Papelera."}


class FaqFilaNuevaIn(BaseModel):
    seccion: str = ""
    despuesDe: int | None = None


@router.post("/design/api/faq/hojas/{hoja_id}/filas")
def api_faq_fila_crear(hoja_id: int, payload: FaqFilaNuevaIn,
                             user: Empleado = Depends(require_comments("faq")),
                             db: Session = Depends(get_db)):
    _faq_editor(user)
    f = sd.faq_fila_crear(db, hoja_id, payload.seccion, payload.despuesDe)
    if not f:
        raise HTTPException(404, "Hoja no encontrada.")
    return {"id": f.id}


class FaqSeccionIn(BaseModel):
    filas: list[int]
    nombre: str


@router.post("/design/api/faq/hojas/{hoja_id}/seccion")
def api_faq_seccion_renombrar(hoja_id: int, payload: FaqSeccionIn,
                                    user: Empleado = Depends(require_comments("faq")),
                                    db: Session = Depends(get_db)):
    _faq_editor(user)
    return {"filas": sd.faq_seccion_renombrar(db, hoja_id, payload.filas, payload.nombre)}


class FaqCeldaIn(BaseModel):
    campo: str
    valor: str = ""


@router.post("/design/api/faq/filas/{fila_id}")
def api_faq_fila_actualizar(fila_id: int, payload: FaqCeldaIn,
                                  user: Empleado = Depends(require_comments("faq")),
                                  db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_fila_actualizar(db, fila_id, payload.campo, payload.valor):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/faq/filas/{fila_id}/eliminar")
def api_faq_fila_eliminar(fila_id: int, user: Empleado = Depends(require_comments("faq")),
                                db: Session = Depends(get_db)):
    _faq_editor(user)
    if not sd.faq_fila_eliminar(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Enviada a la Papelera."}


# ---------- Página: Pre-Approved ----------

@router.get("/design/preapproved")
def pagina_preapproved(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "preapproved")


# ---------- API: Pre-Approved ----------
# Leen todos los del módulo; editan solo los roles por encima del diseñador (como Comments N2 / Face).

def _pa_area(db: Session, user: Empleado, area_id: int | None) -> None:
    """Pre-Approved: solo las áreas que ve `user` (ver sd.preapproved_areas_permitidas)."""
    permitidas = sd.preapproved_areas_permitidas(db, user)
    if permitidas is not None and area_id not in permitidas:
        raise HTTPException(403, "Este Pre-Approved es de otra área.")


def _pa_de(db: Session, user: Empleado, modelo, obj_id: int | None) -> None:
    """Revisa el área de una hoja (o de un centro, doctor o fila, por su hoja). Si no existe, sigue (la ruta da 404)."""
    if obj_id is None:
        return
    o = db.get(modelo, obj_id)
    if not o:
        return
    sheet = o if isinstance(o, sd.DesignPreApprovedSheet) else db.get(sd.DesignPreApprovedSheet, o.sheet_id)
    if sheet:
        _pa_area(db, user, sheet.area_id)


def _pa_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden editar el Pre-Approved.")


@router.get("/design/api/preapproved/sheets")
def api_preapproved_sheets(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    _pa_area(db, user, area_id)
    return [{"id": s.id, "nombre": s.nombre} for s in sd.preapproved_sheets(db, area_id)]


@router.get("/design/api/preapproved/buscar")
def api_preapproved_buscar(q: str = Query("", max_length=100), area_id: int | None = None,
                           user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Buscar doctor o centro en todas las hojas de Pre-Approved del área abierta (cada área busca solo en la suya)."""
    permitidas = sd.preapproved_areas_permitidas(db, user)
    if area_id is not None:
        _pa_area(db, user, area_id)
        permitidas = {area_id}
    return sd.preapproved_buscar(db, q, permitidas)


@router.get("/design/api/preapproved/centro")
def api_preapproved_centro(area_id: int, centro: str = Query("", max_length=150), team_id: int | None = None,
                           user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Schedule: Pre-Approved de los doctores del centro elegido en una orden (miniatura y ventana flotante).
    Solo hojas de las áreas que la persona puede ver en Pre-Approved. `v` cambia cuando cambia algo (en vivo)."""
    import hashlib
    datos = sd.preapproved_de_centro(db, area_id, centro, sd.preapproved_areas_permitidas(db, user), team_id)
    return {"hojas": datos, "v": hashlib.md5(json.dumps(datos, sort_keys=True).encode()).hexdigest()[:16]}


@router.get("/design/api/preapproved/sheets/{sheet_id}")
def api_preapproved_detalle(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    detalle = sd.preapproved_detalle(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada.")
    detalle["puedeEditar"] = user.rol in FAQ_ROLES_EDITAN
    return detalle


@router.get("/design/api/preapproved/sheets/{sheet_id}/version")
def api_preapproved_version(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    """Huella de la hoja abierta (Pre-Approved en vivo): si cambia, la pantalla vuelve a pedirla."""
    s = db.get(sd.DesignPreApprovedSheet, sheet_id)
    if not s:  # la borraron: la pantalla recarga la lista de hojas
        return {"v": None}
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    return {"v": sd.version_preapproved(db, sheet_id)}


@router.post("/design/api/preapproved/sheets")
def api_crear_preapproved_sheet(area_id: int, nombre: str = "",
                                      user: Empleado = Depends(require_modulo("design_schedule")),
                                      db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_area(db, user, area_id)
    if not db.get(DesignArea, area_id):
        raise HTTPException(404, "Área no encontrada.")
    s = sd.crear_preapproved_sheet(db, area_id, nombre)
    return {"id": s.id, "nombre": s.nombre}


class PreApprovedSheetIn(BaseModel):
    nombre: str | None = None
    titulo: str | None = None
    changesLabel: str | None = None


@router.post("/design/api/preapproved/sheets/{sheet_id}")
def api_actualizar_preapproved_sheet(sheet_id: int, payload: PreApprovedSheetIn,
                                           user: Empleado = Depends(require_modulo("design_schedule")),
                                           db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    s = sd.actualizar_preapproved_sheet(db, sheet_id, {"nombre": payload.nombre, "titulo": payload.titulo,
                                                       "changes_label": payload.changesLabel})
    if not s:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/eliminar")
def api_eliminar_preapproved_sheet(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                         db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    if not sd.eliminar_preapproved_sheet(db, sheet_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/centros")
def api_agregar_centro(sheet_id: int, nombre: str = "", doctores: int = 1,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    if not db.get(sd.DesignPreApprovedSheet, sheet_id):
        raise HTTPException(404, "Hoja no encontrada.")
    c = sd.preapproved_agregar_centro(db, sheet_id, nombre, doctores)
    return {"id": c.id}


class CentroIn(BaseModel):
    nombre: str = ""
    span: int = 1


@router.post("/design/api/preapproved/centros/{centro_id}")
def api_actualizar_centro(centro_id: int, payload: CentroIn,
                                user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedCentro, centro_id)
    sd.preapproved_actualizar_centro(db, centro_id, payload.nombre, payload.span)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/centros/{centro_id}/eliminar")
def api_eliminar_centro(centro_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedCentro, centro_id)
    if not sd.preapproved_eliminar_centro(db, centro_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/doctores")
def api_agregar_doctor(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    if not db.get(sd.DesignPreApprovedSheet, sheet_id):
        raise HTTPException(404, "Hoja no encontrada.")
    d = sd.preapproved_agregar_doctor(db, sheet_id)
    return {"id": d.id}


class NombreIn(BaseModel):
    nombre: str = ""


@router.post("/design/api/preapproved/doctores/{doctor_id}")
def api_renombrar_doctor(doctor_id: int, payload: NombreIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedDoctor, doctor_id)
    sd.preapproved_renombrar_doctor(db, doctor_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/doctores/{doctor_id}/eliminar")
def api_eliminar_doctor(doctor_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedDoctor, doctor_id)
    if not sd.preapproved_eliminar_doctor(db, doctor_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado."}


@router.post("/design/api/preapproved/sheets/{sheet_id}/filas")
def api_agregar_fila(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    if not db.get(sd.DesignPreApprovedSheet, sheet_id):
        raise HTTPException(404, "Hoja no encontrada.")
    f = sd.preapproved_agregar_fila(db, sheet_id)
    return {"id": f.id}


@router.post("/design/api/preapproved/filas/{fila_id}")
def api_renombrar_fila(fila_id: int, payload: NombreIn,
                             user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedFila, fila_id)
    sd.preapproved_renombrar_fila(db, fila_id, payload.nombre)
    return {"mensaje": "Actualizado."}


@router.post("/design/api/preapproved/filas/{fila_id}/eliminar")
def api_eliminar_fila(fila_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedFila, fila_id)
    if not sd.preapproved_eliminar_fila(db, fila_id, user.nombre_completo):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada."}


class CeldaIn(BaseModel):
    filaId: int
    doctorId: int
    valor: str = ""


@router.post("/design/api/preapproved/celdas")
def api_guardar_celda(payload: CeldaIn, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedFila, payload.filaId)
    _pa_de(db, user, sd.DesignPreApprovedDoctor, payload.doctorId)
    sd.preapproved_guardar_celda(db, payload.filaId, payload.doctorId, payload.valor)
    return {"mensaje": "Guardado."}


# ---------- Fotos en las celdas de Pre-Approved ----------

def _pa_foto_area(db: Session, user: Empleado, foto_id: int):
    hoja = sd.preapproved_hoja_de_foto(db, foto_id)
    if not hoja:
        raise HTTPException(404, "Foto no encontrada.")
    _pa_area(db, user, hoja.area_id)
    return hoja


@router.get("/design/api/preapproved/fotos/{foto_id}")
def api_pa_foto(foto_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pa_foto_area(db, user, foto_id)
    f = db.get(sd.DesignPreApprovedFoto, foto_id)
    # una foto no cambia nunca (si se reemplaza, es otra con otro id): el navegador la guarda
    return Response(f.datos, media_type=f.tipo, headers={"Cache-Control": "private, max-age=2592000, immutable",
                                                         "X-Content-Type-Options": "nosniff"})


@router.post("/design/api/preapproved/fotos")
async def api_pa_subir_foto(filaId: int = Form(...), doctorId: int = Form(...), archivo: UploadFile = File(...),
                            user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedFila, filaId)
    _pa_de(db, user, sd.DesignPreApprovedDoctor, doctorId)
    tipo = (archivo.content_type or "").lower()
    if tipo not in sd.PA_FOTO_TIPOS:
        raise HTTPException(400, "Solo se pueden subir imágenes (PNG, JPG, WEBP o GIF).")
    datos = await archivo.read(sd.PA_FOTO_MAX + 1)
    if len(datos) > sd.PA_FOTO_MAX:
        raise HTTPException(400, "La foto pesa más de 8 MB.")
    if not datos:
        raise HTTPException(400, "El archivo está vacío.")
    f = sd.preapproved_agregar_foto(db, filaId, doctorId, archivo.filename or "foto", tipo, datos, user.nombre_completo)
    if not f:
        raise HTTPException(404, "La celda ya no existe.")
    db.commit()
    return {"id": f.id}


@router.post("/design/api/preapproved/fotos/{foto_id}/eliminar")
def api_pa_eliminar_foto(foto_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_foto_area(db, user, foto_id)
    db.delete(db.get(sd.DesignPreApprovedFoto, foto_id))
    db.commit()
    return {"mensaje": "Eliminada."}


class AnchoIn(BaseModel):
    clave: str
    px: int | None = None


@router.post("/design/api/preapproved/sheets/{sheet_id}/anchos")
def api_preapproved_ancho(sheet_id: int, payload: AnchoIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _pa_editor(user)
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    if not sd.preapproved_guardar_ancho(db, sheet_id, payload.clave, payload.px):
        raise HTTPException(404, "Hoja no encontrada.")
    return {"mensaje": "Guardado."}


# ---------- Pre-Approved "Cambios": mover/intercambiar doctores y centros entre managers ----------

class PACMoverDoctorIn(BaseModel):
    doctorId: int
    sheetDestinoId: int
    centroDestinoId: int | None = None


class PACMoverCentroIn(BaseModel):
    centroId: int
    sheetDestinoId: int
    centroDestinoId: int | None = None


class PACIntercambiarDoctorIn(BaseModel):
    doctorAId: int
    doctorBId: int


class PACIntercambiarCentroIn(BaseModel):
    centroAId: int
    centroBId: int


def _pac_respuesta(resultado: dict) -> dict:
    if "error" in resultado:
        raise HTTPException(400, resultado["error"])
    return resultado


@router.post("/design/api/preapproved/cambios/mover-doctor")
def api_pac_mover_doctor(payload: PACMoverDoctorIn, user: Empleado = Depends(require_design_manager),
                               db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedDoctor, payload.doctorId); _pa_de(db, user, sd.DesignPreApprovedSheet, payload.sheetDestinoId)
    return _pac_respuesta(sd.pac_mover_doctor(db, payload.doctorId, payload.sheetDestinoId, payload.centroDestinoId))


@router.post("/design/api/preapproved/cambios/mover-centro")
def api_pac_mover_centro(payload: PACMoverCentroIn, user: Empleado = Depends(require_design_manager),
                               db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedCentro, payload.centroId); _pa_de(db, user, sd.DesignPreApprovedSheet, payload.sheetDestinoId)
    c = db.get(sd.DesignPreApprovedCentro, payload.centroId)
    nombre, area_id = c.nombre, c.sheet.area_id
    r = _pac_respuesta(sd.pac_mover_centro(db, payload.centroId, payload.sheetDestinoId, payload.centroDestinoId))
    if payload.centroDestinoId is None:  # el centro pasó a otro manager: Openings también
        r["openings"] = so.openings_asignar_por_pa(db, area_id, [(nombre, payload.sheetDestinoId)])
    return r


@router.post("/design/api/preapproved/cambios/intercambiar-doctor")
def api_pac_intercambiar_doctor(payload: PACIntercambiarDoctorIn,
                                      user: Empleado = Depends(require_design_manager),
                                      db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedDoctor, payload.doctorAId); _pa_de(db, user, sd.DesignPreApprovedDoctor, payload.doctorBId)
    return _pac_respuesta(sd.pac_intercambiar_doctor(db, payload.doctorAId, payload.doctorBId))


@router.post("/design/api/preapproved/cambios/intercambiar-centro")
def api_pac_intercambiar_centro(payload: PACIntercambiarCentroIn,
                                      user: Empleado = Depends(require_design_manager),
                                      db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedCentro, payload.centroAId); _pa_de(db, user, sd.DesignPreApprovedCentro, payload.centroBId)
    a, b = db.get(sd.DesignPreApprovedCentro, payload.centroAId), db.get(sd.DesignPreApprovedCentro, payload.centroBId)
    cambio = [(a.nombre, b.sheet_id), (b.nombre, a.sheet_id)]
    area_id = a.sheet.area_id
    r = _pac_respuesta(sd.pac_intercambiar_centro(db, payload.centroAId, payload.centroBId))
    r["openings"] = so.openings_asignar_por_pa(db, area_id, cambio)  # cada centro queda con el manager de su nueva hoja
    return r


# ---------- Desempeño (aprobadores y admins: equivalente a "Tools Managers") ----------

@router.get("/design/perf")
def pagina_perf(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "perf")


@router.get("/design/api/perf/sheets")
def api_perf_sheets(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    hojas = [s for s in sd.perf_sheets(db) if sd.perf_sheet_visible(user, s)]
    # El aprobador entra directo a la evaluación de su equipo (la primera hoja de equipo que maneja).
    propia = None if sd.es_admin(user) else next((s.id for s in hojas if s.tipo == "eval" and not sd._es_hoja_general(s.nombre)), None)
    return [{"id": s.id, "nombre": s.nombre, "tipo": s.tipo, "propia": s.id == propia} for s in hojas]


def _perf_sheet(db: Session, user: Empleado, sheet_id: int) -> DesignPerfSheet:
    sheet = db.get(DesignPerfSheet, sheet_id)
    if not sheet:
        raise HTTPException(404, "Hoja no encontrada")
    if not sd.perf_sheet_visible(user, sheet):
        raise HTTPException(403, "Solo puedes ver la evaluación de tu equipo.")
    return sheet


NO_CALIFICA = "Solo puedes calificar a los diseñadores de tu equipo (nunca a ti mismo)."


@router.get("/design/api/perf/sheets/{sheet_id}/eval")
def api_perf_detalle_eval(sheet_id: int, user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    sheet = _perf_sheet(db, user, sheet_id)
    detalle = sd.perf_detalle_eval(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    if not sd.es_admin(user) and sd._es_hoja_general(sheet.nombre):
        # DESIGN MANAGERS: cada aprobador ve solo sus propias calificaciones (sin editar)
        detalle["empleados"] = [e for e in detalle["empleados"] if sd._es_la_persona(e["nombre"], user)]
    for e in detalle["empleados"]:
        e["editable"] = sd.perf_puede_calificar(user, db.get(DesignPerfEmpleado, e["id"]))
    return detalle


def _perf_empleado_calificable(db: Session, user: Empleado, empleado_id: int) -> None:
    emp = db.get(DesignPerfEmpleado, empleado_id)
    if not emp:
        raise HTTPException(404, "Persona no encontrada.")
    if not sd.perf_puede_calificar(user, emp):
        raise HTTPException(403, NO_CALIFICA)


class PerfCeldaIn(BaseModel):
    empleadoId: int
    criterioId: int
    mesIndice: int = Field(ge=0, lt=60)
    nivel: str = ""
    puntaje: float = 0


@router.post("/design/api/perf/celdas")
def api_perf_guardar_celda(payload: PerfCeldaIn, user: Empleado = Depends(require_design_manager),
                                 db: Session = Depends(get_db)):
    _perf_empleado_calificable(db, user, payload.empleadoId)
    sd.perf_guardar_celda(db, payload.empleadoId, payload.criterioId, payload.mesIndice,
                          payload.nivel, payload.puntaje)
    return {"mensaje": "Guardado."}


class PerfNotaIn(BaseModel):
    nota: str = ""


@router.post("/design/api/perf/empleados/{empleado_id}/nota")
def api_perf_guardar_nota(empleado_id: int, payload: PerfNotaIn, user: Empleado = Depends(require_design_manager),
                                db: Session = Depends(get_db)):
    _perf_empleado_calificable(db, user, empleado_id)
    sd.perf_guardar_nota(db, empleado_id, payload.nota)
    return {"mensaje": "Guardado."}


@router.get("/design/api/perf/sheets/{sheet_id}/seleccion")
def api_perf_detalle_seleccion(sheet_id: int, user: Empleado = Depends(require_design_manager),
                                     db: Session = Depends(get_db)):
    _perf_sheet(db, user, sheet_id)
    detalle = sd.perf_detalle_seleccion(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
    detalle["ganadoresEditables"] = sd.es_admin(user)
    if not sd.es_admin(user):
        # Empleado del mes lo deciden y lo ven solo los admins; el aprobador ve y edita solo su fila de nominación.
        detalle["ganadores"], detalle["verGanadores"] = [], False
        detalle["filas"] = [f for f in detalle["filas"] if sd._es_la_persona(f["evaluador"], user)]
    for f in detalle["filas"]:
        f["editable"] = sd.perf_puede_editar_fila_seleccion(user, db.get(DesignPerfSeleccionFila, f["id"]))
    return detalle


class PerfGanadorMesIn(BaseModel):
    mesIndice: int = Field(ge=0, lt=60)
    nombre: str = ""


@router.post("/design/api/perf/ganadores/{ganador_id}")
def api_perf_guardar_ganador(ganador_id: int, payload: PerfGanadorMesIn, user: Empleado = Depends(require_design_manager),
                                   db: Session = Depends(get_db)):
    if not sd.es_admin(user):
        raise HTTPException(403, "El empleado del mes lo registra un administrador.")
    sd.perf_guardar_ganador_mes(db, ganador_id, payload.mesIndice, payload.nombre)
    return {"mensaje": "Guardado."}


class PerfCeldaSeleccionIn(BaseModel):
    mesIndice: int = Field(ge=0, lt=60)
    persona: str = ""
    puntaje: str = ""
    nota: str = ""


@router.post("/design/api/perf/filas/{fila_id}/celdas")
def api_perf_guardar_celda_seleccion(fila_id: int, payload: PerfCeldaSeleccionIn,
                                           user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    fila = db.get(DesignPerfSeleccionFila, fila_id)
    if not fila:
        raise HTTPException(404, "Fila no encontrada.")
    if not sd.perf_puede_editar_fila_seleccion(user, fila):
        raise HTTPException(403, "Solo puedes editar tu propia fila de evaluador.")
    sd.perf_guardar_celda_seleccion(db, fila_id, payload.mesIndice, payload.persona, payload.puntaje, payload.nota)
    return {"mensaje": "Guardado."}


# ---------- Seguimiento en tiempo real (Gestión) ----------

@router.get("/design/api/seguimiento")
def api_seguimiento(fin: str = Query("17:00", max_length=5, pattern=r"^\d{1,2}:\d{2}$"), user: Empleado = Depends(require_design_manager),
                    db: Session = Depends(get_db)):
    """Qué está haciendo cada diseñador ahora (libre, en pausa, con casos asignados, ocupado o ausente) y, por equipo,
    si alcanza a cumplir lo programado hoy antes de `fin` (fin de la jornada, HH:MM). Los admins ven todas las áreas;
    un aprobador, solo la suya."""
    return sd.seguimiento_visible(db, user, fin_jornada=fin)   # un aprobador solo ve su área (19-oct-2026)


class TemaIn(BaseModel):
    tema: Literal["claro", "oscuro"]


@router.post("/design/api/preferencias/tema")
def api_preferencia_tema(payload: TemaIn, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Modo oscuro de Design: se guarda por persona (vale en cualquier computador)."""
    from ..models_design import DesignPreferencia
    p = db.get(DesignPreferencia, user.id)
    if not p:
        p = DesignPreferencia(empleado_id=user.id)
        db.add(p)
    p.tema, p.actualizado_en = payload.tema, datetime.utcnow()
    db.commit()
    return {"tema": p.tema}


@router.get("/design/api/seguimiento/produccion")
def api_seguimiento_produccion(fecha: str = "", user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    """N3/N2 Producción: el reporte diario de cada equipo (diseñadores en turno y casos nuevos por centro)."""
    return {"fecha": (_fecha(fecha) if fecha else sd.ahora_colombia().date()).isoformat(),
            "equipos": sprod.produccion(db, _fecha(fecha) if fecha else sd.ahora_colombia().date())}


# ---------- Papelera ----------

@router.get("/design/papelera")
def pagina_papelera(request: Request, user: Empleado = Depends(require_admin)):   # Papelera: solo admins (13-oct-2026)
    return _redirigir_a_panel(request, "papelera")


@router.get("/design/api/papelera")
def api_papelera_listar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return [{"id": t.id, "modulo": t.modulo, "etiqueta": t.etiqueta, "eliminado_por": t.eliminado_por,
            "eliminado_en": t.eliminado_en.strftime("%d/%m/%Y %H:%M")} for t in sd.trash_listar(db)]


# Lo que solo los admins editan (Protocolos, Openings) tampoco lo restaura un aprobador desde la Papelera.
PAPELERA_SOLO_ADMIN = ("protocol", "openings-fila", "openings-col")


@router.post("/design/api/papelera/{trash_id}/restaurar")
def api_papelera_restaurar(trash_id: int, user: Empleado = Depends(require_admin),
                                 db: Session = Depends(get_db)):
    t = db.get(sd.DesignTrash, trash_id)
    if t and t.modulo in PAPELERA_SOLO_ADMIN and user.rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Solo los administradores pueden restaurar esto.")
    modulo = t.modulo if t else ""
    if not sd.trash_restaurar(db, trash_id):
        raise HTTPException(400, "No se pudo restaurar (el destino cambió demasiado o ya no existe).")
    if modulo == "openings-fila":  # un centro que vuelve a Openings vuelve a ordenar Pre-Approved
        so.tras_cambio_openings(db, user.nombre_completo)
    return {"mensaje": "Restaurado."}


@router.post("/design/api/papelera/{trash_id}/eliminar")
def api_papelera_eliminar(trash_id: int, user: Empleado = Depends(require_admin),
                                db: Session = Depends(get_db)):
    if not sd.trash_eliminar_permanente(db, trash_id):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Eliminado del historial."}


@router.post("/design/api/papelera/vaciar")
def api_papelera_vaciar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    sd.trash_vaciar(db)
    return {"mensaje": "Historial vaciado."}


# ---------- Favoritos ----------

@router.get("/design/favoritos")
def pagina_favoritos(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "favoritos")


@router.get("/design/api/favoritos")
def api_favoritos(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return sd.favoritos_de(db, user.id, sd.preapproved_areas_permitidas(db, user))


@router.get("/design/api/favoritos/activos")
def api_favoritos_activos(user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    activos = sd.favoritos_activos(db, user.id)
    return {"teams": list(activos["teams"]), "preapproved": list(activos["preapproved"]),
           "protocolos": list(activos["protocolos"]), "cmtTemplates": list(activos["cmtTemplates"])}


@router.post("/design/api/favoritos/team/{team_id}/toggle")
def api_favorito_toggle_team(team_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    if team_id not in sd.favoritos_activos(db, user.id)["teams"]:
        _verificar_equipo(db, user, team_id)  # solo se marcan equipos que la persona puede ver (quitar, siempre)
    return {"favorito": sd.favorito_toggle_team(db, user.id, team_id)}


@router.post("/design/api/favoritos/preapproved/{sheet_id}/toggle")
def api_favorito_toggle_preapproved(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                          db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    _exigir_para_marcar(db, user, "preapproved", sheet_id, sd.DesignPreApprovedSheet, "Hoja no encontrada.")
    return {"favorito": sd.favorito_toggle_preapproved(db, user.id, sheet_id)}


@router.post("/design/api/favoritos/protocolo/{protocolo_id}/toggle")
def api_favorito_toggle_protocolo(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                        db: Session = Depends(get_db)):
    _exigir_para_marcar(db, user, "protocolos", protocolo_id, sd.DesignProtocolo, "Protocolo no encontrado.")
    return {"favorito": sd.favorito_toggle_protocolo(db, user.id, protocolo_id)}


def _exigir_para_marcar(db: Session, user: Empleado, clave: str, obj_id: int, modelo, msg: str) -> None:
    """Al marcar un favorito el elemento debe existir (antes: error 500 por la llave foránea en Postgres).
    Quitar un favorito siempre se puede, aunque el elemento ya no exista."""
    if obj_id not in sd.favoritos_activos(db, user.id)[clave] and not db.get(modelo, obj_id):
        raise HTTPException(404, msg)


# ---------- Protocols ----------

@router.get("/design/protocols")
def pagina_protocols(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "protocols")


# Protocolos: solo los admins suben, editan o eliminan (1-oct-2026); el resto los consulta.
PROTOCOLOS_ROLES_EDITAN = ("admin", "superadmin")


def _pr_editor(user: Empleado) -> None:
    if user.rol not in PROTOCOLOS_ROLES_EDITAN:
        raise HTTPException(403, "Solo los administradores pueden subir o editar protocolos.")


def _pr_area_permitida(db: Session, user: Empleado, area_id: int) -> None:
    """Cada equipo ve los protocolos de su área y de su pareja (N2↔Face, N3↔N6); ver sd.pr_areas_permitidas."""
    permitidas = sd.pr_areas_permitidas(db, user)
    if permitidas is not None and area_id not in permitidas:
        raise HTTPException(403, "No tienes acceso a los protocolos de esa área.")


def _pr_protocolo_permitido(db: Session, user: Empleado, protocolo_id: int) -> None:
    if not sd.pr_puede_ver(db, protocolo_id, sd.pr_areas_permitidas(db, user)):
        raise HTTPException(403, "No tienes acceso a este protocolo.")


@router.get("/design/api/protocolos")
def api_protocolos_listar(area_id: int = 0, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    _pr_area_permitida(db, user, area_id)
    return {"protocolos": sd.protocolos_listar(db, area_id or None), "puedeEditar": user.rol in PROTOCOLOS_ROLES_EDITAN}


@router.get("/design/api/protocolos/buscar")
def api_protocolos_buscar(q: str = "", area_id: int = 0, protocolo_id: int = 0, solo: str = "",
                                user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_area_permitida(db, user, area_id)
    ids = [int(x) for x in solo.split(",") if x.strip().isdigit()]
    return sd.protocolos_buscar(db, area_id or None, q, protocolo_id or None, protocolo_ids=ids or None)


@router.get("/design/api/protocolos/espacio")
def api_protocolos_espacio(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_editor(user)
    return sd.pr_espacio(db)


@router.get("/design/api/protocolos/{protocolo_id}")
def api_protocolo_detalle(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    p = sd.protocolo_detalle(db, protocolo_id)
    if not p:
        raise HTTPException(404, "No encontrado.")
    _pr_protocolo_permitido(db, user, protocolo_id)
    d = sd.pr_resumen(db, p)
    d["contenido"] = p.contenido
    return d


@router.get("/design/api/protocolos/{protocolo_id}/pdf")
def api_protocolo_pdf(protocolo_id: int, request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    """Sirve el PDF por rangos (el visor pide solo las partes que necesita) o completo en streaming,
    leyendo de la base de datos de a 1 MB para no cargar archivos grandes en memoria."""
    a = sd.pr_archivo_info(db, protocolo_id)
    if not a:
        raise HTTPException(404, "Este protocolo no tiene PDF.")
    _pr_protocolo_permitido(db, user, protocolo_id)
    archivo_id, total = a.id, int(a.tamano or 0)
    nombre = (a.nombre or "protocolo.pdf").replace('"', "").encode("ascii", "ignore").decode() or "protocolo.pdf"
    base = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400", "ETag": f'"pr{archivo_id}-{total}"',
            "Content-Disposition": f'inline; filename="{nombre}"'}
    rango = request.headers.get("range", "")
    m = re.match(r"bytes=(\d*)-(\d*)$", rango.strip())
    if m and total:
        ini = int(m.group(1)) if m.group(1) else max(0, total - int(m.group(2) or 0))
        fin = min(int(m.group(2)), total - 1) if (m.group(1) and m.group(2)) else total - 1
        fin = min(fin, ini + 2 * 1024 * 1024 - 1)  # el cliente pide el resto en otra petición (RFC 9110)
        if ini >= total or fin < ini:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        datos = sd.pr_archivo_trozo(db, archivo_id, ini, fin - ini + 1)
        return Response(content=datos, status_code=206, media_type="application/pdf",
                        headers={**base, "Content-Range": f"bytes {ini}-{fin}/{total}", "Content-Length": str(len(datos))})

    def trozos():
        from ..database import SessionLocal
        s2 = SessionLocal()
        try:
            pos = 0
            while pos < total:
                d = sd.pr_archivo_trozo(s2, archivo_id, pos, 1024 * 1024)
                if not d:
                    break
                yield d
                pos += len(d)
        finally:
            s2.close()
    return StreamingResponse(trozos(), media_type="application/pdf", headers={**base, "Content-Length": str(total)})


# Miniatura de la primera diapositiva: la tarjeta muestra esta imagen en vez de abrir el PDF (que es lento).
PR_MINI_TIPOS = ("image/jpeg", "image/png", "image/webp")


@router.get("/design/api/protocolos/{protocolo_id}/miniatura")
def api_protocolo_miniatura(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                            db: Session = Depends(get_db)):
    a = sd.pr_archivo_info(db, protocolo_id)
    m = sd.pr_miniatura(db, a.id) if a else None
    if not m:
        raise HTTPException(404, "Sin miniatura.")
    _pr_protocolo_permitido(db, user, protocolo_id)
    return Response(content=m.datos, media_type=m.tipo,
                    headers={"Cache-Control": "private, max-age=604800", "ETag": f'"mini{a.id}"'})


@router.post("/design/api/protocolos/{protocolo_id}/miniatura")
async def api_protocolo_miniatura_guardar(protocolo_id: int, request: Request,
                                          user: Empleado = Depends(require_modulo("design_schedule")),
                                          db: Session = Depends(get_db)):
    tipo = (request.headers.get("content-type") or "").split(";")[0].strip()
    if tipo not in PR_MINI_TIPOS:
        raise HTTPException(400, "Formato de imagen no válido.")
    datos = await request.body()
    if not datos or len(datos) > 400 * 1024:
        raise HTTPException(400, "La miniatura debe pesar menos de 400 KB.")
    a = sd.pr_archivo_info(db, protocolo_id)
    if not a:
        raise HTTPException(404, "Este protocolo no tiene PDF.")
    _pr_protocolo_permitido(db, user, protocolo_id)
    # La primera que llega queda; solo quien edita protocolos puede reemplazarla.
    guardada = sd.pr_miniatura_guardar(db, a.id, tipo, datos, reemplazar=user.rol in PROTOCOLOS_ROLES_EDITAN)
    return {"ok": True, "guardada": guardada}


class PdfNuevoIn(BaseModel):
    nombre: str = ""
    tamano: int


@router.post("/design/api/protocolos/subida")
def api_protocolo_subida_iniciar(payload: PdfNuevoIn, user: Empleado = Depends(require_modulo("design_schedule")),
                                       db: Session = Depends(get_db)):
    _pr_editor(user)
    if payload.tamano <= 0 or payload.tamano > sd.PR_MAX_BYTES:
        raise HTTPException(413, f"El PDF debe pesar menos de {sd.PR_MAX_BYTES // (1024 * 1024)} MB.")
    a = sd.pr_subida_iniciar(db, payload.nombre, payload.tamano)
    return {"archivoId": a.id, "parte": sd.PR_PARTE_MAX - 1024 * 1024}


@router.post("/design/api/protocolos/subida/{archivo_id}/parte")
async def api_protocolo_subida_parte(archivo_id: int, offset: int, request: Request,
                                     user: Empleado = Depends(require_modulo("design_schedule")),
                                     db: Session = Depends(get_db)):
    _pr_editor(user)
    if int(request.headers.get("content-length") or 0) > sd.PR_PARTE_MAX:
        raise HTTPException(413, "Parte del archivo inválida.")
    datos = await request.body()
    if not datos or len(datos) > sd.PR_PARTE_MAX:
        raise HTTPException(413, "Parte del archivo inválida.")
    try:
        largo = await run_in_threadpool(sd.pr_subida_parte, db, archivo_id, offset, datos)
    except ValueError as e:
        raise HTTPException(409, str(e))
    if largo is None:
        raise HTTPException(404, "La subida no existe o ya terminó.")
    return {"recibido": largo}


class PdfFinalizarIn(BaseModel):
    titulo: str = ""
    areas: list[int] = []
    version: str = "v1.0"
    paginas: list[str] = []


@router.post("/design/api/protocolos/subida/{archivo_id}/finalizar")
def api_protocolo_subida_finalizar(archivo_id: int, payload: PdfFinalizarIn,
                                         user: Empleado = Depends(require_modulo("design_schedule")),
                                         db: Session = Depends(get_db)):
    _pr_editor(user)
    if not payload.areas:
        raise HTTPException(400, "Elige al menos un área.")
    try:
        p = sd.pr_subida_finalizar(db, archivo_id, payload.titulo, payload.areas, payload.paginas,
                                   payload.version, user.nombre_completo)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": p.id}


class ProtocoloEditIn(BaseModel):
    titulo: str | None = None
    areas: list[int] | None = None
    version: str | None = None


@router.post("/design/api/protocolos/{protocolo_id}")
def api_protocolo_actualizar(protocolo_id: int, payload: ProtocoloEditIn,
                                   user: Empleado = Depends(require_modulo("design_schedule")),
                                   db: Session = Depends(get_db)):
    _pr_editor(user)
    if payload.areas is not None and not payload.areas:
        raise HTTPException(400, "Elige al menos un área.")
    if not sd.protocolo_actualizar(db, protocolo_id, payload.titulo, payload.areas, payload.version):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Actualizado."}


class ProtocoloIn(BaseModel):
    areaId: int | None = None
    areas: list[int] | None = None
    titulo: str
    descripcion: str = ""
    contenido: str = ""
    version: str = "v1.0"


@router.post("/design/api/protocolos")
def api_protocolo_crear(payload: ProtocoloIn, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    _pr_editor(user)
    p = sd.protocolo_crear(db, payload.areaId, payload.titulo, payload.descripcion, payload.contenido,
                           payload.version, user.nombre_completo, payload.areas)
    return {"id": p.id}


# ---------- Protocols: editar en Nuvia Office, publicar versión nueva e historial ----------

class PrBorradorIn(BaseModel):
    contenido: str
    reemplazar: bool = False


@router.get("/design/api/protocolos/{protocolo_id}/borrador")
def api_pr_borrador(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_editor(user)
    try:
        return spe.estado_borrador(db, protocolo_id, user)
    except KeyError:
        raise HTTPException(404, "El protocolo no existe.")


@router.post("/design/api/protocolos/{protocolo_id}/borrador")
def api_pr_borrador_crear(protocolo_id: int, payload: PrBorradorIn, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    _pr_editor(user)
    try:
        doc = spe.crear_borrador(db, protocolo_id, user, payload.contenido, payload.reemplazar)
    except KeyError:
        raise HTTPException(404, "El protocolo no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"docId": doc.id}


class PrPublicarIn(BaseModel):
    archivoId: int
    paginas: list[str] = []
    version: str = Field("", max_length=20)
    nota: str = Field("", max_length=500)


@router.post("/design/api/protocolos/{protocolo_id}/publicar")
def api_pr_publicar(protocolo_id: int, payload: PrPublicarIn, user: Empleado = Depends(require_modulo("design_schedule")),
                    db: Session = Depends(get_db)):
    _pr_editor(user)
    try:
        p = spe.publicar(db, protocolo_id, payload.archivoId, payload.paginas, payload.version, payload.nota, user.nombre_completo)
    except KeyError:
        raise HTTPException(404, "El protocolo no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return sd.pr_resumen(db, p)


@router.get("/design/api/protocolos/{protocolo_id}/versiones")
def api_pr_versiones(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_protocolo_permitido(db, user, protocolo_id)
    return {"versiones": spe.versiones(db, protocolo_id), "puedeEditar": user.rol in PROTOCOLOS_ROLES_EDITAN}


@router.get("/design/api/protocolos/versiones/{version_id}/pdf")
def api_pr_version_pdf(version_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    v, a = spe.version_archivo(db, version_id)
    if not v or not a:
        raise HTTPException(404, "Esa versión ya no está disponible.")
    _pr_protocolo_permitido(db, user, v.protocolo_id)
    nombre = re.sub(r"[^A-Za-z0-9 ._-]", "", (a.nombre or "protocolo.pdf").rsplit(".", 1)[0])[:120] or "protocolo"
    total = int(a.tamano or 0)

    def trozos():
        from ..database import SessionLocal
        s2 = SessionLocal()
        try:
            pos = 0
            while pos < total:
                d = sd.pr_archivo_trozo(s2, a.id, pos, 1024 * 1024)
                if not d:
                    break
                yield d
                pos += len(d)
        finally:
            s2.close()
    return StreamingResponse(trozos(), media_type="application/pdf",
                             headers={"Content-Length": str(total), "Cache-Control": "private, max-age=86400",
                                      "Content-Disposition": f'inline; filename="{nombre} {v.version}.pdf"'})


@router.post("/design/api/protocolos/versiones/{version_id}/eliminar")
def api_pr_version_eliminar(version_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_editor(user)
    try:
        spe.borrar_version(db, version_id)
    except KeyError:
        raise HTTPException(404, "La versión no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/design/api/protocolos/versiones/{version_id}/restaurar")
def api_pr_version_restaurar(version_id: int, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    _pr_editor(user)
    try:
        p = spe.restaurar_version(db, version_id, user.nombre_completo)
    except KeyError:
        raise HTTPException(404, "La versión no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return sd.pr_resumen(db, p)


@router.post("/design/api/protocolos/{protocolo_id}/eliminar")
def api_protocolo_eliminar(protocolo_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                 db: Session = Depends(get_db)):
    _pr_editor(user)
    if not sd.protocolo_eliminar(db, protocolo_id, user.nombre_completo):
        raise HTTPException(404, "No encontrado.")
    return {"mensaje": "Enviado a la Papelera."}


# ---------- Canvas ----------

@router.get("/design/canvas")
def pagina_canvas(request: Request, user: Empleado = Depends(require_modulo("design_schedule"))):
    return _redirigir_a_panel(request, "canvas")


@router.get("/design/api/canvas/docs")
def api_canvas_docs(area_id: int, ver_de: int | None = None, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    docs = sd.canvas_docs(db, area_id, user, ver_de)
    if docs is None:
        raise HTTPException(403, "No puedes ver las hojas de esa persona.")
    return docs


@router.get("/design/api/canvas/personas")
def api_canvas_personas(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    """Personas del área cuyas hojas puede ver quien consulta (managers: sus equipos; admins: todas)."""
    return sd.canvas_personas_visibles(db, user, area_id)


@router.get("/design/api/canvas/docs/{doc_id}")
def api_canvas_doc(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                         db: Session = Depends(get_db)):
    d = sd.canvas_doc(db, doc_id, user)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return d


class CanvasCrearIn(BaseModel):
    areaId: int
    nombre: str = "Hoja"
    templateId: str = ""
    titulo: str = ""
    frames: list = []


@router.post("/design/api/canvas/docs")
def api_canvas_crear(payload: CanvasCrearIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    d = sd.canvas_crear_doc(db, payload.areaId, payload.nombre, payload.templateId, payload.titulo,
                            payload.frames, user)
    return sd.canvas_serializar(d)


class CanvasGuardarIn(BaseModel):
    nombre: str | None = None
    titulo: str | None = None
    tituloColor: str | None = None
    w: int | None = None
    h: int | None = None
    frames: list | None = None
    elements: list | None = None


@router.post("/design/api/canvas/docs/{doc_id}")
def api_canvas_guardar(doc_id: int, payload: CanvasGuardarIn,
                             user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    datos = {k: v for k, v in payload.model_dump().items() if v is not None}
    d = sd.canvas_guardar_doc(db, doc_id, datos, user)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Guardado."}


@router.post("/design/api/canvas/docs/{doc_id}/renombrar")
def api_canvas_renombrar(doc_id: int, payload: NombreIn, user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    if not sd.canvas_renombrar_doc(db, doc_id, payload.nombre, user):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/canvas/docs/{doc_id}/duplicar")
def api_canvas_duplicar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    d = sd.canvas_duplicar_doc(db, doc_id, user)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return sd.canvas_serializar(d)


class CanvasMoverIn(BaseModel):
    targetId: int


@router.post("/design/api/canvas/docs/{doc_id}/mover")
def api_canvas_mover(doc_id: int, payload: CanvasMoverIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    if not sd.canvas_mover_doc(db, doc_id, payload.targetId, user):
        raise HTTPException(400, "No se pudo mover.")
    return {"mensaje": "Movida."}


@router.post("/design/api/canvas/docs/{doc_id}/eliminar")
def api_canvas_eliminar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    trash_id = sd.canvas_eliminar_doc(db, doc_id, user)
    if not trash_id:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Eliminada.", "papeleraId": trash_id}


@router.post("/design/api/canvas/deshacer/{trash_id}")
def api_canvas_deshacer(trash_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    r = sd.canvas_deshacer_eliminar(db, trash_id, user.id)
    if r == "ok":
        return {"mensaje": "Hoja restaurada."}
    mensajes = {"no-existe": "La hoja ya no está en la Papelera.", "ajena": "Solo quien borró la hoja puede deshacerlo.",
                "vencido": "Pasó el tiempo para deshacer; pídele a un líder que la restaure desde la Papelera.",
                "error": "No se pudo restaurar la hoja."}
    raise HTTPException(400, mensajes.get(r, "No se pudo restaurar la hoja."))


# ---------- Nuvia Office (Herramientas): rutas en routers/design_office.py ----------
from .design_office import router as _office_router  # noqa: E402  (importa require_design_manager de aquí)
router.include_router(_office_router)


# ---------- Página de Inicio de Design (editor, medios y muro): rutas en routers/design_inicio.py ----------
from .design_inicio import router as _inicio_router  # noqa: E402
router.include_router(_inicio_router)

# ---------- Support Time (turnos rotativos de Support y coberturas): rutas en routers/design_support.py ----------
from .design_support import router as _support_router  # noqa: E402
router.include_router(_support_router)

# ---------- Training (aprendizaje interactivo bilingüe): rutas en routers/design_training.py ----------
from .design_training import router as _training_router  # noqa: E402
router.include_router(_training_router)

# ---------- Solicitar ayuda (aprobadores de N3): rutas en routers/design_ayuda.py ----------
from .design_ayuda import router as _ayuda_router  # noqa: E402
router.include_router(_ayuda_router)

# ---------- Mural (en construcción, solo Rosember): rutas en routers/design_mural.py ----------
from .design_mural import router as _mural_router  # noqa: E402
router.include_router(_mural_router)

# ---------- Notificaciones push (Web Push): rutas en routers/design_push.py ----------
from .design_push import router as _push_router  # noqa: E402
router.include_router(_push_router)

# ---------- En vivo por aviso del servidor (Server-Sent Events): routers/design_vivo.py ----------
from .design_vivo import router as _vivo_router  # noqa: E402
router.include_router(_vivo_router)

# ---------- Calendario (Gestión / Herramientas): rutas en routers/design_calendario.py ----------
from .design_calendario import router as _calendario_router  # noqa: E402
router.include_router(_calendario_router)

# ---------- Training › Pizarrón: rutas en routers/design_pizarron.py ----------
from .design_pizarron import router as _pizarron_router  # noqa: E402
router.include_router(_pizarron_router)

# ---------- Pizarrón › Reunión en vivo (cámara y micrófono entre PCs): rutas en routers/design_reunion.py ----------
from .design_reunion import router as _reunion_router  # noqa: E402
router.include_router(_reunion_router)

# ---------- Cumpleaños (anuncio del día + Parameters › Formatos Canva): rutas en routers/design_cumple.py ----------
from .design_cumple import router as _cumple_router  # noqa: E402
router.include_router(_cumple_router)

# ---------- Development (proyectos y protocolos; admins + Luis Felipe y Paul): rutas en routers/design_dev.py ----------
from .design_dev import router as _dev_router  # noqa: E402
router.include_router(_dev_router)
