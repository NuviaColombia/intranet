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

Sin desventaja por tamaño de área ni de equipo (auditoría de Rosember, 22-oct-2026). Antes, con todos igual de buenos,
el área más pequeña ganaba mucho más de lo que le tocaba (Face ≈ 60 % de «N2 / Face» siendo un tercio de la gente):
  - El percentil es la posición real dentro del grupo ((puesto − ½) / n): el mejor de 25 queda más arriba que el mejor
    de 5 (antes los dos valían 100). Un grupo de 1 queda en 50.
  - Destacado: vale la posición «mejor de su equipo» ((n − ½) / n) y los demás del equipo, el promedio del resto; así ser
    el destacado de 3 no pesa igual que serlo de 12. Si su manager no llenó ese mes, el criterio no cuenta para su gente
    (antes quedaban en 0 frente a los de los managers que sí llenaron).
  - Evaluación: cuánto está sobre o bajo el promedio de su líder (quita al líder generoso o estricto) y se compara en el
    área; antes, el percentil dentro de la hoja del líder (con 2 calificados: 0 o 100).
  - Puntualidad no depende del área: se compara entre todos los diseñadores.
  - Un área con menos de MIN_GRUPO_AREA competidores compara carga y eficiencia con su categoría (N2 + Face o N3 + N6).
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

# Carga de trabajo (Rosember, 22-oct-2026): Face hace más casos pero más fáciles (asistidos con IA), N2 está en un nivel
# medio y N3 / N6 son más complejos (más pasos, más oportunidades de fallar), así que su volumen siempre es menor.
# Para compararlos, cada caso aprobado vale los «minutos estándar» de su producto: la mediana real del tiempo de diseño de
# ese producto en los últimos DIAS_COMPLEJIDAD días (mínimo MIN_MUESTRAS casos). Si un producto tiene pocos datos, se usa
# la mediana de su área; si el área tampoco tiene, la mediana general por el factor del área (respaldo).
DIAS_COMPLEJIDAD = 90
MIN_MUESTRAS = 5
FACTOR_AREA = {"Face Design": 1.0, "N2 Demodenture": 1.5, "N3 Prosthetic": 2.5, "N6 Material Changes": 2.5}
MIN_FRACCION_DIAS = 0.5     # al menos la mitad de los días hábiles disponibles
SUAVIZADO = 10              # «casos virtuales» con la tasa del área (bayes empírico)
MIN_GRUPO_AREA = 4          # menos competidores en un área: carga y eficiencia se comparan con toda su categoría

# Pesos (suman 100). Se pueden ajustar con Rosember.
# Pesos (22-oct-2026, Rosember: «lo más imparcial posible»).
# - Quien tiene un hallazgo de QC en el mes queda descartado de una vez (la calidad no pondera: es requisito).
# - Cambios digitales no cuentan: no son culpa del diseñador ni del equipo.
# - 60 % datos objetivos y 40 % opinión de los líderes. La calificación de la hoja de cada equipo se compara SOLO contra los
#   compañeros calificados por el mismo líder (un líder «generoso» no favorece a su gente), y ser el destacado del mes de
#   su manager en la hoja de Selección suma aparte.
PESOS_DISENADOR = {
    "productividad": 40,   # carga de trabajo aprobada por día disponible (descuenta vacaciones, incapacidad, luto, etc.)
    "evaluacion": 25,      # calificación de su líder en Desempeño ese mes, relativa a los demás del mismo líder
    "destacado": 15,       # su manager lo destacó ese mes en la hoja de Selección
    "eficiencia": 10,      # tiempo de diseño contra la mediana del mismo producto en su área (menos tiempo es mejor)
    "puntualidad": 10,     # GeoVictoria (22-oct-2026): % de días trabajados en que llegó a tiempo (y minutos de atraso)
}
# Managers: más peso a la hoja DESIGN MANAGERS (Rosember, 22-oct-2026), donde se califica a los managers.
PESOS_MANAGER = {
    "evaluacion": 35,      # hoja DESIGN MANAGERS de Desempeño para ese mes
    "productividad": 25,   # carga de trabajo aprobada del equipo por día disponible de sus diseñadores (comparable entre áreas)
    "qcOportuno": 15,      # minutos (mediana) entre Approved y el QC marcado (menos es mejor)
    "qcCobertura": 10,     # % de aprobadas con QC marcado
    "equidad": 5,          # qué tan parejo reparte los productos (equidad del Reparto; menos es mejor)
    "puntualidad": 10,     # GeoVictoria (22-oct-2026): % de días trabajados en que el manager llegó a tiempo
}
# Configuración (Rosember, 22-oct-2026): el admin ajusta los porcentajes en Desempeño › Selección asistida › ⚙️.
# Se guarda en design_conexion_reglas (tipo «sistema», clave CONFIG_CLAVE) como JSON {"disenador": {...}, "manager": {...}}.
# Lo que no esté guardado usa los pesos de fábrica de arriba. Cada grupo debe sumar 100.
CONFIG_CLAVE = "seleccion_asistida_pesos"


def pesos(db: Session) -> tuple[dict, dict]:
    from .models_design import DesignConexionRegla
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == CONFIG_CLAVE).first()
    guardado = {}
    if r:
        try:
            guardado = json.loads(r.valor or "{}")
        except ValueError:
            guardado = {}
    def mezclar(base, g):
        if not g:
            return dict(base)
        out = {k: int(g.get(k, v)) for k, v in base.items()}
        nuevos = [k for k in base if k not in g]
        if nuevos and sum(out.values()) != 100:   # un criterio nuevo (p. ej. puntualidad): se le descuenta al de más peso
            mayor = max((k for k in base if k in g), key=lambda k: out[k], default=None)
            if mayor:
                out[mayor] = max(0, out[mayor] - (sum(out.values()) - 100))
        return out
    return mezclar(PESOS_DISENADOR, guardado.get("disenador")), mezclar(PESOS_MANAGER, guardado.get("manager"))


# Qué representa cada criterio (tooltip en la configuración; Rosember, 22-oct-2026)
AYUDA = {
    "disenador": {
        "productividad": "Cuánto trabajo aprobó por cada día que estuvo disponible (sin vacaciones, incapacidad, luto, etc.). "
                         "Cada caso vale los minutos estándar de su producto, así un caso complejo pesa más que uno fácil. "
                         "Se compara con los demás de su área.",
        "evaluacion": "La calificación de su líder en la hoja de Desempeño de su equipo ese mes, comparada solo con sus "
                      "compañeros del mismo líder (un líder que califica alto a todos no favorece a su gente).",
        "destacado": "Si su manager lo eligió como la persona destacada del mes en la hoja de Selección (sí = 100, no = 0). "
                     "Si ese mes nadie ha llenado la hoja, no cuenta.",
        "eficiencia": "Qué tan rápido diseña: su tiempo de diseño frente a la mediana del mismo producto en su área. "
                      "Pesa poco porque los tiempos se escriben a mano.",
        "puntualidad": "De GeoVictoria: en cuántos de los días que trabajó llegó a tiempo (llegadas perfectas) y cuántos "
                       "minutos sumó de atraso. Se compara con los demás de su área.",
    },
    "manager": {
        "evaluacion": "La calificación del manager en la hoja DESIGN MANAGERS de Desempeño ese mes.",
        "productividad": "Cuánto trabajo aprobó su equipo por cada día disponible de sus diseñadores, con los minutos "
                         "estándar de cada producto (compensa áreas con casos más complejos). No cuentan los casos del manager.",
        "qcOportuno": "Qué tan rápido marca el QC: mediana de minutos entre que la orden pasa a Approved y se marca el QC.",
        "qcCobertura": "Qué porcentaje de las órdenes aprobadas de su equipo tiene el QC marcado.",
        "equidad": "Qué tan parejo reparte los productos entre sus diseñadores, según la tabla Reparto de productos "
                   "(descuenta las ausencias de cada uno).",
        "puntualidad": "De GeoVictoria: en cuántos de los días que trabajó el manager llegó a tiempo y cuántos minutos sumó de atraso.",
    },
}


def destinos(db: Session, anio: int, mes: int) -> dict:
    """Dónde se registra lo que se elige en la Selección asistida (Rosember, 22-oct-2026): las categorías de «Empleado del
    mes» de la hoja de Selección que tiene la columna de ese mes, con lo que ya tienen anotado."""
    from .models_design import DesignPerfGanador
    hojas = db.query(DesignPerfSheet).filter(DesignPerfSheet.tipo == "seleccion").order_by(DesignPerfSheet.orden, DesignPerfSheet.id).all()
    for h in sorted(hojas, key=lambda h: str(anio) not in (h.nombre or "")):   # primero la hoja con el año en el nombre
        etiquetas = json.loads(h.meses or "[]")
        i = _indice_mes(etiquetas, anio, mes)
        if i is None:
            continue
        cats = []
        for g in db.query(DesignPerfGanador).filter(DesignPerfGanador.sheet_id == h.id).order_by(DesignPerfGanador.orden, DesignPerfGanador.id):
            v = json.loads(g.ganadores_mes or "[]")
            cats.append({"id": g.id, "categoria": g.categoria, "actual": v[i] if i < len(v) else ""})
        return {"sheetId": h.id, "hoja": h.nombre, "mesIndice": i, "etiqueta": etiquetas[i], "categorias": cats}
    return {"sheetId": None, "hoja": "", "mesIndice": None, "etiqueta": "", "categorias": []}


def configuracion(db: Session) -> dict:
    pd, pm = pesos(db)
    return {"disenador": pd, "manager": pm, "fabrica": {"disenador": PESOS_DISENADOR, "manager": PESOS_MANAGER}, "nombres": NOMBRES,
            "ayuda": AYUDA}


def guardar_pesos(db: Session, datos: dict, quien: Empleado) -> dict:
    """Valida (enteros de 0 a 100, cada grupo suma 100) y guarda. datos = {"disenador": {...}, "manager": {...}}."""
    from .models_design import DesignConexionRegla
    limpio = {}
    for grupo, base in (("disenador", PESOS_DISENADOR), ("manager", PESOS_MANAGER)):
        g = datos.get(grupo) or {}
        vals = {}
        for k in base:
            try:
                v = int(round(float(g.get(k, base[k]))))
            except (TypeError, ValueError):
                raise ValueError(f"{NOMBRES[k]}: escribe un número de 0 a 100.")
            if not 0 <= v <= 100:
                raise ValueError(f"{NOMBRES[k]}: debe estar entre 0 y 100.")
            vals[k] = v
        if sum(vals.values()) != 100:
            nombre = "diseñadores" if grupo == "disenador" else "managers"
            raise ValueError(f"Los porcentajes de {nombre} suman {sum(vals.values())} %: deben sumar 100 %.")
        limpio[grupo] = vals
    r = db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == CONFIG_CLAVE).first()
    if not r:
        r = DesignConexionRegla(tipo="sistema", clave=CONFIG_CLAVE)
        db.add(r)
    r.valor = json.dumps(limpio)
    r.creado_por = (quien.nombre_completo or "")[:150]
    db.commit()
    return configuracion(db)


NOMBRES = {"puntualidad": "Puntualidad (GeoVictoria)", "productividad": "Carga de trabajo", "calidad": "Calidad (QC)", "destacado": "Destacado por su manager", "evaluacion": "Evaluación del líder",
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
    """{clave: percentil 0-100} dentro del grupo: (puesto − ½) / n, así el mejor de un grupo grande queda más arriba que el
    mejor de uno pequeño (no hay ventaja por ser pocos). Empates comparten percentil. Un grupo de 1 queda en 50."""
    claves = [k for k, v in valores.items() if v is not None]
    n = len(claves)
    if not n:
        return {}
    out = {}
    for k in claves:
        v = valores[k]
        peores = sum(1 for j in claves if (valores[j] < v if mayor_es_mejor else valores[j] > v))
        iguales = sum(1 for j in claves if valores[j] == v) - 1
        out[k] = round((peores + iguales / 2 + 0.5) * 100 / n, 1)
    return out


def _suavizada(eventos: float, base: float, tasa_grupo: float) -> float:
    return (eventos + SUAVIZADO * tasa_grupo) / (base + SUAVIZADO) if base + SUAVIZADO else 0.0


def _puntaje(percentiles: dict, pesos: dict) -> tuple[float, list[str]]:
    disponibles = {k: p for k, p in pesos.items() if p and percentiles.get(k) is not None}
    faltan = [k for k, p in pesos.items() if p and k not in disponibles]
    total = sum(disponibles.values())
    if not total:
        return 0.0, faltan
    return round(sum(percentiles[k] * w for k, w in disponibles.items()) / total, 1), faltan


def _por_que(percentiles: dict, metricas: dict, pesos: dict) -> dict:
    """Fortalezas (percentil ≥ 70, de más peso a menos) y puntos a mejorar (percentil ≤ 30)."""
    orden = sorted((k for k in pesos if pesos[k] and percentiles.get(k) is not None), key=lambda k: (-percentiles[k], -pesos[k]))
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
    """{empleado_id: {"pct": % de la calificación del mes (0-100), "dev": puntos sobre o bajo el promedio de la misma hoja}} desde las
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
        media = sum(hoja.values()) / len(hoja) if hoja else 0
        for eid, v in hoja.items():
            out[eid] = {"pct": v, "dev": round(v - media, 2)}
    return out


def _destacados(db: Session, empleados: list[Empleado], anio: int, mes: int, evaluadores: list[Empleado] | None = None,
                llenaron: set[int] | None = None) -> set[int] | None:
    """Personas que su manager destacó ese mes en la hoja de Selección (cada evaluador escribe 1 nombre por mes).
    None si ese mes nadie ha destacado a nadie todavía (el criterio no cuenta y su peso se reparte). En `llenaron` (si se
    pasa) quedan los evaluadores (de `evaluadores`) que ya escribieron a alguien ese mes."""
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
            if llenaron is not None and evaluadores:
                ev = sd._buscar_empleado_por_nombre(c.fila.evaluador or "", evaluadores)
                if ev:
                    llenaron.add(ev.id)
    return out if hay else None


# ---------- complejidad de los productos ----------

def _minutos_estandar(db: Session, fin: date, equipos: list[DesignTeam]):
    """Función (área, producto) → minutos estándar de un caso, y el promedio por área. Ver FACTOR_AREA."""
    area_de = {t.id: t.area.nombre for t in equipos}
    formato = {t.id: t.area.formato for t in equipos}
    por_prod: dict[tuple, list[float]] = {}
    por_area: dict[str, list[float]] = {}
    for o in db.query(DesignOrden).filter(sd.filtro_orden_completa(), DesignOrden.team_id.in_(list(area_de) or [-1]),
                                          DesignOrden.fecha > fin - timedelta(days=DIAS_COMPLEJIDAD), DesignOrden.fecha <= fin):
        if not sd._es_aprobada(o.estado):
            continue
        m = sd.duracion_orden_min(o, formato[o.team_id])
        if 5 <= m <= 600:
            a = area_de[o.team_id]
            por_prod.setdefault((a, sd._normalizar_texto(o.producto)), []).append(m)
            por_area.setdefault(a, []).append(m)
    med_prod = {k: median(v) for k, v in por_prod.items() if len(v) >= MIN_MUESTRAS}
    med_area = {k: median(v) for k, v in por_area.items() if len(v) >= MIN_MUESTRAS}
    todos = [m for v in por_area.values() for m in v]
    general = median(todos) if todos else 30.0
    base = general / (sum(FACTOR_AREA.values()) / len(FACTOR_AREA))

    def minutos(area: str, producto: str) -> float:
        return med_prod.get((area, sd._normalizar_texto(producto))) or med_area.get(area) or base * FACTOR_AREA.get(area, 1.0)
    return minutos


# ---------- datos del mes ----------

def _equipos(db: Session) -> list[DesignTeam]:
    return (db.query(DesignTeam).join(DesignArea, DesignArea.id == DesignTeam.area_id)
            .filter(DesignArea.nombre.in_(AREAS), DesignTeam.activo == 1).all())


def _ordenes(db: Session, ini: date, fin: date, team_ids: list[int]) -> list[DesignOrden]:
    return [o for o in db.query(DesignOrden).filter(sd.filtro_orden_completa(), DesignOrden.fecha >= ini, DesignOrden.fecha <= fin,
                                                    DesignOrden.team_id.in_(team_ids or [-1]))
            if not sd._es_cancelada(o.estado)]


# ---------- puntualidad desde GeoVictoria (Rosember, 22-oct-2026) ----------

def _puntualidad(db: Session, ini: date, fin: date, ids: list[int] | None = None) -> dict[int, dict]:
    """{empleado_id: {"dias": días trabajados, "tarde": días con atraso, "minutos": minutos de atraso}} del periodo.
    Vacío si GeoVictoria no está configurado o no responde (el criterio no cuenta y su peso se reparte)."""
    from . import services_design_geovictoria as gv
    try:
        c = gv.config(db)
        if not c["key"] or not c["secret"]:
            return {}
        pares = gv.cruce(db)["pares"]
        if ids is not None:
            pares = {k: v for k, v in pares.items() if k in ids}
        por_id = {gv._norm_id(v): k for k, v in pares.items()}
        out: dict[int, dict] = {}
        lista = list(pares.values())
        cuerpo = lambda lote: {"StartDate": ini.strftime("%Y%m%d000000"), "EndDate": fin.strftime("%Y%m%d235959"), "UserIds": ",".join(lote)}
        for k in range(0, len(lista), gv.LOTE):
            lote = lista[k:k + gv.LOTE]
            ext = gv._post(c, "/Consolidated/Extended", {**cuerpo(lote), "IncludeAll": 0})
            for u in ext if isinstance(ext, list) else (ext or {}).get("Response") or []:
                eid = por_id.get(gv._norm_id(u.get("Identifier")))
                if eid:
                    out.setdefault(eid, {"dias": 0, "tarde": 0, "minutos": 0})["dias"] = int(((u.get("PaidDays") or {}).get("WorkedDays")) or 0)
            col = gv._post(c, "/AttendanceBook/GetConsolidatedColombia", cuerpo(lote))
            for u in col if isinstance(col, list) else (col or {}).get("Response") or []:
                eid = por_id.get(gv._norm_id(u.get("Identifier")))
                if not eid:
                    continue
                x = out.setdefault(eid, {"dias": 0, "tarde": 0, "minutos": 0})
                for d in u.get("SpecialDays") or []:
                    m = gv._min(d.get("Delay")) if str(d.get("HasDelay")) == "True" else 0
                    if m > 0:
                        x["tarde"] += 1
                        x["minutos"] += m
        return {k: v for k, v in out.items() if v["dias"]}
    except Exception:  # noqa: BLE001
        return {}


def _valor_punt(p: dict | None) -> float | None:
    """% de días a tiempo; a igual %, gana quien sumó menos minutos de atraso."""
    if not p or not p["dias"]:
        return None
    return round((p["dias"] - min(p["tarde"], p["dias"])) * 100 / p["dias"], 2) - p["minutos"] / 100000


def _texto_punt(p: dict | None) -> str:
    if not p or not p["dias"]:
        return "sin datos de GeoVictoria"
    if not p["tarde"]:
        return f"llegó a tiempo los {p['dias']} días que trabajó"
    return f"{p['dias'] - p['tarde']} de {p['dias']} días a tiempo ({p['tarde']} tarde, {p['minutos']} min)"


def analizar(db: Session, anio: int, mes: int) -> dict:
    PD, PM = pesos(db)   # porcentajes configurados en «⚙️ Configuración» (si no, los de fábrica)
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
    minutos = _minutos_estandar(db, fin, equipos)
    carga_area: dict[str, list[float]] = {}   # minutos estándar de los casos del mes, por área (para mostrar la diferencia)
    for o in ordenes:
        if sd._es_aprobada(o.estado):
            carga_area.setdefault(area_de_equipo[o.team_id], []).append(minutos(area_de_equipo[o.team_id], o.producto))

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
    datos: dict[int, dict] = {eid: {"aprobadas": 0, "hallazgos": 0, "esperado": 0.0, "real": 0.0, "carga": 0.0} for eid in empleados}
    for o in ordenes:
        x = datos.get(o.designer_id)
        if x is None:
            continue
        # hallazgos de QC en cualquiera de sus casos del mes (no solo los Approved): descartan
        x["hallazgos"] += int(bool(o.qc and (o.qc_reporte or "").strip())) + int(bool(o.z_qc and (o.z_qc_reporte or "").strip()))
        if not sd._es_aprobada(o.estado):
            continue
        x["aprobadas"] += 1
        x["carga"] += minutos(area_de_equipo[o.team_id], o.producto)
        k = (area_de_equipo[o.team_id], sd._normalizar_texto(o.producto))
        if o.id in dur and k in mediana:
            x["esperado"] += mediana[k]
            x["real"] += dur[o.id]
    ev_dis = _evaluaciones(db, list(empleados.values()), anio, mes, hoja_general=False)
    punt = _puntualidad(db, ini, fin)   # GeoVictoria; vacío si no está configurado (el criterio no cuenta)
    llenaron: set[int] = set()
    destacados = _destacados(db, list(empleados.values()), anio, mes,
                             list(db.query(Empleado).filter(Empleado.id.in_(list(managers) or [-1]))), llenaron)
    # equipos (con su manager) de cada diseñador, para saber si su manager llenó y de cuántos fue el destacado
    equipos_de: dict[int, list[DesignTeam]] = {}
    for t in equipos:
        for eid in miembros.get(t.id, set()):
            equipos_de.setdefault(eid, []).append(t)
    tam_equipo = {t.id: len((miembros.get(t.id, set()) - {t.manager_id}) & set(empleados)) for t in equipos}

    def valor_destacado(eid: int) -> float | None:
        if destacados is None:
            return None
        suyos = [t for t in equipos_de.get(eid, []) if not llenaron or t.manager_id in llenaron]
        if not suyos:
            return None   # su manager no ha llenado ese mes: no cuenta (no queda en 0)
        n = max(1, max(tam_equipo.get(t.id, 1) for t in suyos))
        return round(((n - 0.5) / n if eid in destacados else (n - 1) / 2 / n) * 100, 1)
    filas, no_compiten = [], []
    for eid, e in empleados.items():
        x = datos[eid]
        dias = max(0, dias_hab - len(ausencias.get(eid, {})))
        fila = {"id": eid, "nombre": e.nombre_completo, "area": area_de[eid], "aprobadas": x["aprobadas"], "hallazgos": x["hallazgos"],
                "dias": dias, "habiles": dias_hab, "cargaDia": round(x["carga"] / dias, 1) if dias else 0, "ausencias": sd._resumen_ausencias(ausencias.get(eid, {})),
                "evaluacion": (ev_dis.get(eid) or {}).get("pct"), "evaluacionDev": (ev_dis.get(eid) or {}).get("dev"),
                "puntualidad": punt.get(eid),
                "destacado": None if destacados is None else (eid in destacados), "destacadoValor": valor_destacado(eid),
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

    pct_punt = _percentiles({f["id"]: _valor_punt(f["puntualidad"]) for f in filas}, True)   # no depende del área: todos
    for area in AREAS:
        grupo = [f for f in filas if f["area"] == area]
        if not grupo:
            continue
        cat = GRUPO_N2_FACE if area in GRUPO_N2_FACE else GRUPO_N3_N6
        base = grupo if len(grupo) >= MIN_GRUPO_AREA else [f for f in filas if f["area"] in cat]   # área muy pequeña
        pct = {
            "productividad": _percentiles({f["id"]: f["cargaDia"] for f in base}, True),
            "eficiencia": _percentiles({f["id"]: f["eficiencia"] for f in base}, True),
            "puntualidad": pct_punt,
            # evaluación: puntos sobre o bajo el promedio de su líder, comparados en el área (quita al líder generoso)
            "evaluacion": _percentiles({f["id"]: f["evaluacionDev"] for f in grupo}, True),
            "destacado": {f["id"]: f["destacadoValor"] for f in grupo},
        }
        for f in grupo:
            p = {k: pct[k].get(f["id"]) for k in PD}
            met = {
                "productividad": {"texto": f"{f['aprobadas']} aprobadas en {f['dias']} días ≈ {f['cargaDia'] / 60:.1f} h de trabajo estándar por día"},
                "evaluacion": {"texto": f"{f['evaluacion']:.0f} % en la hoja de su líder" if f["evaluacion"] is not None else "sin calificar"},
                "destacado": {"texto": "su manager lo destacó este mes" if f["destacado"] else "no fue el destacado de su manager"},
                "eficiencia": {"texto": (f"{f['eficiencia']:.2f}× la mediana del producto" if f["eficiencia"] else "sin tiempos válidos")},
                "puntualidad": {"texto": _texto_punt(f["puntualidad"])},
            }
            f["percentiles"] = p
            f["puntaje"], f["faltan"] = _puntaje(p, PD)
            f["faltan"] = [NOMBRES[k] for k in f["faltan"]]
            f["porQue"] = _por_que(p, met, PD)
            f["metricas"] = met
    filas.sort(key=lambda f: (-f["puntaje"], -f["aprobadas"], f["nombre"].lower()))

    def top(areas, n):
        return [f for f in filas if f["area"] in areas][:n]

    # ---------------- Managers ----------------
    ev_man = _evaluaciones(db, list(db.query(Empleado).filter(Empleado.id.in_(list(managers) or [-1]))), anio, mes, hoja_general=True)
    punt_m = punt if all(m in punt for m in managers) else {**punt, **_puntualidad(db, ini, fin, ids=list(managers))}
    admin = db.query(Empleado).filter(Empleado.rol.in_(["admin", "superadmin"])).first()
    mans: dict[int, dict] = {}
    for t in equipos:
        if not t.manager_id or t.manager_id in inhabilitados:
            continue
        m = mans.setdefault(t.manager_id, {"id": t.manager_id, "nombre": t.manager.nombre_completo if t.manager else "", "areas": set(),
                                           "equipos": [], "aprobadas": 0, "carga": 0.0, "diasDis": 0, "conQc": 0, "minQc": [], "cv": []})
        m["areas"].add(t.area.nombre)
        m["equipos"].append(t.nombre)
        miembros_t = (miembros.get(t.id, set()) - {t.manager_id})
        m["diasDis"] += sum(max(0, dias_hab - len(ausencias.get(e, {}))) for e in miembros_t)
        for o in ordenes:
            if o.team_id != t.id or not sd._es_aprobada(o.estado) or o.designer_id == t.manager_id:
                continue
            m["aprobadas"] += 1
            m["carga"] += minutos(t.area.nombre, o.producto)
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
        m["porDia"] = round(m["carga"] / m["diasDis"], 1) if m["diasDis"] else None   # minutos estándar por diseñador-día
        m["qcMediana"] = round(median(m["minQc"])) if m["minQc"] else None
        m["qcPct"] = round(m["conQc"] * 100 / m["aprobadas"], 1)
        m["equidadCv"] = round(sum(m["cv"]) / len(m["cv"])) if m["cv"] else None
        m["evaluacion"] = (ev_man.get(m["id"]) or {}).get("pct")
        m["puntualidad"] = punt_m.get(m["id"])
        del m["minQc"], m["cv"]
        lista_m.append(m)
    # La carga de trabajo ya pesa la complejidad de cada producto: se compara entre TODOS los managers (antes, por área;
    # así un área con un solo manager, como N6, ya no queda siempre en la mitad).
    pct_m: dict[str, dict] = {k: {} for k in PM}
    pct_m["productividad"] = _percentiles({m["id"]: m["porDia"] for m in lista_m}, True)
    pct_m["qcOportuno"] = _percentiles({m["id"]: m["qcMediana"] for m in lista_m}, False)
    pct_m["qcCobertura"] = _percentiles({m["id"]: m["qcPct"] for m in lista_m}, True)
    pct_m["equidad"] = _percentiles({m["id"]: m["equidadCv"] for m in lista_m}, False)
    pct_m["evaluacion"] = _percentiles({m["id"]: m["evaluacion"] for m in lista_m}, True)
    pct_m["puntualidad"] = _percentiles({m["id"]: _valor_punt(m["puntualidad"]) for m in lista_m}, True)
    for m in lista_m:
        p = {k: pct_m[k].get(m["id"]) for k in PM}
        met = {
            "productividad": {"texto": (f"{m['aprobadas']} aprobadas del equipo ≈ {m['carga'] / 60:.0f} h de trabajo estándar "
                                        f"({m['porDia'] / 60:.1f} h por diseñador-día)") if m["porDia"] else f"{m['aprobadas']} aprobadas"},
            "qcOportuno": {"texto": f"QC en {m['qcMediana']} min (mediana)" if m["qcMediana"] is not None else "sin datos"},
            "qcCobertura": {"texto": f"{m['qcPct']} % de aprobadas con QC"},
            "equidad": {"texto": f"reparto con {m['equidadCv']} % de variación" if m["equidadCv"] is not None else "sin datos"},
            "evaluacion": {"texto": f"{m['evaluacion']:.0f} %" if m["evaluacion"] is not None else "sin calificar"},
            "puntualidad": {"texto": _texto_punt(m["puntualidad"])},
        }
        m["percentiles"] = p
        m["puntaje"], faltan = _puntaje(p, PM)
        m["faltan"] = [NOMBRES[k] for k in faltan]
        m["porQue"] = _por_que(p, met, PM)
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
    # MVP (auditoría 22-oct-2026): compite contra todas las áreas con el mismo puntaje de su categoría, porque cada
    # criterio ya es la posición de la persona dentro de su área (o entre todos, la puntualidad). Antes la carga se
    # comparaba en minutos estándar entre todos: un mes con pocas órdenes en un área bajaba a toda esa área y dependía
    # de los tiempos escritos a mano; en la simulación (todos igual de buenos) Face ganaba el MVP el doble de lo que le tocaba.
    c_mvp = elegir(list(filas))
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
        "pesos": {"disenador": PD, "manager": PM}, "nombres": NOMBRES,
        "reglas": {"minAprobadas": MIN_APROBADAS, "minFraccionDias": MIN_FRACCION_DIAS},
        "complejidad": [{"area": a, "minutos": round(sum(v) / len(v))} for a in AREAS for v in [carga_area.get(a)] if v],
    }
