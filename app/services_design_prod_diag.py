"""Diagnóstico de producción (admins, /design/diagnostico/produccion): compara, persona por persona, lo que cuenta la ventana
«Producción del día» (el número gris del mes) con lo que cuenta Dashboard › Reparto de productos, y dice el motivo de cada
caso que uno cuenta y el otro no. Solo lee. Creado el 27-oct-2026 por el equipo de Dariana (389 en Producción, 310 en Reparto).

Reglas que se comparan (las mismas del código de cada pantalla):
  * Producción: órdenes del equipo con diseñador, sin canceladas/skipped ni «Training», más las que sus diseñadores hicieron
    prestados en otros equipos (no Support). Incluye al manager y las filas a medio llenar.
  * Reparto: órdenes completas (centro, producto y diseñador), sin canceladas/skipped ni «Training», sin el manager, sin
    personas/productos de REPARTO_EXCLUIR; en N2 los Changes van aparte. Lo que hizo alguien de afuera va en «Prestados».
"""
from collections import Counter, defaultdict
from datetime import date

from sqlalchemy.orm import Session, joinedload

from .models import Empleado
from .models_design import DesignOrden, DesignTeam, DesignTeamDesigner
from . import services_design as sd

TABLAS = ["principal", "nightguard", sd.TABLA_MATERIAL]


def diagnosticar(db: Session, team_id: int, desde: date, hasta: date) -> dict | None:
    team = db.query(DesignTeam).options(joinedload(DesignTeam.area)).filter(DesignTeam.id == team_id).first()
    if not team:
        return None
    area = team.area.nombre if team.area else ""
    miembros = {i for (i,) in db.query(DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.team_id == team.id)}
    excl = [r for r in sd.REPARTO_EXCLUIR if r["area"] == area]
    excl_personas = [set(p.split()) for r in excl for p in r["personas"]]
    excl_productos = {sd._normalizar_texto(p) for r in excl for p in r["productos"]}
    excluida = lambda nombre: any(p <= set(sd._normalizar_texto(nombre or "").split()) for p in excl_personas)
    changes_aparte = area in sd.REPARTO_CHANGES_APARTE
    es_support = team.area and team.area.formato == sd.FORMATO_SUPPORT

    prod = Counter()                 # empleado_id -> casos en Producción
    rep = Counter()                  # empleado_id (o "prestados") -> casos en Reparto
    motivos = defaultdict(Counter)   # empleado_id -> motivo -> casos (lo que Producción cuenta y Reparto no, o al revés)
    ejemplos = defaultdict(list)     # empleado_id -> [(fecha, orden, motivo)]

    def anotar(eid, motivo, o):
        motivos[eid][motivo] += 1
        if len(ejemplos[eid]) < 60:
            ejemplos[eid].append({"fecha": o.fecha, "orden": o.orden or "(sin número)", "producto": o.producto or "", "motivo": motivo})

    ordenes = (db.query(DesignOrden).options(joinedload(DesignOrden.designer))
               .filter(DesignOrden.team_id == team.id, DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta,
                       DesignOrden.tabla.in_(TABLAS)).all())
    for o in ordenes:
        if sd._es_cancelada(o.estado) or sd.es_producto_fantasma(o.producto):
            continue
        en_prod = o.designer_id is not None
        if en_prod:
            prod[o.designer_id] += 1
        # ¿Por qué el Reparto no la cuenta (o la cuenta en otra fila)?
        nombre = o.designer.nombre_completo if o.designer else (o.designer_prestado or "")
        motivo = None
        if not (o.centro or "").strip() or not (o.producto or "").strip():
            motivo = "Fila incompleta (sin centro o sin producto): el Reparto no la cuenta"
        elif not o.designer_id and not (o.designer_prestado or "").strip():
            continue
        elif team.manager_id and o.designer_id == team.manager_id:
            motivo = "Caso del manager: el Reparto no lo cuenta"
        elif sd._normalizar_texto(o.producto or "") in excl_productos or (excl_personas and excluida(nombre)):
            motivo = "Persona o producto excluido del Reparto"
        elif changes_aparte and "change" in sd._normalizar_texto(o.producto or ""):
            motivo = "Change de N2: el Reparto lo muestra en su tabla aparte"
        if motivo:
            if en_prod:
                anotar(o.designer_id, motivo, o)
            continue
        prestado = not es_support and (bool((o.designer_prestado or "").strip()) or not o.designer_id or o.designer_id not in miembros)
        if prestado:
            rep["prestados"] += 1
            if en_prod:
                anotar(o.designer_id, "Es de otro equipo: el Reparto lo cuenta en la fila «Prestados», no en su nombre", o)
        else:
            rep[o.designer_id] += 1

    # Lo que los diseñadores del equipo hicieron prestados en otros equipos: Producción lo suma, el Reparto no
    otros = {}
    for tid, eid in db.query(DesignTeamDesigner.team_id, DesignTeamDesigner.empleado_id).filter(DesignTeamDesigner.empleado_id.in_(miembros or [-1])):
        otros.setdefault(eid, set()).add(tid)
    support = {i for (i,) in sd._equipos_support_ids(db).all()}
    fuera = (db.query(DesignOrden).options(joinedload(DesignOrden.team))
             .filter(DesignOrden.designer_id.in_(miembros or [-1]), DesignOrden.team_id != team.id,
                     DesignOrden.fecha >= desde, DesignOrden.fecha <= hasta, DesignOrden.tabla.in_(TABLAS)).all())
    for o in fuera:
        if sd._es_cancelada(o.estado) or sd.es_producto_fantasma(o.producto):
            continue
        if o.team_id in otros.get(o.designer_id, set()) or o.team_id in support:
            continue
        prod[o.designer_id] += 1
        anotar(o.designer_id, f"Lo hizo prestado en el equipo {o.team.nombre if o.team else '?'}: Producción lo suma, el Reparto no", o)

    ids = set(prod) | {k for k in rep if k != "prestados"} | miembros
    nombres = {e.id: e.nombre_completo for e in db.query(Empleado).filter(Empleado.id.in_(ids or [-1]))}
    filas = []
    for eid in ids:
        if not prod[eid] and not rep[eid]:
            continue
        filas.append({"nombre": nombres.get(eid, f"#{eid}"), "miembro": eid in miembros, "manager": eid == team.manager_id,
                      "prod": prod[eid], "rep": rep[eid], "dif": prod[eid] - rep[eid],
                      "motivos": motivos[eid].most_common(), "ejemplos": sorted(ejemplos[eid], key=lambda x: (x["fecha"], x["orden"]))})
    filas.sort(key=lambda f: (not f["miembro"], -f["dif"], f["nombre"]))
    return {"equipo": team.nombre, "area": area, "manager": team.manager.nombre_completo if team.manager else "",
            "desde": desde, "hasta": hasta, "filas": filas, "prestados": rep["prestados"],
            "totalProd": sum(prod.values()), "totalRep": sum(rep.values())}


def equipos(db: Session) -> list[dict]:
    q = (db.query(DesignTeam).options(joinedload(DesignTeam.area), joinedload(DesignTeam.manager))
         .filter(DesignTeam.activo == 1).all())
    return sorted(({"id": t.id, "nombre": t.nombre, "area": t.area.nombre if t.area else "",
                    "manager": t.manager.nombre_completo if t.manager else ""} for t in q),
                  key=lambda x: (x["area"].lower(), x["nombre"].lower()))
