"""Recordatorio único de firmas pendientes (Producción y Caja menor Nuvia).

Cada 2 horas, en horario laboral (lunes a viernes de 7 a. m. a 5 p. m.), cada persona recibe por Cliq UN solo mensaje con todo lo que tiene pendiente
por firmar: recibidos y firmas de DIR Producción en Cambio de custodia, segundo conteo y firmas del Conteo
inventario mensual, y recibos, FM y recibidos de Caja menor. Reemplaza los recordatorios sueltos por documento
(el aviso inmediato al crear cada documento se mantiene). Si se corren varios procesos de la intranet, la tabla
recordatorio_firmas evita mandar el mensaje dos veces."""
import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import Integer, DateTime, ForeignKey, update
from sqlalchemy.orm import Mapped, mapped_column, Session
from ..database import Base, SessionLocal, engine
from ..models import Empleado
from ..formato import nombre_propio

router = APIRouter()

HORAS_ENTRE_RECORDATORIOS = 2
HORARIO = (7, 17)          # se envía de 7:00 a. m. a 5:00 p. m. (hora Colombia)
DIAS_LABORALES = range(0, 5)  # lunes a viernes
MAX_POR_SECCION = 12


class RecordatorioFirmas(Base):
    """Último recordatorio consolidado enviado a cada persona."""
    __tablename__ = "recordatorio_firmas"

    empleado_id: Mapped[int] = mapped_column(ForeignKey("empleados.id"), primary_key=True)
    enviado_en: Mapped[datetime] = mapped_column(DateTime)
    cantidad: Mapped[int] = mapped_column(Integer, default=0)


def _ahora_colombia() -> datetime:
    return datetime.utcnow() - timedelta(hours=5)


def en_horario(momento: datetime | None = None) -> bool:
    m = momento or _ahora_colombia()
    return m.weekday() in DIAS_LABORALES and HORARIO[0] <= m.hour < HORARIO[1]


def _pesos(v: float) -> str:
    return "$ " + f"{v:,.0f}".replace(",", ".")


# ---------------- Lo pendiente de cada persona ----------------

def _custodia(db: Session) -> dict[int, list[str]]:
    from ..models_custodia import CustodiaTraslado  # noqa: F401
    from .. import services_custodia as sc
    from ..acceso_produccion import tiene_submodulo, EMPRESA_PRODUCCION
    pendientes = sc.pendientes_entrada(db)
    if not pendientes:
        return {}
    salida: dict[int, list[str]] = {}
    personas = [e for e in db.query(Empleado).filter(Empleado.activo == 1, Empleado.area_custodia != "") if e.areas_custodia]
    for e in personas:
        if e.empresa != EMPRESA_PRODUCCION or not tiene_submodulo(db, e, "custodia"):
            continue
        for t in pendientes:
            total = sum(o.cantidad_discos or 0 for o in t.ordenes)
            desc = f"Traslado #{t.id:04d} · {nombre_propio(t.area_salida)} → {nombre_propio(t.area_entrada)} · {total:g} disco{'' if total == 1 else 's'}"
            if not t.confirmado_entrada and e.tiene_area(t.area_entrada):
                salida.setdefault(e.id, []).append(f"{desc} — firmar recibido")
            elif t.pendiente_dir and sc.AREA_ORIGEN in e.areas_custodia:
                salida.setdefault(e.id, []).append(f"{desc} — firma DIR Producción")
    return salida


def _conteo(db: Session) -> dict[int, list[str]]:
    from ..models_conteo import ConteoReporte
    from .. import services_conteo as sct
    salida: dict[int, list[str]] = {}
    for r in db.query(ConteoReporte).filter(ConteoReporte.estado == sct.ENVIADO):
        desc = f"{nombre_propio(r.area)} · {sct.MESES[r.mes - 1]} {r.anio}"
        falta_seg = "" if sct.tiene_segundo(r) else "segundo conteo y "
        if r.manager_firma_id and not r.manager_firmado_en:
            salida.setdefault(r.manager_firma_id, []).append(f"{desc} — {falta_seg}firma del Director de Producción")
        if not r.testigo_firmado_en:
            for t in sct.testigos_posibles(db, r):
                salida.setdefault(t.id, []).append(f"{desc} — {falta_seg}firma del área contable")
    return salida


def _caja(db: Session) -> dict[int, list[str]]:
    from ..models_caja import CajaRecibo, CajaFM
    salida: dict[int, list[str]] = {}
    for r in db.query(CajaRecibo).filter(CajaRecibo.autorizado_por_id.isnot(None), CajaRecibo.firmado_en.is_(None),
                                         CajaRecibo.estado != "ANULADO"):
        salida.setdefault(r.autorizado_por_id, []).append(
            f"Recibo {r.caja.prefijo}-{r.consecutivo:04d} · {_pesos(r.valor)} · {nombre_propio(r.pagado_a)} — autorizar")
    for r in db.query(CajaRecibo).filter(CajaRecibo.recibido_por_id.isnot(None), CajaRecibo.recibido_en.is_(None),
                                         CajaRecibo.estado != "ANULADO"):
        salida.setdefault(r.recibido_por_id, []).append(
            f"Recibo {r.caja.prefijo}-{r.consecutivo:04d} · {_pesos(r.valor)} — firmar que recibiste el dinero")
    for f in db.query(CajaFM).filter(CajaFM.estado == "VIGENTE"):
        caja = nombre_propio(f.caja.nombre) if f.caja else ""
        if f.elaborado_por_id and not f.elaborado_en:
            salida.setdefault(f.elaborado_por_id, []).append(f"FM{f.numero} · Caja {caja} · {_pesos(f.total_pagos)} — firmar elaborado")
        elif f.supervisado_por_id and not f.supervisado_en:
            salida.setdefault(f.supervisado_por_id, []).append(f"FM{f.numero} · Caja {caja} · {_pesos(f.total_pagos)} — visto bueno")
    return salida


def _consumo(db: Session) -> dict[int, list[str]]:
    """Solicitudes de anulación de registros de jornada: las resuelve el manager del área."""
    from ..models_consumo import ConsumoJornada
    from .. import services_consumo as scc
    salida: dict[int, list[str]] = {}
    for r in db.query(ConsumoJornada).filter(ConsumoJornada.estado == "SOLICITADA"):
        if r.frasco.entrega.prueba:
            continue
        tecnico = scc._tecnico_de(r)
        desc = (f"{nombre_propio(tecnico.empleado.nombre_completo) if tecnico.empleado else ''} · {r.frasco.materia.descripcion} "
                f"· {r.fecha.isoformat()} — aprobar o rechazar anulación")
        for m in scc.managers_del_area(db, tecnico.area):
            salida.setdefault(m.id, []).append(desc)
    # Solicitudes para abrir un día anterior
    from ..models_consumo import ConsumoApertura
    for a in db.query(ConsumoApertura).filter(ConsumoApertura.estado == "SOLICITADA", ConsumoApertura.prueba == 0):
        if not a.tecnico or not a.tecnico.empleado:
            continue
        for m in scc.managers_del_area(db, a.tecnico.area):
            salida.setdefault(m.id, []).append(f"{nombre_propio(a.tecnico.empleado.nombre_completo)} · abrir el día {a.fecha.isoformat()}")
    # Jornada del día sin registrar (desde las 3:00 p. m.): aviso al técnico y a su manager
    if _ahora_colombia().hour >= scc.HORA_AVISO_JORNADA:
        from ..models_consumo import ConsumoTecnico
        for tid, n in scc.sin_jornada_hoy(db).items():
            t = db.get(ConsumoTecnico, tid)
            if not t or not t.empleado:
                continue
            salida.setdefault(t.empleado_id, []).append(f"No has registrado la jornada de hoy ({n} frasco{'s' if n != 1 else ''} en uso)")
            for m in scc.managers_del_area(db, t.area):
                salida.setdefault(m.id, []).append(f"{nombre_propio(t.empleado.nombre_completo)} no ha registrado la jornada de hoy")
    return salida


def pendientes_por_persona(db: Session) -> dict[int, list[tuple[str, list[str], str]]]:
    """{empleado_id: [(módulo, [pendientes], enlace)]} de quienes tienen algo por firmar."""
    from .. import config
    base = config.BASE_URL
    secciones = (("🏭 Cambio de custodia", _custodia, f"{base}/custodia?tab=aprobaciones"),
                 ("📋 Conteo inventario mensual", _conteo, f"{base}/conteo?tab=validacion"),
                 ("💵 Caja menor Nuvia", _caja, f"{base}/caja-menor/firmas"),
                 ("📊 Seguimiento de consumo", _consumo, f"{base}/consumo?tab=jornada"))
    salida: dict[int, list] = {}
    for titulo, funcion, url in secciones:
        try:
            por_persona = funcion(db)
        except Exception as ex:  # un módulo con error no impide avisar lo de los demás
            print(f"[Recordatorio firmas] Error leyendo pendientes de {titulo}: {ex}")
            continue
        for eid, items in por_persona.items():
            if items:
                salida.setdefault(eid, []).append((titulo, list(dict.fromkeys(items)), url))
    return salida


def texto_recordatorio(nombre: str, secciones: list[tuple[str, list[str], str]]) -> str:
    total = sum(len(items) for _, items, _ in secciones)
    lineas = [f"🔔 *Recordatorio de firmas pendientes* · {nombre}",
              f"Tienes *{total}* documento{'s' if total != 1 else ''} por firmar:"]
    for titulo, items, url in secciones:
        lineas.append("")
        lineas.append(f"*{titulo}* ({len(items)})")
        lineas += [f"• {x}" for x in items[:MAX_POR_SECCION]]
        if len(items) > MAX_POR_SECCION:
            lineas.append(f"• … y {len(items) - MAX_POR_SECCION} más")
        lineas.append(f"Firmar aquí: {url}")
    lineas.append("")
    lineas.append(f"_Te lo recordamos cada {HORAS_ENTRE_RECORDATORIOS} horas mientras tengas firmas pendientes._")
    return "\n".join(lineas)


def _reservar_envio(db: Session, empleado_id: int, cantidad: int) -> bool:
    """Marca el envío solo si pasaron 2 horas desde el último (seguro aunque corran varios procesos)."""
    ahora = datetime.utcnow()
    limite = ahora - timedelta(hours=HORAS_ENTRE_RECORDATORIOS) + timedelta(minutes=5)
    fila = db.get(RecordatorioFirmas, empleado_id)
    if fila is None:
        try:
            db.add(RecordatorioFirmas(empleado_id=empleado_id, enviado_en=ahora, cantidad=cantidad))
            db.commit()
            return True
        except Exception:  # otro proceso lo acaba de crear
            db.rollback()
            return False
    res = db.execute(update(RecordatorioFirmas)
                     .where(RecordatorioFirmas.empleado_id == empleado_id, RecordatorioFirmas.enviado_en <= limite)
                     .values(enviado_en=ahora, cantidad=cantidad))
    db.commit()
    return res.rowcount == 1


def enviar_recordatorios(forzar_horario: bool = False) -> int:
    """Un mensaje por persona con todo lo pendiente. Devuelve a cuántas personas se les envió."""
    if not forzar_horario and not en_horario():
        return 0
    from ..zoho_cliq import enviar_cliq_varios, boton_enlace
    db = SessionLocal()
    enviados = 0
    try:
        for eid, secciones in pendientes_por_persona(db).items():
            e = db.get(Empleado, eid)
            if not e or not e.activo or not e.email:
                continue
            total = sum(len(items) for _, items, _ in secciones)
            if not _reservar_envio(db, eid, total):
                continue
            botones = [boton_enlace("✍️ " + t.split(" ", 1)[1][:17], url) for t, _, url in secciones][:3]
            if enviar_cliq_varios([e.email], texto_recordatorio(nombre_propio(e.nombres or e.nombre_completo), secciones), botones):
                enviados += 1
    finally:
        db.close()
    return enviados


@router.on_event("startup")
async def iniciar() -> None:
    try:
        RecordatorioFirmas.__table__.create(bind=engine, checkfirst=True)
    except Exception as e:  # otro proceso la acaba de crear
        print(f"Recordatorio firmas: tabla ({type(e).__name__}).")

    async def ciclo():
        while True:
            await asyncio.sleep(600)  # revisa cada 10 minutos; a cada persona le llega como máximo cada 2 horas
            try:
                n = await run_in_threadpool(enviar_recordatorios)
                if n:
                    print(f"Recordatorio firmas: enviado a {n} persona(s).")
            except Exception as e:  # un fallo nunca debe detener la intranet
                print(f"Recordatorio firmas: error: {e}")
    asyncio.create_task(ciclo())
