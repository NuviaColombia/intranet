"""Diagnóstico de producción (admins, /design/diagnostico/produccion): compara, persona por persona, lo que cuenta la ventana
«Producción del día» (el número gris del mes) con lo que cuenta Dashboard › Reparto de productos, y dice el motivo de cada
caso que uno cuenta y el otro no. Solo lee. Creado el 27-oct-2026 por el equipo de Dariana (389 en Producción, 310 en Reparto).

Desde el 27-oct-2026 el Reparto cuenta como Producción del día (filas a medio llenar, el manager en su fila y lo prestado en
otros equipos). Diferencias que quedan, a propósito:
  * personas/productos de REPARTO_EXCLUIR (Rosember pidió seguir excluyéndolos);
  * lo que hizo alguien de afuera en el equipo: el Reparto lo pone en «Prestados», no en su nombre;
  * N6 Material Change en Zirconia: el Reparto la cuenta en Bite y en Zirconia (dos columnas), Producción una vez.
La columna Reparto sale de services_design.dashboard_reparto (la misma función del Dashboard).
"""
from collections import Counter, defaultdict
from datetime import date

from sqlalchemy.orm import Session, joinedload

from .models import Empleado
from .models_design import DesignOrden, DesignTeam, DesignTeamDesigner
from . import services_design as sd

TABLAS = sd.TABLAS_HORARIO


def _produccion(db: Session, team: DesignTeam, miembros: set, desde: date, hasta: date) -> list:
    """Órdenes que suma «Producción del día» para el equipo: (orden, empleado_id, de_otro_equipo)."""
    out = []
    for o in (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
              .filter(DesignOrden.team_id == team.id, DesignOrden.designer_id.isnot(None), DesignOrden.fecha >= desde,
                      DesignOrden.fecha <= hasta, DesignOrden.tabla.in_(TABLAS))):
        if not sd._es_cancelada(o.estado) and not sd.es_producto_fantasma(o.producto):
            out.append((o, o.designer_id, False))
    socio = {}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.empleado_id.in_(miembros or [-1])):
        socio.setdefault(eid, set()).add(tid)
    support = {i for (i,) in sd._equipos_support_ids(db).all()}
    for o in (db.query(DesignOrden).options(joinedload(DesignOrden.team))
              .filter(DesignOrden.designer_id.in_(miembros or [-1]), DesignOrden.team_id != team.id,
                      DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta, DesignOrden.tabla.in_(TABLAS))):
        if sd._es_cancelada(o.estado) or sd.es_producto_fantasma(o.producto):
            continue
        if o.team_id in socio.get(o.designer_id, set()) or o.team_id in support:
            continue
        out.append((o, o.designer_id, True))
    return out


def diagnosticar(db: Session, team_id: int, desde: date, hasta: date, user: Empleado) -> dict | None:
    team = db.query(DesignTeam).options(joinedload(DesignTeam.area)).filter(DesignTeam.id == team_id).first()
    if not team:
        return None
    area = team.area.nombre if team.area else ""
    miembros = {i for (i,) in db.query(DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id == team.id)}
    excl = [r for r in sd.REPARTO_EXCLUIR if r["area"] == area]
    excl_personas = [set(p.split()) for r in excl for p in r["personas"]]
    excl_productos = {sd._normalizar_texto(p) for r in excl for p in r["productos"]}
    excluida = lambda nombre: any(p <= set(sd._normalizar_texto(nombre or "").split()) for p in excl_personas)

    prod, motivos, ejemplos = Counter(), defaultdict(Counter), defaultdict(list)

    def anotar(eid, motivo, o, n=1):
        motivos[eid][motivo] += n
        if len(ejemplos[eid]) < 60:
            ejemplos[eid].append({"fecha": o.fecha, "orden": o.orden or "(sin número)", "producto": o.producto or "", "motivo": motivo})

    es_support = team.area and team.area.formato == sd.FORMATO_SUPPORT
    for o, eid, afuera in _produccion(db, team, miembros, desde, hasta):
        prod[eid] += 1
        nombre = o.designer.nombre_completo if o.designer else ""
        if sd._normalizar_texto(o.producto or "") in excl_productos or (excl_personas and excluida(nombre)):
            anotar(eid, "Persona o producto excluido del Reparto (se dejó así a propósito)", o)
        elif not afuera and not es_support and eid not in miembros and eid != team.manager_id:
            anotar(eid, "Es de otro equipo: el Reparto lo cuenta en la fila «Prestados», no en su nombre", o)
        elif sd.es_tabla_etapas(o.tabla) and sd.es_etapa_zirconia(o.etapa):
            anotar(eid, "Material Change en Zirconia: el Reparto la cuenta en Bite y en Zirconia", o, -1)

    # Reparto: lo mismo que muestra el Dashboard (y en N2, también su tabla de Changes)
    rep, prestados = Counter(), 0
    secciones = [""] + (["changes"] if area in sd.REPARTO_CHANGES_APARTE else [])
    for sec in secciones:
        r = sd.dashboard_reparto(db, user, desde, hasta, team.id, seccion=sec)
        if r.get("teamId") != team.id:
            continue
        for f in r["filas"]:
            if f["designerId"]:
                rep[f["designerId"]] += f["total"]
        prestados += r["prestados"]["total"] if r.get("prestados") else 0

    ids = set(prod) | set(rep)
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_(ids or [-1]))}
    filas = []
    for eid in ids:
        if not prod[eid] and not rep[eid]:
            continue
        filas.append({"nombre": nombres.get(eid, f"#{eid}"), "miembro": eid in miembros, "manager": eid == team.manager_id,
                      "prod": prod[eid], "rep": rep[eid], "dif": prod[eid] - rep[eid],
                      "motivos": [(m, n) for m, n in motivos[eid].most_common() if n],
                      "ejemplos": sorted(ejemplos[eid], key=lambda x: (x["fecha"], x["orden"]))})
    filas.sort(key=lambda f: (not f["miembro"], -abs(f["dif"]), f["nombre"]))
    return {"equipo": team.nombre, "area": area, "manager": team.manager.nombre_completo if team.manager else "",
            "desde": desde, "hasta": hasta, "filas": filas, "prestados": prestados,
            "totalProd": sum(prod.values()), "totalRep": sum(rep.values()) + prestados}


def equipos(db: Session) -> list[dict]:
    q = (db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.manager))
         .filter(DesignTeam.activo == 1).all())
    return sorted(({"id": t.id, "nombre": t.nombre, "area": t.area.nombre if t.area else "",
                    "manager": t.manager.nombre_completo if t.manager else ""} for t in q),
                  key=lambda x: (x["area"].lower(), x["nombre"].lower()))
