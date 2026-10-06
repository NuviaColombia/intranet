"""Lógica de Producción › Seguimiento de consumo (ver models_consumo.py)."""
import json
from datetime import datetime, date, timedelta
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from .models import Empleado
from .models_consumo import (ConsumoMateria, ConsumoTipo, ConsumoTecnico, ConsumoManager, ConsumoEntrega,
                             ConsumoFrasco, ConsumoJornada, ConsumoTraslado)
from .formato import nombre_propio

TIPOS_INICIALES = ["TIPO 5", "TIPO 4", "TIPO 7"]
DIAS_REGISTRO_TECNICO = 3   # el técnico registra hasta 3 días atrás; más antiguo, solo el manager
HORA_AVISO_JORNADA = 15     # desde las 3:00 p. m. se avisa a quien no ha registrado la jornada del día
ALERTA_GOTAS = 1.2          # gotas por arco por encima del 120 % del promedio de la materia


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
                     "jornadas": len(f.jornadas), "tecnicoActualId": f.tecnico_id_actual,
                     "tecnicoActual": _nombre_tecnico(f.tecnico_vigente) if f.tecnico_actual_id else "",
                     "traslados": [{"de": _nombre_tecnico(t.de_tecnico), "a": _nombre_tecnico(t.a_tecnico), "motivo": t.motivo,
                                    "por": nombre_propio(t.por.nombre_completo) if t.por else "", "en": _hora_col(t.en)}
                                   for t in f.traslados]} for f in e.frascos],
        "prueba": bool(e.prueba),
    }


def crear_entrega(db: Session, user: Empleado, datos: dict, prueba: bool = False) -> ConsumoEntrega | str:
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
              .filter(ConsumoFrasco.serie.in_(series), ConsumoFrasco.estado == "EN_USO", ConsumoEntrega.estado == "ACTIVO",
                      ConsumoEntrega.prueba == (1 if prueba else 0))}
    if en_uso:
        return f"El n.º de serie {', '.join(sorted(en_uso))} ya está entregado y en uso."
    e = ConsumoEntrega(fecha=fecha, hora=str(datos.get("hora") or "")[:5], area=tecnico.area, manager_id=user.id,
                       tecnico_id=tecnico.id, observaciones=str(datos.get("observaciones") or "").strip()[:1000],
                       creado_por_id=user.id, prueba=1 if prueba else 0)
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


def trasladar_frasco(db: Session, user: Empleado, f: ConsumoFrasco, a_tecnico_id: int, motivo: str) -> str | None:
    """Pasa un frasco en uso a otro técnico. Lo ya registrado queda a nombre de quien lo produjo."""
    if f.entrega.estado != "ACTIVO" or f.estado != "EN_USO":
        return "Solo se trasladan frascos en uso de entregas vigentes."
    actual = f.tecnico_vigente
    if not puede_corregir_jornada(db, user, actual):
        return "Solo el manager del área del técnico que tiene el frasco (o un administrador) puede trasladarlo."
    destino = db.get(ConsumoTecnico, int(a_tecnico_id or 0))
    if not destino or not destino.activo:
        return "Elige el técnico que recibe el frasco."
    if destino.id == actual.id:
        return "El frasco ya está con ese técnico."
    if not puede_gestionar_tecnico(db, user, destino):
        return "Ese técnico no pertenece a tu área."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe el motivo del traslado (mínimo 5 caracteres)."
    db.add(ConsumoTraslado(frasco_id=f.id, de_tecnico_id=actual.id, a_tecnico_id=destino.id, motivo=motivo[:500], por_id=user.id))
    f.tecnico_actual_id = destino.id
    db.commit()
    return None


# ---------------- Jornada diaria ----------------

def frascos_para_jornada(db: Session, tecnico: ConsumoTecnico, fecha: date, prueba: bool = False) -> list[dict]:
    """Frascos en uso del técnico (y los que consumió ese mismo día) con los registros del día."""
    frascos = (db.query(ConsumoFrasco).join(ConsumoEntrega)
               .options(joinedload(ConsumoFrasco.materia), joinedload(ConsumoFrasco.entrega))
               .filter(func.coalesce(ConsumoFrasco.tecnico_actual_id, ConsumoEntrega.tecnico_id) == tecnico.id,
                       ConsumoEntrega.estado == "ACTIVO", ConsumoEntrega.prueba == (1 if prueba else 0),
                       ConsumoEntrega.fecha <= fecha,
                       (ConsumoFrasco.estado == "EN_USO") | (ConsumoFrasco.consumido_en == fecha))
               .order_by(ConsumoEntrega.fecha, ConsumoFrasco.id).all())
    salida = []
    for f in frascos:
        medidas = medidas_de(f.materia)
        del_dia = [r for r in f.registros if r.fecha == fecha]
        vigentes = [r for r in del_dia if r.estado != "ANULADO"]
        salida.append({
            "id": f.id, "materia": f.materia.descripcion, "medidas": medidas,
            "midesArcos": "arcos" in medidas, "midesGotas": "gotas" in medidas,
            "lote": f.lote, "ref": f.ref, "serie": f.serie, "fechaEntrega": f.entrega.fecha.isoformat(),
            "consumido": f.estado == "CONSUMIDO", "diasAbierto": (fecha - f.entrega.fecha).days,
            "diasAlerta": f.materia.dias_alerta or 0,
            "alertaDias": bool(f.materia.dias_alerta) and (fecha - f.entrega.fecha).days > f.materia.dias_alerta,
            "recibidoDe": _nombre_tecnico(f.traslados[-1].de_tecnico) if f.tecnico_actual_id and f.traslados else "",
            "arcosDia": round(sum(r.total for r in vigentes), 2), "gotasDia": round(sum(r.gotas or 0 for r in vigentes), 2),
            "acumulado": round(sum(x.total for x in f.jornadas), 2),
            "gotasAcumuladas": round(sum(x.gotas or 0 for x in f.jornadas), 2),
            "registros": [serializar_registro(r) for r in del_dia],
        })
    return salida


def _hora_col(d: datetime | None) -> str:
    return (d - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if d else ""


def serializar_registro(r: ConsumoJornada) -> dict:
    return {"id": r.id, "fecha": r.fecha.isoformat(), "hora": _hora_col(r.registrado_en)[11:],
            "arcos": json.loads(r.arcos or "{}"), "total": r.total, "gotas": r.gotas or 0, "consumido": bool(r.consumido),
            "observacion": r.observacion or "", "estado": r.estado or "ACTIVO",
            "registradoPor": nombre_propio(r.registrado_por.nombre_completo) if r.registrado_por else "",
            "registradoPorId": r.registrado_por_id,
            "solicitudMotivo": r.solicitud_motivo or "", "solicitadoEn": _hora_col(r.solicitado_en),
            "solicitadoPor": nombre_propio(r.solicitado_por.nombre_completo) if r.solicitado_por else "",
            "respuesta": r.respuesta or "",
            "anuladoPor": nombre_propio(r.anulado_por.nombre_completo) if r.anulado_por else "",
            "anuladoEn": _hora_col(r.anulado_en), "motivoAnulacion": r.motivo_anulacion or ""}


def guardar_jornada(db: Session, user: Empleado, tecnico: ConsumoTecnico, fecha: date, filas: list[dict],
                    prueba: bool = False) -> str | None:
    """Agrega un registro nuevo por frasco (puede haber varios en el día). Lo guardado no se modifica:
    para corregirlo se solicita la anulación al manager."""
    if not puede_editar_tecnico(db, user, tecnico):
        return "No puedes registrar la jornada de ese técnico."
    if fecha > hoy_colombia():
        return "La fecha de la jornada no puede ser futura."
    if (hoy_colombia() - fecha).days > DIAS_REGISTRO_TECNICO and not puede_corregir_jornada(db, user, tecnico):
        return (f"Solo puedes registrar jornadas de los últimos {DIAS_REGISTRO_TECNICO} días. "
                "Para una fecha anterior, pídeselo al manager de tu área.")
    tipos_validos = {str(t.id) for t in tipos_activos(db)}
    permitidos = {f["id"] for f in frascos_para_jornada(db, tecnico, fecha, prueba)}
    cambios = 0
    for fila in filas:
        frasco = db.get(ConsumoFrasco, int(fila.get("frasco_id") or 0))
        if not frasco or frasco.id not in permitidos:
            return "Uno de los frascos ya no está en uso por este técnico."
        observacion = str(fila.get("observacion") or "").strip()[:500]
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
        if not (total or gotas or consumido):
            continue  # fila vacía: no se registra nada de ese frasco
        if frasco.estado == "CONSUMIDO":
            return (f"{frasco.materia.descripcion} (serie {frasco.serie}) ya está marcado como consumido. "
                    "Si fue un error, solicita la anulación de ese registro.")
        db.add(ConsumoJornada(frasco_id=frasco.id, fecha=fecha, tecnico_id=tecnico.id, arcos=json.dumps(arcos), total=total, gotas=gotas,
                              consumido=1 if consumido else 0, observacion=observacion, estado="ACTIVO",
                              registrado_por_id=user.id, registrado_en=datetime.utcnow()))
        if consumido:
            frasco.estado, frasco.consumido_en = "CONSUMIDO", fecha
        cambios += 1
    if not cambios:
        return "No hay arcos, gotas ni frascos consumidos para guardar."
    db.commit()
    return None


# ---------------- Anulación de registros de jornada ----------------

def puede_corregir_jornada(db: Session, user: Empleado, tecnico: ConsumoTecnico) -> bool:
    """Anular registros (y aprobar o rechazar solicitudes): el manager del área del técnico o un administrador."""
    return es_admin(user) or area_manager(db, user) == tecnico.area


def _tecnico_de(r: ConsumoJornada) -> ConsumoTecnico:
    """Quién produjo el registro (si el frasco se trasladó, puede no ser el de la entrega)."""
    return r.tecnico if r.tecnico_id else r.frasco.entrega.tecnico


def solicitar_anulacion(db: Session, user: Empleado, r: ConsumoJornada, motivo: str) -> str | None:
    """El técnico (o quien lo registró) pide anular un registro, con observación; el manager decide."""
    tecnico = _tecnico_de(r)
    if user.id not in (tecnico.empleado_id, r.registrado_por_id):
        return "Solo el técnico o quien hizo el registro puede solicitar su anulación."
    if r.estado != "ACTIVO":
        return "Ese registro ya tiene una solicitud de anulación o ya está anulado."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe la observación: por qué se debe anular (mínimo 5 caracteres)."
    r.estado, r.solicitud_motivo, r.solicitado_por_id, r.solicitado_en = "SOLICITADA", motivo[:500], user.id, datetime.utcnow()
    r.respuesta = None
    db.commit()
    return None


def anular_registro(db: Session, user: Empleado, r: ConsumoJornada, motivo: str) -> str | None:
    """El manager del área (o un administrador) anula un registro; si había solicitud, la aprueba."""
    if not puede_corregir_jornada(db, user, _tecnico_de(r)):
        return "Solo el manager del área del técnico o un administrador puede anular registros."
    if r.estado == "ANULADO":
        return "Ese registro ya está anulado."
    motivo = (motivo or "").strip() or (r.solicitud_motivo or "")
    if len(motivo) < 5:
        return "Escribe el motivo de la anulación (mínimo 5 caracteres)."
    r.estado, r.anulado_por_id, r.anulado_en, r.motivo_anulacion = "ANULADO", user.id, datetime.utcnow(), motivo[:500]
    f = r.frasco
    if r.consumido and f.estado == "CONSUMIDO" and f.consumido_en == r.fecha:
        otro = any(x.consumido and x.estado != "ANULADO" and x.id != r.id for x in f.registros)
        if not otro:
            f.estado, f.consumido_en = "EN_USO", None  # el frasco vuelve a estar en uso
    db.commit()
    return None


def rechazar_solicitud(db: Session, user: Empleado, r: ConsumoJornada, respuesta: str) -> str | None:
    if not puede_corregir_jornada(db, user, _tecnico_de(r)):
        return "Solo el manager del área del técnico o un administrador puede responder la solicitud."
    if r.estado != "SOLICITADA":
        return "Ese registro no tiene una solicitud de anulación pendiente."
    respuesta = (respuesta or "").strip()
    if len(respuesta) < 3:
        return "Escribe por qué se rechaza la solicitud."
    r.estado, r.respuesta = "ACTIVO", respuesta[:500]
    db.commit()
    return None


def solicitudes_pendientes(db: Session, user: Empleado, prueba: bool = False) -> list[dict]:
    """Solicitudes de anulación que el usuario puede resolver (su área; administradores, todas)."""
    admin, area = es_admin(user), area_manager(db, user)
    if not admin and not area:
        return []
    q = (db.query(ConsumoJornada).join(ConsumoFrasco).join(ConsumoEntrega)
         .filter(ConsumoJornada.estado == "SOLICITADA", ConsumoEntrega.prueba == (1 if prueba else 0)))
    salida = []
    for r in q.order_by(ConsumoJornada.solicitado_en).all():
        tec, f = _tecnico_de(r), r.frasco
        if admin or tec.area == area:
            salida.append({**serializar_registro(r), "tecnico": _nombre_tecnico(tec), "tecnicoId": tec.id,
                           "materia": f.materia.descripcion, "serie": f.serie, "lote": f.lote})
    return salida


def sin_jornada_hoy(db: Session) -> dict[int, int]:
    """{técnico_id: frascos en uso} de los técnicos (datos reales) que no han registrado nada hoy."""
    hoy = hoy_colombia()
    frascos = (db.query(ConsumoFrasco).join(ConsumoEntrega)
               .filter(ConsumoFrasco.estado == "EN_USO", ConsumoEntrega.estado == "ACTIVO", ConsumoEntrega.prueba == 0,
                       ConsumoEntrega.fecha <= hoy).all())
    en_uso: dict[int, int] = {}
    for f in frascos:
        en_uso[f.tecnico_id_actual] = en_uso.get(f.tecnico_id_actual, 0) + 1
    if not en_uso:
        return {}
    con_registro = {tid for (tid,) in db.query(ConsumoJornada.tecnico_id).filter(ConsumoJornada.fecha == hoy)}
    con_registro |= {e.tecnico_id for e in db.query(ConsumoEntrega).join(ConsumoFrasco).join(ConsumoJornada)
                     .filter(ConsumoJornada.fecha == hoy, ConsumoJornada.tecnico_id.is_(None))}
    tecnicos = {t.id: t for t in db.query(ConsumoTecnico).filter(ConsumoTecnico.id.in_(list(en_uso)), ConsumoTecnico.activo == 1)}
    return {tid: n for tid, n in en_uso.items() if tid in tecnicos and tid not in con_registro}


def managers_del_area(db: Session, area: str) -> list[Empleado]:
    return [m.empleado for m in db.query(ConsumoManager).filter(ConsumoManager.area == area).all()
            if m.empleado and m.empleado.activo]


def limpiar_pruebas(db: Session) -> dict:
    """Borra solo lo hecho en modo pruebas (entregas con prueba=1, sus frascos, traslados y registros)."""
    entregas = [i for (i,) in db.query(ConsumoEntrega.id).filter(ConsumoEntrega.prueba == 1)]
    frascos = [i for (i,) in db.query(ConsumoFrasco.id).filter(ConsumoFrasco.entrega_id.in_(entregas or [0]))]
    n = {"entregas": len(entregas), "frascos": len(frascos),
         "jornadas": db.query(ConsumoJornada).filter(ConsumoJornada.frasco_id.in_(frascos or [0])).count()}
    db.query(ConsumoJornada).filter(ConsumoJornada.frasco_id.in_(frascos or [0])).delete(synchronize_session=False)
    db.query(ConsumoTraslado).filter(ConsumoTraslado.frasco_id.in_(frascos or [0])).delete(synchronize_session=False)
    db.query(ConsumoFrasco).filter(ConsumoFrasco.id.in_(frascos or [0])).delete(synchronize_session=False)
    db.query(ConsumoEntrega).filter(ConsumoEntrega.id.in_(entregas or [0])).delete(synchronize_session=False)
    db.commit()
    return n


def contar_movimientos(db: Session) -> dict:
    return {"entregas": db.query(ConsumoEntrega).count(), "frascos": db.query(ConsumoFrasco).count(),
            "jornadas": db.query(ConsumoJornada).count()}


def limpiar_movimientos(db: Session) -> dict:
    """Empezar desde cero: borra entregas (también las anuladas), frascos y jornadas.
    Conserva la configuración: managers, técnicos, materias primas y tipos de producto."""
    antes = contar_movimientos(db)
    db.query(ConsumoJornada).delete(synchronize_session=False)
    db.query(ConsumoTraslado).delete(synchronize_session=False)
    db.query(ConsumoFrasco).delete(synchronize_session=False)
    db.query(ConsumoEntrega).delete(synchronize_session=False)
    db.commit()
    return antes


# ---------------- Reportes ----------------

def reportes(db: Session, desde: date | None, hasta: date | None, tecnico_id: int | None = None,
             materia_id: int | None = None, user: Empleado | None = None, prueba: bool = False) -> dict:
    """Los registros cuentan para quien los produjo; consumos y frascos en uso, para quien tiene hoy el frasco."""
    tipos = tipos_activos(db)
    visibles = {t.id for t in tecnicos_visibles(db, user)} if user else None

    def en_rango(f: date | None) -> bool:
        return bool(f) and (not desde or f >= desde) and (not hasta or f <= hasta)

    def ve(tid: int) -> bool:
        return (visibles is None or tid in visibles) and (not tecnico_id or tid == tecnico_id)

    frascos = (db.query(ConsumoFrasco).join(ConsumoEntrega)
               .options(joinedload(ConsumoFrasco.materia), joinedload(ConsumoFrasco.jornadas),
                        joinedload(ConsumoFrasco.entrega).joinedload(ConsumoEntrega.tecnico).joinedload(ConsumoTecnico.empleado))
               .filter(ConsumoEntrega.estado == "ACTIVO", ConsumoEntrega.prueba == (1 if prueba else 0)).all())
    frascos = [f for f in frascos if not materia_id or f.materia_id == materia_id]

    por_tec: dict[int, dict] = {}
    por_mat: dict[tuple, dict] = {}
    total_arcos, consumidos, arcos_consumidos, liquidos, wip = 0.0, 0, 0.0, 0, []
    total_gotas, gotas = 0.0, {}  # gotas (y arcos de esos mismos registros) por (técnico, materia)

    def fila_tec(tec: ConsumoTecnico) -> dict:
        return por_tec.setdefault(tec.id, {"tecnico": _nombre_tecnico(tec), "area": tec.area, "tipos": {}, "total": 0.0,
                                           "consumidos": 0, "arcosConsumidos": 0.0, "dias": set()})

    for f in frascos:
        medidas = medidas_de(f.materia)
        for j in f.jornadas:
            tec = _tecnico_de(j)
            if not en_rango(j.fecha) or not ve(tec.id):
                continue
            t = fila_tec(tec)
            if j.gotas:
                g = gotas.setdefault((tec.id, f.materia.descripcion), {"tecnico": _nombre_tecnico(tec), "area": tec.area,
                                                                      "materia": f.materia.descripcion, "gotas": 0.0,
                                                                      "arcos": 0.0, "dias": set(), "mideArcos": "arcos" in medidas})
                g["gotas"] += j.gotas
                g["arcos"] += j.total
                g["dias"].add(j.fecha)
                total_gotas += j.gotas
            for tid, cant in json.loads(j.arcos or "{}").items():
                t["tipos"][tid] = t["tipos"].get(tid, 0) + cant
            t["total"] += j.total
            total_arcos += j.total
            if j.total:
                t["dias"].add(j.fecha)
        arcos_frasco = sum(j.total for j in f.jornadas)
        duenio = f.tecnico_vigente
        if not ve(duenio.id):
            continue
        if f.estado == "CONSUMIDO" and en_rango(f.consumido_en):
            if "arcos" in medidas:
                t = fila_tec(duenio)
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
            dias = (hoy_colombia() - f.entrega.fecha).days
            wip.append({"tecnico": _nombre_tecnico(duenio), "area": duenio.area, "materia": f.materia.descripcion,
                        "lote": f.lote, "ref": f.ref, "serie": f.serie, "fechaEntrega": f.entrega.fecha.isoformat(),
                        "dias": dias, "diasAlerta": f.materia.dias_alerta or 0,
                        "alerta": bool(f.materia.dias_alerta) and dias > f.materia.dias_alerta,
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
    # Gotas por arco: cuánto gasta cada técnico frente al promedio de la materia (solo materias que miden ambas)
    gpa_materia: dict[str, float] = {}
    for mat in {g["materia"] for g in gotas.values()}:
        filas = [g for g in gotas.values() if g["materia"] == mat and g["mideArcos"]]
        a = sum(g["arcos"] for g in filas)
        if a:
            gpa_materia[mat] = sum(g["gotas"] for g in filas) / a
    filas_gotas = []
    for g in gotas.values():
        gpa = round(g["gotas"] / g["arcos"], 2) if g["mideArcos"] and g["arcos"] else None
        prom_m = gpa_materia.get(g["materia"])
        filas_gotas.append({**g, "gotas": round(g["gotas"], 2), "arcos": round(g["arcos"], 2), "dias": len(g["dias"]),
                            "promedioDia": round(g["gotas"] / max(len(g["dias"]), 1), 1), "gotasPorArco": gpa,
                            "promedioMateria": round(prom_m, 2) if prom_m else None,
                            "alto": gpa is not None and bool(prom_m) and gpa > prom_m * ALERTA_GOTAS})
    return {
        "tipos": [{"id": str(t.id), "nombre": t.nombre} for t in tipos],
        "kpis": {"arcos": round(total_arcos, 2), "consumidos": consumidos, "promedio": promedio,
                 "enUso": len(wip), "liquidos": liquidos, "gotas": round(total_gotas, 2),
                 "alertasDias": sum(1 for w in wip if w["alerta"])},
        "gotas": sorted(filas_gotas, key=lambda x: (x["materia"], -x["gotas"])),
        "tecnicos": sorted(tecnicos, key=lambda x: -x["total"]),
        "lotes": sorted(lotes, key=lambda x: (x["materia"], x["lote"])),
        "wip": sorted(wip, key=lambda x: (not x["alerta"], -x["dias"])),
    }
