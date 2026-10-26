"""Módulo Activos › Design: mantenimientos individuales y jornadas de mantenimiento por grupo de
trabajo (con recurrencia automática). Separado de services_activos.py por tamaño, igual que Design
separa services_design.py de services_design_inicio.py.

Reglas clave a no perder al tocar este archivo (migradas de gestion_activos.py):
- PREVENTIVO nunca mueve el equipo de estado/usuario; solo CORRECTIVO en EN_PROCESO lo hace, y solo
  vuelve a stock al completar si se pide explícitamente (`devolver_stock`).
- No se puede programar dos veces el mismo tipo de mantenimiento pendiente para el mismo equipo.
- La recurrencia automática de jornadas es idempotente (vía id_jornada_origen) y solo se dispara
  cuando la jornada queda sin servicios pendientes."""
import calendar
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from .models import Empleado
from .models_activos import ActivosEquipo, ActivosPerfil, ActivosMantenimiento, ActivosJornadaMantenimiento
from .services_activos import NoEncontrado, Conflicto, _texto, _obligatorio, _equipo_activo, _perfil_activo, _mover_equipo, auditar

TIPOS_MANTENIMIENTO = {"PREVENTIVO", "CORRECTIVO"}
ESTADOS_MANTENIMIENTO = {"PROGRAMADO", "EN_PROCESO", "COMPLETADO", "CANCELADO"}
CAMPOS_MANTENIMIENTO = {"tipo_mantenimiento", "estado_mantenimiento", "fecha_programada", "fecha_realizada",
                        "descripcion_falla", "acciones_realizadas", "responsable"}
CAMPOS_JORNADA = {"fecha_programada", "responsable", "descripcion", "frecuencia_meses"}


def _validar_frecuencia(frecuencia_meses: int | None) -> None:
    if frecuencia_meses is not None and not (1 <= frecuencia_meses <= 24):
        raise ValueError("La frecuencia debe estar entre 1 y 24 meses.")


# ---------- Sincronización equipo <-> mantenimiento ----------

def _sincronizar_equipo_por_mantenimiento(db: Session, asset_tag: str, tipo: str, estado_anterior: str | None,
                                          estado_nuevo: str, devolver_stock: bool) -> None:
    if tipo != "CORRECTIVO":
        return
    if estado_nuevo == "EN_PROCESO" and estado_anterior != "EN_PROCESO":
        e = db.get(ActivosEquipo, asset_tag)
        if e and e.estado != "MANTENIMIENTO":
            _mover_equipo(db, asset_tag, None, "MANTENIMIENTO", "Inicio de mantenimiento correctivo.")
    elif estado_nuevo == "COMPLETADO" and devolver_stock:
        e = db.get(ActivosEquipo, asset_tag)
        if e and e.estado == "MANTENIMIENTO":
            _mover_equipo(db, asset_tag, None, "STOCK", "Devuelto a stock al completar mantenimiento.")


# ---------- Mantenimientos individuales ----------

def registrar_mantenimiento(db: Session, actor: Empleado, datos: dict) -> ActivosMantenimiento:
    asset_tag = _obligatorio(datos.get("asset_tag"), "El Asset Tag es obligatorio.")
    tipo = datos.get("tipo_mantenimiento")
    if tipo not in TIPOS_MANTENIMIENTO:
        raise ValueError("El tipo de mantenimiento debe ser PREVENTIVO o CORRECTIVO.")
    estado = datos.get("estado_mantenimiento")
    if estado not in ESTADOS_MANTENIMIENTO:
        raise ValueError("Estado de mantenimiento no válido.")
    fecha_programada = datos.get("fecha_programada")
    if not fecha_programada:
        raise ValueError("La fecha programada es obligatoria.")
    descripcion_falla = _obligatorio(datos.get("descripcion_falla"), "La descripción de la falla es obligatoria.")
    responsable = _obligatorio(datos.get("responsable"), "El responsable es obligatorio.")
    fecha_realizada = datos.get("fecha_realizada")
    if estado == "COMPLETADO" and not fecha_realizada:
        fecha_realizada = date.today()
    _equipo_activo(db, asset_tag)
    m = ActivosMantenimiento(asset_tag=asset_tag, tipo_mantenimiento=tipo, estado_mantenimiento=estado,
                             fecha_programada=fecha_programada, fecha_realizada=fecha_realizada,
                             descripcion_falla=descripcion_falla, acciones_realizadas=_texto(datos.get("acciones_realizadas")) or "",
                             responsable=responsable)
    db.add(m)
    _sincronizar_equipo_por_mantenimiento(db, asset_tag, tipo, None, estado, False)
    auditar(db, actor, "Alta de mantenimiento", f"Servicio {tipo.lower()} registrado para {asset_tag}.")
    db.commit()
    db.refresh(m)
    return m


def _aplicar_cambios_mantenimiento(db: Session, id_mantenimiento: int, cambios: dict, devolver_stock: bool) -> ActivosMantenimiento:
    m = db.get(ActivosMantenimiento, id_mantenimiento)
    if not m:
        raise NoEncontrado(f"No existe el mantenimiento #{id_mantenimiento}.")
    estado_anterior = m.estado_mantenimiento
    for k, v in cambios.items():
        setattr(m, k, v)
    if m.estado_mantenimiento == "COMPLETADO" and not m.fecha_realizada:
        m.fecha_realizada = date.today()
    db.flush()   # la sesión no hace autoflush: sin esto, _conteo_servicios() seguiría viendo el estado anterior
    _sincronizar_equipo_por_mantenimiento(db, m.asset_tag, m.tipo_mantenimiento, estado_anterior, m.estado_mantenimiento, devolver_stock)
    return m


def actualizar_mantenimiento(db: Session, actor: Empleado, id_mantenimiento: int, cambios: dict, devolver_stock: bool = False) -> dict:
    extra = set(cambios) - CAMPOS_MANTENIMIENTO
    if extra:
        raise ValueError(f"Campos no permitidos: {', '.join(sorted(extra))}.")
    if not cambios:
        raise ValueError("No se recibieron campos válidos para actualizar.")
    if "tipo_mantenimiento" in cambios and cambios["tipo_mantenimiento"] not in TIPOS_MANTENIMIENTO:
        raise ValueError("El tipo de mantenimiento debe ser PREVENTIVO o CORRECTIVO.")
    if "estado_mantenimiento" in cambios and cambios["estado_mantenimiento"] not in ESTADOS_MANTENIMIENTO:
        raise ValueError("Estado de mantenimiento no válido.")
    if "fecha_programada" in cambios and not cambios["fecha_programada"]:
        raise ValueError("La fecha programada no puede quedar vacía.")
    for campo, msg in (("descripcion_falla", "La descripción de la falla no puede quedar vacía."),
                       ("responsable", "El responsable no puede quedar vacío.")):
        if campo in cambios:
            cambios[campo] = _obligatorio(str(cambios[campo] or ""), msg)
    if "acciones_realizadas" in cambios:
        cambios["acciones_realizadas"] = _texto(cambios["acciones_realizadas"]) or ""
    m = _aplicar_cambios_mantenimiento(db, id_mantenimiento, cambios, devolver_stock)
    id_jornada_siguiente = None
    if m.id_jornada:
        id_jornada_siguiente = _programar_siguiente_si_corresponde(db, m.id_jornada)
    auditar(db, actor, "Edición de mantenimiento", f"Se actualizó el mantenimiento #{id_mantenimiento}.")
    db.commit()
    return {"id_jornada_siguiente": id_jornada_siguiente}


def completar_mantenimientos(db: Session, actor: Empleado, ids: list[int], acciones_realizadas: str | None = None,
                             fecha_realizada=None) -> dict:
    ids = sorted(set(ids))
    if not ids:
        raise ValueError("Selecciona al menos un mantenimiento.")
    cambios = {"estado_mantenimiento": "COMPLETADO"}
    if acciones_realizadas is not None:
        cambios["acciones_realizadas"] = _texto(acciones_realizadas) or ""
    if fecha_realizada is not None:
        cambios["fecha_realizada"] = fecha_realizada
    jornadas_afectadas: list[int] = []
    for id_m in ids:
        m = db.get(ActivosMantenimiento, id_m)
        if not m:
            raise NoEncontrado(f"No existe el mantenimiento #{id_m}.")
        if m.estado_mantenimiento == "CANCELADO":
            raise ValueError(f"El mantenimiento #{id_m} está cancelado.")
        _aplicar_cambios_mantenimiento(db, id_m, dict(cambios), False)
        if m.id_jornada and m.id_jornada not in jornadas_afectadas:
            jornadas_afectadas.append(m.id_jornada)
    siguientes = [j for j in (_programar_siguiente_si_corresponde(db, idj) for idj in jornadas_afectadas) if j]
    auditar(db, actor, "Completar mantenimientos", f"Se completaron {len(ids)} servicio(s).")
    db.commit()
    return {"completados": len(ids), "siguientes": siguientes}


# ---------- Jornadas de mantenimiento (grupos) ----------

def _sumar_meses(f: date, meses: int) -> date:
    total = f.month - 1 + meses
    anio = f.year + total // 12
    mes = total % 12 + 1
    dia = min(f.day, calendar.monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def _equipos_del_grupo(db: Session, id_lider: int) -> list[str]:
    """Equipos del líder y de sus integrantes directos -- salvo que un integrante lidere, a su vez,
    su propio grupo activo (sus equipos cuentan ahí, no aquí, para no contarlos dos veces)."""
    ids_grupo = {id_lider}
    lideres_con_integrantes = {idl for (idl,) in db.query(ActivosPerfil.id_lider_id).filter(
        ActivosPerfil.id_lider_id.isnot(None), ActivosPerfil.retirado.is_(False)).distinct()}
    for (eid,) in db.query(ActivosPerfil.empleado_id).filter(
            ActivosPerfil.id_lider_id == id_lider, ActivosPerfil.retirado.is_(False)).all():
        if eid not in lideres_con_integrantes:
            ids_grupo.add(eid)
    equipos = db.query(ActivosEquipo.asset_tag).filter(
        ActivosEquipo.empleado_id.in_(ids_grupo), ActivosEquipo.retirado.is_(False)).all()
    return sorted(e for (e,) in equipos)


def _con_pendientes(db: Session, asset_tags: list[str], tipo: str) -> dict[str, int]:
    if not asset_tags:
        return {}
    filas = db.query(ActivosMantenimiento.asset_tag, ActivosMantenimiento.id_jornada).filter(
        ActivosMantenimiento.asset_tag.in_(asset_tags), ActivosMantenimiento.tipo_mantenimiento == tipo,
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))).all()
    out: dict[str, int] = {}
    for tag, idj in filas:
        actual = out.get(tag)
        candidato = idj or 0
        if actual is None or candidato < actual:
            out[tag] = candidato
    return out


def _validar_sin_pendientes(db: Session, asset_tags: list[str], tipo: str) -> None:
    pendientes = _con_pendientes(db, asset_tags, tipo)
    if pendientes:
        detalle = ", ".join(f"{tag} (solicitud #{idj})" if idj else tag for tag, idj in pendientes.items())
        raise Conflicto(f"Estos equipos ya tienen un {tipo.lower()} pendiente: {detalle}.")


def _descripcion_servicio(db: Session, id_lider: int, tipo: str, descripcion: str | None) -> str:
    d = _texto(descripcion)
    if d:
        return d
    lider = db.get(Empleado, id_lider)
    nombre = lider.nombre_completo if lider else f"#{id_lider}"
    return f"Mantenimiento {tipo.lower()} del grupo de {nombre}"


def _crear_jornada(db: Session, id_lider: int, tipo: str, fecha_programada: date, responsable: str,
                   descripcion: str, asset_tags: list[str], frecuencia_meses: int | None,
                   id_jornada_origen: int | None = None) -> ActivosJornadaMantenimiento:
    j = ActivosJornadaMantenimiento(id_lider_id=id_lider, tipo_mantenimiento=tipo, fecha_programada=fecha_programada,
                                    responsable=responsable, descripcion=descripcion, frecuencia_meses=frecuencia_meses,
                                    id_jornada_origen=id_jornada_origen)
    db.add(j)
    db.flush()
    desc_servicio = _descripcion_servicio(db, id_lider, tipo, descripcion)
    for tag in asset_tags:
        db.add(ActivosMantenimiento(asset_tag=tag, tipo_mantenimiento=tipo, estado_mantenimiento="PROGRAMADO",
                                    fecha_programada=fecha_programada, descripcion_falla=desc_servicio,
                                    acciones_realizadas="", responsable=responsable, id_jornada=j.id_jornada))
    return j


def programar_jornada(db: Session, actor: Empleado, id_lider: int, tipo_mantenimiento: str, fecha_programada: date,
                      responsable: str, descripcion: str | None = None, asset_tags: list[str] | None = None,
                      frecuencia_meses: int | None = None) -> ActivosJornadaMantenimiento:
    if tipo_mantenimiento not in TIPOS_MANTENIMIENTO:
        raise ValueError("El tipo de mantenimiento debe ser PREVENTIVO o CORRECTIVO.")
    responsable = _obligatorio(responsable, "El responsable es obligatorio.")
    _validar_frecuencia(frecuencia_meses)
    _perfil_activo(db, id_lider)
    del_grupo = _equipos_del_grupo(db, id_lider)
    if asset_tags:
        ajenos = [t for t in asset_tags if t not in del_grupo]
        if ajenos:
            raise ValueError(f"Estos equipos no pertenecen al grupo: {', '.join(ajenos)}.")
        seleccion = [t for t in del_grupo if t in asset_tags]
    else:
        seleccion = del_grupo
    if not seleccion:
        raise ValueError("El grupo no tiene equipos asignados para programar.")
    _validar_sin_pendientes(db, seleccion, tipo_mantenimiento)
    desc = _descripcion_servicio(db, id_lider, tipo_mantenimiento, descripcion)
    j = _crear_jornada(db, id_lider, tipo_mantenimiento, fecha_programada, responsable, desc, seleccion, frecuencia_meses)
    auditar(db, actor, "Programar jornada", f"Jornada para el grupo del líder #{id_lider}: {len(seleccion)} equipo(s).")
    db.commit()
    db.refresh(j)
    return j


def _conteo_servicios(db: Session, id_jornada: int) -> dict[str, int]:
    filas = db.query(ActivosMantenimiento.estado_mantenimiento, ActivosMantenimiento.id_mantenimiento).filter(
        ActivosMantenimiento.id_jornada == id_jornada).all()
    out: dict[str, int] = {}
    for estado, _ in filas:
        out[estado] = out.get(estado, 0) + 1
    return out


def estado_jornada(j: ActivosJornadaMantenimiento, conteo: dict[str, int]) -> str:
    if j.fecha_anulacion is not None:
        return "ANULADA"
    pendientes = conteo.get("PROGRAMADO", 0) + conteo.get("EN_PROCESO", 0)
    if pendientes == 0:
        return "CERRADA"
    if j.fecha_programada < date.today():
        return "VENCIDA"
    return "ABIERTA"


def _programar_siguiente_si_corresponde(db: Session, id_jornada: int) -> int | None:
    j = db.get(ActivosJornadaMantenimiento, id_jornada)
    if not j or not j.frecuencia_meses or j.fecha_anulacion is not None:
        return None
    conteo = _conteo_servicios(db, id_jornada)
    if conteo.get("PROGRAMADO", 0) + conteo.get("EN_PROCESO", 0) > 0:
        return None
    if db.query(ActivosJornadaMantenimiento.id_jornada).filter(
            ActivosJornadaMantenimiento.id_jornada_origen == id_jornada).first():
        return None
    perfil = db.get(ActivosPerfil, j.id_lider_id)
    if not perfil or perfil.retirado:
        return None
    del_grupo = _equipos_del_grupo(db, j.id_lider_id)
    if not del_grupo:
        return None
    pendientes = _con_pendientes(db, del_grupo, j.tipo_mantenimiento)
    disponibles = [t for t in del_grupo if t not in pendientes]
    if not disponibles:
        return None
    siguiente_fecha = _sumar_meses(j.fecha_programada, j.frecuencia_meses)
    if siguiente_fecha <= date.today():
        siguiente_fecha = _sumar_meses(date.today(), j.frecuencia_meses)
    nueva = _crear_jornada(db, j.id_lider_id, j.tipo_mantenimiento, siguiente_fecha, j.responsable, j.descripcion,
                           disponibles, j.frecuencia_meses, id_jornada_origen=id_jornada)
    db.flush()
    return nueva.id_jornada


def actualizar_jornada(db: Session, actor: Empleado, id_jornada: int, cambios: dict) -> ActivosJornadaMantenimiento:
    extra = set(cambios) - CAMPOS_JORNADA
    if extra:
        raise ValueError(f"Campos no permitidos: {', '.join(sorted(extra))}.")
    if not cambios:
        raise ValueError("No se recibieron campos válidos para actualizar.")
    j = db.get(ActivosJornadaMantenimiento, id_jornada)
    if not j:
        raise NoEncontrado(f"No existe la solicitud #{id_jornada}.")
    if j.fecha_anulacion is not None:
        raise Conflicto("La solicitud está anulada y no se puede editar.")
    conteo = _conteo_servicios(db, id_jornada)
    if conteo.get("PROGRAMADO", 0) + conteo.get("EN_PROCESO", 0) == 0:
        raise Conflicto("La solicitud ya está cerrada y no se puede editar.")
    if "fecha_programada" in cambios and not cambios["fecha_programada"]:
        raise ValueError("La fecha programada es obligatoria.")
    if "responsable" in cambios:
        cambios["responsable"] = _obligatorio(cambios["responsable"], "El responsable es obligatorio.")
    if "descripcion" in cambios:
        cambios["descripcion"] = _texto(cambios["descripcion"]) or ""
    if "frecuencia_meses" in cambios:
        _validar_frecuencia(cambios["frecuencia_meses"])
    for k, v in cambios.items():
        setattr(j, k, v)
    desc = _descripcion_servicio(db, j.id_lider_id, j.tipo_mantenimiento, j.descripcion)
    campos_propagar = {}
    if "fecha_programada" in cambios:
        campos_propagar["fecha_programada"] = j.fecha_programada
    if "responsable" in cambios:
        campos_propagar["responsable"] = j.responsable
    if "descripcion" in cambios:
        campos_propagar["descripcion_falla"] = desc
    if campos_propagar:
        db.query(ActivosMantenimiento).filter(
            ActivosMantenimiento.id_jornada == id_jornada,
            ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))
        ).update(campos_propagar, synchronize_session=False)
    auditar(db, actor, "Edición de jornada", f"Se editó la solicitud #{id_jornada}.")
    db.commit()
    return j


def anular_jornada(db: Session, actor: Empleado, id_jornada: int, motivo: str) -> ActivosJornadaMantenimiento:
    motivo = _obligatorio(motivo, "El motivo es obligatorio.")
    j = db.get(ActivosJornadaMantenimiento, id_jornada)
    if not j:
        raise NoEncontrado(f"No existe la solicitud #{id_jornada}.")
    if j.fecha_anulacion is not None:
        raise Conflicto("La solicitud ya estaba anulada.")
    conteo = _conteo_servicios(db, id_jornada)
    if conteo.get("COMPLETADO", 0) + conteo.get("EN_PROCESO", 0) > 0:
        raise Conflicto("No se puede anular: ya hay equipos atendidos en esta solicitud. "
                        "Cancela desde «Editar» solo los equipos que no se van a atender.")
    j.fecha_anulacion, j.motivo_anulacion = datetime.utcnow(), motivo
    db.query(ActivosMantenimiento).filter(
        ActivosMantenimiento.id_jornada == id_jornada, ActivosMantenimiento.estado_mantenimiento == "PROGRAMADO"
    ).update({"estado_mantenimiento": "CANCELADO", "acciones_realizadas": f"Solicitud anulada: {motivo}"}, synchronize_session=False)
    auditar(db, actor, "Anular jornada", f"Solicitud #{id_jornada} anulada. {motivo}")
    db.commit()
    return j
