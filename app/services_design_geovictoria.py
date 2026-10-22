"""GeoVictoria (Rosember, 22-oct-2026): marcas de asistencia de Nuvia Design desde la API de GeoVictoria.

- Credenciales: Parámetros › GeoVictoria (las escribe un admin). Se guardan en design_conexion_reglas (tipo «sistema»,
  clave CLAVE); el secreto nunca vuelve a la pantalla.
- Cruce: por cédula (Empleado.identificacion ↔ Identifier de GeoVictoria, solo dígitos y sin ceros a la izquierda).
- Marcas de hoy: AttendanceBook en lotes de LOTE personas, guardadas en memoria; se renuevan cada REFRESCO_S (el
  revisor en segundo plano las trae; Seguimiento solo lee la memoria, nunca espera a GeoVictoria).
- Avisos (push, no Cliq): a la persona y a su manager cuando, con TOLERANCIA minutos de margen, no marcó la entrada,
  no marcó el regreso del almuerzo o no marcó la salida. Cada aviso sale una sola vez por día; los ya enviados quedan
  en una fila por día (clave AVISOS_CLAVE + fecha) para no repetirlos si el servidor se reinicia.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from .models import EMPRESA_DESIGN, Empleado
from .models_design import DesignConexionRegla, DesignTeam, DesignTeamDesigner

log = logging.getLogger(__name__)

BASE = "https://customerapi.geovictoria.com/api/v1"
CLAVE = "geovictoria"
AVISOS_CLAVE = "gv_avisos_"
LOTE = 40
REFRESCO_S = 300            # marcas de hoy: cada 5 minutos
USUARIOS_S = 3600           # lista de usuarios de GeoVictoria: cada hora
TOLERANCIA = 10             # minutos de margen antes de avisar (Rosember)
TIMEOUT = 60

_token = {"v": "", "hasta": 0.0}
_usuarios = {"t": 0.0, "lista": []}
_hoy = {"fecha": None, "t": 0.0, "datos": {}, "error": "", "consultado": None}
_enviados = {"fecha": None, "claves": set()}
ESTADO = {"desde": None, "ultima": None, "error": "", "avisos": 0}
_lock = threading.Lock()


# ---------- configuración ----------

def _fila(db: Session) -> DesignConexionRegla | None:
    return db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == CLAVE).first()


def config(db: Session) -> dict:
    r = _fila(db)
    try:
        c = json.loads(r.valor or "{}") if r else {}
    except ValueError:
        c = {}
    return {"key": c.get("key", ""), "secret": c.get("secret", ""), "avisos": bool(c.get("avisos", False)),
            "tolerancia": int(c.get("tolerancia", TOLERANCIA))}


def publico(db: Session) -> dict:
    """Lo que ve la pantalla: el secreto nunca sale."""
    c = config(db)
    return {"key": c["key"], "tieneSecreto": bool(c["secret"]), "avisos": c["avisos"], "tolerancia": c["tolerancia"],
            "estado": {k: (v.isoformat() + "Z" if isinstance(v, datetime) else v) for k, v in ESTADO.items()},
            "ultimaConsulta": (_hoy["consultado"].isoformat() + "Z") if _hoy["consultado"] else None, "errorConsulta": _hoy["error"]}


def guardar(db: Session, datos: dict, quien: Empleado) -> dict:
    c = config(db)
    key = (datos.get("key") or "").strip()
    secret = (datos.get("secret") or "").strip() or c["secret"]   # vacío = se conserva el que había
    if not key or not secret:
        raise ValueError("Escribe la clave API y el secreto de GeoVictoria.")
    try:
        tol = int(datos.get("tolerancia", c["tolerancia"]))
    except (TypeError, ValueError):
        raise ValueError("La tolerancia debe ser un número de minutos.")
    if not 0 <= tol <= 120:
        raise ValueError("La tolerancia debe estar entre 0 y 120 minutos.")
    r = _fila(db) or DesignConexionRegla(tipo="sistema", clave=CLAVE)
    r.valor = json.dumps({"key": key, "secret": secret, "avisos": bool(datos.get("avisos")), "tolerancia": tol})
    r.creado_por = (quien.nombre_completo or "")[:150]
    db.add(r)
    db.commit()
    if key != c["key"] or secret != c["secret"]:
        _token.update(v="", hasta=0.0)
        _usuarios.update(t=0.0, lista=[])
        _hoy.update(t=0.0)
    return publico(db)


# ---------- API ----------

def _login(c: dict) -> str:
    if _token["v"] and time.time() < _token["hasta"]:
        return _token["v"]
    if not c["key"] or not c["secret"]:
        raise RuntimeError("GeoVictoria no está configurado (Parámetros › GeoVictoria).")
    r = httpx.post(BASE + "/Login", json={"User": c["key"], "Password": c["secret"]}, timeout=TIMEOUT)
    if r.status_code != 200 or "token" not in (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}):
        raise RuntimeError(f"GeoVictoria rechazó las credenciales ({r.status_code}).")
    _token.update(v=r.json()["token"], hasta=time.time() + 45 * 60)   # se renueva antes de que venza
    return _token["v"]


def _post(c: dict, ruta: str, cuerpo) -> object:
    for intento in range(2):
        r = httpx.post(BASE + ruta, headers={"Authorization": "Bearer " + _login(c)}, json=cuerpo, timeout=TIMEOUT)
        if r.status_code == 401 and intento == 0:
            _token.update(v="", hasta=0.0)
            continue
        if r.status_code != 200:
            raise RuntimeError(f"GeoVictoria {ruta} respondió {r.status_code}: {r.text[:160]}")
        return r.json()


def probar(db: Session) -> dict:
    c = config(db)
    _token.update(v="", hasta=0.0)
    us = _post(c, "/User/List", {})
    return {"ok": True, "usuarios": len(us), "habilitados": sum(1 for u in us if str(u.get("Enabled")) in ("1", "True"))}


def _norm_id(s) -> str:
    d = re.sub(r"\D", "", str(s or ""))
    return d.lstrip("0") or d


def usuarios(db: Session, forzar: bool = False) -> list[dict]:
    if forzar or not _usuarios["lista"] or time.time() - _usuarios["t"] > USUARIOS_S:
        _usuarios.update(lista=_post(config(db), "/User/List", {}), t=time.time())
    return _usuarios["lista"]


def cruce(db: Session, forzar: bool = False) -> dict:
    """Empleados activos de Nuvia Design ↔ usuarios habilitados de GeoVictoria, por cédula."""
    gv = {_norm_id(u.get("Identifier")): u for u in usuarios(db, forzar) if str(u.get("Enabled")) in ("1", "True") and _norm_id(u.get("Identifier"))}
    emps = db.query(Empleado).filter(Empleado.empresa == EMPRESA_DESIGN, Empleado.activo == 1).all()
    pares, sin_gv = {}, []
    for e in emps:
        k = _norm_id(e.identificacion)
        if k and k in gv:
            pares[e.id] = gv[k]["Identifier"]
        else:
            sin_gv.append({"id": e.id, "nombre": e.nombre_completo})
    usados = {_norm_id(v) for v in pares.values()}
    sin_emp = [{"identificador": u["Identifier"][-4:].rjust(len(u["Identifier"]), "•"), "nombre": f"{u.get('Name', '')} {u.get('LastName', '')}".strip()}
               for k, u in gv.items() if k not in usados]
    return {"pares": pares, "sinGeoVictoria": sorted(sin_gv, key=lambda x: x["nombre"].lower()),
            "sinPlataforma": sorted(sin_emp, key=lambda x: x["nombre"].lower())}


# ---------- marcas de hoy ----------

def _dt(s: str) -> datetime | None:
    try:
        return datetime.strptime(str(s)[:14], "%Y%m%d%H%M%S")
    except (TypeError, ValueError):
        return None


def _hm(d: datetime | None) -> str:
    return d.strftime("%H:%M") if d else ""


def leer_dia(u: dict, dia: date) -> dict | None:
    """Del libro de asistencia de una persona, lo de `dia`: turno, permisos y marcas (entrada, almuerzo, salida)."""
    pref = dia.strftime("%Y%m%d")
    ints = [i for w in u.get("Weeks", []) or [] for i in w.get("Intervals", []) or []] or (u.get("PlannedInterval") or [])
    it = next((i for i in ints if str(i.get("Date", "")).startswith(pref)), None)
    if not it:
        return None
    turno = None
    descanso = any(s.get("Type") == "NotWorking" for s in it.get("Shifts") or [])
    for s in it.get("Shifts") or []:
        if s.get("Type") == "NotWorking" or (s.get("Status") or "").lower() == "disabled":
            continue
        ini, fin = _dt(s.get("Begins")), _dt(s.get("Ends"))
        if not ini or not fin:
            continue
        fijo = s.get("BreakType") == "FixedLunch"
        alm_ini = _dt(pref + (s.get("BreakStart") or "00:00").replace(":", "") + "00") if fijo else None
        alm_fin = _dt(pref + (s.get("BreakEnd") or "00:00").replace(":", "") + "00") if fijo else None
        try:
            alm_min = int(s.get("BreakMinutes") or 0)
        except ValueError:
            alm_min = 0
        if fijo and alm_ini and alm_fin:
            alm_min = int((alm_fin - alm_ini).total_seconds() // 60)
        turno = {"inicio": ini, "fin": fin, "almuerzoMin": alm_min, "almuerzoFijoFin": alm_fin if fijo else None, "texto": s.get("ShiftDisplay") or ""}
        break
    permisos = [(t.get("TimeOffTypeDescription") or t.get("Description") or "Permiso").strip() for t in it.get("TimeOffs") or []]
    marcas = {"entrada": None, "salidaAlm": None, "regresoAlm": None, "salida": None}
    sueltas = []
    for p in sorted(it.get("Punches") or [], key=lambda p: str(p.get("Date"))):
        d, t = _dt(p.get("Date")), p.get("ShiftPunchType") or ""
        if not d:
            continue
        k = {"Entrada": "entrada", "SalidaColacion": "salidaAlm", "EntradaColacion": "regresoAlm", "Salida": "salida"}.get(t)
        if k and not marcas[k]:
            marcas[k] = d
        elif not k:
            sueltas.append((p.get("Type"), d))
    for tipo, d in sueltas:   # marcas «SinAsignar»: Ingreso cuenta como entrada y Salida como salida si faltan
        if tipo == "Ingreso" and not marcas["entrada"]:
            marcas["entrada"] = d
        elif tipo == "Salida" and not marcas["salida"]:
            marcas["salida"] = d
    atraso = 0
    if turno and marcas["entrada"] and marcas["entrada"] > turno["inicio"]:
        atraso = int((marcas["entrada"] - turno["inicio"]).total_seconds() // 60)
    return {"turno": turno, "permisos": permisos, "marcas": marcas, "atrasoMin": atraso,
            "sinHorario": not turno and not descanso and not permisos}   # nadie le asignó turno ese día


def faltas(info: dict, ahora: datetime, tol: int) -> list[dict]:
    """Marcas que debieron hacerse y no están (con `tol` minutos de margen). Sin turno o con permiso de día completo
    (de GeoVictoria, de People o de Tiempos libres): nada. Con un permiso por horas que cubre la hora de la marca, se
    espera hasta que termine el permiso (y la tolerancia) antes de avisar."""
    if not info or not info["turno"] or info["permisos"]:
        return []
    t, m, out = info["turno"], info["marcas"], []
    margen = timedelta(minutes=tol)

    def vence(esperada: datetime) -> datetime:
        limite = esperada + margen
        for ini, fin, _tipo in info.get("permisosHoras") or []:
            if ini <= limite and fin >= esperada:   # el permiso cubre la hora de la marca: se corre hasta que termine
                limite = max(limite, fin + margen)
        return limite
    if not m["entrada"] and ahora >= vence(t["inicio"]) and ahora < t["fin"]:
        out.append({"tipo": "entrada", "hora": _hm(t["inicio"])})
    if m["salidaAlm"] and not m["regresoAlm"]:
        fin_alm = t["almuerzoFijoFin"] or (m["salidaAlm"] + timedelta(minutes=t["almuerzoMin"] or 60))
        if ahora >= vence(fin_alm) and not m["salida"]:
            out.append({"tipo": "almuerzo", "hora": _hm(fin_alm)})
    if m["entrada"] and not m["salida"] and ahora >= vence(t["fin"]):
        out.append({"tipo": "salida", "hora": _hm(t["fin"])})
    return out


def _permisos_plataforma(db: Session, ids: list[int], dia: date) -> tuple[dict[int, str], dict[int, list]]:
    """Permisos que no están en GeoVictoria pero sí en la plataforma (Rosember, 22-oct-2026): de día completo (People
    aprobados o pendientes de soporte, y ausencias de Tiempos libres) y por horas (People)."""
    from . import services_design as sd
    from .models_design import DesignBreak
    from sqlalchemy import func
    if not ids:
        return {}, {}
    dia_completo = dict(sd._permisos_aprobados_del_dia(db, ids, dia))
    for eid, tipo in (db.query(DesignBreak.empleado_id, DesignBreak.tipo_ausencia)
                      .filter(DesignBreak.empleado_id.in_(ids), DesignBreak.fecha == dia, func.coalesce(DesignBreak.tipo_ausencia, "") != "")):
        dia_completo.setdefault(eid, tipo.strip())
    horas: dict[int, list] = {}
    for eid, lista in sd.permisos_por_horas_del_dia(db, ids, dia).items():
        for p in lista:
            try:
                ini = datetime.combine(dia, datetime.strptime(p["desde"], "%H:%M").time())
                fin = datetime.combine(dia, datetime.strptime(p["hasta"], "%H:%M").time()) if p.get("hasta") else ini + timedelta(hours=1)
            except ValueError:
                continue
            horas.setdefault(eid, []).append((ini, fin, p.get("tipo") or "Permiso"))
    return dia_completo, horas


def _consultar(db: Session, dia: date) -> dict:
    c = config(db)
    pares = cruce(db)["pares"]
    por_id = {_norm_id(v): eid for eid, v in pares.items()}
    datos = {}
    ids = list(pares.values())
    for k in range(0, len(ids), LOTE):
        r = _post(c, "/AttendanceBook", {"StartDate": dia.strftime("%Y%m%d000000"), "EndDate": dia.strftime("%Y%m%d235959"),
                                         "UserIds": ",".join(ids[k:k + LOTE])})
        for u in (r or {}).get("Users", []) or []:
            eid = por_id.get(_norm_id(u.get("Identifier")))
            if eid:
                info = leer_dia(u, dia)
                if info:
                    datos[eid] = info
    for eid in pares:   # no vino en el libro de ese día: no tiene horario asignado
        datos.setdefault(eid, {"turno": None, "permisos": [], "atrasoMin": 0, "sinHorario": True,
                               "marcas": {"entrada": None, "salidaAlm": None, "regresoAlm": None, "salida": None}})
    # permisos de la plataforma: con uno de día completo no se avisa nada (ni «sin horario»); por horas, se espera
    dia_completo, horas = _permisos_plataforma(db, list(datos), dia)
    for eid, info in datos.items():
        if eid in dia_completo and dia_completo[eid] not in info["permisos"]:
            info["permisos"] = info["permisos"] + [dia_completo[eid]]
            info["sinHorario"] = False
        info["permisosHoras"] = horas.get(eid, [])
    return datos


def hoy(db: Session, ahora: datetime, forzar: bool = False) -> dict:
    """Marcas de hoy de todo Design (en memoria; se renuevan cada REFRESCO_S)."""
    with _lock:
        if not forzar and _hoy["fecha"] == ahora.date() and time.time() - _hoy["t"] < REFRESCO_S:
            return _hoy["datos"]
        try:
            datos = _consultar(db, ahora.date())
            _hoy.update(fecha=ahora.date(), t=time.time(), datos=datos, error="", consultado=datetime.utcnow())
        except Exception as e:  # noqa: BLE001
            _hoy.update(t=time.time(), error=f"{type(e).__name__}: {e}"[:300])
            if _hoy["fecha"] != ahora.date():
                _hoy.update(fecha=ahora.date(), datos={})
            log.warning("GeoVictoria: no se pudieron traer las marcas: %s", e)
        return _hoy["datos"]


def para_seguimiento(empleado_id: int, ahora: datetime, tol: int | None = None) -> dict | None:
    """Lo de esta persona para Seguimiento, solo desde la memoria (no consulta GeoVictoria)."""
    if _hoy["fecha"] != ahora.date():
        return None
    info = _hoy["datos"].get(empleado_id)
    if not info:
        return None
    t, m = info["turno"], info["marcas"]
    return {"turno": f"{_hm(t['inicio'])} – {_hm(t['fin'])}" if t else "", "permisos": info["permisos"], "atrasoMin": info["atrasoMin"],
            "entrada": _hm(m["entrada"]), "salidaAlm": _hm(m["salidaAlm"]), "regresoAlm": _hm(m["regresoAlm"]), "salida": _hm(m["salida"]),
            "faltas": faltas(info, ahora, TOLERANCIA if tol is None else tol), "sinHorario": bool(info.get("sinHorario")),
            "permisosHoras": [f"{tp} {_hm(a)}–{_hm(b)}" for a, b, tp in info.get("permisosHoras") or []]}


# ---------- avisos (push) ----------

TEXTOS = {
    "entrada": ("⏰ No has marcado tu entrada", "Tu turno empezó a las {hora}. Marca tu entrada en GeoVictoria.",
                "⏰ {nombre} no ha marcado entrada", "Su turno empezó a las {hora}."),
    "almuerzo": ("🍽️ No has marcado el regreso del almuerzo", "Tu almuerzo terminaba a las {hora}. Marca tu regreso en GeoVictoria.",
                 "🍽️ {nombre} no ha marcado el regreso del almuerzo", "Su almuerzo terminaba a las {hora}."),
    "salida": ("🏁 No has marcado tu salida", "Tu turno terminó a las {hora}. Marca tu salida en GeoVictoria.",
               "🏁 {nombre} no ha marcado su salida", "Su turno terminó a las {hora}."),
}


def _cargar_enviados(db: Session, dia: date) -> set:
    if _enviados["fecha"] == dia:
        return _enviados["claves"]
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == AVISOS_CLAVE + dia.isoformat()).first()
    try:
        claves = set(json.loads(r.valor or "[]")) if r else set()
    except ValueError:
        claves = set()
    _enviados.update(fecha=dia, claves=claves)
    # limpieza: las filas de avisos de hace más de 7 días ya no sirven
    viejo = AVISOS_CLAVE + (dia - timedelta(days=7)).isoformat()
    for f in db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave.like(AVISOS_CLAVE + "%")):
        if f.clave < viejo:
            db.delete(f)
    db.commit()
    return claves


def _guardar_enviados(db: Session, dia: date) -> None:
    clave = AVISOS_CLAVE + dia.isoformat()
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).first()
    if not r:
        r = DesignConexionRegla(tipo="sistema", clave=clave, creado_por="GeoVictoria")
        db.add(r)
    r.valor = json.dumps(sorted(_enviados["claves"]))
    db.commit()


def _managers_de(db: Session, empleado_id: int) -> set[int]:
    from . import services_design as sd
    tids = [t for (t,) in db.query(DesignTeamDesigner.team_id).filter(DesignTeamDesigner.empleado_id == empleado_id)]
    out = {m for (m,) in db.query(DesignTeam.manager_id).filter(DesignTeam.id.in_(tids or [-1]), DesignTeam.activo == 1) if m}
    for tid, eid in sd.delegaciones_activas(db).items():   # quien está a cargo hoy del equipo también se entera
        if tid in tids and eid:
            out.add(eid)
    out.discard(empleado_id)
    return out


def revisar(db: Session, ahora: datetime) -> list[str]:
    """Trae las marcas (cada REFRESCO_S) y envía los avisos que falten. Devuelve las claves de los avisos enviados."""
    from . import services_design_push as sp
    c = config(db)
    if not c["key"] or not c["secret"]:
        return []
    datos = hoy(db, ahora)
    if not c["avisos"]:
        return []
    enviados = _cargar_enviados(db, ahora.date())
    nuevos = []
    nombres = None
    for eid, info in datos.items():
        for f in faltas(info, ahora, c["tolerancia"]):
            k = f"{eid}|{f['tipo']}"
            if k in enviados:
                continue
            if nombres is None:
                nombres = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(list(datos)))}
            e = nombres.get(eid)
            if not e:
                continue
            tp, cp, tm, cm = TEXTOS[f["tipo"]]
            corto = " ".join((e.nombres or "").split()[:1] + (e.apellidos or "").split()[:1]) or e.nombre_completo
            sp.enviar(db, [eid], tp, cp.format(hora=f["hora"]), "/design/inicio", f"gv-{f['tipo']}", fijo=True)
            mans = _managers_de(db, eid)
            if mans:
                sp.enviar(db, list(mans), tm.format(nombre=corto), cm.format(hora=f["hora"]), "/design?panel=seguimiento", f"gv-{eid}-{f['tipo']}", fijo=True)
            enviados.add(k)
            nuevos.append(k)
    nuevos += _recordar_horarios(db, ahora, datos, enviados)
    if nuevos:
        _guardar_enviados(db, ahora.date())
    nuevos = [k for k in nuevos if not k.endswith("|*")]   # las marcas «ya se revisó hoy» no son avisos
    ESTADO["avisos"] += len(nuevos)
    return nuevos


# ---------- horario sin asignar (Rosember, 22-oct-2026) ----------
# Si un diseñador no tiene turno en GeoVictoria (ni descanso ni permiso), a su manager le llega un push para que se lo
# asigne: a las HORA_MANANA revisa el día siguiente hábil (para que alcance a corregirlo) y a las HORA_HOY revisa hoy.
# Solo días hábiles (sin sábados, domingos ni festivos). Un solo push por manager con la lista de su gente.
HORA_HOY = 7
HORA_MANANA = 15
_manana = {"fecha": None, "t": 0.0, "datos": {}}


def _habil(db: Session, d: date) -> bool:
    from . import services_design as sd
    return d.weekday() < 5 and d not in sd.festivos(db)


def _siguiente_habil(db: Session, d: date) -> date:
    d += timedelta(days=1)
    while not _habil(db, d):
        d += timedelta(days=1)
    return d


def _recordar_horarios(db: Session, ahora: datetime, datos_hoy: dict, enviados: set) -> list[str]:
    from . import services_design_push as sp
    pendientes = []
    if ahora.hour >= HORA_HOY and _habil(db, ahora.date()):
        pendientes.append(("hoy", ahora.date(), datos_hoy))
    if ahora.hour >= HORA_MANANA:
        dia = _siguiente_habil(db, ahora.date())
        if f"horario-manana|{dia.isoformat()}|*" not in enviados:
            if _manana["fecha"] != dia or time.time() - _manana["t"] > REFRESCO_S:
                _manana.update(fecha=dia, t=time.time(), datos=_consultar(db, dia))
            pendientes.append(("manana", dia, _manana["datos"]))
    nuevos = []
    for cual, dia, datos in pendientes:
        marca = f"horario-{cual}|{dia.isoformat()}|*"
        if marca in enviados:
            continue
        sin = [eid for eid, info in datos.items() if info.get("sinHorario")]
        por_manager: dict[int, list[str]] = {}
        nombres = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(sin or [-1]))}
        for eid in sin:
            e = nombres.get(eid)
            if not e:
                continue
            corto = " ".join((e.nombres or "").split()[:1] + (e.apellidos or "").split()[:1]) or e.nombre_completo
            for m in _managers_de(db, eid):
                por_manager.setdefault(m, []).append(corto)
        dia_txt = "hoy" if cual == "hoy" else dia.strftime("%d/%m")
        for m, gente in por_manager.items():
            lista = ", ".join(sorted(gente)[:6]) + (f" y {len(gente) - 6} más" if len(gente) > 6 else "")
            titulo = "📅 Falta asignar horario" if cual == "hoy" else "📅 Asigna el horario de " + dia_txt
            cuerpo = (f"Hoy no tienen horario en GeoVictoria: {lista}." if cual == "hoy"
                      else f"El {dia_txt} no tienen horario en GeoVictoria: {lista}. Asígnalo antes de que empiece el día.")
            sp.enviar(db, [m], titulo, cuerpo, "/design?panel=seguimiento", f"gv-horario-{cual}", fijo=True)
            nuevos.append(f"horario-{cual}|{dia.isoformat()}|{m}")
        enviados.add(marca)   # se revisa una vez por día (aunque nadie falte)
        nuevos.append(marca)
    return nuevos


def para_seguimiento_info(info: dict, ahora: datetime, tol: int) -> dict:
    t, m = info["turno"], info["marcas"]
    return {"turno": f"{_hm(t['inicio'])} – {_hm(t['fin'])}" if t else "", "permisos": info["permisos"], "atrasoMin": info["atrasoMin"],
            "entrada": _hm(m["entrada"]), "salidaAlm": _hm(m["salidaAlm"]), "regresoAlm": _hm(m["regresoAlm"]), "salida": _hm(m["salida"]),
            "faltas": faltas(info, ahora, tol), "sinHorario": bool(info.get("sinHorario"))}


_hilo = {"t": None}


def arrancar() -> None:
    """Hilo que cada minuto revisa (las marcas solo se piden a GeoVictoria cada REFRESCO_S)."""
    if _hilo["t"] is not None or os.getenv("DESIGN_SIN_AVISOS_TURNO"):
        return

    def _bucle():
        from . import services_design as sd
        from .database import SessionLocal
        ESTADO["desde"] = datetime.utcnow()
        while True:
            time.sleep(60)
            try:
                db = SessionLocal()
                try:
                    revisar(db, sd.ahora_colombia().replace(tzinfo=None))
                    ESTADO["ultima"], ESTADO["error"] = datetime.utcnow(), ""
                except Exception as e:  # noqa: BLE001
                    ESTADO["error"] = f"{type(e).__name__}: {e}"[:300]
                    log.exception("GeoVictoria: no se pudo revisar")
                    try:
                        db.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                finally:
                    db.close()
            except Exception:  # noqa: BLE001
                log.exception("GeoVictoria: fallo del revisor")
    _hilo["t"] = threading.Thread(target=_bucle, daemon=True, name="design-geovictoria")
    _hilo["t"].start()
