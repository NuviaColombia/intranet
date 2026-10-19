"""Diagnóstico de acceso a Design (admins, /design/diagnostico/acceso?persona=...): revisa paso a paso por qué alguien
entra o no a Design y qué Schedules ve. Solo lee: no cambia nada. Creado el 19-oct-2026 (Natalia no veía ningún Schedule).

Reglas que revisa (las mismas que aplica la plataforma):
- Empleado activo, correo no bloqueado y sin inhabilitar en Design (auth.correo_bloqueado / acceso_inhabilitado).
- Empresa «Nuvia Design Colombia SAS» y el módulo Design (o rol admin); el superadmin entra siempre (models.tiene_modulo).
- Rol efectivo: el rol de Design (Parámetros › Simulación) REEMPLAZA al de People, salvo para el superadmin
  (routers/design_schedule._aplicar_rol_design). Solo admin/superadmin ven todos los Schedule; los demás, sus equipos.
"""
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from .models import EMPRESA_DESIGN, Empleado
from .models_design import DesignInhabilitado, DesignRolUsuario, DesignTeam, DesignTeamDesigner
from . import services_design as sd


def _norm(t: str) -> str:
    return sd._normalizar_texto(t or "")


def buscar(db: Session, texto: str) -> list[Empleado]:
    palabras = _norm(texto).split()
    if not palabras:
        return []
    q = db.query(Empleado)
    for p in palabras[:1]:
        q = q.filter(or_(Empleado.nombres.ilike(f"%{p}%"), Empleado.apellidos.ilike(f"%{p}%"), Empleado.email.ilike(f"%{p}%")))
    return [e for e in q.order_by(Empleado.activo.desc(), Empleado.nombres).limit(40).all()
            if all(p in _norm(f"{e.nombres} {e.apellidos} {e.email}") for p in palabras)][:10]


def diagnosticar(db: Session, e: Empleado) -> dict:
    from .auth import correo_bloqueado
    pasos = []
    def paso(ok, texto, arreglo=""):
        pasos.append({"ok": bool(ok), "texto": texto, "arreglo": arreglo if not ok else ""})
    rol_people = db.query(Empleado.rol).filter(Empleado.id == e.id).scalar() or "empleado"   # de la base, sin rol de Design
    paso(e.activo, "Empleado activo en People." if e.activo else "El empleado está INACTIVO en People.", "Actívalo en People.")
    paso(not correo_bloqueado(e.email), f"Correo {e.email} sin bloquear." if not correo_bloqueado(e.email) else f"El correo {e.email} está bloqueado para entrar.",
         "Quítalo de la lista de correos bloqueados (CORREOS_BLOQUEADOS).")
    inh = db.get(DesignInhabilitado, e.id)
    paso(not (inh and inh.activo), "No está inhabilitado en Design." if not (inh and inh.activo) else "Está INHABILITADO en Design.",
         "Habilítalo en Parámetros › Equipos.")
    super_ = rol_people == "superadmin"
    emp_ok = super_ or (e.empresa or "") == EMPRESA_DESIGN
    paso(emp_ok, f"Empresa: {e.empresa or '(vacía)'}." + (" Es superadmin: entra siempre." if super_ else ""),
         f"En People su empresa debe ser «{EMPRESA_DESIGN}» (Design solo se abre a esa empresa; el superadmin entra siempre).")
    r = db.get(DesignRolUsuario, e.id)
    rol_design = r.rol if (r and not super_) else ""
    efectivo = rol_design or rol_people
    mod_ok = super_ or efectivo in ("admin", "superadmin") or "design_schedule" in e.modulos_lista
    paso(mod_ok, "Tiene el módulo Design." if "design_schedule" in e.modulos_lista else
         ("No necesita el módulo: es " + efectivo + "." if mod_ok else "NO tiene el módulo Design (design_schedule)."),
         "Dale el módulo Design Schedule en People.")
    detalle_rol = f"Rol en People: {rol_people}. Rol en Design: " + (f"{rol_design} (asignado por {r.asignado_por or '—'}" +
                  (f" el {r.asignado_en:%d/%m/%Y}" if getattr(r, 'asignado_en', None) else "") + ")" if rol_design else "igual que People") + \
                  f". Rol que usa Design: {efectivo}."
    ve_todo = efectivo in ("admin", "superadmin")
    pisa = bool(rol_design) and rol_people in ("admin", "superadmin") and not ve_todo
    paso(ve_todo, detalle_rol + (" Ve TODOS los Schedule." if ve_todo else ""),
         ("Su rol de Design (" + rol_design + ") está tapando su rol de People (" + rol_people + "). En Parámetros › Simulación cambia su "
          "«Rol en Design» a «Igual que People» (o a admin; solo un superadmin puede darlo).") if pisa else
         "Para ver todos los Schedule su rol en Design debe ser admin (Parámetros › Simulación › Rol en Design; solo un superadmin lo da).")
    equipos = db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.designers)).filter(DesignTeam.activo == 1).all()
    maneja = [f"{t.nombre} ({t.area.nombre})" for t in equipos if t.manager_id == e.id]
    disena = [f"{t.nombre} ({t.area.nombre})" for t in equipos if any(d.empleado_id == e.id for d in t.designers)]
    a_cargo = [f"{t.nombre} ({t.area.nombre})" for t in equipos if sd.delegaciones_activas(db).get(t.id) == e.id]
    entra = all(p["ok"] for p in pasos[:5])
    if not entra:
        ve = "No entra a Design."
    elif ve_todo:
        ve = f"Ve los {len(equipos)} Schedule activos."
    else:
        propios = sorted(set(maneja + disena + a_cargo))
        ve = ("Solo ve: " + ", ".join(propios) + " (y Training).") if propios else "No ve ningún Schedule (solo Training): no maneja ni está en ningún equipo."
    return {"persona": e.nombre_completo, "email": e.email, "pasos": pasos, "ve": ve, "maneja": maneja, "disena": disena, "aCargo": a_cargo,
            "entra": entra, "veTodo": ve_todo}
