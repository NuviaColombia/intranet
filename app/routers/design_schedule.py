"""Rutas del módulo Design Schedule: horario del equipo de diseño y su administración."""
import logging
import os
import re
from datetime import date, datetime
from typing import Literal
from fastapi import APIRouter, Request, Depends, Form, HTTPException, Query
from ..concurrencia import clase_con_cupo
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_design import (DesignArea, DesignTeam, DesignTeamDesigner, DesignCatalogo, DesignAusenciaTipo, DesignOrden,
                             DesignPerfSheet, DesignPerfEmpleado, DesignPerfSeleccionFila, FORMATO_SUPPORT)
from ..auth import get_current_user
from ..main_templates import templates
from .. import services_design as sd


# ---------- Simulación (solo Design): un admin ve y usa Design como otra persona ----------
# El admin elige a alguien en /design/simulacion y, mientras dure, TODAS las rutas de Design lo tratan como esa
# persona (lo que ve y lo que guarda queda a su nombre). Cada cambio hecho simulando queda en el log del servidor
# con el admin real. Fuera de Design la intranet sigue igual: el inicio de sesión no cambia.
SIM_KEY = "design_simular_id"
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
    sim = _aplicar_rol_design(db, db.get(Empleado, sid)) if user.rol in ("admin", "superadmin") else None
    if not sim or not sim.activo:
        request.session.pop(SIM_KEY, None)
        return user
    request.state.design_real = user
    if request.method != "GET":
        _log_sim.warning("SIMULACION %s (%s) como %s (%s): %s %s", user.email, user.id, sim.email, sim.id,
                         request.method, request.url.path)
    return sim


def _sin_acceso_simulando(request: Request, sim: Empleado):
    if getattr(request.state, "design_real", None):  # simulando: volver a elegir, no salir de Design
        raise HTTPException(status_code=307, headers={
            "Location": f"/design/simulacion?msg={sim.nombre_completo} no tiene el módulo Design Schedule."})


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
    """Dashboard y Papelera: aprobadores y admins (igual que app.auth.require_design_manager)."""
    u = _usuario_efectivo(request, user, db)
    if not u.tiene_modulo("design_schedule"):
        _sin_acceso_simulando(request, u)
        raise HTTPException(status_code=307, headers={"Location": "/?error=sin_acceso"})
    if u.rol not in ("aprobador", "admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de aprobador o administrador.")
    return u

# Tope de peticiones de Design usando la base a la vez (ver app/concurrencia.py). Se puede ajustar con la
# variable de entorno DESIGN_CONCURRENCIA (debe quedar por debajo del tamaño del pool junto con el resto).
DESIGN_CONCURRENCIA = max(1, int(os.getenv("DESIGN_CONCURRENCIA", "8")))
_RutaDesign = clase_con_cupo(DESIGN_CONCURRENCIA)


router = APIRouter(route_class=_RutaDesign)

NUVIA_DESIGN = "Nuvia Design Colombia SAS"


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
    request.session[SIM_KEY] = p.id
    _log_sim.warning("SIMULACION inicia %s (%s) como %s (%s)", user.email, user.id, p.email, p.id)
    return RedirectResponse("/design", status_code=303)


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


@router.get("/design")
def pagina(request: Request, user: Empleado = Depends(require_modulo("design_schedule")),
                 db: Session = Depends(get_db)):
    # Áreas y tipos de ausencia van dentro de la página: son 2 peticiones menos por persona al abrir el horario.
    areas = sd.areas_disponibles(db)
    inicio = {"areas": [{"id": a.id, "nombre": a.nombre, "formato": a.formato} for a in areas],
              "ausencias": sd.ausencias_disponibles(db),
              "misEquipos": sd.mis_equipos(db, user),  # empleados y aprobadores entran directo a su schedule
              "comments": sd.comments_permitidos(db, user),
              "miPreapproved": sd.preapproved_hoja_de(db, user)}  # Pre-Approved abre la hoja de su equipo
    inicio["miEquipo"] = ({"areaId": inicio["misEquipos"][0]["areaId"], "teamId": inicio["misEquipos"][0]["teamId"]}
                          if inicio["misEquipos"] else None)
    # `areas` también llena el filtro de Área del Dashboard (desde que Design es una sola página salía vacío).
    return templates.TemplateResponse(request, "design_schedule.html",
                                      {"user": user, "es_design": True, "ds_inicio": inicio, "areas": areas})


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
def parametros(request: Request, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    areas = sd.ordenar_areas(db.query(DesignArea).all())
    teams = (db.query(DesignTeam).order_by(DesignTeam.orden).all())
    candidatos = (db.query(Empleado).filter(Empleado.empresa == NUVIA_DESIGN, Empleado.activo == 1)
                 .order_by(Empleado.apellidos).all())
    ausencias = db.query(DesignAusenciaTipo).order_by(DesignAusenciaTipo.orden).all()
    catalogos = (db.query(DesignCatalogo).order_by(DesignCatalogo.area_id, DesignCatalogo.tipo,
                                                   DesignCatalogo.orden).all())
    return templates.TemplateResponse(request, "design_parametros.html",
                                      {"user": user, "areas": areas, "teams": teams, "candidatos": candidatos,
                                       "candidatos_az": sorted(candidatos, key=lambda e: sd._normalizar_texto(e.nombre_completo)),
                                       "con_ordenes": {tid for (tid,) in db.query(DesignOrden.team_id).distinct()},
                                       "ausencias": ausencias, "catalogos": catalogos, "es_design": True,
                                       "sim_personas": _personas_simulacion(db, user), "sim_abrir": request.query_params.get("sim") == "1",
                                       "msg": request.query_params.get("msg")})


def _personas_simulacion(db: Session, actor: Empleado) -> list[dict]:
    rp_actor = _rol_people(db, actor.id)
    personas = sd.personas_para_simular(db)
    for p in personas:  # p["rol"] y p["empresa"] ya vienen de la base
        p["motivoRol"] = _motivo_rol(actor.id, rp_actor, actor.empresa, p["id"], p["rol"], p["empresa"])
        p["puedeAdmin"] = rp_actor == "superadmin"
    return personas


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


@router.get("/design/api/parametros/personas")
def api_parametros_personas(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    personas = db.query(Empleado).filter(Empleado.activo == 1).all()
    return sorted(({"id": e.id, "nombre": e.nombre_completo} for e in personas), key=lambda x: sd._normalizar_texto(x["nombre"]))


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
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return RedirectResponse("/design/parametros", status_code=303)


@router.post("/design/parametros/equipos/{team_id}/designers")
def agregar_designer(team_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                           empleado_id: int = Form(...)):
    if not db.get(DesignTeam, team_id) or not db.get(Empleado, empleado_id):
        return _param_invalido("El equipo o la persona elegida no existe.")
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
    t.nombre = nombre.strip()
    t.manager_id = mid
    db.commit()
    return RedirectResponse("/design/parametros?msg=Equipo actualizado.", status_code=303)


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


# ---------- API: lectura ----------

def _verificar_equipo(db: Session, user: Empleado, team_id: int) -> DesignTeam:
    team = db.get(DesignTeam, team_id)
    if not team:
        raise HTTPException(404, "Equipo no encontrado.")
    if not sd.gestiona_equipo(user, team) and team_id not in sd.equipos_como_designer(db, user):
        raise HTTPException(403, "No tienes acceso a este equipo.")
    return team


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
        ds = t.designers if sd.gestiona_equipo(user, t) else [d for d in t.designers if d.empleado_id == user.id]
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


@router.get("/design/api/dia")
def api_dia(team_id: int, fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                  db: Session = Depends(get_db)):
    team = _verificar_equipo(db, user, team_id)
    return sd.datos_dia(db, team, _fecha(fecha), None if sd.gestiona_equipo(user, team) else user.id)


@router.get("/design/api/todas-areas")
def api_todas_areas(fecha: str, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    return sd.resumen_todas_areas(db, user, _fecha(fecha))


# ---------- API: escritura ----------

class OrdenIn(BaseModel):
    teamId: int
    fecha: str
    tabla: Literal["principal", "nightguard"] = "principal"
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
    }


DIA_CERRADO = "Este día ya se cerró (5:00 am del día siguiente) y no se puede editar."


@router.post("/design/api/ordenes")
def api_crear_orden(payload: OrdenIn, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, payload.teamId)):
        raise HTTPException(403, SOLO_MANAGER)
    if sd.dia_cerrado(_fecha(payload.fecha)):
        raise HTTPException(403, DIA_CERRADO)
    datos = _datos_desde_in(payload)
    if sd.orden_repetida(db, payload.teamId, _fecha(payload.fecha), datos["orden"]):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    o = sd.crear_orden(db, user, payload.teamId, _fecha(payload.fecha), payload.tabla, datos)
    return sd.serializar_orden(o)


def _msg_repetida(orden: str) -> str:
    return f'Ya existe una orden con el número "{orden}" en este día. Usa un número distinto.'


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
    tabla: Literal["principal", "nightguard"] = "principal"
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
    if sd.dia_cerrado(fecha):
        raise HTTPException(403, DIA_CERRADO)
    if not 1 <= len(payload.filas) <= MAX_LOTE:
        raise HTTPException(400, f"Se pueden crear entre 1 y {MAX_LOTE} órdenes por vez.")
    try:
        validadas = [OrdenIn.model_validate({**fila, "teamId": payload.teamId, "fecha": payload.fecha, "tabla": payload.tabla})
                     for fila in payload.filas]
    except ValueError as e:
        raise HTTPException(400, f"Hay filas con datos inválidos: {str(e)[:200]}")
    vistos = set()
    for datos in validadas:  # número repetido: contra el día y dentro del mismo lote
        n = datos.orden.strip().upper()
        if n and (n in vistos or sd.orden_repetida(db, payload.teamId, fecha, n)):
            raise HTTPException(400, _msg_repetida(n))
        vistos.add(n)
    creadas = []
    for datos in validadas:
        creadas.append(sd.serializar_orden(sd.crear_orden(db, user, payload.teamId, fecha, payload.tabla,
                                                         _datos_desde_in(datos))))
    return creadas


@router.post("/design/api/ordenes/{orden_id}")
def api_actualizar_orden(orden_id: int, payload: OrdenIn,
                               user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    team = db.get(DesignTeam, orden_existente.team_id)
    solo_propia = not sd.gestiona_equipo(user, team)
    if solo_propia:
        # Un diseñador edita sus órdenes: las de su equipo y las de otro equipo que se lo pidió prestado.
        propia = orden_existente.designer_id == user.id and (
            team.id in sd.equipos_como_designer(db, user) or sd.es_orden_prestada_a(db, orden_existente, user))
        if not propia:
            raise HTTPException(403, "Solo puedes editar las órdenes que tienes asignadas.")
    if sd.dia_cerrado(orden_existente.fecha):
        # Día cerrado: solo el QC (checkbox + reporte de hallazgos), y solo hasta las 5:00 am de D+2.
        # El resto de campos se ignora.
        if not sd.qc_editable(orden_existente.fecha):
            raise HTTPException(403, DIA_CERRADO)
        o = sd.actualizar_orden(db, orden_id, {"qc": payload.qc, "qc_reporte": payload.qcReporte})
        return sd.serializar_orden(o)
    datos = _datos_desde_in(payload)
    if (datos["orden"] != (orden_existente.orden or "").strip().upper()
            and sd.orden_repetida(db, orden_existente.team_id, orden_existente.fecha, datos["orden"], orden_id)):
        raise HTTPException(400, _msg_repetida(datos["orden"]))
    if solo_propia:  # un diseñador edita su fila pero no la reasigna
        datos["designer_id"] = orden_existente.designer_id
        datos["designer_prestado"] = orden_existente.designer_prestado
    o = sd.actualizar_orden(db, orden_id, datos)
    return sd.serializar_orden(o)


@router.post("/design/api/ordenes/{orden_id}/eliminar")
def api_eliminar_orden(orden_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                             db: Session = Depends(get_db)):
    orden_existente = db.get(DesignOrden, orden_id)
    if not orden_existente:
        raise HTTPException(404, "Orden no encontrada.")
    if not sd.gestiona_equipo(user, _verificar_equipo(db, user, orden_existente.team_id)):
        raise HTTPException(403, SOLO_MANAGER)
    if sd.dia_cerrado(orden_existente.fecha):
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
    if sd.dia_cerrado(_fecha(payload.fecha)):
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
                        fecha_desde: str = "", fecha_hasta: str = "",
                        user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    fd = _fecha(fecha_desde) if fecha_desde else None
    fh = _fecha(fecha_hasta) if fecha_hasta else None
    return sd.dashboard_query(db, area_id, team_id, designer_id, producto, estado, qc, fd, fh, user)


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


@router.get("/design/api/preapproved/sheets/{sheet_id}")
def api_preapproved_detalle(sheet_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                                  db: Session = Depends(get_db)):
    _pa_de(db, user, sd.DesignPreApprovedSheet, sheet_id)
    detalle = sd.preapproved_detalle(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada.")
    detalle["puedeEditar"] = user.rol in FAQ_ROLES_EDITAN
    return detalle


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
    return _pac_respuesta(sd.pac_mover_centro(db, payload.centroId, payload.sheetDestinoId, payload.centroDestinoId))


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
    return _pac_respuesta(sd.pac_intercambiar_centro(db, payload.centroAId, payload.centroBId))


# ---------- Desempeño (aprobadores y admins: equivalente a "Tools Managers") ----------

@router.get("/design/perf")
def pagina_perf(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "perf")


@router.get("/design/api/perf/sheets")
def api_perf_sheets(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return [{"id": s.id, "nombre": s.nombre, "tipo": s.tipo} for s in sd.perf_sheets(db) if sd.perf_sheet_visible(user, s)]


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
    _perf_sheet(db, user, sheet_id)
    detalle = sd.perf_detalle_eval(db, sheet_id)
    if not detalle:
        raise HTTPException(404, "Hoja no encontrada")
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


# ---------- Papelera ----------

@router.get("/design/papelera")
def pagina_papelera(request: Request, user: Empleado = Depends(require_design_manager)):
    return _redirigir_a_panel(request, "papelera")


@router.get("/design/api/papelera")
def api_papelera_listar(user: Empleado = Depends(require_design_manager), db: Session = Depends(get_db)):
    return [{"id": t.id, "modulo": t.modulo, "etiqueta": t.etiqueta, "eliminado_por": t.eliminado_por,
            "eliminado_en": t.eliminado_en.strftime("%d/%m/%Y %H:%M")} for t in sd.trash_listar(db)]


@router.post("/design/api/papelera/{trash_id}/restaurar")
def api_papelera_restaurar(trash_id: int, user: Empleado = Depends(require_design_manager),
                                 db: Session = Depends(get_db)):
    if not sd.trash_restaurar(db, trash_id):
        raise HTTPException(400, "No se pudo restaurar (el destino cambió demasiado o ya no existe).")
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


def _pr_editor(user: Empleado) -> None:
    if user.rol not in FAQ_ROLES_EDITAN:
        raise HTTPException(403, "Solo líderes y administradores pueden subir o editar protocolos.")


@router.get("/design/api/protocolos")
def api_protocolos_listar(area_id: int = 0, user: Empleado = Depends(require_modulo("design_schedule")),
                                db: Session = Depends(get_db)):
    return {"protocolos": sd.protocolos_listar(db, area_id or None), "puedeEditar": user.rol in FAQ_ROLES_EDITAN}


@router.get("/design/api/protocolos/buscar")
def api_protocolos_buscar(q: str = "", area_id: int = 0, protocolo_id: int = 0, solo: str = "",
                                user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
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
def api_canvas_docs(area_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                          db: Session = Depends(get_db)):
    return sd.canvas_docs(db, area_id)


@router.get("/design/api/canvas/docs/{doc_id}")
def api_canvas_doc(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                         db: Session = Depends(get_db)):
    d = sd.canvas_doc(db, doc_id)
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
                            payload.frames, user.nombre_completo)
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
    d = sd.canvas_guardar_doc(db, doc_id, datos)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Guardado."}


@router.post("/design/api/canvas/docs/{doc_id}/renombrar")
def api_canvas_renombrar(doc_id: int, payload: NombreIn, user: Empleado = Depends(require_modulo("design_schedule")),
                               db: Session = Depends(get_db)):
    if not sd.canvas_renombrar_doc(db, doc_id, payload.nombre):
        raise HTTPException(404, "No encontrada.")
    return {"mensaje": "Renombrada."}


@router.post("/design/api/canvas/docs/{doc_id}/duplicar")
def api_canvas_duplicar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    d = sd.canvas_duplicar_doc(db, doc_id)
    if not d:
        raise HTTPException(404, "No encontrada.")
    return sd.canvas_serializar(d)


class CanvasMoverIn(BaseModel):
    targetId: int


@router.post("/design/api/canvas/docs/{doc_id}/mover")
def api_canvas_mover(doc_id: int, payload: CanvasMoverIn, user: Empleado = Depends(require_modulo("design_schedule")),
                           db: Session = Depends(get_db)):
    if not sd.canvas_mover_doc(db, doc_id, payload.targetId):
        raise HTTPException(400, "No se pudo mover.")
    return {"mensaje": "Movida."}


@router.post("/design/api/canvas/docs/{doc_id}/eliminar")
def api_canvas_eliminar(doc_id: int, user: Empleado = Depends(require_modulo("design_schedule")),
                              db: Session = Depends(get_db)):
    trash_id = sd.canvas_eliminar_doc(db, doc_id, user.nombre_completo, user.id)
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
