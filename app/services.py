"""Lógica de negocio: flujo de aprobaciones, saldos, notificaciones y auditoría."""
from datetime import datetime, date, time
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from . import config
from .models import Empleado, Solicitud, Aprobacion, TipoPermiso, Auditoria, Configuracion, HoraExtra
from .zoho_mail import enviar_correo
from .tokens import generar_token

HORAS_SEMANA = 42  # jornada laboral legal usada para prorratear solicitudes por horas


def auditar(db: Session, actor: str, accion: str, detalle: str = "", solicitud_id: int | None = None,
           empleado_id: int | None = None):
    db.add(Auditoria(actor=actor, accion=accion, detalle=detalle, solicitud_id=solicitud_id,
                     empleado_id=empleado_id))


def config_actual(db: Session) -> Configuracion:
    cfg = db.query(Configuracion).first()
    if not cfg:
        cfg = Configuracion(sabado_habil=0)
        db.add(cfg)
        db.flush()
    return cfg


def horas_por_dia(db: Session) -> float:
    sabado_cuenta = bool(config_actual(db).sabado_habil)
    return HORAS_SEMANA / (6 if sabado_cuenta else 5)


def dias_habiles(db: Session, inicio: date, fin: date) -> float:
    """Cuenta días hábiles entre dos fechas (inclusive): lunes-viernes siempre,
    sábado solo si está habilitado en Configuración (por defecto no lo es)."""
    from datetime import timedelta
    sabado_cuenta = bool(config_actual(db).sabado_habil)
    d, total = inicio, 0
    while d <= fin:
        if d.weekday() < 5 or (sabado_cuenta and d.weekday() == 5):
            total += 1
        d += timedelta(days=1)
    return float(total)


def dias_usados(db: Session, empleado_id: int, tipo_id: int, anio: int) -> float:
    total = (
        db.query(func.coalesce(func.sum(Solicitud.dias), 0.0))
        .filter(
            Solicitud.empleado_id == empleado_id,
            Solicitud.tipo_id == tipo_id,
            Solicitud.estado.in_(["aprobada", "pendiente_1", "pendiente_2"]),
            Solicitud.fecha_inicio >= date(anio, 1, 1),
            Solicitud.fecha_inicio <= date(anio, 12, 31),
        )
        .scalar()
    )
    return float(total or 0)


def dias_reservados_vacaciones(db: Session, empleado_id: int, tipo_id: int) -> float:
    """Días de vacaciones ya comprometidos en solicitudes pendientes (aún no aprobadas)."""
    total = (
        db.query(func.coalesce(func.sum(Solicitud.dias), 0.0))
        .filter(
            Solicitud.empleado_id == empleado_id,
            Solicitud.tipo_id == tipo_id,
            Solicitud.estado.in_(["pendiente_1", "pendiente_2"]),
        )
        .scalar()
    )
    return float(total or 0)


def saldo_disponible(db: Session, empleado: Empleado, tipo: TipoPermiso, anio: int) -> float | None:
    if tipo.es_vacaciones:
        return empleado.dias_vacaciones - dias_reservados_vacaciones(db, empleado.id, tipo.id)
    if tipo.dias_anuales is None:
        return None  # sin límite
    return tipo.dias_anuales - dias_usados(db, empleado.id, tipo.id, anio)


def pendientes_de(db: Session, empleado: Empleado) -> list[Aprobacion]:
    """Aprobaciones de permisos que están activas en el nivel que le corresponde al empleado."""
    aps = (db.query(Aprobacion).join(Solicitud)
           .filter(Aprobacion.aprobador_id == empleado.id, Aprobacion.decision == "pendiente",
                   Solicitud.estado.in_(["pendiente_1", "pendiente_2"]))
           .order_by(Solicitud.creada_en).all())
    return [a for a in aps
            if (a.solicitud.estado == "pendiente_1" and a.nivel == 1)
            or (a.solicitud.estado == "pendiente_2" and a.nivel == 2)]


# ---------- Flujo de solicitudes ----------

def crear_solicitud(db: Session, empleado: Empleado, tipo: TipoPermiso,
                    fecha_inicio: date, fecha_fin: date, motivo: str,
                    hora_inicio: time | None = None,
                    hora_fin: time | None = None) -> tuple[Solicitud | None, str | None]:
    """Crea la solicitud y sus aprobaciones. Devuelve (solicitud, error)."""
    if fecha_fin < fecha_inicio:
        return None, "La fecha fin no puede ser anterior a la fecha inicio."
    if not empleado.aprobador1_id:
        return None, "No tienes un aprobador asignado. Contacta al administrador."
    if empleado.num_aprobaciones >= 2 and not empleado.aprobador2_id:
        return None, "Tu cargo requiere 2 aprobaciones pero no tienes segundo aprobador asignado."

    dias = dias_habiles(db, fecha_inicio, fecha_fin)
    if dias <= 0:
        return None, "El rango seleccionado no contiene días hábiles."

    usa_horas = bool(fecha_inicio == fecha_fin and tipo.permite_horas and hora_inicio and hora_fin)
    if usa_horas:
        if hora_fin <= hora_inicio:
            return None, "La hora fin debe ser posterior a la hora inicio."
        horas = (datetime.combine(date.min, hora_fin) - datetime.combine(date.min, hora_inicio)).total_seconds() / 3600
        dias = round(horas / horas_por_dia(db), 2)
    else:
        hora_inicio = hora_fin = None  # no aplica: rango multi-día o el tipo no permite horas

    saldo = saldo_disponible(db, empleado, tipo, fecha_inicio.year)
    if saldo is not None and dias > saldo:
        return None, f"Saldo insuficiente para '{tipo.nombre}': disponibles {saldo:g} días, solicitas {dias:g}."

    sol = Solicitud(empleado_id=empleado.id, tipo_id=tipo.id, fecha_inicio=fecha_inicio,
                    fecha_fin=fecha_fin, dias=dias, motivo=motivo.strip(), estado="pendiente_1",
                    hora_inicio=hora_inicio, hora_fin=hora_fin)
    db.add(sol)
    db.flush()
    db.add(Aprobacion(solicitud_id=sol.id, aprobador_id=empleado.aprobador1_id, nivel=1))
    if empleado.num_aprobaciones >= 2:
        db.add(Aprobacion(solicitud_id=sol.id, aprobador_id=empleado.aprobador2_id, nivel=2))
    auditar(db, empleado.email, "Solicitud creada",
            f"{tipo.nombre} {fecha_inicio} a {fecha_fin} ({dias:g} días)", sol.id, empleado_id=empleado.id)
    db.commit()
    db.refresh(sol)
    _notificar_aprobador(db, sol, nivel=1)
    return sol, None


def resolver_aprobacion(db: Session, aprobacion: Aprobacion, decision: str,
                        comentario: str = "", actor: str = "") -> str:
    """Aplica una decisión ('aprobada'/'rechazada'). Devuelve mensaje para el usuario."""
    sol = aprobacion.solicitud
    if aprobacion.decision != "pendiente":
        return "Esta aprobación ya fue resuelta anteriormente."
    nivel_activo = 1 if sol.estado == "pendiente_1" else 2 if sol.estado == "pendiente_2" else None
    if nivel_activo != aprobacion.nivel:
        return "Esta solicitud no está pendiente de tu aprobación en este momento."

    aprobacion.decision = decision
    aprobacion.comentario = comentario.strip()
    aprobacion.decidida_en = datetime.utcnow()

    if decision == "rechazada":
        sol.estado = "rechazada"
        auditar(db, actor, f"Rechazada (nivel {aprobacion.nivel})", comentario, sol.id,
                empleado_id=sol.empleado_id)
        db.commit()
        _notificar_empleado(sol, aprobado=False, comentario=comentario)
        return "Solicitud rechazada. Se notificó al empleado."

    # aprobada en este nivel
    total_niveles = len(sol.aprobaciones)
    if aprobacion.nivel < total_niveles:
        sol.estado = "pendiente_2"
        auditar(db, actor, "Aprobada nivel 1, pasa a nivel 2", comentario, sol.id,
                empleado_id=sol.empleado_id)
        db.commit()
        _notificar_aprobador(db, sol, nivel=2)
        return "Aprobación registrada. La solicitud pasó al segundo aprobador."
    else:
        sol.estado = "aprobada"
        if sol.tipo.es_vacaciones:
            sol.empleado.dias_vacaciones -= sol.dias
        auditar(db, actor, f"Aprobada (nivel {aprobacion.nivel}, final)", comentario, sol.id,
                empleado_id=sol.empleado_id)
        db.commit()
        _notificar_empleado(sol, aprobado=True, comentario=comentario)
        return "Solicitud aprobada. Se notificó al empleado."


# ---------- Notificaciones ----------

def notificar_empleado_creado(emp: Empleado):
    """Correo de bienvenida cuando se crea un empleado nuevo (alta manual o import de Excel)."""
    html = f"""
    <h2 style="font-family:sans-serif">¡Bienvenido a Solicitudes Nuvia, {emp.nombres}!</h2>
    <p style="font-family:sans-serif">Ya quedaste registrado en la plataforma de solicitudes de Nuvia.
    Ingresa con tu correo corporativo ({emp.email}):</p>
    <p style="font-family:sans-serif">{_btn(f'{config.BASE_URL}/login', 'Ingresar a la plataforma', '#2563eb')}</p>
    <p style="font-family:sans-serif;color:#666;font-size:12px">
      Si tienes dudas, contacta a Recursos Humanos.
    </p>"""
    enviar_correo(emp.email, "Bienvenido a Solicitudes Nuvia", html)


def _btn(url: str, texto: str, color: str) -> str:
    return (f'<a href="{url}" style="display:inline-block;padding:10px 22px;margin:4px;'
            f'background:{color};color:#fff;text-decoration:none;border-radius:6px;'
            f'font-family:sans-serif">{texto}</a>')


def _resumen_html(sol: Solicitud) -> str:
    e = sol.empleado
    if sol.hora_inicio and sol.hora_fin:
        fechas = (f"{sol.fecha_inicio}, {sol.hora_inicio.strftime('%H:%M')} a "
                 f"{sol.hora_fin.strftime('%H:%M')} ({sol.dias:g} días)")
    else:
        fechas = f"{sol.fecha_inicio} al {sol.fecha_fin} ({sol.dias:g} días hábiles)"
    return f"""
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px;color:#666">Empleado</td><td style="padding:4px 12px"><b>{e.nombre_completo}</b> ({e.cargo}, {e.area})</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Empresa</td><td style="padding:4px 12px">{e.empresa}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Tipo</td><td style="padding:4px 12px">{sol.tipo.nombre}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Fechas</td><td style="padding:4px 12px">{fechas}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Motivo</td><td style="padding:4px 12px">{sol.motivo or '—'}</td></tr>
    </table>"""


def _notificar_aprobador(db: Session, sol: Solicitud, nivel: int):
    apr = next((a for a in sol.aprobaciones if a.nivel == nivel), None)
    if not apr:
        return
    url_ok = f"{config.BASE_URL}/aprobar-email/{generar_token(apr.id, 'aprobada')}"
    url_no = f"{config.BASE_URL}/aprobar-email/{generar_token(apr.id, 'rechazada')}"
    html = f"""
    <h2 style="font-family:sans-serif">Solicitud de permiso pendiente (nivel {nivel})</h2>
    {_resumen_html(sol)}
    <p style="font-family:sans-serif">
      {_btn(url_ok, '✔ Aprobar', '#16a34a')} {_btn(url_no, '✘ Rechazar', '#dc2626')}
    </p>
    <p style="font-family:sans-serif;color:#666;font-size:12px">
      También puedes gestionarla en la plataforma: <a href="{config.BASE_URL}/aprobaciones">{config.BASE_URL}/aprobaciones</a>
    </p>"""
    enviar_correo(apr.aprobador.email,
                  f"[Permisos] Solicitud #{sol.id} de {sol.empleado.nombre_completo} pendiente de tu aprobación",
                  html)


def _notificar_empleado(sol: Solicitud, aprobado: bool, comentario: str = ""):
    estado = "APROBADA ✔" if aprobado else "RECHAZADA ✘"
    color = "#16a34a" if aprobado else "#dc2626"
    html = f"""
    <h2 style="font-family:sans-serif">Tu solicitud de permiso fue <span style="color:{color}">{estado}</span></h2>
    {_resumen_html(sol)}
    {f'<p style="font-family:sans-serif"><b>Comentario:</b> {comentario}</p>' if comentario else ''}
    <p style="font-family:sans-serif;color:#666;font-size:12px">
      Detalle: <a href="{config.BASE_URL}/solicitudes">{config.BASE_URL}/solicitudes</a>
    </p>"""
    enviar_correo(sol.empleado.email, f"[Permisos] Solicitud #{sol.id}: {estado}", html)


# ---------- Horas extra ----------

def empleados_a_cargo(db: Session, aprobador: Empleado) -> list[Empleado]:
    """Empleados que tienen a `aprobador` como aprobador1 o aprobador2."""
    return (db.query(Empleado)
            .filter(or_(Empleado.aprobador1_id == aprobador.id, Empleado.aprobador2_id == aprobador.id),
                    Empleado.activo == 1)
            .order_by(Empleado.apellidos).all())


def crear_horas_extra(db: Session, solicitante: Empleado, empleado: Empleado,
                      fecha: date, horas: float, motivo: str) -> tuple[HoraExtra | None, str | None]:
    es_admin = solicitante.rol == "admin"
    if not es_admin and empleado.id not in [e.id for e in empleados_a_cargo(db, solicitante)]:
        return None, "No tienes a ese empleado asignado como aprobador."
    if horas <= 0:
        return None, "Las horas deben ser mayores a 0."

    he = HoraExtra(empleado_id=empleado.id, solicitante_id=solicitante.id,
                   fecha=fecha, horas=horas, motivo=motivo.strip())
    if es_admin:
        # Los admins registran horas extra directamente, sin necesitar aprobación de nadie.
        he.estado = "aprobada"
        he.decidida_por_id = solicitante.id
        he.decidida_en = datetime.utcnow()
    db.add(he)
    auditar(db, solicitante.email,
            "Horas extra registradas (auto-aprobadas)" if es_admin else "Horas extra solicitadas",
            f"{empleado.nombre_completo}: {fecha} ({horas:g}h)", empleado_id=empleado.id)
    db.commit()
    db.refresh(he)
    if es_admin:
        _notificar_resultado_horas_extra(he)
    else:
        _notificar_admins_horas_extra(db, he)
    return he, None


def resolver_horas_extra(db: Session, he: HoraExtra, decision: str, comentario: str, admin: Empleado) -> str:
    if he.estado != "pendiente":
        return "Esta solicitud ya fue resuelta anteriormente."
    he.estado = decision
    he.comentario = comentario.strip()
    he.decidida_en = datetime.utcnow()
    he.decidida_por_id = admin.id
    auditar(db, admin.email, f"Horas extra {he.estado}", comentario, empleado_id=he.empleado_id)
    db.commit()
    _notificar_resultado_horas_extra(he)
    return f"Solicitud de horas extra {he.estado_texto.lower()}."


def _notificar_admins_horas_extra(db: Session, he: HoraExtra):
    admins = db.query(Empleado).filter(Empleado.rol == "admin", Empleado.activo == 1).all()
    html = f"""
    <h2 style="font-family:sans-serif">Solicitud de horas extra pendiente</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px;color:#666">Empleado</td><td style="padding:4px 12px"><b>{he.empleado.nombre_completo}</b></td></tr>
      <tr><td style="padding:4px 12px;color:#666">Solicitada por</td><td style="padding:4px 12px">{he.solicitante.nombre_completo}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Fecha</td><td style="padding:4px 12px">{he.fecha}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Horas</td><td style="padding:4px 12px">{he.horas:g}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Motivo</td><td style="padding:4px 12px">{he.motivo or '—'}</td></tr>
    </table>
    <p style="font-family:sans-serif;color:#666;font-size:12px">
      Gestiónala en: <a href="{config.BASE_URL}/horas-extra">{config.BASE_URL}/horas-extra</a>
    </p>"""
    for admin in admins:
        enviar_correo(admin.email,
                      f"[Permisos] Horas extra pendientes: {he.empleado.nombre_completo}", html)


def _notificar_resultado_horas_extra(he: HoraExtra):
    estado = "APROBADA ✔" if he.estado == "aprobada" else "RECHAZADA ✘"
    color = "#16a34a" if he.estado == "aprobada" else "#dc2626"
    html = f"""
    <h2 style="font-family:sans-serif">Solicitud de horas extra <span style="color:{color}">{estado}</span></h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px;color:#666">Empleado</td><td style="padding:4px 12px"><b>{he.empleado.nombre_completo}</b></td></tr>
      <tr><td style="padding:4px 12px;color:#666">Fecha</td><td style="padding:4px 12px">{he.fecha}</td></tr>
      <tr><td style="padding:4px 12px;color:#666">Horas</td><td style="padding:4px 12px">{he.horas:g}</td></tr>
    </table>
    {f'<p style="font-family:sans-serif"><b>Comentario:</b> {he.comentario}</p>' if he.comentario else ''}"""
    enviar_correo(he.solicitante.email, f"[Permisos] Horas extra: {estado}", html)
    enviar_correo(he.empleado.email, f"[Permisos] Horas extra: {estado}", html)
