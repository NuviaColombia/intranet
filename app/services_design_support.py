"""Support Time: turnos rotativos de las dos personas de Support (Parámetros › Support Time) y las coberturas de turno
("Dejar a cargo" en el Schedule de Support). La rotación se calcula sola desde una fecha de referencia: cada `semanas`
semanas las dos personas intercambian turno, sin tener que registrar cada cambio.
Ejemplo: referencia 12-oct, 4 semanas → el 12-oct cambian, el 9-nov cambian otra vez, el 7-dic otra vez..."""
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignSupportConfig, DesignSupportCobertura

DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
_COB_CACHE: dict = {"t": 0.0, "dia": None, "v": None}


def config(db: Session) -> DesignSupportConfig:
    c = db.get(DesignSupportConfig, 1)
    if not c:
        c = DesignSupportConfig(id=1)
        db.add(c)
        db.commit()
        db.refresh(c)
    return c


def _hora_ok(v: str) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    try:
        h, m = [int(x) for x in v.split(":")[:2]]
    except ValueError:
        raise ValueError("Las horas deben tener el formato 07:00.")
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError("Hay una hora que no es válida.")
    return f"{h:02d}:{m:02d}"


def guardar_config(db: Session, datos: dict, por: str) -> str | None:
    """Guarda la configuración de turnos. Devuelve el mensaje de error, o None si quedó guardada."""
    try:
        a, b = int(datos.get("persona_a") or 0), int(datos.get("persona_b") or 0)
        semanas = int(datos.get("semanas") or 0)
        ref = date.fromisoformat((datos.get("ref_fecha") or "").strip()) if (datos.get("ref_fecha") or "").strip() else None
        horas = {k: _hora_ok(datos.get(k)) for k in ("turno1_inicio", "turno1_fin", "turno2_inicio", "turno2_fin")}
    except ValueError as e:
        return str(e) if "hora" in str(e).lower() else "Revisa las fechas y los números."
    if not (a and b) or a == b:
        return "Elige las dos personas de Support (deben ser distintas)."
    if not db.get(Empleado, a) or not db.get(Empleado, b):
        return "Una de las personas no existe."
    if not 1 <= semanas <= 26:
        return "La rotación debe ser de 1 a 26 semanas."
    if not ref:
        return "Elige la fecha del cambio de turno."
    dias = sorted({int(d) for d in (datos.get("dias") or []) if str(d).isdigit() and 0 <= int(d) <= 6})
    if not dias:
        return "Elige al menos un día de la semana."
    n1, n2 = (datos.get("turno1_nombre") or "").strip()[:40], (datos.get("turno2_nombre") or "").strip()[:40]
    if not n1 or not n2 or n1.lower() == n2.lower():
        return "Los dos turnos necesitan un nombre distinto."
    c = config(db)
    c.turno1_nombre, c.turno2_nombre = n1, n2
    c.turno1_inicio, c.turno1_fin, c.turno2_inicio, c.turno2_fin = (horas[k] for k in ("turno1_inicio", "turno1_fin", "turno2_inicio", "turno2_fin"))
    c.dias = ",".join(str(d) for d in dias)
    c.persona_a_id, c.persona_b_id, c.ref_fecha, c.semanas = a, b, ref, semanas
    c.ref_turno1 = "b" if datos.get("ref_turno1") == "b" else "a"
    c.actualizado_por, c.actualizado_en = por, datetime.utcnow()
    db.commit()
    return None


MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def hora12(v: str) -> str:
    """"16:40" -> "4:40 pm"."""
    try:
        h, m = [int(x) for x in (v or "").split(":")[:2]]
    except ValueError:
        return ""
    return f"{(h % 12) or 12}:{m:02d} {'am' if h < 12 else 'pm'}"


def fecha_txt(d: date) -> str:
    return f"{DIAS_CORTOS[d.weekday()].lower()} {d.day} {MESES[d.month - 1]}"


def _turno(c: DesignSupportConfig, n: int) -> dict:
    ini, fin = (c.turno1_inicio, c.turno1_fin) if n == 1 else (c.turno2_inicio, c.turno2_fin)
    return {"n": n, "nombre": c.turno1_nombre if n == 1 else c.turno2_nombre, "inicio": ini, "fin": fin,
            "horaTxt": (f"{hora12(ini)} – {hora12(fin)}" if ini and fin else "Sin horario")}


def listo(c: DesignSupportConfig) -> bool:
    return bool(c.persona_a_id and c.persona_b_id and c.ref_fecha)


def turnos_en(c: DesignSupportConfig, fecha: date) -> dict[int, int]:
    """{turno: empleado_id} de quién está en cada turno esa fecha (según la rotación, sin coberturas)."""
    if not listo(c):
        return {}
    k = (fecha - c.ref_fecha).days // (7 * max(1, c.semanas))   # las fechas anteriores a la referencia rotan al revés
    en1, en2 = (c.persona_a_id, c.persona_b_id) if c.ref_turno1 != "b" else (c.persona_b_id, c.persona_a_id)
    return {1: en1, 2: en2} if k % 2 == 0 else {1: en2, 2: en1}


def proximo_cambio(c: DesignSupportConfig, hoy: date) -> date | None:
    if not listo(c):
        return None
    paso = 7 * max(1, c.semanas)
    return c.ref_fecha + timedelta(days=((hoy - c.ref_fecha).days // paso + 1) * paso)


def coberturas(db: Session, hoy: date) -> list[dict]:
    """Coberturas que están corriendo o programadas (las vencidas no cuentan)."""
    out = []
    for x in (db.query(DesignSupportCobertura).filter(DesignSupportCobertura.hasta >= hoy)
              .order_by(DesignSupportCobertura.desde, DesignSupportCobertura.id).all()):
        out.append({"id": x.id, "turno": x.turno, "empleadoId": x.empleado_id,
                    "nombre": x.empleado.nombre_completo if x.empleado else "", "desde": x.desde.isoformat(),
                    "hasta": x.hasta.isoformat(), "activa": x.desde <= hoy, "asignadoPor": x.asignado_por or ""})
    return out


def empleados_cubriendo(db: Session, hoy: date) -> set[int]:
    """Quiénes cubren hoy un turno de Support (pueden editar el Schedule de Support). Se guarda 20 s."""
    import time as _t
    c = _COB_CACHE
    if c["v"] is not None and c["dia"] == hoy and _t.monotonic() - c["t"] < 20:
        return c["v"]
    v = {x.empleado_id for x in db.query(DesignSupportCobertura).filter(DesignSupportCobertura.desde <= hoy, DesignSupportCobertura.hasta >= hoy).all()}
    c["t"], c["dia"], c["v"] = _t.monotonic(), hoy, v
    return v


def agregar_cobertura(db: Session, turno: int, empleado_id: int, desde: date, hasta: date, por: str, hoy: date) -> str | None:
    if turno not in (1, 2):
        return "Elige el turno que se cubre."
    if not db.get(Empleado, empleado_id):
        return "La persona no existe."
    if hasta < desde:
        return "La fecha final no puede ser antes de la inicial."
    if hasta < hoy:
        return "La fecha final ya pasó."
    c = config(db)
    if empleado_id in (c.persona_a_id, c.persona_b_id):
        return "Esa persona ya es de Support: elige a alguien que cubra el turno."
    # un mismo turno no tiene dos coberturas a la vez
    choque = (db.query(DesignSupportCobertura).filter(DesignSupportCobertura.turno == turno, DesignSupportCobertura.desde <= hasta,
                                                      DesignSupportCobertura.hasta >= desde).first())
    if choque:
        return "Ese turno ya tiene una cobertura en esas fechas: quítala primero."
    db.add(DesignSupportCobertura(turno=turno, empleado_id=empleado_id, desde=desde, hasta=hasta, asignado_por=por))
    db.commit()
    _COB_CACHE["v"] = None
    return None


def quitar_cobertura(db: Session, cobertura_id: int) -> bool:
    x = db.get(DesignSupportCobertura, cobertura_id)
    if not x:
        return False
    db.delete(x)
    db.commit()
    _COB_CACHE["v"] = None
    return True


def estado(db: Session, hoy: date) -> dict:
    """Todo lo que muestran Parámetros, la página de Inicio y el Schedule de Support."""
    c = config(db)
    cobs = coberturas(db, hoy)
    dias = [int(d) for d in (c.dias or "").split(",") if d != ""]
    out = {"listo": listo(c), "semanas": c.semanas, "dias": dias, "diasTxt": _dias_txt(dias), "hoy": hoy.isoformat(),
           "turnos": [_turno(c, 1), _turno(c, 2)], "refFecha": c.ref_fecha.isoformat() if c.ref_fecha else "",
           "refTurno1": c.ref_turno1, "personaA": c.persona_a_id, "personaB": c.persona_b_id,
           "proximoCambio": None, "personas": [], "coberturas": cobs,
           "actualizadoPor": c.actualizado_por or ""}
    if not listo(c):
        return out
    cambio = proximo_cambio(c, hoy)
    out["proximoCambio"] = cambio.isoformat()
    out["proximoCambioTxt"] = fecha_txt(cambio)
    paso = timedelta(days=7 * max(1, c.semanas))
    out["proximos"] = []   # los próximos cambios de turno, para ver la rotación completa
    for i in range(4):
        d = cambio + paso * i
        t = turnos_en(c, d)
        out["proximos"].append({"fecha": d.isoformat(), "fechaTxt": fecha_txt(d),
                                "turno1": (db.get(Empleado, t[1]).nombre_completo if db.get(Empleado, t[1]) else ""),
                                "turno2": (db.get(Empleado, t[2]).nombre_completo if db.get(Empleado, t[2]) else "")})
    ahora, luego = turnos_en(c, hoy), turnos_en(c, cambio)
    for n in (1, 2):
        pid = ahora[n]
        e = db.get(Empleado, pid)
        n_luego = 1 if luego[1] == pid else 2
        cub = next((x for x in cobs if x["turno"] == n and x["activa"]), None)
        out["personas"].append({
            "id": pid, "nombre": e.nombre_completo if e else "", "foto": f"/design/api/foto/{pid}",
            "turnoActual": _turno(c, n), "turnoSiguiente": _turno(c, n_luego), "cambiaEl": cambio.isoformat(), "cambiaElTxt": fecha_txt(cambio),
            "cubierto": {"id": cub["empleadoId"], "nombre": cub["nombre"], "hasta": cub["hasta"]} if cub else None,
        })
    return out


def _dias_txt(dias: list[int]) -> str:
    if not dias:
        return ""
    if dias == list(range(dias[0], dias[-1] + 1)) and len(dias) > 2:
        return f"{DIAS_CORTOS[dias[0]]} a {DIAS_CORTOS[dias[-1]]}"
    return ", ".join(DIAS_CORTOS[d] for d in dias)
