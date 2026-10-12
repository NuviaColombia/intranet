"""
Gestión › Seguimiento › N3/N2 Producción (pedido por Rosember el 12-oct-2026).

El reporte que los managers de N3 y N2 envían cada día, armado con lo que hay en el Schedule:
    Diseñadores: 6            (o "5 (1 Incapacitado)" si hay ausencias registradas o permisos aprobados)
    Alpharetta: 3             (cada centro que Openings le da al manager, también los que van en 0)
    ...
    Total cirugías: 13        (N2: "Total órdenes")
Solo cuentan las órdenes NUEVAS del día en Cirugías / Órdenes: no las que pasaron de otro día (Hold, Ready to design)
ni las canceladas. Una orden es nueva si se creó para ese día (DesignOrden.fecha_creada; las anteriores a esa columna,
por la fecha de creación en hora de Colombia). Solo lee Openings y Equipos (no cambia de dónde salen los datos).
"""
import json
from datetime import date, timedelta

from sqlalchemy.orm import Session, joinedload

from .models_design import DesignArea, DesignTeam, DesignTeamDesigner, DesignOrden, DesignBreak
from . import services_design as sd
from . import services_design_origenes as so

AREAS = {"N3 Prosthetic": ("manager_n3", "cirugías"), "N2 Demodenture": ("manager_n2", "órdenes")}


def es_nueva(o: DesignOrden) -> bool:
    if o.fecha_creada:
        return o.fecha_creada == o.fecha
    return bool(o.creado_en) and (o.creado_en - timedelta(hours=5)).date() == o.fecha  # creado_en está en UTC


def produccion(db: Session, fecha: date) -> list[dict]:
    areas = {a.nombre: a for a in db.query(DesignArea).filter(DesignArea.nombre.in_(list(AREAS)), DesignArea.activo == 1)}
    filas_op = [json.loads(f.datos or "{}") for f in so._filas_openings(db)]
    out = []
    for nombre_area, (col, unidad) in AREAS.items():
        area = areas.get(nombre_area)
        if not area:
            continue
        equipos = (db.query(DesignTeam).filter(DesignTeam.area_id == area.id, DesignTeam.activo == 1)
                   .options(joinedload(DesignTeam.manager), joinedload(DesignTeam.designers).joinedload(DesignTeamDesigner.empleado))
                   .order_by(DesignTeam.orden, DesignTeam.nombre).all())
        con_manager = [t for t in equipos if t.manager_id and t.manager]
        centros_de: dict[int, list[str]] = {t.id: [] for t in equipos}
        for f in filas_op:
            nombre_c = (f.get("centro") or "").strip()
            mtxt = (f.get(col) or "").strip()
            if not nombre_c or so._sin_manager(mtxt):
                continue
            t = so._equipo_de_texto(mtxt, con_manager)[0]
            if t and nombre_c not in centros_de[t.id]:
                centros_de[t.id].append(nombre_c)
        ids = [t.id for t in equipos]
        ordenes = (db.query(DesignOrden).filter(DesignOrden.team_id.in_(ids or [-1]), DesignOrden.fecha == fecha,
                                                DesignOrden.tabla == "principal").all())
        for t in equipos:
            disenadores = [d.empleado for d in t.designers if d.empleado and getattr(d.empleado, "activo", 1)]
            dids = [e.id for e in disenadores]
            ausencias = {b.empleado_id: (b.tipo_ausencia or "").strip() for b in
                         db.query(DesignBreak).filter(DesignBreak.team_id == t.id, DesignBreak.fecha == fecha,
                                                      DesignBreak.empleado_id.in_(dids or [-1])) if (b.tipo_ausencia or "").strip()}
            for eid, tipo in sd._permisos_aprobados_del_dia(db, dids, fecha).items():
                ausencias.setdefault(eid, tipo)
            por_tipo: dict[str, int] = {}
            for tipo in ausencias.values():
                por_tipo[tipo] = por_tipo.get(tipo, 0) + 1
            nuevas = [o for o in ordenes if o.team_id == t.id and (o.centro or "").strip()
                      and not sd._es_cancelada(o.estado) and es_nueva(o)]
            conteo: dict[str, int] = {}
            nombres = sorted(centros_de.get(t.id, []), key=lambda n: sd._normalizar_texto(n))
            clave_a_nombre = {so.centro_clave(n): n for n in nombres}
            for n in nombres:
                conteo[n] = 0
            for o in nuevas:
                n = clave_a_nombre.get(so.centro_clave(o.centro)) or o.centro.strip()
                conteo[n] = conteo.get(n, 0) + 1
            en_turno = len(disenadores) - len(ausencias)
            linea_dis = f"Diseñadores: {en_turno}" + (
                " (" + ", ".join(f"{n} {tipo}" for tipo, n in sorted(por_tipo.items())) + ")" if por_tipo else "")
            centros = [{"centro": n, "casos": c, "fueraDeOpenings": n not in nombres} for n, c in conteo.items()]
            total = sum(conteo.values())
            texto = "\n".join([linea_dis, ""] + [f"{c['centro']}: {c['casos']}" for c in centros] + ["", f"Total {unidad}: {total}"])
            out.append({"teamId": t.id, "equipo": t.nombre, "area": nombre_area, "manager": t.manager.nombre_completo if t.manager else "",
                        "disenadores": len(disenadores), "enTurno": en_turno, "ausencias": por_tipo, "centros": centros,
                        "total": total, "unidad": unidad, "texto": texto})
    return out
