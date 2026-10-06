"""Lógica de Producción › Seguimiento de consumo (ver models_consumo.py)."""
import json
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session, joinedload
from .models import Empleado
from .models_consumo import (ConsumoMateria, ConsumoTipo, ConsumoTecnico, ConsumoManager, ConsumoEntrega,
                             ConsumoFrasco, ConsumoJornada)
from .formato import nombre_propio

TIPOS_INICIALES = ["TIPO 5", "TIPO 4", "TIPO 7"]


def hoy_colombia() -> date:
    return (datetime.utcnow() - timedelta(hours=5)).date()


def es_admin(user: Empleado) -> bool:
    from .acceso_produccion import es_admin_produccion
    return user.rol in ("admin", "superadmin") or es_admin_produccion(user)


def asegurar_tipos(db: Session) -> None:
    if db.query(ConsumoTipo).count() == 0:
        for i, nombre in enumerate(TIPOS_INICIALES, start=1):
            db.add(ConsumoTipo(nombre=nombre, orden=i))
        db.commit()


def tipos_activos(db: Session) -> list[ConsumoTipo]:
    return db.query(ConsumoTipo).filter(ConsumoTipo.activo == 1).order_by(ConsumoTipo.orden, ConsumoTipo.nombre).all()


def area_manager(db: Session, user: Empleado) -> str | None:
    m = db.query(ConsumoManager).filter(ConsumoManager.empleado_id == user.id).first()
    return m.area if m else None


def mi_tecnico(db: Session, user: Empleado) -> ConsumoTecnico | None:
    return db.query(ConsumoTecnico).filter(ConsumoTecnico.empleado_id == user.id, ConsumoTecnico.activo == 1).first()


def tecnicos_visibles(db: Session, user: Empleado) -> list[ConsumoTecnico]:
    """Administrador: todos. Manager: los de su área. Técnico: él mismo."""
    q = db.query(ConsumoTecnico).options(joinedload(ConsumoTecnico.empleado)).filter(ConsumoTecnico.activo == 1)
    if not es_admin(user):
        area = area_manager(db, user)
        if area:
            q = q.filter(ConsumoTecnico.area == area)
        else:
            q = q.filter(ConsumoTecnico.empleado_id == user.id)
    return sorted(q.all(), key=lambda t: t.empleado.nombre_completo if t.empleado else "")


def puede_gestionar_tecnico(db: Session, user: Empleado, tecnico: ConsumoTecnico) -> bool:
    return tecnico.id in {t.id for t in tecnicos_visibles(db, user)}


def puede_entregar(db: Session, user: Empleado) -> bool:
    """Crear entregas y anular: los managers (Parámetros › Managers, con su área) y los administradores.
    Los técnicos registran y guardan su propia jornada."""
    return es_admin(user) or area_manager(db, user) is not None


def puede_editar_tecnico(db: Session, user: Empleado, tecnico: ConsumoTecnico) -> bool:
    """Registrar o corregir la jornada de un técnico: el propio técnico, el manager de su área o un administrador."""
    return es_admin(user) or tecnico.empleado_id == user.id or area_manager(db, user) == tecnico.area


MEDIDAS = {"arcos": "Arcos producidos", "gotas": "Gotas usadas por día", "consumo": "Solo consumido (líquido)"}  # se combinan arcos y gotas


def medidas_de(m: ConsumoMateria) -> list[str]:
    """Cómo se registra la materia en la jornada; puede ser varias a la vez (ej. arcos y gotas).
    Sin arcos ni gotas = solo se marca cuando se consume (líquido)."""
    guardadas = [x for x in (m.medida or "").split(",") if x in MEDIDAS]
    if not guardadas:
        guardadas = ["arcos"] if m.mide_arcos else ["consumo"]
    medidas = [x for x in ("arcos", "gotas") if x in guardadas]
    return medidas or ["consumo"]


def normalizar_medidas(elegidas: list[str]) -> str:
    """Lo que se guarda en la materia: «arcos», «gotas», «arcos,gotas» o «consumo»."""
    medidas = [x for x in ("arcos", "gotas") if x in set(elegidas or [])]
    return ",".join(medidas) or "consumo"


def materias_activas(db: Session, area: str | None = None) -> list[ConsumoMateria]:
    q = db.query(ConsumoMateria).filter(ConsumoMateria.activo == 1)
    if area:
        q = q.filter((ConsumoMateria.area == area) | (ConsumoMateria.area == ""))
    return q.order_by(ConsumoMateria.area, ConsumoMateria.orden, ConsumoMateria.descripcion).all()


def _nombre_tecnico(t: ConsumoTecnico | None) -> str:
    return nombre_propio(t.empleado.nombre_completo) if t and t.empleado else "—"


# ---------------- Entregas ----------------

def serializar_entrega(e: ConsumoEntrega) -> dict:
    return {
        "id": e.id, "fecha": e.fecha.isoformat(), "hora": e.hora, "area": e.area,
        "manager": nombre_propio(e.manager.nombre_completo) if e.manager else "",
        "tecnico": _nombre_tecnico(e.tecnico), "tecnicoId": e.tecnico_id,
        "observaciones": e.observaciones or "", "estado": e.estado,
        "anuladoPor": nombre_propio(e.anulado_por.nombre_completo) if e.anulado_por else "",
        "anuladoEn": (e.anulado_en - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if e.anulado_en else "",
        "motivoAnulacion": e.motivo_anulacion or "",
        "frascos": [{"id": f.id, "materia": f.materia.descripcion if f.materia else "", "presentacion": f.materia.presentacion if f.materia else "",
                     "contenido": f.materia.contenido if f.materia else "", "lote": f.lote, "ref": f.ref, "serie": f.serie,
                     "estado": f.estado, "consumidoEn": f.consumido_en.isoformat() if f.consumido_en else "",
                     "jornadas": len(f.jornadas)} for f in e.frascos],
    }


def crear_entrega(db: Session, user: Empleado, datos: dict) -> ConsumoEntrega | str:
    if not puede_entregar(db, user):
        return "Solo los managers asignados (o un administrador) pueden registrar entregas."
    tecnico = db.get(ConsumoTecnico, int(datos.get("tecnico_id") or 0))
    if not tecnico or not tecnico.activo:
        return "Elige el técnico que recibe."
    if not puede_gestionar_tecnico(db, user, tecnico):
        return "Ese técnico no pertenece a tu área."
    try:
        fecha = date.fromisoformat(str(datos.get("fecha") or ""))
    except ValueError:
        return "Fecha inválida."
    if fecha > hoy_colombia():
        return "La fecha de entrega no puede ser futura."
    frascos = datos.get("frascos") or []
    if not frascos:
        return "Agrega al menos un frasco a la entrega."
    limpios = []
    for i, f in enumerate(frascos, start=1):
        materia = db.get(ConsumoMateria, int(f.get("materia_id") or 0))
        if not materia or not materia.activo:
            return f"Frasco {i}: elige la materia prima."
        lote, ref, serie = (str(f.get(k) or "").strip().upper() for k in ("lote", "ref", "serie"))
        if not (lote and ref and serie):
            return f"Frasco {i} ({materia.descripcion}): lote, ref. y n.º de serie son obligatorios."
        limpios.append((materia, lote, ref, serie))
    series = [s for _, _, _, s in limpios]
    repetidas = {s for s in series if series.count(s) > 1}
    if repetidas:
        return f"El n.º de serie {', '.join(sorted(repetidas))} está repetido en esta entrega."
    en_uso = {s for (s,) in db.query(ConsumoFrasco.serie).join(ConsumoEntrega)
              .filter(ConsumoFrasco.serie.in_(series), ConsumoFrasco.estado == "EN_USO", ConsumoEntrega.estado == "ACTIVO")}
    if en_uso:
        return f"El n.º de serie {', '.join(sorted(en_uso))} ya está entregado y en uso."
    e = ConsumoEntrega(fecha=fecha, hora=str(datos.get("hora") or "")[:5], area=tecnico.area, manager_id=user.id,
                       tecnico_id=tecnico.id, observaciones=str(datos.get("observaciones") or "").strip()[:1000],
                       creado_por_id=user.id)
    db.add(e)
    db.flush()
    for materia, lote, ref, serie in limpios:
        db.add(ConsumoFrasco(entrega_id=e.id, materia_id=materia.id, lote=lote, ref=ref, serie=serie))
    db.commit()
    db.refresh(e)
    return e


def anular_entrega(db: Session, e: ConsumoEntrega, user: Empleado, motivo: str) -> str | None:
    if e.estado == "ANULADO":
        return "Esta entrega ya estaba anulada."
    if not (es_admin(user) or (area_manager(db, user) == e.area)):
        return "Solo el manager del área o un administrador puede anular esta entrega."
    if any(f.jornadas for f in e.frascos):
        return "No se puede anular: algún frasco de esta entrega ya tiene jornadas registradas."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe el motivo de la anulación (mínimo 5 caracteres)."
    e.estado, e.anulado_por_id, e.anulado_en, e.motivo_anulacion = "ANULADO", user.id, datetime.utcnow(), motivo[:500]
    db.commit()
    return None


# ---------------- Jornada diaria ----------------

def frascos_para_jornada(db: Session, tecnico: ConsumoTecnico, fecha: date) -> list[dict]:
    """Frascos en uso del técnico (y los que consumió ese mismo día, para poder corregir) con lo ya registrado."""
    frascos = (db.query(ConsumoFrasco).join(ConsumoEntrega)
               .options(joinedload(ConsumoFrasco.materia), joinedload(ConsumoFrasco.entrega))
               .filter(ConsumoEntrega.tecnico_id == tecnico.id, ConsumoEntrega.estado == "ACTIVO",
                       ConsumoEntrega.fecha <= fecha,
                       (ConsumoFrasco.estado == "EN_USO") | (ConsumoFrasco.consumido_en == fecha))
               .order_by(ConsumoEntrega.fecha, ConsumoFrasco.id).all())
    salida = []
    for f in frascos:
        j = db.query(ConsumoJornada).filter(ConsumoJornada.frasco_id == f.id, ConsumoJornada.fecha == fecha).first()
        medidas = medidas_de(f.materia)
        salida.append({
            "id": f.id, "materia": f.materia.descripcion, "medidas": medidas,
            "midesArcos": "arcos" in medidas, "midesGotas": "gotas" in medidas,
            "gotas": (j.gotas or 0) if j else 0, "gotasAcumuladas": sum(x.gotas or 0 for x in f.jornadas),
            "lote": f.lote, "ref": f.ref, "serie": f.serie, "fechaEntrega": f.entrega.fecha.isoformat(),
            "arcos": json.loads(j.arcos) if j else {}, "consumido": f.estado == "CONSUMIDO",
            "acumulado": sum(x.total for x in f.jornadas), "diasAbierto": (fecha - f.entrega.fecha).days,
        })
    return salida


def guardar_jornada(db: Session, user: Empleado, tecnico: ConsumoTecnico, fecha: date, filas: list[dict]) -> str | None:
    """Guarda (o corrige, si ya existe) la jornada del día: arcos por tipo y si el frasco se consumió."""
    if not puede_editar_tecnico(db, user, tecnico):
        return "No puedes registrar la jornada de ese técnico."
    if fecha > hoy_colombia():
        return "La fecha de la jornada no puede ser futura."
    tipos_validos = {str(t.id) for t in tipos_activos(db)}
    permitidos = {f["id"] for f in frascos_para_jornada(db, tecnico, fecha)}
    cambios = 0
    for fila in filas:
        frasco = db.get(ConsumoFrasco, int(fila.get("frasco_id") or 0))
        if not frasco or frasco.id not in permitidos:
            return "Uno de los frascos ya no está en uso por este técnico."
        arcos, gotas, medidas = {}, 0.0, medidas_de(frasco.materia)
        if "gotas" in medidas:
            try:
                gotas = round(float(fila.get("gotas") or 0), 2)
            except (TypeError, ValueError):
                return "Las gotas usadas deben ser un número."
            if gotas < 0:
                return "Las gotas usadas no pueden ser negativas."
        if "arcos" in medidas:
            for tid, cant in (fila.get("arcos") or {}).items():
                try:
                    cant = round(float(cant or 0), 2)
                except (TypeError, ValueError):
                    return "Las cantidades de arcos deben ser números."
                if cant < 0:
                    return "Las cantidades de arcos no pueden ser negativas."
                if cant and str(tid) in tipos_validos:
                    arcos[str(tid)] = cant
        total = round(sum(arcos.values()), 2)
        consumido = bool(fila.get("consumido"))
        j = db.query(ConsumoJornada).filter(ConsumoJornada.frasco_id == frasco.id, ConsumoJornada.fecha == fecha).first()
        if total or gotas or consumido:
            if not j:
                j = ConsumoJornada(frasco_id=frasco.id, fecha=fecha)
                db.add(j)
            j.arcos, j.total, j.gotas = json.dumps(arcos), total, gotas
            j.registrado_por_id, j.registrado_en = user.id, datetime.utcnow()
            cambios += 1
        elif j:  # se corrigió a cero y sin consumir: se borra el registro del día
            db.delete(j)
            cambios += 1
        if consumido:
            frasco.estado, frasco.consumido_en = "CONSUMIDO", fecha
        elif frasco.estado == "CONSUMIDO" and frasco.consumido_en == fecha:
            frasco.estado, frasco.consumido_en = "EN_USO", None  # corrección del mismo día
    if not cambios:
        return "No hay arcos, gotas ni frascos consumidos para guardar."
    db.commit()
    return None


def contar_movimientos(db: Session) -> dict:
    return {"entregas": db.query(ConsumoEntrega).count(), "frascos": db.query(ConsumoFrasco).count(),
            "jornadas": db.query(ConsumoJornada).count()}


def limpiar_movimientos(db: Session) -> dict:
    """Empezar desde cero: borra entregas (también las anuladas), frascos y jornadas.
    Conserva la configuración: managers, técnicos, materias primas y tipos de producto."""
    antes = contar_movimientos(db)
    db.query(ConsumoJornada).delete(synchronize_session=False)
    db.query(ConsumoFrasco).delete(synchronize_session=False)
    db.query(ConsumoEntrega).delete(synchronize_session=False)
    db.commit()
    return antes


# ---------------- Reportes ----------------

def reportes(db: Session, desde: date | None, hasta: date | None, tecnico_id: int | None = None,
             materia_id: int | None = None, user: Empleado | None = None) -> dict:
    tipos = tipos_activos(db)
    visibles = {t.id for t in tecnicos_visibles(db, user)} if user else None

    def en_rango(f: date | None) -> bool:
        return bool(f) and (not desde or f >= desde) and (not hasta or f <= hasta)

    frascos = (db.query(ConsumoFrasco).join(ConsumoEntrega)
               .options(joinedload(ConsumoFrasco.materia), joinedload(ConsumoFrasco.jornadas),
                        joinedload(ConsumoFrasco.entrega).joinedload(ConsumoEntrega.tecnico).joinedload(ConsumoTecnico.empleado))
               .filter(ConsumoEntrega.estado == "ACTIVO").all())
    frascos = [f for f in frascos if (not tecnico_id or f.entrega.tecnico_id == tecnico_id)
               and (not materia_id or f.materia_id == materia_id) and (visibles is None or f.entrega.tecnico_id in visibles)]

    por_tec: dict[int, dict] = {}
    por_mat: dict[tuple, dict] = {}
    total_arcos, consumidos, arcos_consumidos, liquidos, wip = 0.0, 0, 0.0, 0, []
    total_gotas, gotas = 0.0, {}  # gotas por (técnico, materia)
    for f in frascos:
        tec = f.entrega.tecnico
        t = por_tec.setdefault(tec.id, {"tecnico": _nombre_tecnico(tec), "area": tec.area, "tipos": {}, "total": 0.0,
                                        "consumidos": 0, "arcosConsumidos": 0.0, "dias": set()})
        medidas = medidas_de(f.materia)
        for j in f.jornadas:
            if not en_rango(j.fecha):
                continue
            if j.gotas:
                g = gotas.setdefault((tec.id, f.materia.descripcion), {"tecnico": _nombre_tecnico(tec), "area": tec.area,
                                                                      "materia": f.materia.descripcion, "gotas": 0.0, "dias": set()})
                g["gotas"] += j.gotas
                g["dias"].add(j.fecha)
                total_gotas += j.gotas
            for tid, cant in json.loads(j.arcos or "{}").items():
                t["tipos"][tid] = t["tipos"].get(tid, 0) + cant
            t["total"] += j.total
            total_arcos += j.total
            if j.total:
                t["dias"].add(j.fecha)
        arcos_frasco = sum(j.total for j in f.jornadas)
        if f.estado == "CONSUMIDO" and en_rango(f.consumido_en):
            if "arcos" in medidas:
                consumidos += 1
                arcos_consumidos += arcos_frasco
                t["consumidos"] += 1
                t["arcosConsumidos"] += arcos_frasco
                m = por_mat.setdefault((f.materia.descripcion, f.lote), {"materia": f.materia.descripcion, "lote": f.lote,
                                                                       "frascos": 0, "arcos": 0.0, "tipos": {}})
                m["frascos"] += 1
                m["arcos"] += arcos_frasco
                for j in f.jornadas:
                    for tid, cant in json.loads(j.arcos or "{}").items():
                        m["tipos"][tid] = m["tipos"].get(tid, 0) + cant
            elif "gotas" not in medidas:
                liquidos += 1
        if f.estado == "EN_USO":
            wip.append({"tecnico": _nombre_tecnico(tec), "area": tec.area, "materia": f.materia.descripcion,
                        "lote": f.lote, "ref": f.ref, "serie": f.serie, "fechaEntrega": f.entrega.fecha.isoformat(),
                        "dias": (hoy_colombia() - f.entrega.fecha).days,
                        "acumulado": arcos_frasco, "gotas": sum(j.gotas or 0 for j in f.jornadas),
                        "midesArcos": "arcos" in medidas, "midesGotas": "gotas" in medidas})

    promedio = round(arcos_consumidos / consumidos, 1) if consumidos else None
    # Promedio por materia (para comparar cada lote contra su materia)
    prom_materia: dict[str, list] = {}
    for m in por_mat.values():
        prom_materia.setdefault(m["materia"], []).append(m)
    lotes = []
    for m in por_mat.values():
        grupo = prom_materia[m["materia"]]
        prom_mat = sum(x["arcos"] for x in grupo) / max(sum(x["frascos"] for x in grupo), 1)
        prom = m["arcos"] / m["frascos"]
        lotes.append({**m, "promedio": round(prom, 1), "promedioMateria": round(prom_mat, 1),
                      "bajo": prom_mat > 0 and prom < prom_mat * 0.8})
    tecnicos = []
    for t in por_tec.values():
        prom = round(t["arcosConsumidos"] / t["consumidos"], 1) if t["consumidos"] else None
        tecnicos.append({"tecnico": t["tecnico"], "area": t["area"], "tipos": t["tipos"], "total": round(t["total"], 2),
                         "consumidos": t["consumidos"], "promedio": prom, "dias": len(t["dias"]),
                         "bajo": promedio is not None and prom is not None and prom < promedio * 0.8})
    tecnicos = [t for t in tecnicos if t["total"] or t["consumidos"]]
    return {
        "tipos": [{"id": str(t.id), "nombre": t.nombre} for t in tipos],
        "kpis": {"arcos": round(total_arcos, 2), "consumidos": consumidos, "promedio": promedio,
                 "enUso": len(wip), "liquidos": liquidos, "gotas": round(total_gotas, 2)},
        "gotas": sorted([{**g, "gotas": round(g["gotas"], 2), "dias": len(g["dias"]),
                          "promedioDia": round(g["gotas"] / max(len(g["dias"]), 1), 1)} for g in gotas.values()],
                        key=lambda x: (x["materia"], -x["gotas"])),
        "tecnicos": sorted(tecnicos, key=lambda x: -x["total"]),
        "lotes": sorted(lotes, key=lambda x: (x["materia"], x["lote"])),
        "wip": sorted(wip, key=lambda x: -x["dias"]),
    }
