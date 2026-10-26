"""Módulo Activos › Design: reglas de negocio de equipos, perfiles (custodios de hardware),
dongles ExoCAD, áreas y grupos de trabajo. Los mantenimientos y las jornadas de grupo están en
services_activos_mantenimiento.py (por tamaño, igual que Design separa services_design.py de
services_design_inicio.py).

Migrado desde un proyecto aparte (gestion_activos.py / consultas.py, SQLite crudo sin ORM) -- las
reglas de negocio documentadas ahí se preservan aquí función por función; ver docs/wiki/activos.md
para el detalle de qué cambió a propósito en la migración (auditoría simple en vez de restaurar la
base completa, usuarios unificados con Empleado, etc.)."""
from datetime import datetime
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from .models import Empleado
from .models_activos import (ActivosArea, ActivosPerfil, ActivosEquipo, ActivosDongle,
                             ActivosHistorialAsignacion, ActivosAuditoria)
from .services_activos_cache import invalidar as _invalidar_cache_dashboard

EMOJIS_SALUD = ("OPTIMO", "NOVEDADES", "EN_MANTENIMIENTO", "SIN_REVISION")


class NoEncontrado(LookupError):
    """El registro solicitado no existe o no está activo."""


class Conflicto(ValueError):
    """El cambio choca con un dato existente (duplicado o asignación ocupada)."""


def _texto(valor: str | None) -> str | None:
    v = (valor or "").strip()
    return v or None


def _obligatorio(valor: str | None, mensaje: str) -> str:
    v = _texto(valor)
    if not v:
        raise ValueError(mensaje)
    return v


def auditar(db: Session, actor: Empleado | None, accion: str, descripcion: str) -> None:
    db.add(ActivosAuditoria(accion=accion, descripcion=descripcion, empleado_id=actor.id if actor else None))
    _invalidar_cache_dashboard()  # toda escritura del módulo pasa por aquí -- ver services_activos_cache.py


# ---------- Helpers de estado activo ----------

def _equipo_activo(db: Session, asset_tag: str) -> ActivosEquipo:
    e = db.get(ActivosEquipo, asset_tag)
    if not e:
        raise NoEncontrado(f"No existe el equipo {asset_tag}.")
    if e.retirado:
        raise ValueError(f"El equipo {asset_tag} está retirado.")
    return e


def _perfil_activo(db: Session, empleado_id: int) -> ActivosPerfil:
    p = db.get(ActivosPerfil, empleado_id)
    if not p or p.retirado:
        raise NoEncontrado(f"No existe un custodio de hardware activo con id {empleado_id}.")
    return p


# ---------- Un solo punto de escritura del historial de asignaciones ----------

def _mover_equipo(db: Session, asset_tag: str, empleado_id: int | None, estado: str, motivo: str) -> None:
    """Cierra el periodo de asignación abierto del equipo y, según el caso, abre uno nuevo (si se
    asigna a alguien) o inserta un registro ya cerrado con el custodio anterior (si se libera) --
    así el motivo de la liberación siempre queda en el historial, aunque el periodo dure 0 segundos."""
    anterior = db.query(ActivosEquipo.empleado_id).filter(ActivosEquipo.asset_tag == asset_tag).scalar()
    ahora = datetime.utcnow()
    db.query(ActivosHistorialAsignacion).filter(
        ActivosHistorialAsignacion.tipo_activo == "EQUIPO", ActivosHistorialAsignacion.asset_tag == asset_tag,
        ActivosHistorialAsignacion.fecha_fin.is_(None)).update({"fecha_fin": ahora}, synchronize_session=False)
    db.query(ActivosEquipo).filter(ActivosEquipo.asset_tag == asset_tag).update(
        {"empleado_id": empleado_id, "estado": estado}, synchronize_session=False)
    if empleado_id is not None:
        db.add(ActivosHistorialAsignacion(tipo_activo="EQUIPO", asset_tag=asset_tag, empleado_id=empleado_id,
                                          fecha_inicio=ahora, fecha_fin=None, motivo=motivo))
    elif anterior is not None:
        db.add(ActivosHistorialAsignacion(tipo_activo="EQUIPO", asset_tag=asset_tag, empleado_id=anterior,
                                          fecha_inicio=ahora, fecha_fin=ahora, motivo=motivo))


def _mover_dongle(db: Session, id_dongle: int, asset_tag: str | None, motivo: str) -> None:
    if asset_tag is not None:
        otro = db.query(ActivosDongle.numero_dongle).filter(
            ActivosDongle.asset_tag_asignado == asset_tag, ActivosDongle.id_dongle != id_dongle).scalar()
        if otro:
            raise Conflicto(f"El equipo {asset_tag} ya tiene asignado el dongle '{otro}'.")
    ahora = datetime.utcnow()
    db.query(ActivosHistorialAsignacion).filter(
        ActivosHistorialAsignacion.tipo_activo == "DONGLE", ActivosHistorialAsignacion.id_dongle == id_dongle,
        ActivosHistorialAsignacion.fecha_fin.is_(None)).update({"fecha_fin": ahora}, synchronize_session=False)
    db.query(ActivosDongle).filter(ActivosDongle.id_dongle == id_dongle).update(
        {"asset_tag_asignado": asset_tag, "estado_dongle": "EN USO" if asset_tag else "DISPONIBLE"}, synchronize_session=False)
    if asset_tag is not None:
        db.add(ActivosHistorialAsignacion(tipo_activo="DONGLE", id_dongle=id_dongle, asset_tag=asset_tag,
                                          fecha_inicio=ahora, fecha_fin=None, motivo=motivo))


# ---------- Equipos ----------

TIPOS_EQUIPO = {"Laptop", "Mini PC"}


def _validar_datos_equipo(tipo_equipo, marca, modelo, serial_number) -> tuple[str, str, str, str]:
    tipo = _obligatorio(tipo_equipo, "El tipo de equipo es obligatorio.")
    if tipo not in TIPOS_EQUIPO:
        raise ValueError("El tipo debe ser Laptop o Mini PC.")
    return tipo, _obligatorio(marca, "La marca es obligatoria."), _obligatorio(modelo, "El modelo es obligatorio."), \
        _obligatorio(serial_number, "El serial es obligatorio.")


def registrar_equipo(db: Session, actor: Empleado, asset_tag: str, tipo_equipo: str, marca: str, modelo: str,
                     serial_number: str, sistema_operativo: str | None = None, observaciones: str | None = None,
                     procesador: str | None = None, memoria_ram: str | None = None, almacenamiento: str | None = None) -> ActivosEquipo:
    tag = _obligatorio(asset_tag, "El Asset Tag es obligatorio.")
    tipo, marca, modelo, serial = _validar_datos_equipo(tipo_equipo, marca, modelo, serial_number)
    if db.get(ActivosEquipo, tag):
        raise Conflicto(f"Ya existe un equipo con Asset Tag {tag}.")
    if db.query(ActivosEquipo.asset_tag).filter(ActivosEquipo.serial_number == serial).first():
        raise Conflicto(f"El serial {serial} ya pertenece a otro equipo.")
    e = ActivosEquipo(asset_tag=tag, tipo_equipo=tipo, marca=marca, modelo_referencia=modelo, serial_number=serial,
                      sistema_operativo=_texto(sistema_operativo), observaciones=_texto(observaciones),
                      procesador=_texto(procesador), memoria_ram=_texto(memoria_ram), almacenamiento=_texto(almacenamiento))
    db.add(e)
    auditar(db, actor, "Alta de equipo", f"Se registró el equipo {tag} ({marca} {modelo}).")
    db.commit()
    db.refresh(e)
    return e


def obtener_equipo(db: Session, asset_tag: str) -> ActivosEquipo:
    return _equipo_activo(db, asset_tag)


def actualizar_equipo(db: Session, actor: Empleado, asset_tag: str, tipo_equipo: str, marca: str, modelo: str,
                      serial_number: str, sistema_operativo: str | None, observaciones: str | None,
                      procesador: str | None = None, memoria_ram: str | None = None, almacenamiento: str | None = None) -> ActivosEquipo:
    e = _equipo_activo(db, asset_tag)
    tipo, marca, modelo, serial = _validar_datos_equipo(tipo_equipo, marca, modelo, serial_number)
    if db.query(ActivosEquipo.asset_tag).filter(ActivosEquipo.serial_number == serial, ActivosEquipo.asset_tag != asset_tag).first():
        raise Conflicto(f"El serial {serial} ya pertenece a otro equipo.")
    e.tipo_equipo, e.marca, e.modelo_referencia, e.serial_number = tipo, marca, modelo, serial
    e.sistema_operativo, e.observaciones = _texto(sistema_operativo), _texto(observaciones)
    e.procesador, e.memoria_ram, e.almacenamiento = _texto(procesador), _texto(memoria_ram), _texto(almacenamiento)
    auditar(db, actor, "Edición de equipo", f"Se editaron los datos del equipo {asset_tag}.")
    db.commit()
    return e


def asignar_equipo(db: Session, actor: Empleado, asset_tag: str, empleado_id: int | None, motivo: str) -> ActivosEquipo:
    """empleado_id dado = asigna (queda EN USO); None = libera (queda STOCK)."""
    motivo = _obligatorio(motivo, "El motivo es obligatorio para registrar un cambio.")
    e = _equipo_activo(db, asset_tag)
    if empleado_id is not None:
        _perfil_activo(db, empleado_id)
        if e.empleado_id == empleado_id:
            raise ValueError("El equipo ya está asignado a ese usuario.")
        _mover_equipo(db, asset_tag, empleado_id, "EN USO", motivo)
        auditar(db, actor, "Asignación de equipo", f"{asset_tag} asignado al empleado #{empleado_id}. {motivo}")
    else:
        if e.empleado_id is None and e.estado == "STOCK":
            raise ValueError("El equipo ya está libre en STOCK.")
        _mover_equipo(db, asset_tag, None, "STOCK", f"Liberado a STOCK. {motivo}")
        auditar(db, actor, "Liberación de equipo", f"{asset_tag} liberado a STOCK. {motivo}")
    db.commit()
    db.refresh(e)
    return e


def actualizar_estado_equipo(db: Session, actor: Empleado, asset_tag: str, nuevo_estado: str, motivo: str | None = None) -> ActivosEquipo:
    if nuevo_estado not in ("MANTENIMIENTO", "STOCK"):
        raise ValueError("El nuevo estado debe ser MANTENIMIENTO o STOCK.")
    e = _equipo_activo(db, asset_tag)
    if e.estado == nuevo_estado:
        raise ValueError(f"El equipo ya se encuentra en estado {nuevo_estado}.")
    detalle = _texto(motivo) or f"Cambio de estado a {nuevo_estado}"
    _mover_equipo(db, asset_tag, None, nuevo_estado, detalle)
    auditar(db, actor, "Cambio de estado de equipo", f"{asset_tag} -> {nuevo_estado}. {detalle}")
    db.commit()
    db.refresh(e)
    return e


def retirar_equipo(db: Session, actor: Empleado, asset_tag: str, motivo: str) -> ActivosEquipo:
    from .models_activos import ActivosMantenimiento
    motivo = _obligatorio(motivo, "El motivo es obligatorio.")
    e = _equipo_activo(db, asset_tag)
    dongle = db.query(ActivosDongle).filter(ActivosDongle.asset_tag_asignado == asset_tag).first()
    if dongle:
        _mover_dongle(db, dongle.id_dongle, None, f"Liberado por retiro del equipo {asset_tag}.")
    if e.empleado_id is not None:
        _mover_equipo(db, asset_tag, None, e.estado, f"Liberado por retiro del equipo. {motivo}")
    db.query(ActivosMantenimiento).filter(
        ActivosMantenimiento.asset_tag == asset_tag,
        ActivosMantenimiento.estado_mantenimiento.in_(("PROGRAMADO", "EN_PROCESO"))
    ).update({"estado_mantenimiento": "CANCELADO",
             "acciones_realizadas": func.trim(func.coalesce(ActivosMantenimiento.acciones_realizadas, "") + " [Cancelado por retiro del equipo]")},
            synchronize_session=False)
    e.empleado_id, e.estado, e.retirado = None, "STOCK", True
    e.fecha_retiro, e.motivo_retiro = datetime.utcnow(), motivo
    auditar(db, actor, "Retiro de equipo", f"{asset_tag} retirado. {motivo}")
    db.commit()
    db.refresh(e)
    return e


# ---------- Perfiles (custodios de hardware) ----------

def _validar_area(db: Session, id_area: int | None) -> None:
    if id_area is not None and not db.get(ActivosArea, id_area):
        raise NoEncontrado(f"No existe el área #{id_area}.")


def _validar_jumpcloud(db: Session, jumpcloud: str | None, excluir: int | None = None) -> str | None:
    j = _texto(jumpcloud)
    if not j:
        return None
    q = db.query(ActivosPerfil.empleado_id).filter(func.lower(ActivosPerfil.jumpcloud_username) == j.lower())
    if excluir is not None:
        q = q.filter(ActivosPerfil.empleado_id != excluir)
    if q.first():
        raise Conflicto(f"El usuario de JumpCloud '{j}' ya pertenece a otra persona.")
    return j


def _validar_lider(db: Session, id_lider: int | None, empleado_id: int) -> None:
    if id_lider is None:
        return
    if id_lider == empleado_id:
        raise ValueError("Un usuario no puede ser su propio líder.")
    _perfil_activo(db, id_lider)


def dar_alta_perfil(db: Session, actor: Empleado, empleado_id: int, jumpcloud_username: str | None = None,
                    id_area_id: int | None = None) -> ActivosPerfil:
    """Registra a un Empleado ya existente (de People) como custodio de hardware."""
    empleado = db.get(Empleado, empleado_id)
    if not empleado:
        raise NoEncontrado(f"No existe el empleado #{empleado_id}.")
    existente = db.get(ActivosPerfil, empleado_id)
    if existente and not existente.retirado:
        raise Conflicto(f"{empleado.nombre_completo} ya está registrado en Activos.")
    _validar_area(db, id_area_id)
    jc = _validar_jumpcloud(db, jumpcloud_username, excluir=empleado_id)
    if existente:   # estaba retirado: se reactiva en vez de duplicar la fila
        existente.retirado, existente.fecha_retiro, existente.motivo_retiro = False, None, None
        existente.jumpcloud_username, existente.id_area_id = jc, id_area_id
        perfil = existente
    else:
        perfil = ActivosPerfil(empleado_id=empleado_id, jumpcloud_username=jc, id_area_id=id_area_id)
        db.add(perfil)
    auditar(db, actor, "Alta de custodio de hardware", f"{empleado.nombre_completo} se registró en Activos.")
    db.commit()
    db.refresh(perfil)
    return perfil


CAMPOS_PERFIL = {"jumpcloud_username", "id_area_id", "id_lider_id", "personaje", "personaje_variante", "personaje_piel"}


def actualizar_perfil(db: Session, actor: Empleado, empleado_id: int, cambios: dict) -> ActivosPerfil:
    extra = set(cambios) - CAMPOS_PERFIL
    if extra:
        raise ValueError(f"Campos no permitidos: {', '.join(sorted(extra))}.")
    if not cambios:
        raise ValueError("No se recibieron campos válidos para actualizar.")
    perfil = _perfil_activo(db, empleado_id)
    if "jumpcloud_username" in cambios:
        cambios["jumpcloud_username"] = _validar_jumpcloud(db, cambios["jumpcloud_username"], excluir=empleado_id)
    if "id_area_id" in cambios:
        _validar_area(db, cambios["id_area_id"])
    if "id_lider_id" in cambios:
        _validar_lider(db, cambios["id_lider_id"], empleado_id)
    for k, v in cambios.items():
        setattr(perfil, k, v)
    auditar(db, actor, "Edición de custodio", f"Se editó el perfil de Activos del empleado #{empleado_id}.")
    db.commit()
    return perfil


def retirar_perfil(db: Session, actor: Empleado, empleado_id: int, motivo: str) -> ActivosPerfil:
    motivo = _obligatorio(motivo, "El motivo es obligatorio.")
    perfil = _perfil_activo(db, empleado_id)
    con_equipo = [a for (a,) in db.query(ActivosEquipo.asset_tag).filter(
        ActivosEquipo.empleado_id == empleado_id, ActivosEquipo.retirado.is_(False)).all()]
    if con_equipo:
        raise Conflicto(f"Libera o reasigna primero estos equipos: {', '.join(con_equipo)}.")
    perfil.retirado, perfil.fecha_retiro, perfil.motivo_retiro, perfil.id_lider_id = True, datetime.utcnow(), motivo, None
    db.query(ActivosPerfil).filter(ActivosPerfil.id_lider_id == empleado_id).update({"id_lider_id": None}, synchronize_session=False)
    auditar(db, actor, "Retiro de custodio", f"Empleado #{empleado_id} retirado de Activos. {motivo}")
    db.commit()
    return perfil


def reactivar_perfil(db: Session, actor: Empleado, empleado_id: int) -> ActivosPerfil:
    perfil = db.get(ActivosPerfil, empleado_id)
    if not perfil:
        raise NoEncontrado(f"No existe un perfil de Activos para el empleado #{empleado_id}.")
    if not perfil.retirado:
        raise Conflicto("Ese perfil ya está activo.")
    perfil.retirado, perfil.fecha_retiro, perfil.motivo_retiro = False, None, None
    auditar(db, actor, "Reactivación de custodio", f"Empleado #{empleado_id} reactivado en Activos.")
    db.commit()
    return perfil


# ---------- Grupos de trabajo ----------

def actualizar_grupo(db: Session, actor: Empleado, id_lider: int, integrantes: list[int]) -> None:
    _perfil_activo(db, id_lider)
    lider_del_lider = db.query(ActivosPerfil.id_lider_id).filter(ActivosPerfil.empleado_id == id_lider).scalar()
    miembros = sorted({i for i in integrantes if i != id_lider})
    if lider_del_lider is not None and lider_del_lider in miembros:
        raise ValueError("El líder de este usuario no puede quedar como integrante de su grupo.")
    for m in miembros:
        _perfil_activo(db, m)
    db.query(ActivosPerfil).filter(ActivosPerfil.id_lider_id == id_lider, ~ActivosPerfil.empleado_id.in_(miembros or [0])
                                   ).update({"id_lider_id": None}, synchronize_session=False)
    if miembros:
        db.query(ActivosPerfil).filter(ActivosPerfil.empleado_id.in_(miembros)).update({"id_lider_id": id_lider}, synchronize_session=False)
    auditar(db, actor, "Edición de grupo", f"Grupo del líder #{id_lider}: {len(miembros)} integrante(s).")
    db.commit()


# ---------- Áreas ----------

def _validar_area_padre(db: Session, id_area_padre: int | None, id_area: int | None) -> None:
    if id_area_padre is None:
        return
    if id_area_padre == id_area:
        raise ValueError("Un área no puede ser su propia área superior.")
    padre = db.get(ActivosArea, id_area_padre)
    if not padre:
        raise NoEncontrado(f"No existe el área #{id_area_padre}.")
    if padre.id_area_padre is not None:
        raise ValueError("El área superior debe ser un área principal, no un departamento.")
    if id_area is not None and db.query(ActivosArea.id_area).filter(ActivosArea.id_area_padre == id_area).first():
        raise ValueError("Esta área tiene departamentos propios; no puede quedar dentro de otra.")


def registrar_area(db: Session, actor: Empleado, nombre_area: str, id_area_padre: int | None = None,
                   aplica_software_diseno: bool = False, requiere_exocad: bool = False) -> ActivosArea:
    nombre = _obligatorio(nombre_area, "El nombre del área es obligatorio.").upper()
    if db.query(ActivosArea.id_area).filter(func.upper(ActivosArea.nombre_area) == nombre).first():
        raise Conflicto(f"Ya existe un área llamada {nombre}.")
    _validar_area_padre(db, id_area_padre, None)
    a = ActivosArea(nombre_area=nombre, id_area_padre=id_area_padre,
                    aplica_software_diseno=bool(aplica_software_diseno), requiere_exocad=bool(requiere_exocad))
    db.add(a)
    auditar(db, actor, "Alta de área", f"Se registró el área {nombre}.")
    db.commit()
    db.refresh(a)
    return a


def actualizar_area(db: Session, actor: Empleado, id_area: int, nombre_area: str, id_area_padre: int | None = None,
                    aplica_software_diseno: bool = False, requiere_exocad: bool = False) -> ActivosArea:
    a = db.get(ActivosArea, id_area)
    if not a:
        raise NoEncontrado(f"No existe el área #{id_area}.")
    nombre = _obligatorio(nombre_area, "El nombre del área es obligatorio.").upper()
    if db.query(ActivosArea.id_area).filter(func.upper(ActivosArea.nombre_area) == nombre, ActivosArea.id_area != id_area).first():
        raise Conflicto(f"Ya existe un área llamada {nombre}.")
    _validar_area_padre(db, id_area_padre, id_area)
    a.nombre_area, a.id_area_padre = nombre, id_area_padre
    a.aplica_software_diseno, a.requiere_exocad = bool(aplica_software_diseno), bool(requiere_exocad)
    auditar(db, actor, "Edición de área", f"Se editó el área #{id_area}.")
    db.commit()
    return a


def eliminar_area(db: Session, actor: Empleado, id_area: int) -> str:
    a = db.get(ActivosArea, id_area)
    if not a:
        raise NoEncontrado(f"No existe el área #{id_area}.")
    if db.query(ActivosArea.id_area).filter(ActivosArea.id_area_padre == id_area).first():
        raise Conflicto("Esta área tiene departamentos; elimínalos primero.")
    if db.query(ActivosPerfil.empleado_id).filter(ActivosPerfil.id_area_id == id_area).first():
        raise Conflicto("Esta área tiene personas asociadas (activas o retiradas); no se puede eliminar.")
    nombre = a.nombre_area
    db.delete(a)
    auditar(db, actor, "Eliminación de área", f"Se eliminó el área {nombre}.")
    db.commit()
    return nombre


# ---------- Dongles ----------

def _dongle(db: Session, numero_dongle: str) -> ActivosDongle:
    d = db.query(ActivosDongle).filter(ActivosDongle.numero_dongle == numero_dongle).first()
    if not d:
        raise NoEncontrado(f"No existe el dongle {numero_dongle}.")
    return d


def registrar_dongle(db: Session, actor: Empleado, numero_dongle: str, serial_number: str,
                     version_exocad: str = "N/A", modulos: str | None = None) -> ActivosDongle:
    numero = _obligatorio(numero_dongle, "El número de dongle es obligatorio.")
    serial = _obligatorio(serial_number, "El serial es obligatorio.")
    if db.query(ActivosDongle.id_dongle).filter(
            or_(ActivosDongle.numero_dongle == numero, ActivosDongle.serial_number == serial)).first():
        raise Conflicto("El número o el serial del dongle ya existe.")
    d = ActivosDongle(numero_dongle=numero, serial_number=serial, version_exocad_compatible=_texto(version_exocad) or "N/A",
                      modulos=_texto(modulos))
    db.add(d)
    auditar(db, actor, "Alta de dongle", f"Se registró el dongle {numero}.")
    db.commit()
    db.refresh(d)
    return d


def actualizar_datos_dongle(db: Session, actor: Empleado, numero_dongle: str, serial_number: str | None = None,
                            version_exocad: str | None = None, modulos: str | None = None) -> ActivosDongle:
    if serial_number is None and version_exocad is None and modulos is None:
        raise ValueError("Indica al menos un dato para actualizar.")
    d = _dongle(db, numero_dongle)
    if serial_number is not None:
        serial = _obligatorio(serial_number, "El serial no puede quedar vacío.")
        if db.query(ActivosDongle.id_dongle).filter(ActivosDongle.serial_number == serial, ActivosDongle.id_dongle != d.id_dongle).first():
            raise Conflicto(f"El serial {serial} ya pertenece a otro dongle.")
        d.serial_number = serial
    if version_exocad is not None:
        d.version_exocad_compatible = _texto(version_exocad) or "N/A"
    if modulos is not None:
        d.modulos = _texto(modulos)
    auditar(db, actor, "Edición de dongle", f"Se editó el dongle {numero_dongle}.")
    db.commit()
    return d


def asignar_dongle(db: Session, actor: Empleado, numero_dongle: str, asset_tag: str | None, motivo: str) -> ActivosDongle:
    numero = _obligatorio(numero_dongle, "El número de dongle es obligatorio.")
    motivo = _obligatorio(motivo, "El motivo es obligatorio.")
    d = _dongle(db, numero)
    if asset_tag is not None:
        _equipo_activo(db, asset_tag)
    if d.asset_tag_asignado == asset_tag:
        raise ValueError("El dongle ya se encuentra en esa situación.")
    _mover_dongle(db, d.id_dongle, asset_tag, motivo)
    auditar(db, actor, "Asignación de dongle", f"Dongle {numero} -> {asset_tag or 'libre'}. {motivo}")
    db.commit()
    db.refresh(d)
    return d


def consultar_uso_dongle(db: Session, numero_dongle: str) -> dict:
    d = _dongle(db, numero_dongle)
    filas = db.query(ActivosHistorialAsignacion).filter(
        ActivosHistorialAsignacion.tipo_activo == "DONGLE", ActivosHistorialAsignacion.id_dongle == d.id_dongle
    ).order_by(ActivosHistorialAsignacion.fecha_inicio.desc()).all()
    historial = []
    equipos_vistos = set()
    for f in filas:
        usuario = None
        if f.asset_tag:
            equipos_vistos.add(f.asset_tag)
            fila_eq = db.query(ActivosHistorialAsignacion, Empleado).join(
                Empleado, Empleado.id == ActivosHistorialAsignacion.empleado_id
            ).filter(ActivosHistorialAsignacion.tipo_activo == "EQUIPO", ActivosHistorialAsignacion.asset_tag == f.asset_tag,
                    ActivosHistorialAsignacion.fecha_inicio <= (f.fecha_fin or datetime.utcnow()),
                    or_(ActivosHistorialAsignacion.fecha_fin.is_(None), ActivosHistorialAsignacion.fecha_fin >= f.fecha_inicio)
                    ).order_by(ActivosHistorialAsignacion.fecha_inicio.desc()).first()
            usuario = fila_eq[1].nombre_completo if fila_eq else None
        historial.append({"asset_tag": f.asset_tag, "fecha_inicio": f.fecha_inicio, "fecha_fin": f.fecha_fin,
                          "motivo": f.motivo, "usuario": usuario or "Sin usuario registrado"})
    return {"numero_dongle": numero, "cantidad_equipos": len(equipos_vistos), "historial": historial}
