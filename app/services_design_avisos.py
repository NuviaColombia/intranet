"""Centro de avisos (Cliq) · Rosember, 20-oct-2026: qué envía el bot, a dónde y qué ha enviado (/design/avisos).

- Grupos (DesignCliqGrupo + DesignCliqDestino): listas con nombre de canales de Cliq (Unique Name) y personas (correo de
  Zoho, mensaje directo del bot).
- Mensajes (DesignCliqMensaje): texto con variables, cuándo se envía (al empezar cada turno de Support, el día de la
  rotación de Support, programado una vez o cada semana, o solo a mano) y a qué grupos. Cada mensaje puede salir con
  otro bot (Unique Name); vacío = el bot por defecto.
- Historial (DesignCliqEnvio): una fila por destino de cada envío, con lo que respondió Cliq.

No hay tareas programadas en el servidor: un hilo revisa cada minuto (arrancar). Cada envío automático deja una marca en
design_conexion_reglas (tipo «sistema», clave única), así no se repite aunque Render tenga dos instancias. Si el servidor
estaba caído a la hora del envío, sale dentro de VENTANA_MIN; después ya no.

Los dos avisos que el bot ya enviaba antes del Centro quedan como mensajes «de sistema» (se pausan, no se borran):
«Support Designer en turno» (antes services_design_cliq.avisar_turno_si_corresponde) y «Cambio de turno de Support»
(antes avisar_cambio_si_corresponde). Usan las mismas claves de marca que antes para no repetir un aviso ya enviado."""
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import services_design_cliq as sc
from .models import EMPRESA_DESIGN, Empleado
from .models_design import DesignCliqDestino, DesignCliqEnvio, DesignCliqGrupo, DesignCliqMensaje, DesignConexionRegla

log = logging.getLogger("design.avisos")
VENTANA_MIN = 30
DISPARADORES = {
    "turno_support": "Al empezar cada turno de Support",
    "cambio_support": "El día del cambio de turno de Support",
    "programado": "Programado",
    "manual": "Solo a mano",
}
VARIABLES = [   # (clave, explicación); todas se pueden usar en cualquier mensaje
    ("persona", "@mención de quien está en Support"),
    ("nombre", "nombre de quien está en Support"),
    ("turno", "nombre del turno (Diurno, Nocturno…)"),
    ("horario", "horario del turno, p. ej. 9:00 pm – 7:00 am"),
    ("cubre", "«(cubre a … hasta el dd/mm)» si alguien está cubriendo; si no, vacío"),
    ("turnos", "las dos personas de Support, una por línea, con su turno y horario"),
    ("proximo", "fecha del próximo cambio de turno"),
    ("fecha", "fecha de hoy, p. ej. mar 20 oct"),
    ("hora", "hora del envío, p. ej. 7:00 am"),
]
TEXTO_TURNO = "🛟 *Support Designer en turno*\n{persona} — {turno}{cubre}\n🕘 {horario}  (Colombia Time)"
TEXTO_CAMBIO = "🔄 *Cambio de turno de Support* — {fecha}\n{turnos}\nPróximo cambio: {proximo}"
SIS_TURNO, SIS_CAMBIO = "support_turno", "support_cambio"


def _limpio(v, n: int) -> str:
    return str(v or "").strip()[:n]


def _hora_ok(v: str) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    if not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", v):
        raise ValueError("La hora debe tener el formato 07:00.")
    h, m = v.split(":")
    return f"{int(h):02d}:{m}"


def _min(h: str) -> int | None:
    try:
        a, b = [int(x) for x in (h or "").split(":")[:2]]
        return a * 60 + b
    except ValueError:
        return None


def _ids(texto: str) -> list[int]:
    return [int(x) for x in (texto or "").split(",") if x.strip().isdigit()]


# ---------- Primera vez: los avisos que ya existían pasan al Centro ----------

_sembrado = {"ok": False}


def sembrar(db: Session) -> None:
    if _sembrado["ok"]:
        return
    from . import services_design_support as ss
    try:
        if not db.query(DesignCliqMensaje).filter(DesignCliqMensaje.sistema.in_([SIS_TURNO, SIS_CAMBIO])).count():
            canales = sc_canales((ss.config(db).cliq_canales or "") or sc.canal_support())
            g = DesignCliqGrupo(nombre="Support", actualizado_por="Sistema")
            db.add(g)
            db.flush()
            for i, k in enumerate(canales):
                db.add(DesignCliqDestino(grupo_id=g.id, tipo="canal", valor=k, orden=i))
            db.add(DesignCliqMensaje(nombre="Support Designer en turno", texto=TEXTO_TURNO, disparador="turno_support",
                                     grupos=str(g.id), sistema=SIS_TURNO, orden=1, actualizado_por="Sistema"))
            db.add(DesignCliqMensaje(nombre="Cambio de turno de Support", texto=TEXTO_CAMBIO, disparador="cambio_support",
                                     prog_hora="07:00", grupos=str(g.id), sistema=SIS_CAMBIO, orden=2, actualizado_por="Sistema"))
            db.commit()
        _sembrado["ok"] = True
    except IntegrityError:   # la otra instancia ya los creó
        db.rollback()
        _sembrado["ok"] = True


def sc_canales(texto: str) -> list[str]:
    vistos, out = set(), []
    for x in (texto or "").replace(",", "\n").splitlines():
        x = x.strip().lstrip("#").strip()
        if x and x.lower() not in vistos:
            vistos.add(x.lower())
            out.append(x)
    return out


# ---------- Variables ----------

def _mencion(nombre: str, correo: str | None) -> str:
    """@mención de Cliq por correo de Zoho; sin correo, el nombre en negrita."""
    return f"{{@{correo.strip()}}}" if correo and "@" in correo else f"*{nombre}*"


def valores(db: Session, ahora: datetime, turno: int | None = None) -> dict:
    """Valores de las variables en este momento. `turno` = el turno que acaba de empezar (si no, el que está corriendo)."""
    from . import services_design_support as ss
    out = {k: "" for k, _ in VARIABLES}
    out["fecha"], out["hora"] = ss.fecha_txt(ahora.date()), ss.hora12(ahora.strftime("%H:%M"))
    c = ss.config(db)
    if not ss.listo(c):
        return out
    st = ss.estado(db, ahora.date())
    personas = st.get("personas") or []
    ids = {p["id"] for p in personas} | {p["cubierto"]["id"] for p in personas if p.get("cubierto")}
    correos = {e.id: e.email for e in db.query(Empleado).filter(Empleado.id.in_(ids or [-1]))}
    n = turno or (ss.en_turno(db, ahora) or {}).get("turno")
    p = next((x for x in personas if x["turnoActual"]["n"] == n), None)
    if p:
        t, cub = p["turnoActual"], p.get("cubierto")
        quien = cub or {"id": p["id"], "nombre": p["nombre"]}
        out.update(persona=_mencion(quien["nombre"], correos.get(quien["id"])), nombre=quien["nombre"], turno=t["nombre"],
                   horario=t["horaTxt"],
                   cubre=f" (cubre a {p['nombre']} hasta el {cub['hasta'][8:10]}/{cub['hasta'][5:7]})" if cub else "")
    lineas = []
    for x in sorted(personas, key=lambda x: x["turnoActual"]["n"]):
        t = x["turnoActual"]
        extra = f" (cubre {x['cubierto']['nombre']} hasta el {x['cubierto']['hasta'][8:10]}/{x['cubierto']['hasta'][5:7]})" if x.get("cubierto") else ""
        lineas.append(f"• {t['nombre']} ({t['horaTxt']}): {x['nombre']}{extra}")
    out["turnos"], out["proximo"] = "\n".join(lineas), st.get("proximoCambioTxt") or ""
    return out


def armar(texto: str, vals: dict) -> str:
    """Reemplaza {variable}; lo que no es una variable conocida se deja igual (p. ej. una @mención escrita a mano)."""
    return re.sub(r"\{(\w+)\}", lambda m: str(vals[m.group(1)]) if m.group(1) in vals else m.group(0), texto or "").strip()


# ---------- Lectura para la página ----------

def _grupo_dict(g: DesignCliqGrupo, destinos: list[DesignCliqDestino], usos: list[str]) -> dict:
    return {"id": g.id, "nombre": g.nombre, "usos": usos,
            "destinos": [{"id": d.id, "tipo": d.tipo, "valor": d.valor} for d in sorted(destinos, key=lambda d: (d.orden, d.id))]}


def _descripcion(m: DesignCliqMensaje) -> str:
    from . import services_design_support as ss
    if m.disparador == "programado":
        h = ss.hora12(m.prog_hora) if m.prog_hora else "sin hora"
        if m.prog_tipo == "semanal":
            dias = [int(d) for d in (m.prog_dias or "").split(",") if d.strip().isdigit()]
            return f"Cada {ss._dias_txt(dias) or 'semana (sin días)'} a las {h}"
        return f"Una vez: {ss.fecha_txt(m.prog_fecha)} a las {h}" if m.prog_fecha else "Una vez (sin fecha)"
    if m.disparador == "cambio_support":
        return f"El día del cambio de turno de Support a las {ss.hora12(m.prog_hora or '07:00')}"
    return DISPARADORES.get(m.disparador, m.disparador)


def _mensaje_dict(m: DesignCliqMensaje, ultimo: DesignCliqEnvio | None) -> dict:
    return {"id": m.id, "nombre": m.nombre, "activo": bool(m.activo), "bot": m.bot or "", "texto": m.texto or "",
            "disparador": m.disparador, "progTipo": m.prog_tipo or "una",
            "progFecha": m.prog_fecha.isoformat() if m.prog_fecha else "", "progHora": m.prog_hora or "",
            "progDias": [int(d) for d in (m.prog_dias or "").split(",") if d.strip().isdigit()],
            "saltarFestivos": bool(m.saltar_festivos), "grupos": _ids(m.grupos), "sistema": m.sistema or "",
            "descripcion": _descripcion(m), "actualizadoPor": m.actualizado_por or "",
            "ultimo": ({"en": ultimo.en.isoformat() + "Z", "ok": ultimo.ok} if ultimo else None)}


def todo(db: Session) -> dict:
    sembrar(db)
    grupos = db.query(DesignCliqGrupo).order_by(DesignCliqGrupo.nombre).all()
    destinos = db.query(DesignCliqDestino).all()
    mensajes = db.query(DesignCliqMensaje).order_by(DesignCliqMensaje.orden, DesignCliqMensaje.id).all()
    usos = {g.id: [m.nombre for m in mensajes if g.id in _ids(m.grupos)] for g in grupos}
    ultimos = {}
    for e in db.query(DesignCliqEnvio).order_by(DesignCliqEnvio.en.desc()).limit(500):
        ultimos.setdefault(e.mensaje_id, e)
    personas = (db.query(Empleado).filter(Empleado.activo == 1, Empleado.empresa == EMPRESA_DESIGN)
                .order_by(Empleado.nombres, Empleado.apellidos).all())
    bots = sorted({sc.bot()} | {m.bot for m in mensajes if m.bot})
    iso = lambda d: d.isoformat() + "Z" if d else None
    revisor = {"activo": _hilo["t"] is not None and _hilo["t"].is_alive(), "desde": iso(ESTADO["desde"]), "ultima": iso(ESTADO["ultima"]),
               "error": ESTADO["error"], "errorEn": iso(ESTADO["error_en"])}
    return {"conexion": {"configurado": sc.configurado(), "bot": sc.bot()}, "bots": bots, "revisor": revisor,
            "grupos": [_grupo_dict(g, [d for d in destinos if d.grupo_id == g.id], usos[g.id]) for g in grupos],
            "mensajes": [_mensaje_dict(m, ultimos.get(m.id)) for m in mensajes],
            "disparadores": [{"k": k, "l": v} for k, v in DISPARADORES.items()],
            "variables": [{"k": k, "l": v} for k, v in VARIABLES],
            "personas": [{"email": e.email, "nombre": e.nombre_completo} for e in personas if e.email]}


def historial(db: Session, mensaje_id: int | None = None, limite: int = 200) -> list[dict]:
    q = db.query(DesignCliqEnvio)
    if mensaje_id:
        q = q.filter(DesignCliqEnvio.mensaje_id == mensaje_id)
    return [{"id": e.id, "en": e.en.isoformat() + "Z", "mensaje": e.mensaje_nombre, "mensajeId": e.mensaje_id, "grupo": e.grupo_nombre,
             "tipo": e.tipo, "destino": e.destino, "bot": e.bot, "ok": e.ok, "detalle": e.detalle, "origen": e.origen,
             "por": e.por, "texto": e.texto} for e in q.order_by(DesignCliqEnvio.en.desc(), DesignCliqEnvio.id.desc()).limit(limite)]


# ---------- Guardar ----------

def guardar_grupo(db: Session, datos: dict, por: str) -> DesignCliqGrupo:
    nombre = _limpio(datos.get("nombre"), 120)
    if not nombre:
        raise ValueError("El grupo necesita un nombre.")
    g = db.get(DesignCliqGrupo, int(datos["id"])) if datos.get("id") else None
    if datos.get("id") and not g:
        raise ValueError("Ese grupo ya no existe.")
    if (db.query(DesignCliqGrupo).filter(func.lower(DesignCliqGrupo.nombre) == nombre.lower()).filter(DesignCliqGrupo.id != (g.id if g else -1)).first()):
        raise ValueError(f"Ya hay un grupo llamado «{nombre}».")
    destinos, vistos = [], set()
    for d in datos.get("destinos") or []:
        tipo = "persona" if d.get("tipo") == "persona" else "canal"
        valor = _limpio(d.get("valor"), 200).lstrip("#@").strip()
        if not valor:
            continue
        if tipo == "persona" and "@" not in valor:
            raise ValueError(f"«{valor}» no es un correo: para una persona escribe su correo de Zoho.")
        if tipo == "canal" and not re.fullmatch(r"[\w.\-]+", valor):
            raise ValueError(f"«{valor}» no parece un Unique Name de canal (sin espacios).")
        if (tipo, valor.lower()) in vistos:
            continue
        vistos.add((tipo, valor.lower()))
        destinos.append((tipo, valor))
    if not g:
        g = DesignCliqGrupo(nombre=nombre)
        db.add(g)
        db.flush()
    g.nombre, g.actualizado_por = nombre, por
    db.query(DesignCliqDestino).filter(DesignCliqDestino.grupo_id == g.id).delete()
    for i, (tipo, valor) in enumerate(destinos):
        db.add(DesignCliqDestino(grupo_id=g.id, tipo=tipo, valor=valor, orden=i))
    db.commit()
    return g


def eliminar_grupo(db: Session, grupo_id: int) -> None:
    g = db.get(DesignCliqGrupo, grupo_id)
    if not g:
        return
    for m in db.query(DesignCliqMensaje).all():
        if grupo_id in _ids(m.grupos):
            m.grupos = ",".join(str(i) for i in _ids(m.grupos) if i != grupo_id)
    db.query(DesignCliqDestino).filter(DesignCliqDestino.grupo_id == grupo_id).delete()
    db.delete(g)
    db.commit()


def guardar_mensaje(db: Session, datos: dict, por: str) -> DesignCliqMensaje:
    nombre = _limpio(datos.get("nombre"), 120)
    texto = str(datos.get("texto") or "").strip()[:4000]
    if not nombre:
        raise ValueError("El mensaje necesita un nombre.")
    if not texto:
        raise ValueError("Escribe el texto del mensaje.")
    m = db.get(DesignCliqMensaje, int(datos["id"])) if datos.get("id") else None
    if datos.get("id") and not m:
        raise ValueError("Ese mensaje ya no existe.")
    disp = datos.get("disparador") if datos.get("disparador") in DISPARADORES else "manual"
    if m and m.sistema:
        disp = m.disparador   # los de sistema conservan su momento de envío
    hora = _hora_ok(datos.get("progHora"))
    tipo = "semanal" if datos.get("progTipo") == "semanal" else "una"
    fecha = None
    if disp == "programado":
        if not hora:
            raise ValueError("Elige la hora del envío.")
        if tipo == "una":
            try:
                fecha = date.fromisoformat(str(datos.get("progFecha") or ""))
            except ValueError:
                raise ValueError("Elige la fecha del envío.")
    dias = sorted({int(d) for d in datos.get("progDias") or [] if str(d).isdigit() and 0 <= int(d) <= 6})
    if disp == "programado" and tipo == "semanal" and not dias:
        raise ValueError("Elige al menos un día de la semana.")
    existentes = {g.id for g in db.query(DesignCliqGrupo.id)}
    grupos = [int(g) for g in datos.get("grupos") or [] if str(g).isdigit() and int(g) in existentes]
    bot = _limpio(datos.get("bot"), 100)
    if bot and not re.fullmatch(r"[\w.\-]+", bot):
        raise ValueError("El bot se escribe con su Unique Name (sin espacios).")
    if not m:
        m = DesignCliqMensaje(orden=(max([x.orden or 0 for x in db.query(DesignCliqMensaje)] or [0]) + 1))
        db.add(m)
    m.nombre, m.texto, m.disparador, m.bot = nombre, texto, disp, ("" if bot == sc.bot() else bot)
    m.activo = bool(datos.get("activo", True))
    m.prog_tipo, m.prog_fecha, m.prog_hora, m.prog_dias = tipo, fecha, hora or ("07:00" if disp == "cambio_support" else ""), ",".join(map(str, dias))
    m.saltar_festivos = bool(datos.get("saltarFestivos", True))
    m.grupos = ",".join(str(g) for g in dict.fromkeys(grupos))
    m.actualizado_por, m.actualizado_en = por, datetime.utcnow()
    db.commit()
    return m


def activar(db: Session, mensaje_id: int, activo: bool, por: str) -> DesignCliqMensaje | None:
    m = db.get(DesignCliqMensaje, mensaje_id)
    if m:
        m.activo, m.actualizado_por, m.actualizado_en = activo, por, datetime.utcnow()
        db.commit()
    return m


def eliminar_mensaje(db: Session, mensaje_id: int) -> str | None:
    m = db.get(DesignCliqMensaje, mensaje_id)
    if not m:
        return None
    if m.sistema:
        return "Este aviso lo usa la plataforma desde antes: puedes pausarlo, pero no eliminarlo."
    db.delete(m)
    db.commit()
    return None


def duplicar(db: Session, mensaje_id: int, por: str) -> DesignCliqMensaje | None:
    m = db.get(DesignCliqMensaje, mensaje_id)
    if not m:
        return None
    disp = m.disparador if not m.sistema else "manual"   # la copia de un aviso de sistema empieza como manual
    c = DesignCliqMensaje(nombre=f"{m.nombre} (copia)"[:120], activo=False, bot=m.bot, texto=m.texto, disparador=disp,
                          prog_tipo=m.prog_tipo, prog_fecha=m.prog_fecha, prog_hora=m.prog_hora, prog_dias=m.prog_dias,
                          saltar_festivos=m.saltar_festivos, grupos=m.grupos, orden=(m.orden or 0) + 1, actualizado_por=por,
                          actualizado_en=datetime.utcnow())
    db.add(c)
    db.commit()
    return c


# ---------- Enviar ----------

def _envio(db: Session, m: DesignCliqMensaje | None, grupo: str, tipo: str, destino: str, bot: str, texto: str,
           ok: bool, detalle: str, origen: str, por: str) -> DesignCliqEnvio:
    e = DesignCliqEnvio(mensaje_id=m.id if m else None, mensaje_nombre=(m.nombre if m else "Prueba de destino"), grupo_nombre=grupo,
                        tipo=tipo, destino=destino, bot=bot or sc.bot(), texto=texto, ok=ok, detalle=(detalle or "")[:400],
                        origen=origen, por=por)
    db.add(e)
    return e


def _enviar_uno(cliente, tipo: str, destino: str, texto: str, bot: str) -> tuple[bool, str]:
    if tipo == "persona":
        return sc.enviar_persona(destino, texto, cliente, bot or None)
    return sc.enviar_canal(destino, texto, cliente, bot or None)


def enviar(db: Session, m: DesignCliqMensaje, ahora: datetime, origen: str = "manual", por: str = "Sistema",
           turno: int | None = None, solo: tuple[str, str] | None = None) -> list[dict]:
    """Envía el mensaje a sus grupos (o solo a `solo` = (tipo, destino)) y lo deja en el historial."""
    texto = armar(m.texto, valores(db, ahora, turno))
    if solo:
        objetivos = [("", solo[0], solo[1])]
    else:
        grupos = {g.id: g for g in db.query(DesignCliqGrupo).filter(DesignCliqGrupo.id.in_(_ids(m.grupos) or [-1]))}
        dest = (db.query(DesignCliqDestino).filter(DesignCliqDestino.grupo_id.in_(list(grupos) or [-1]))
                .order_by(DesignCliqDestino.grupo_id, DesignCliqDestino.orden).all())
        objetivos, vistos = [], set()
        for d in dest:
            if (d.tipo, d.valor.lower()) not in vistos:   # un canal en dos grupos recibe el mensaje una sola vez
                vistos.add((d.tipo, d.valor.lower()))
                objetivos.append((grupos[d.grupo_id].nombre, d.tipo, d.valor))
    out = []
    with httpx.Client(timeout=12) as cliente:
        for grupo, tipo, destino in objetivos:
            ok, det = _enviar_uno(cliente, tipo, destino, texto, m.bot)
            _envio(db, m, grupo, tipo, destino, m.bot, texto, ok, det, origen, por)
            out.append({"grupo": grupo, "tipo": tipo, "destino": destino, "ok": ok, "detalle": det})
    db.commit()
    return out


def probar_destino(db: Session, tipo: str, destino: str, por: str) -> dict:
    tipo = "persona" if tipo == "persona" else "canal"
    destino = (destino or "").strip().lstrip("#@").strip()
    texto = "✅ Prueba del Centro de avisos de la plataforma. Si ves este mensaje, el bot puede escribir aquí."
    with httpx.Client(timeout=12) as cliente:
        ok, det = _enviar_uno(cliente, tipo, destino, texto, "")
    _envio(db, None, "", tipo, destino, "", texto, ok, det, "prueba", por)
    db.commit()
    return {"ok": ok, "detalle": det}


def reintentar(db: Session, envio_id: int, por: str) -> dict | None:
    e = db.get(DesignCliqEnvio, envio_id)
    if not e:
        return None
    with httpx.Client(timeout=12) as cliente:
        ok, det = _enviar_uno(cliente, e.tipo, e.destino, e.texto, e.bot if e.bot != sc.bot() else "")
    m = db.get(DesignCliqMensaje, e.mensaje_id) if e.mensaje_id else None
    n = _envio(db, m, e.grupo_nombre, e.tipo, e.destino, e.bot, e.texto, ok, det, "reintento", por)
    if not m:
        n.mensaje_nombre = e.mensaje_nombre
    db.commit()
    return {"ok": ok, "detalle": det}


# ---------- Automático (un hilo revisa cada minuto) ----------

def _marcar(db: Session, clave: str) -> bool:
    """True si esta instancia ganó la marca (el envío es suyo); False si ya estaba."""
    if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).first():
        return False
    try:
        db.add(DesignConexionRegla(tipo="sistema", clave=clave, creado_por="Sistema"))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def _en_ventana(ahora: datetime, hora: str) -> bool:
    ini = _min(hora)
    return ini is not None and 0 <= (ahora.hour * 60 + ahora.minute) - ini < VENTANA_MIN


def _festivo(db: Session, d: date) -> bool:
    from . import services_design as sd
    return d in sd.festivos(db)


def revisar(db: Session, ahora: datetime) -> list[str]:
    """Envía lo que toca en este minuto. Devuelve las claves de lo enviado (para las pruebas)."""
    from . import services_design_support as ss
    if not sc.configurado():
        return []
    sembrar(db)
    hoy, enviados = ahora.date(), []
    c = ss.config(db)
    dias_support = {int(x) for x in (c.dias or "").split(",") if x.strip().isdigit()}
    for m in db.query(DesignCliqMensaje).filter(DesignCliqMensaje.activo == True).all():  # noqa: E712
        if not _ids(m.grupos):
            continue
        clave, turno = None, None
        if m.disparador == "turno_support" and ss.listo(c):
            for n in (1, 2):
                if _en_ventana(ahora, c.turno1_inicio if n == 1 else c.turno2_inicio):
                    if hoy.weekday() in dias_support and not (m.saltar_festivos and _festivo(db, hoy)):
                        clave = (f"support_en_turno_{hoy.isoformat()}_{n}" if m.sistema == SIS_TURNO
                                 else f"cliq_msg_{m.id}_{hoy.isoformat()}_t{n}")
                        turno = n
                    break
        elif m.disparador == "cambio_support" and ss.listo(c):
            ult = ss.proximo_cambio(c, hoy) - timedelta(days=7 * max(1, c.semanas))   # el cambio más reciente
            if ult == hoy and _en_ventana(ahora, m.prog_hora or "07:00"):
                clave = f"support_cambio_{hoy.isoformat()}" if m.sistema == SIS_CAMBIO else f"cliq_msg_{m.id}_{hoy.isoformat()}"
        elif m.disparador == "programado" and _en_ventana(ahora, m.prog_hora):
            if m.prog_tipo == "semanal":
                dias = {int(x) for x in (m.prog_dias or "").split(",") if x.strip().isdigit()}
                if hoy.weekday() in dias and not (m.saltar_festivos and _festivo(db, hoy)):
                    clave = f"cliq_msg_{m.id}_{hoy.isoformat()}_{m.prog_hora}"
            elif m.prog_fecha == hoy:
                clave = f"cliq_msg_{m.id}_{hoy.isoformat()}_{m.prog_hora}"
        if clave and _marcar(db, clave):
            try:
                res = enviar(db, m, ahora, "auto", "Sistema", turno)
            except Exception:
                # 21-oct-2026: si el envío se cae antes de llegar a Cliq, se quita la marca para reintentar el minuto siguiente
                db.rollback()
                db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == clave).delete()
                db.commit()
                raise
            log.info("Centro de avisos · %s → %s", m.nombre, ", ".join(f"{r['destino']}: {r['detalle']}" for r in res))
            enviados.append(clave)
    return enviados


_hilo = {"t": None}
# Estado del revisor automático de este servidor (se ve en la página): última revisión y último error (21-oct-2026)
ESTADO = {"desde": None, "ultima": None, "error": "", "error_en": None}


def arrancar() -> None:
    """Hilo que cada minuto revisa qué mensajes tocan (no hay tareas programadas en el servidor)."""
    if _hilo["t"] is not None or os.getenv("DESIGN_SIN_AVISOS_TURNO"):
        return

    def _bucle():
        from . import services_design as sd
        from .database import SessionLocal
        ESTADO["desde"] = datetime.utcnow()
        while True:
            time.sleep(60)
            try:   # 21-oct-2026: nada aquí puede matar el hilo (antes un rollback fallido lo detenía para siempre)
                db = SessionLocal()
                try:
                    revisar(db, sd.ahora_colombia().replace(tzinfo=None))
                    ESTADO["ultima"] = datetime.utcnow()
                except Exception as e:  # noqa: BLE001
                    ESTADO["error"], ESTADO["error_en"] = f"{type(e).__name__}: {e}"[:300], datetime.utcnow()
                    log.exception("Centro de avisos: no se pudo revisar")
                    try:
                        db.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                finally:
                    db.close()
            except Exception:  # noqa: BLE001
                log.exception("Centro de avisos: fallo del revisor")
    _hilo["t"] = threading.Thread(target=_bucle, daemon=True, name="design-avisos")
    _hilo["t"].start()
