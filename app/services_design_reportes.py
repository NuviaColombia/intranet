"""Dashboard › Reportes (Rosember, 21-oct-2026): reporte mensual para la Directora de producción, en español o inglés,
con el mismo formato del reporte «Input Failures by Center» de dicom2stl, y reportes en PDF subidos a mano.

Qué trae el reporte del mes (solo lo que tiene problemas; lo que está bien no sale):
- Centros que demoran las cirugías: casos de N3 › Cirugías cuya articulación (RTD − START) pasó de 2 horas
  (services_design.dashboard_articulacion, la misma medida del Dashboard › Articulación).
- Cambios adicionales: los Cambios digitales del mes (DOC = los pidió el doctor, LAB = el laboratorio), cruzados con la
  orden del Schedule para saber qué diseñador hizo el caso. Salen solo los diseñadores con al menos un cambio.
Sin nombres de pacientes."""
import html
import re
from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from . import services_design as sd
from .models import Empleado
from .models_design import DesignArea, DesignCambioDigital, DesignOrden, DesignReporte, DesignTeam

MESES = {"es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
         "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]}
MESES_C = {"es": ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
           "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]}
TAM_MAX = 15 * 1024 * 1024   # PDF subido: 15 MB como mucho (la base tiene espacio limitado)


def rango_mes(mes: str) -> tuple[date, date]:
    """'2026-10' → (1-oct, 31-oct). Si es el mes en curso, hasta hoy."""
    if not re.fullmatch(r"\d{4}-\d{2}", mes or ""):
        raise ValueError("Mes no válido.")
    a, m = int(mes[:4]), int(mes[5:])
    if not 1 <= m <= 12:
        raise ValueError("Mes no válido.")
    ini, fin = date(a, m, 1), date(a, m, monthrange(a, m)[1])
    hoy = sd.ahora_colombia().date()
    return ini, min(fin, hoy) if ini <= hoy else fin


def meses_disponibles(n: int = 12) -> list[str]:
    hoy = sd.ahora_colombia().date()
    out, a, m = [], hoy.year, hoy.month
    for _ in range(n):
        out.append(f"{a}-{m:02d}")
        a, m = (a, m - 1) if m > 1 else (a - 1, 12)
    return out


def _dur(minutos: float, lang: str) -> str:
    m = int(round(minutos or 0))
    h, r = divmod(m, 60)
    if not h:
        return f"{r} min"
    if not r:
        return f"{h} h" if lang == "es" else f"{h}h"
    return f"{h} h {r:02d} min" if lang == "es" else f"{h}h {r:02d}m"


def _fecha_c(d: date, lang: str) -> str:
    return f"{d.day} {MESES_C[lang][d.month - 1]}" if lang == "es" else f"{MESES_C[lang][d.month - 1]} {d.day}"


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", sd._normalizar_texto(t or "")).strip()


# ---------- Articulación (centros que demoran las cirugías) ----------

def _articulacion(db: Session, admin: Empleado, ini: date, fin: date) -> dict:
    d = sd.dashboard_articulacion(db, admin, ini, fin)
    managers = {}
    for o, t in (db.query(DesignOrden.centro, DesignTeam).join(DesignTeam, DesignTeam.id == DesignOrden.team_id)
                 .options(joinedload(DesignTeam.manager))
                 .filter(DesignOrden.fecha >= ini, DesignOrden.fecha <= fin, func.coalesce(DesignOrden.art_start, "") != "")):
        managers.setdefault(_norm(o), set()).add(sd.nombre_corto(t.manager) if t.manager else t.nombre)
    problemas = [c for c in d["centros"] if c["pasadas"]]
    for c in problemas:
        c["managers"] = ", ".join(sorted(managers.get(_norm(c["centro"]), [])))
    casos_tarde = d["casos"]
    prom_tarde = round(sum(c["min"] for c in casos_tarde) / len(casos_tarde)) if casos_tarde else 0
    # tendencia por semana (lunes), % de casos que pasaron de 2 h
    semanas: dict = {}
    q = (db.query(DesignOrden).filter(sd.filtro_orden_completa(), DesignOrden.tabla == "principal", DesignOrden.fecha >= ini,
                                      DesignOrden.fecha <= fin, func.coalesce(DesignOrden.art_start, "") != "",
                                      func.coalesce(DesignOrden.art_rtd, "") != ""))
    for o in q:
        if sd._es_cancelada(o.estado):
            continue
        lunes = o.fecha - timedelta(days=o.fecha.weekday())
        s = semanas.setdefault(lunes, [0, 0])
        s[0] += 1
        s[1] += 1 if sd._entre(o.art_start, o.art_rtd) > sd.ART_LIMITE_MIN else 0
    tendencia = [{"semana": k, "casos": v[0], "pasadas": v[1], "pct": round(v[1] * 100 / v[0], 1) if v[0] else 0}
                 for k, v in sorted(semanas.items())]
    return {"medidos": d["medidos"], "pasadas": d["pasadas"], "pct": round(d["pasadas"] * 100 / d["medidos"], 1) if d["medidos"] else 0,
            "centrosTotal": len(d["centros"]), "centros": problemas, "casos": sorted(casos_tarde, key=lambda x: (x["fecha"], x["orden"])),
            "promTarde": prom_tarde, "maxTarde": max([c["min"] for c in casos_tarde] or [0]), "tendencia": tendencia,
            "limite": sd.ART_LIMITE_MIN}


# ---------- Cambios adicionales (qué diseñador hizo el caso) ----------

def _equipos_excluidos(db: Session) -> set[int]:
    """Copias de Removable Denture y equipos de Support: no son quien diseñó el caso original."""
    return {t.id for t in db.query(DesignTeam).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter((DesignArea.nombre == sd.AREA_RD) | (DesignArea.formato == sd.FORMATO_SUPPORT))}


def _cambios(db: Session, ini: date, fin: date) -> dict:
    cambios = (db.query(DesignCambioDigital).filter(DesignCambioDigital.fecha >= ini, DesignCambioDigital.fecha <= fin)
               .order_by(DesignCambioDigital.fecha, DesignCambioDigital.id).all())
    excl = _equipos_excluidos(db)
    numeros = {(c.orden or "").strip().upper() for c in cambios if (c.orden or "").strip()}
    por_orden: dict[str, list] = {}
    if numeros:
        for o in (db.query(DesignOrden).options(joinedload(DesignOrden.designer), joinedload(DesignOrden.team).joinedload(DesignTeam.manager))
                  .filter(func.upper(func.trim(DesignOrden.orden)).in_(list(numeros)))):
            if o.team_id not in excl and (o.designer_id or (o.designer_prestado or "").strip()):
                por_orden.setdefault((o.orden or "").strip().upper(), []).append(o)
    diseñadores: dict = {}
    filas, sin_cruce = [], 0
    for c in cambios:
        cand = por_orden.get((c.orden or "").strip().upper(), [])
        # la orden del Schedule más reciente hasta la fecha del cambio (si no, la primera que haya)
        antes = [o for o in cand if not c.fecha or o.fecha <= c.fecha]
        o = max(antes, key=lambda x: (x.fecha, x.id)) if antes else (min(cand, key=lambda x: (x.fecha, x.id)) if cand else None)
        if o is None:
            sin_cruce += 1
            nombre, clave, equipo = "", None, ""
        else:
            nombre = o.designer.nombre_completo if o.designer else o.designer_prestado.strip()
            clave = ("id", o.designer_id) if o.designer_id else ("n", _norm(nombre))
            equipo = sd.nombre_corto(o.team.manager) if o.team and o.team.manager else (o.team.nombre if o.team else "")
        filas.append({"fecha": c.fecha, "orden": c.orden, "centro": c.centro, "producto": c.producto, "tipo": c.tipo_cambio,
                      "origen": c.origen, "detalle": c.detalle, "designer": nombre, "manager": equipo})
        if clave:
            x = diseñadores.setdefault(clave, {"nombre": nombre, "id": o.designer_id, "manager": equipo, "cambios": 0, "DOC": 0, "LAB": 0,
                                               "ordenes": set(), "tipos": {}})
            x["cambios"] += 1
            if c.origen in ("DOC", "LAB"):
                x[c.origen] += 1
            x["ordenes"].add((c.orden or "").strip().upper())
            if c.tipo_cambio:
                x["tipos"][c.tipo_cambio] = x["tipos"].get(c.tipo_cambio, 0) + 1
    # casos que hizo cada diseñador en el mes (para el % de sus casos con cambios)
    ids = [x["id"] for x in diseñadores.values() if x["id"]]
    hechos = dict(db.query(DesignOrden.designer_id, func.count(DesignOrden.id))
                  .filter(sd.filtro_orden_completa(), DesignOrden.designer_id.in_(ids or [-1]), DesignOrden.fecha >= ini,
                          DesignOrden.fecha <= fin, DesignOrden.team_id.notin_(list(excl) or [-1]))
                  .group_by(DesignOrden.designer_id).all())
    lista = []
    for x in diseñadores.values():
        n = hechos.get(x["id"], 0) if x["id"] else 0
        tipos = sorted(x["tipos"].items(), key=lambda kv: -kv[1])
        lista.append({"nombre": x["nombre"], "manager": x["manager"], "cambios": x["cambios"], "DOC": x["DOC"], "LAB": x["LAB"],
                      "casosConCambio": len(x["ordenes"]), "casosMes": n,
                      "pct": round(len(x["ordenes"]) * 100 / n, 1) if n else None, "tipos": tipos[:3]})
    lista.sort(key=lambda x: (-x["cambios"], -x["LAB"], x["nombre"].lower()))
    tipos: dict = {}
    for c in cambios:
        if c.tipo_cambio:
            tipos[c.tipo_cambio] = tipos.get(c.tipo_cambio, 0) + 1
    centros: dict = {}
    for c in cambios:
        if c.centro:
            centros[c.centro] = centros.get(c.centro, 0) + 1
    return {"total": len(cambios), "DOC": sum(1 for c in cambios if c.origen == "DOC"), "LAB": sum(1 for c in cambios if c.origen == "LAB"),
            "casos": len(numeros), "disenadores": lista, "sinCruce": sin_cruce, "filas": filas,
            "tipos": sorted(tipos.items(), key=lambda kv: -kv[1])[:8], "centros": sorted(centros.items(), key=lambda kv: -kv[1])[:5]}


# ---------- Hallazgos (ordenados por impacto) ----------

def _hallazgos(art: dict, cam: dict, prev: dict | None, lang: str) -> list[dict]:
    es = lang == "es"
    E = html.escape   # los nombres vienen de los datos y el texto sale como HTML (negritas)
    out = []
    lim = _dur(art["limite"], lang)
    for c in art["centros"][:3]:
        if es:
            t = (f"<b>{E(c['centro'])}: {c['pasadas']} de {c['casos']} cirugías pasaron de {lim} de articulación</b> "
                 f"(promedio del centro {_dur(c['promedio'], lang)}, la más larga {_dur(c['max'], lang)}).")
            a = f"Revisar con {E(c['managers']) or 'el manager del centro'} qué está retrasando la entrega de la articulación en {E(c['centro'])}."
        else:
            t = (f"<b>{E(c['centro'])}: {c['pasadas']} of {c['casos']} surgeries took longer than {lim} to articulate</b> "
                 f"(center average {_dur(c['promedio'], lang)}, longest {_dur(c['max'], lang)}).")
            a = f"Review with {E(c['managers']) or 'the center manager'} what is delaying the articulation delivery at {E(c['centro'])}."
        out.append({"t": t, "a": a, "fuerte": c["pct"] >= 30})
    if len(art["centros"]) > 3:
        resto = art["centros"][3:]
        nombres = ", ".join(E(c["centro"]) for c in resto)
        n = sum(c["pasadas"] for c in resto)
        out.append({"t": (f"<b>{len(resto)} centros más con al menos una cirugía tarde</b> ({n} casos): {nombres}." if es else
                          f"<b>{len(resto)} more centers with at least one late surgery</b> ({n} cases): {nombres}."),
                    "a": ("Seguimiento en el próximo mes: si se repiten, pasan a revisión con su manager." if es else
                          "Follow up next month: if they repeat, review them with their manager."), "fuerte": False})
    if art["medidos"]:
        comp = ""
        if prev and prev.get("medidos"):
            comp = (f" frente a {prev['pct']} % el mes anterior" if es else f" versus {prev['pct']} % the previous month")
        out.append({"t": (f"<b>{art['pct']} % de las cirugías ({art['pasadas']} de {art['medidos']}) pasaron de {lim}</b>{comp}. "
                          f"Los casos tarde tardaron en promedio {_dur(art['promTarde'], lang)}." if es else
                          f"<b>{art['pct']} % of surgeries ({art['pasadas']} of {art['medidos']}) took longer than {lim}</b>{comp}. "
                          f"Late cases took {_dur(art['promTarde'], lang)} on average."),
                    "a": ("El tiempo esperado de articulación es de 2 horas por caso." if es else
                          "The expected articulation time is 2 hours per case."), "fuerte": False})
    for x in cam["disenadores"][:3]:
        tipos = ", ".join(f"{E(k)} ({v})" for k, v in x["tipos"]) or ("sin tipo" if es else "no type")
        pct = (f", {x['pct']} % de sus {x['casosMes']} casos del mes" if es else f", {x['pct']} % of their {x['casosMes']} cases this month") if x["pct"] is not None else ""
        out.append({"t": (f"<b>{E(x['nombre'])}: {x['cambios']} cambios adicionales en {x['casosConCambio']} casos</b> "
                          f"({x['LAB']} LAB, {x['DOC']} DOC{pct}). Más frecuentes: {tipos}." if es else
                          f"<b>{E(x['nombre'])}: {x['cambios']} additional changes in {x['casosConCambio']} cases</b> "
                          f"({x['LAB']} LAB, {x['DOC']} DOC{pct}). Most frequent: {tipos}."),
                    "a": (f"Revisar con {E(x['manager']) or 'su manager'} los casos y reforzar el QC en esos tipos de cambio." if es else
                          f"Review the cases with {E(x['manager']) or 'their manager'} and reinforce QC on those change types."),
                    "fuerte": x["LAB"] >= 3})
    if cam["tipos"]:
        k, v = cam["tipos"][0]
        out.append({"t": (f"<b>El cambio más pedido fue «{E(k)}»: {v} de {cam['total']}.</b>" if es else
                          f"<b>The most requested change was “{E(k)}”: {v} of {cam['total']}.</b>"),
                    "a": ("Usarlo como tema del próximo entrenamiento del equipo." if es else
                          "Use it as the topic of the team's next training."), "fuerte": False})
    if not out:
        out.append({"t": ("<b>Sin problemas este mes.</b> Ninguna cirugía pasó de 2 horas de articulación y no hubo cambios adicionales." if es else
                          "<b>No issues this month.</b> No surgery exceeded 2 hours of articulation and there were no additional changes."),
                    "a": "", "fuerte": False})
    return out


def reporte_mensual(db: Session, admin: Empleado, mes: str, lang: str = "es") -> dict:
    lang = "en" if lang == "en" else "es"
    ini, fin = rango_mes(mes)
    art = _articulacion(db, admin, ini, fin)
    cam = _cambios(db, ini, fin)
    p_fin = ini - timedelta(days=1)
    try:
        prev = _articulacion(db, admin, date(p_fin.year, p_fin.month, 1), p_fin)
    except Exception:  # noqa: BLE001  la comparación es opcional
        prev = None
    for c in art["casos"]:
        c["fechaTxt"] = _fecha_c(date.fromisoformat(c["fecha"]), lang)
        c["dur"] = _dur(c["min"], lang)
    for c in art["centros"]:
        c["promTxt"], c["maxTxt"] = _dur(c["promedio"], lang), _dur(c["max"], lang)
    for t in art["tendencia"]:
        t["txt"] = _fecha_c(t["semana"], lang)
    for f in cam["filas"]:
        f["fechaTxt"] = _fecha_c(f["fecha"], lang) if f["fecha"] else ""
    a = int(mes[:4]); m = int(mes[5:])
    return {"lang": lang, "mes": mes, "mesTxt": f"{MESES[lang][m - 1]} {a}" if lang == "en" else f"{MESES[lang][m - 1]} de {a}",
            "ini": _fecha_c(ini, lang), "fin": _fecha_c(fin, lang), "art": art, "cam": cam, "prev": prev,
            "hallazgos": _hallazgos(art, cam, prev, lang), "durLim": _dur(art["limite"], lang),
            "generado": sd.ahora_colombia().strftime("%Y-%m-%d %H:%M")}


# ---------- Reportes subidos a mano ----------

def listar_subidos(db: Session) -> list[dict]:
    return [{"id": r.id, "titulo": r.titulo, "mes": r.mes, "archivo": r.nombre_archivo, "tam": r.tam, "por": r.subido_por,
             "en": r.creado_en.isoformat() + "Z"}
            for r in db.query(DesignReporte).options(defer(DesignReporte.datos)).order_by(DesignReporte.mes.desc(), DesignReporte.creado_en.desc())]


def subir(db: Session, titulo: str, mes: str, nombre: str, datos: bytes, por: str) -> DesignReporte:
    if not datos:
        raise ValueError("El archivo está vacío.")
    if len(datos) > TAM_MAX:
        raise ValueError("El PDF pasa de 15 MB.")
    if not datos.startswith(b"%PDF"):
        raise ValueError("Solo se pueden subir archivos PDF.")
    rango_mes(mes)
    titulo = " ".join((titulo or "").split())[:200] or re.sub(r"\.pdf$", "", nombre or "Reporte", flags=re.I)[:200]
    r = DesignReporte(titulo=titulo, mes=mes, nombre_archivo=(nombre or "reporte.pdf")[:200], tam=len(datos), datos=datos, subido_por=por)
    db.add(r)
    db.commit()
    return r


def eliminar(db: Session, reporte_id: int) -> bool:
    r = db.get(DesignReporte, reporte_id)
    if not r:
        return False
    db.delete(r)
    db.commit()
    return True
