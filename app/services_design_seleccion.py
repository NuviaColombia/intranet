"""Desempeño › Selección asistida (pedido por Rosember el 21-oct-2026; solo admin).

Propone los ganadores del mes con los datos que ya tiene la plataforma, para que el admin decida (no guarda nada):
  - Manager del mes (entre los aprobadores de Face, N2, N3 y N6),
  - Empleado del mes de N2 / Face,
  - Empleado del mes de N3 / N6 y un segundo de N3 / N6,
  - MVP (el mejor puntaje de todas las áreas entre quienes no ganaron otra categoría: nadie se repite).

Método (puntaje 0-100 por persona):
  1. Cada indicador se convierte en percentil DENTRO DE SU ÁREA (los productos de N2, Face, N3 y N6 son distintos: no
     se comparan volúmenes crudos entre áreas). Quien tiene el mejor valor del área queda cerca de 100.
  2. Las tasas con pocos casos se suavizan hacia el promedio del área (bayes empírico) para que 0 hallazgos en 3 casos
     no le gane a 2 hallazgos en 80.
  3. Puntaje = promedio ponderado de los percentiles disponibles; si a alguien le falta un indicador (p. ej. no tiene
     calificación de Desempeño ese mes), los pesos se reparten entre los que sí tiene y queda anotado.
  4. Para competir: al menos la mitad de los días hábiles disponibles y un mínimo de casos aprobados.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from statistics import median

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import services_design as sd
from .models import Empleado
from .models_design import (DesignArea, DesignInhabilitado, DesignOrden, DesignPerfCelda, DesignPerfEmpleado, DesignPerfSeleccionCelda,
                            DesignPerfSeleccionFila, DesignPerfSheet, DesignTeam, DesignTeamDesigner)

AREAS = ["Face Design", "N2 Demodenture", "N3 Prosthetic", "N6 Material Changes"]
GRUPO_N2_FACE = ("Face Design", "N2 Demodenture")
GRUPO_N3_N6 = ("N3 Prosthetic", "N6 Material Changes")

MIN_APROBADAS = 10          # casos aprobados mínimos para competir como diseñador
MIN_FRACCION_DIAS = 0.5     # al menos la mitad de los días hábiles disponibles
SUAVIZADO = 10              # «casos virtuales» con la tasa del área (bayes empírico)

# Pesos (suman 100). Se pueden ajustar con Rosember.
# Pesos (22-oct-2026, Rosember: «lo más imparcial posible»).
# - Quien tiene un hallazgo de QC en el mes queda descartado de una vez (la calidad no pondera: es requisito).
# - Cambios digitales no cuentan: no son culpa del diseñador ni del equipo.
# - 60 % datos objetivos y 40 % opinión de los líderes. La calificación de la hoja de cada equipo se compara SOLO contra los
#   compañeros calificados por el mismo líder (un líder «generoso» no favorece a su gente), y ser el destacado del mes de
#   su manager en la hoja de Selección suma aparte.
PESOS_DISENADOR = {
    "productividad": 45,   # casos aprobados por día disponible (descuenta vacaciones, incapacidad, luto, etc.)
    "evaluacion": 25,      # calificación de su líder en Desempeño ese mes, relativa a los demás del mismo líder
    "destacado": 15,       # su manager lo destacó ese mes en la hoja de Selección
    "eficiencia": 15,      # tiempo de diseño contra la mediana del mismo producto en su área (menos tiempo es mejor)
}
# Managers: más peso a la hoja DESIGN MANAGERS (Rosember, 22-oct-2026), donde se califica a los managers.
PESOS_MANAGER = {
    "evaluacion": 40,      # hoja DESIGN MANAGERS de Desempeño para ese mes
    "productividad": 25,   # casos aprobados del equipo por día disponible de sus diseñadores
    "qcOportuno": 15,      # minutos (mediana) entre Approved y el QC marcado (menos es mejor)
    "qcCobertura": 10,     # % de aprobadas con QC marcado
    "equidad": 10,         # qué tan parejo reparte los productos (equidad del Reparto; menos es mejor)
}
NOMBRES = {"productividad": "Productividad", "calidad": "Calidad (QC)", "destacado": "Destacado por su manager", "evaluacion": "Evaluación del líder",
           "eficiencia": "Eficiencia", "qcOportuno": "QC a tiempo", "qcCobertura": "Cobertura de QC", "equidad": "Reparto parejo"}

_MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
_MESES_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def periodo(anio: int, mes: int) -> tuple[date, date]:
    ini = date(anio, mes, 1)
    fin = (date(anio + (mes == 12), mes % 12 + 1, 1) - timedelta(days=1))
    return ini, min(fin, sd.ahora_colombia().date())


def mes_anterior(hoy: date | None = None) -> tuple[int, int]:
    hoy = hoy or sd.ahora_colombia().date()
    p = hoy.replace(day=1) - timedelta(days=1)
    return p.year, p.month


# ---------- utilidades estadísticas ----------

def _percentiles(valores: dict, mayor_es_mejor: bool) -> dict:
    """{clave: percentil 0-100} dentro del grupo; empates comparten percentil. Un grupo de 1 queda en 50."""
    claves = [k for k, v in valores.items() if v is not None]
    n = len(claves)
    if not n:
        return {}
    if n == 1:
        return {claves[0]: 50.0}
    out = {}
    for k in claves:
        v = valores[k]
        peores = sum(1 for j in claves if (valores[j] < v if mayor_es_mejor else valores[j] > v))
        iguales = sum(1 for j in claves if valores[j] == v) - 1
        out[k] = round((peores + iguales / 2) * 100 / (n - 1), 1)
    return out


def _suavizada(eventos: float, base: float, tasa_grupo: float) -> float:
    return (eventos + SUAVIZADO * tasa_grupo) / (base + SUAVIZADO) if base + SUAVIZADO else 0.0


def _puntaje(percentiles: dict, pesos: dict) -> tuple[float, list[str]]:
    disponibles = {k: p for k, p in pesos.items() if percentiles.get(k) is not None}
    faltan = [k for k in pesos if k not in disponibles]
    total = sum(disponibles.values())
    if not total:
        return 0.0, faltan
    return round(sum(percentiles[k] * w for k, w in disponibles.items()) / total, 1), faltan


def _por_que(percentiles: dict, metricas: dict, pesos: dict) -> dict:
    """Fortalezas (percentil ≥ 70, de más peso a menos) y puntos a mejorar (percentil ≤ 30)."""
    orden = sorted((k for k in pesos if percentiles.get(k) is not None), key=lambda k: (-percentiles[k], -pesos[k]))
    fuertes = [f"{NOMBRES[k]}: {metricas[k]['texto']} ({'el mejor de su área' if percentiles[k] >= 99.5 else f'percentil {percentiles[k]:.0f} de su área'})"
               for k in orden if percentiles[k] >= 70]
    debiles = [f"{NOMBRES[k]}: {metricas[k]['texto']}" for k in orden if percentiles[k] <= 30]
    return {"fuertes": fuertes[:3], "mejorar": debiles[-2:]}


# ---------- Desempeño (calificación del líder) ----------

def _indice_mes(etiquetas: list[str], anio: int, mes: int) -> int | None:
    """Índice de la columna del mes en una hoja de Desempeño (etiquetas tipo «Ene 2025», «Octubre», «oct-25»)."""
    elegido = None
    for i, et in enumerate(etiquetas):
        t = sd._normalizar_texto(et or "")
        m = next((k for k, pre in enumerate(_MESES) if re.search(r"\b" + pre, t)), None)
        if m is None:
            m = next((k for k, pre in enumerate(_MESES_EN) if re.search(r"\b" + pre, t)), None)
        if m is None or m + 1 != mes:
            continue
        a = re.search(r"(\d{4})|\b(\d{2})\b", t)
        if a:
            an = int(a.group(1)) if a.group(1) else 2000 + int(a.group(2))
            if an == anio:
                return i
            continue
        elegido = i   # sin año: el último mes con ese nombre
    return elegido


def _evaluaciones(db: Session, empleados: list[Empleado], anio: int, mes: int, hoja_general: bool) -> dict[int, dict]:
    """{empleado_id: {"pct": % de la calificación del mes (0-100), "rel": percentil entre los de la misma hoja}} desde las
    hojas de Desempeño (eval). Solo cuenta si el mes tiene al menos un criterio calificado. hoja_general=True lee la hoja
    DESIGN MANAGERS; si no, las de los equipos. «rel» quita el sesgo de cada líder (unos califican más alto que otros)."""
    criterios = [c.id for c in sd.perf_criterios(db)]
    out: dict[int, dict] = {}
    for h in db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "eval"):
        if sd._es_hoja_general(h.nombre) != hoja_general:
            continue
        i = _indice_mes(json.loads(h.meses or "[]"), anio, mes)
        if i is None:
            continue
        hoja: dict[int, float] = {}
        for fila in db.query(DesignPerfEmpleado).filter(DesignPerfEmpleado.sheet_id == h.id):
            e = sd._buscar_empleado_por_nombre(fila.nombre, empleados)
            if not e:
                continue
            celdas = {f"{c.criterio_id}_0": {"nivel": c.nivel}   # solo ese mes, como si fuera el único de la hoja
                      for c in db.query(DesignPerfCelda).filter(DesignPerfCelda.empleado_id == fila.id, DesignPerfCelda.mes_indice == i)}
            if not any((v.get("nivel") or "") for v in celdas.values()):
                continue
            tot, _ = sd.perf_totales(celdas, criterios, 1)
            hoja[e.id] = round(tot[0] * 100, 1)
        rel = _percentiles(hoja, True)
        for eid, v in hoja.items():
            out[eid] = {"pct": v, "rel": rel[eid]}
    return out


def _destacados(db: Session, empleados: list[Empleado], anio: int, mes: int) -> set[int] | None:
    """Personas que su manager destacó ese mes en la hoja de Selección (cada evaluador escribe 1 nombre por mes).
    None si ese mes nadie ha destacado a nadie todavía (el criterio no cuenta y su peso se reparte)."""
    out: set[int] = set()
    hay = False
    for h in db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "seleccion"):
        i = _indice_mes(json.loads(h.meses or "[]"), anio, mes)
        if i is None:
            continue
        for c in (db.query(DesignPerfSeleccionCelda).join(DesignPerfSeleccionFila, DesignPerfSeleccionFila.id == DesignPerfSeleccionCelda.fila_id)
                  .filter(DesignPerfSeleccionFila.sheet_id == h.id, DesignPerfSeleccionCelda.mes_indice == i)):
            if not (c.persona or "").strip():
                continue
            hay = True
            e = sd._buscar_empleado_por_nombre(c.persona, empleados)
            if e:
                out.add(e.id)
    return out if hay else None


# ---------- datos del mes ----------

def _equipos(db: Session) -> list[DesignTeam]:
    return (db.query(DesignTeam).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter(DesignArea.nombre.in_(AREAS), DesignTeam.activo == 1).all())


def _ordenes(db: Session, ini: date, fin: date, team_ids: list[int]) -> list[DesignOrden]:
    return [o for o in db.query(DesignOrden).filter(sd.filtro_orden_completa(), DesignOrden.fecha >= ini, DesignOrden.fecha <= fin,
                                                    DesignOrden.team_id.in_(team_ids or [-1]))
            if not sd._es_cancelada(o.estado)]


def analizar(db: Session, anio: int, mes: int) -> dict:
    ini, fin = periodo(anio, mes)
    equipos = _equipos(db)
    area_de_equipo = {t.id: t.area.nombre for t in equipos}
    managers = {t.manager_id for t in equipos if t.manager_id}
    inhabilitados = {r.empleado_id for r in db.query(DesignInhabilitado).filter(DesignInhabilitado.activo == 1)}
    miembros: dict[int, set[int]] = {}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(
            DesignTeamDesigner.team_id.in_(list(area_de_equipo) or [-1])):
        miembros.setdefault(tid, set()).add(eid)
    ordenes = _ordenes(db, ini, fin, list(area_de_equipo))
    habiles, ausencias = sd._reparto_dias(db, list({e for s in miembros.values() for e in s} | managers), ini, fin)
    dias_hab = len(habiles)

    # Mediana de minutos por producto y área (eficiencia): solo tiempos razonables (5 a 600 min)
    formato = {t.id: t.area.formato for t in equipos}
    dur: dict[int, float] = {}
    muestras: dict[tuple, list[float]] = {}
    for o in ordenes:
        if not sd._es_aprobada(o.estado):
            continue
        m = sd.duracion_orden_min(o, formato[o.team_id])
        if 5 <= m <= 600:
            dur[o.id] = m
            muestras.setdefault((area_de_equipo[o.team_id], sd._normalizar_texto(o.producto)), []).append(m)
    mediana = {k: median(v) for k, v in muestras.items() if len(v) >= 3}

    # ---------------- Diseñadores ----------------
    empleados_ids = {e for tid, s in miembros.items() for e in s} - managers - inhabilitados
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_(list(empleados_ids) or [-1]), Empleado.activo == 1)}
    area_de: dict[int, str] = {}
    casos_area: dict[int, dict[str, int]] = {}
    for o in ordenes:
        if o.designer_id in empleados:
            d = casos_area.setdefault(o.designer_id, {})
            d[area_de_equipo[o.team_id]] = d.get(area_de_equipo[o.team_id], 0) + 1
    for eid in empleados:
        if casos_area.get(eid):
            area_de[eid] = max(casos_area[eid].items(), key=lambda x: x[1])[0]
        else:   # sin casos: su área es la de su equipo
            tid = next((t for t, s in miembros.items() if eid in s), None)
            area_de[eid] = area_de_equipo.get(tid, "")
    datos: dict[int, dict] = {eid: {"aprobadas": 0, "hallazgos": 0, "esperado": 0.0, "real": 0.0} for eid in empleados}
    for o in ordenes:
        x = datos.get(o.designer_id)
        if x is None:
            continue
        # hallazgos de QC en cualquiera de sus casos del mes (no solo los Approved): descartan
        x["hallazgos"] += int(bool(o.qc and (o.qc_reporte or "").strip())) + int(bool(o.z_qc and (o.z_qc_reporte or "").strip()))
        if not sd._es_aprobada(o.estado):
            continue
        x["aprobadas"] += 1
        k = (area_de_equipo[o.team_id], sd._normalizar_texto(o.producto))
        if o.id in dur and k in mediana:
            x["esperado"] += mediana[k]
            x["real"] += dur[o.id]
    ev_dis = _evaluaciones(db, list(empleados.values()), anio, mes, hoja_general=False)
    destacados = _destacados(db, list(empleados.values()), anio, mes)
    filas, no_compiten = [], []
    for eid, e in empleados.items():
        x = datos[eid]
        dias = max(0, dias_hab - len(ausencias.get(eid, {})))
        fila = {"id": eid, "nombre": e.nombre_completo, "area": area_de[eid], "aprobadas": x["aprobadas"], "hallazgos": x["hallazgos"],
                "dias": dias, "habiles": dias_hab, "ausencias": sd._resumen_ausencias(ausencias.get(eid, {})),
                "evaluacion": (ev_dis.get(eid) or {}).get("pct"), "evaluacionRel": (ev_dis.get(eid) or {}).get("rel"),
                "destacado": None if destacados is None else (eid in destacados),
                "eficiencia": round(x["esperado"] / x["real"], 2) if x["real"] else None}
        motivo = None
        if not area_de[eid]:
            motivo = "sin área"
        elif dias < MIN_FRACCION_DIAS * dias_hab:
            motivo = f"solo {dias} de {dias_hab} días disponibles"
        elif x["hallazgos"]:
            motivo = f"tiene {x['hallazgos']} hallazgo{'s' if x['hallazgos'] != 1 else ''} de QC en el mes"
        elif x["aprobadas"] < MIN_APROBADAS:
            motivo = f"{x['aprobadas']} casos aprobados (mínimo {MIN_APROBADAS})"
        (no_compiten if motivo else filas).append({**fila, "motivo": motivo} if motivo else fila)

    for area in AREAS:
        grupo = [f for f in filas if f["area"] == area]
        if not grupo:
            continue
        val = {
            "productividad": {f["id"]: f["aprobadas"] / f["dias"] for f in grupo},
            "eficiencia": {f["id"]: f["eficiencia"] for f in grupo},
        }
        pct = {k: _percentiles(v, mayor_es_mejor=True) for k, v in val.items()}
        # la evaluación ya viene relativa a su líder; el destacado vale 100 (sí) o 0 (no)
        pct["evaluacion"] = {f["id"]: f["evaluacionRel"] for f in grupo}
        pct["destacado"] = {f["id"]: (None if f["destacado"] is None else (100.0 if f["destacado"] else 0.0)) for f in grupo}
        for f in grupo:
            p = {k: pct[k].get(f["id"]) for k in PESOS_DISENADOR}
            met = {
                "productividad": {"texto": f"{f['aprobadas']} aprobadas en {f['dias']} días ({f['aprobadas'] / f['dias']:.1f}/día)"},
                "evaluacion": {"texto": f"{f['evaluacion']:.0f} % en la hoja de su líder" if f["evaluacion"] is not None else "sin calificar"},
                "destacado": {"texto": "su manager lo destacó este mes" if f["destacado"] else "no fue el destacado de su manager"},
                "eficiencia": {"texto": (f"{f['eficiencia']:.2f}× la mediana del producto" if f["eficiencia"] else "sin tiempos válidos")},
            }
            f["percentiles"] = p
            f["puntaje"], f["faltan"] = _puntaje(p, PESOS_DISENADOR)
            f["faltan"] = [NOMBRES[k] for k in f["faltan"]]
            f["porQue"] = _por_que(p, met, PESOS_DISENADOR)
    filas.sort(key=lambda f: (-f["puntaje"], -f["aprobadas"], f["nombre"].lower()))

    def top(areas, n):
        return [f for f in filas if f["area"] in areas][:n]

    # ---------------- Managers ----------------
    ev_man = _evaluaciones(db, list(db.query(Empleado).filter(Empleado.id.in_(list(managers) or [-1]))), anio, mes, hoja_general=True)
    admin = db.query(Empleado).filter(Empleado.rol.in_(["admin", "superadmin"])).first()
    mans: dict[int, dict] = {}
    for t in equipos:
        if not t.manager_id or t.manager_id in inhabilitados:
            continue
        m = mans.setdefault(t.manager_id, {"id": t.manager_id, "nombre": t.manager.nombre_completo if t.manager else "", "areas": set(),
                                           "equipos": [], "aprobadas": 0, "diasDis": 0, "conQc": 0, "minQc": [], "cv": []})
        m["areas"].add(t.area.nombre)
        m["equipos"].append(t.nombre)
        miembros_t = (miembros.get(t.id, set()) - {t.manager_id})
        m["diasDis"] += sum(max(0, dias_hab - len(ausencias.get(e, {}))) for e in miembros_t)
        for o in ordenes:
            if o.team_id != t.id or not sd._es_aprobada(o.estado) or o.designer_id == t.manager_id:
                continue
            m["aprobadas"] += 1
            if o.z_qc if o.tabla == sd.TABLA_MATERIAL else o.qc:   # en N6 el QC final es el de Zirconia
                m["conQc"] += 1
            if o.aprobada_en and o.qc_en and o.qc_en >= o.aprobada_en:
                m["minQc"].append((o.qc_en - o.aprobada_en).total_seconds() / 60)
        if admin:
            r = sd.dashboard_reparto(db, admin, ini, fin, t.id)
            if r.get("teamId") == t.id and r["equidad"] and r["equidad"][-1]:
                m["cv"].append(r["equidad"][-1]["cv"])
    lista_m = []
    for m in mans.values():
        if not m["aprobadas"]:
            continue
        m["area"] = sorted(m["areas"])[0] if len(m["areas"]) == 1 else " / ".join(sorted(m["areas"]))
        m["areas"] = sorted(m["areas"])
        m["porDia"] = round(m["aprobadas"] / m["diasDis"], 2) if m["diasDis"] else None
        m["qcMediana"] = round(median(m["minQc"])) if m["minQc"] else None
        m["qcPct"] = round(m["conQc"] * 100 / m["aprobadas"], 1)
        m["equidadCv"] = round(sum(m["cv"]) / len(m["cv"])) if m["cv"] else None
        m["evaluacion"] = (ev_man.get(m["id"]) or {}).get("pct")
        del m["minQc"], m["cv"]
        lista_m.append(m)
    # productividad se compara dentro del área (los productos cambian); lo demás entre todos los managers
    pct_m: dict[str, dict] = {k: {} for k in PESOS_MANAGER}
    for area in {m["areas"][0] for m in lista_m}:
        pct_m["productividad"].update(_percentiles({m["id"]: m["porDia"] for m in lista_m if m["areas"][0] == area}, True))
    pct_m["qcOportuno"] = _percentiles({m["id"]: m["qcMediana"] for m in lista_m}, False)
    pct_m["qcCobertura"] = _percentiles({m["id"]: m["qcPct"] for m in lista_m}, True)
    pct_m["equidad"] = _percentiles({m["id"]: m["equidadCv"] for m in lista_m}, False)
    pct_m["evaluacion"] = _percentiles({m["id"]: m["evaluacion"] for m in lista_m}, True)
    for m in lista_m:
        p = {k: pct_m[k].get(m["id"]) for k in PESOS_MANAGER}
        met = {
            "productividad": {"texto": f"{m['aprobadas']} aprobadas del equipo ({m['porDia']}/día por diseñador)" if m["porDia"] else f"{m['aprobadas']} aprobadas"},
            "qcOportuno": {"texto": f"QC en {m['qcMediana']} min (mediana)" if m["qcMediana"] is not None else "sin datos"},
            "qcCobertura": {"texto": f"{m['qcPct']} % de aprobadas con QC"},
            "equidad": {"texto": f"reparto con {m['equidadCv']} % de variación" if m["equidadCv"] is not None else "sin datos"},
            "evaluacion": {"texto": f"{m['evaluacion']:.0f} %" if m["evaluacion"] is not None else "sin calificar"},
        }
        m["percentiles"] = p
        m["puntaje"], faltan = _puntaje(p, PESOS_MANAGER)
        m["faltan"] = [NOMBRES[k] for k in faltan]
        m["porQue"] = _por_que(p, met, PESOS_MANAGER)
    lista_m.sort(key=lambda m: (-m["puntaje"], -m["aprobadas"], m["nombre"].lower()))

    # Nadie se repite (Rosember, 22-oct-2026): se eligen en orden N2/Face, N3/N6, otro de N3/N6 y MVP, cada uno entre
    # quienes no ganaron antes; y en «Siguientes» de cada categoría tampoco sale quien ganó otra.
    ganadores: list[dict] = []

    def elegir(candidatos):
        libres = [f for f in candidatos if f["id"] not in {g["id"] for g in ganadores}]
        if libres:
            ganadores.append(libres[0])
        return libres
    c_n2face = elegir(top(GRUPO_N2_FACE, 99))
    c_n3n6 = elegir(top(GRUPO_N3_N6, 99))
    c_n3n6b = elegir(top(GRUPO_N3_N6, 99))
    c_mvp = elegir(filas)
    ids_g = {g["id"] for g in ganadores}

    def lista(cands):   # el ganador de la categoría y los siguientes que no ganaron nada
        return ([cands[0]] if cands else []) + [f for f in cands[1:] if f["id"] not in ids_g][:4]

    return {
        "anio": anio, "mes": mes, "desde": ini.isoformat(), "hasta": fin.isoformat(), "habiles": dias_hab,
        "enCurso": fin.month == mes and (fin + timedelta(days=1)).month == mes,   # el mes aún no termina
        "categorias": [
            {"clave": "manager", "titulo": "Manager del mes", "candidatos": lista_m[:5], "tipo": "manager"},
            {"clave": "n2face", "titulo": "Empleado del mes · N2 / Face", "candidatos": lista(c_n2face), "tipo": "disenador"},
            {"clave": "n3n6", "titulo": "Empleado del mes · N3 / N6", "candidatos": lista(c_n3n6), "tipo": "disenador"},
            {"clave": "n3n6b", "titulo": "Otro de N3 / N6", "candidatos": lista(c_n3n6b), "tipo": "disenador", "posicion": 2},
            {"clave": "mvp", "titulo": "MVP", "candidatos": lista(c_mvp), "tipo": "disenador"},
        ],
        "noCompiten": sorted(no_compiten, key=lambda f: (f["area"], f["nombre"].lower())),
        "pesos": {"disenador": PESOS_DISENADOR, "manager": PESOS_MANAGER}, "nombres": NOMBRES,
        "reglas": {"minAprobadas": MIN_APROBADAS, "minFraccionDias": MIN_FRACCION_DIAS},
    }
