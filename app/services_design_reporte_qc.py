"""Dashboard › Reportes › Reportes de QC por diseñador (Rosember, 28-oct-2026): documento para enviar a fin de mes al manager
de cada diseñador con muchos reportes de QC, para programar una conversación y, si amerita, levantar un acta de compromiso.
Lleva el texto que dio Rosember, los números del mes y, como anexo, la lista de los hallazgos (la misma del Dashboard ›
Resumen › Reportes de QC por diseñador, services_design.dashboard_qc_disenadores).

Números del documento:
- Reportes registrados en QC: los casos con hallazgo de la lista (uno por cada QC con reporte; en N6 la etapa de Zirconia es otro).
- Total de casos diseñados: los casos del mes del diseñador con las reglas de Producción (sin canceladas ni Training; cuentan los
  que hizo prestado en otros equipos, no en Support; en N6 uno por cada etapa en la que está).
- Principales hallazgos: por categoría (el título antes de «: » en cada línea del reporte), contando cada hallazgo separado por «; »."""
from collections import Counter
from datetime import date

from sqlalchemy.orm import Session

from . import services_design as sd
from . import services_design_reportes as sr
from .models import Empleado
from .models_design import DesignArea, DesignOrden, DesignTeam, DesignTeamDesigner


def _clave(nombre: str) -> str:
    return sd._normalizar_texto(nombre or "")


def disenadores(db: Session, user: Empleado, mes: str) -> list[dict]:
    """Diseñadores con al menos un reporte de QC en el mes, de más a menos: [{clave, nombre, reportes}]."""
    ini, fin = sr.rango_mes(mes)
    filas = sd.dashboard_qc_disenadores(db, user, ini, fin)["disenadores"]
    return [{"clave": _clave(d["nombre"]), "nombre": d["nombre"], "reportes": d["reportes"]} for d in filas]


def categorias(hallazgos: list[str]) -> list[tuple[str, int]]:
    """[('TO PRINT', 4), ('PLATAFORMA', 3)…]: cada línea «TÍTULO: h1; h2» suma un hallazgo por cada parte. Igual que
    ddQcHallazgos en schedule.js. Sin título, cuenta como «Otros»."""
    c: Counter = Counter()
    for texto in hallazgos:
        for linea in (texto or "").split("\n"):
            linea = linea.strip()
            if not linea:
                continue
            k = linea.find(": ")
            tit = linea[:k].strip() if k > 0 else "Otros"
            cuerpo = linea[k + 2:] if k > 0 else linea
            c[tit] += sum(1 for s in cuerpo.split("; ") if s.strip())
    return sorted(c.items(), key=lambda x: (-x[1], x[0].lower()))


def _casos_mes(db: Session, empleado_id: int, ini: date, fin: date) -> int:
    support = {i for (i,) in sd._equipos_support_ids(db).all()}
    n = 0
    for f in (db.query(DesignOrden.designer_id, DesignOrden.z_designer_id, DesignOrden.x_designer_id, DesignOrden.n_designer_id,
                       DesignOrden.team_id, DesignOrden.estado, DesignOrden.tabla)
              .filter(DesignOrden.fecha >= ini, DesignOrden.fecha <= fin, sd.filtro_no_fantasma(), DesignOrden.tabla.in_(sd.TABLAS_HORARIO),
                      sd.filtro_disenador(empleado_id))):
        if f.team_id in support or sd._es_cancelada(f.estado):
            continue
        n += sum(1 for eid in sd.disenadores_de_orden(f) if eid == empleado_id)
    return n


def reporte(db: Session, user: Empleado, mes: str, clave: str) -> dict:
    ini, fin = sr.rango_mes(mes)
    d = next((x for x in sd.dashboard_qc_disenadores(db, user, ini, fin)["disenadores"] if _clave(x["nombre"]) == clave), None)
    if not d:
        raise ValueError("Ese diseñador no tiene reportes de QC en el mes elegido.")
    eid = d["designerId"]
    # Firma: el manager del equipo del diseñador (el del equipo con más hallazgos si está en varios) y el área de ese equipo
    mas = Counter(h["equipo"] for h in d["lista"]).most_common()
    equipos = {t.nombre: t for t in db.query(DesignTeam).filter(DesignTeam.activo == 1)}
    propios = [t.nombre for t in db.query(DesignTeam).join(DesignTeamDesigner, DesignTeamDesigner.team_id == DesignTeam.id)
               .filter(DesignTeam.activo == 1, DesignTeamDesigner.empleado_id == eid)] if eid else []
    nombre_eq = next((n for n, _ in mas if n in propios), None) or (propios[0] if propios else (mas[0][0] if mas else ""))
    t = equipos.get(nombre_eq)
    area = db.get(DesignArea, t.area_id).nombre if t else ""
    casos = _casos_mes(db, eid, ini, fin) if eid else 0
    n = d["reportes"]
    return {"nombre": d["nombre"], "clave": clave, "desde": ini.isoformat(), "hasta": fin.isoformat(), "casos": casos, "reportes": n,
            "porcentaje": round(n * 100 / casos, 1) if casos else None,
            "categorias": categorias([h["hallazgo"] for h in d["lista"]]),
            "lista": sorted(d["lista"], key=lambda h: (h["fecha"], h["orden"])),
            "equipo": nombre_eq, "area": area, "manager": t.manager.nombre_completo if t and t.manager else ""}
