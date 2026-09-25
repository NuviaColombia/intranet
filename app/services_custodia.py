"""Lógica de negocio del módulo Custodia: traslados entre áreas de producción."""
from datetime import datetime, date, time, timedelta
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_, literal, union_all, select, cast, String
from .models import Empleado
from .models_custodia import (CustodiaTraslado, CustodiaOrdenLinea, CustodiaResumen, CustodiaDiscos, CustodiaOP,
                              CustodiaFactorDisco, CustodiaArea, CustodiaMotivo)
from .formato import nombre_propio

# Legado: valores de prueba/migración que nunca fueron áreas de producción reales,
# no administrables desde Parámetros (a diferencia de CustodiaArea.es_inventario).
AREAS_EXCLUIDAS_LEGADO = {"INICIAL", "SALDO INICIAL"}

# Punto de origen del proceso: aquí entra material nuevo a producción (no se "recibe" de
# otra área), así que nunca requiere confirmación previa para poder entregar desde ahí.
AREA_ORIGEN = "DIR PRODUCCIÓN"


def areas_disponibles(db: Session) -> list[str]:
    """Áreas activas configuradas en Parámetros, más cualquier área "extra" que aparezca
    en el histórico pero no esté registrada (compatibilidad hacia atrás)."""
    activas = [a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1)
               .order_by(CustodiaArea.orden).all()]
    conocidas = set(activas)
    extra = set()
    for (a,) in db.query(CustodiaTraslado.area_salida).distinct():
        if a and a not in conocidas:
            extra.add(a)
    for (a,) in db.query(CustodiaTraslado.area_entrada).distinct():
        if a and a not in conocidas:
            extra.add(a)
    return activas + sorted(extra)


def areas_excluidas(db: Session) -> set[str]:
    """Áreas que no cuentan como ubicación de inventario (se excluyen de "ubicación
    actual" y la matriz): legado de datos migrados + lo que Parámetros marque como tal."""
    no_inventario = {a.nombre for a in db.query(CustodiaArea).filter(CustodiaArea.es_inventario == 0).all()}
    return AREAS_EXCLUIDAS_LEGADO | no_inventario


def motivos_disponibles(db: Session) -> list[str]:
    return [m.nombre for m in db.query(CustodiaMotivo).filter(CustodiaMotivo.activo == 1)
            .order_by(CustodiaMotivo.orden).all()]


def alertas_por_area(db: Session) -> dict[str, dict]:
    """Umbrales de horas (advertencia/crítica) por área, para colorear "tiempo en área"
    en Ubicación actual -- configurables en Parámetros en vez de fijos (24h/48h)."""
    return {a.nombre: {"advertencia": a.alerta_horas_advertencia, "critica": a.alerta_horas_critica}
            for a in db.query(CustodiaArea).filter(CustodiaArea.activo == 1).all()}


def ordenes_incompletas(db: Session) -> list[dict]:
    """Órdenes con saldo positivo en alguna área ahora mismo (aún no llegan a un
    estado terminal) -- para el selector de "Número de Orden" al continuar un traslado."""
    return estado_ordenes(db, None)["data"]


def verificar_orden_existente(db: Session, numero_orden_raw: str) -> bool:
    ordenes_buscadas = [o.strip().upper() for o in numero_orden_raw.split("-") if o.strip()]
    if not ordenes_buscadas:
        return False
    existe = (db.query(CustodiaOrdenLinea)
              .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
              .filter(CustodiaOrdenLinea.numero_orden.in_(ordenes_buscadas), CustodiaTraslado.anulado.is_(False))
              .first())
    return existe is not None


def _saldo_confirmado(db: Session, orden: str, area: str) -> float:
    """Cuánta cantidad de esta orden está actualmente CONFIRMADA (entrada ya confirmada)
    en el área dada -- a diferencia de estado_ordenes(), que cuenta lo registrado aunque
    la entrada no se haya confirmado todavía."""
    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
         .filter(CustodiaOrdenLinea.numero_orden == orden, CustodiaTraslado.anulado.is_(False)))
    saldo = 0.0
    for linea, traslado in q.all():
        if traslado.area_entrada == area and traslado.confirmado_entrada:
            saldo += linea.cantidad_discos
        if traslado.area_salida == area:
            saldo -= linea.cantidad_discos
    return saldo


def validar_lineas_traslado(db: Session, lineas: list[dict], resumen: list[dict], area_salida: str) -> str | None:
    """Reglas de negocio antes de crear un traslado:
    - la cantidad movida por línea no puede superar el TOTAL conocido de la orden.
    - no se puede sacar una orden de un área si no se confirmó antes su entrada ahí,
      salvo que sea el primer movimiento de esa orden (recién creada, nada que recibir antes)
      o que el área de salida sea AREA_ORIGEN (ahí entra material nuevo, no se recibe de
      otra área, así que siempre se puede "entregar" -- incluso en lotes posteriores de
      una orden que ya existe)."""
    for linea in lineas:
        orden = linea["numero_orden"]
        cantidad = linea["cantidad_discos"]

        total_existente = (db.query(func.coalesce(func.sum(CustodiaResumen.total), 0.0))
                           .join(CustodiaTraslado, CustodiaResumen.traslado_id == CustodiaTraslado.id)
                           .filter(CustodiaResumen.orden == orden, CustodiaTraslado.anulado.is_(False))
                           .scalar()) or 0.0
        total_en_este_envio = sum(r.get("total") or 0 for r in resumen if r.get("orden") == orden)
        total_efectivo = total_existente + total_en_este_envio
        if total_efectivo > 0 and cantidad > total_efectivo + 1e-6:
            return (f"La cantidad de discos ({cantidad}) para la orden {orden} supera el TOTAL "
                    f"registrado de esa orden ({round(total_efectivo, 3)}).")

        existe_previo = (db.query(CustodiaOrdenLinea)
                         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
                         .filter(CustodiaOrdenLinea.numero_orden == orden, CustodiaTraslado.anulado.is_(False))
                         .first())
        if existe_previo and area_salida != AREA_ORIGEN:
            saldo = _saldo_confirmado(db, orden, area_salida)
            if saldo + 1e-6 < cantidad:
                return (f"No puedes entregar la orden {orden} desde {area_salida}: aún no se ha "
                        f"confirmado la entrada de esa orden en esa área.")
    return None


def crear_traslado(db: Session, user: Empleado, cabecera: dict, lineas: list[dict],
                   resumen: list[dict], discos: list[dict], op: list[dict]) -> CustodiaTraslado:
    traslado = CustodiaTraslado(
        colaborador=cabecera["colaborador"], id_colaborador=cabecera.get("id_colaborador", ""),
        area_creacion=cabecera["area_creacion"], fecha=cabecera["fecha"], hora=cabecera["hora"],
        usuario=cabecera.get("usuario", ""), area_salida=cabecera["area_salida"],
        area_entrada=cabecera["area_entrada"], motivo=cabecera["motivo"], creado_por_id=user.id,
    )
    db.add(traslado)
    db.flush()

    for linea in lineas:
        db.add(CustodiaOrdenLinea(traslado_id=traslado.id, numero_orden=linea["numero_orden"],
                                  cantidad_discos=linea["cantidad_discos"]))
    for r in resumen:
        db.add(CustodiaResumen(traslado_id=traslado.id, orden=r.get("orden", ""),
                               descripcion=r.get("descripcion", ""), paciente=r.get("paciente", ""),
                               total=r.get("total") or 0,
                               verificado_salida=bool(r.get("verifSalida")),
                               verificado_entrada=bool(r.get("verifEntrada"))))
    for d in discos:
        db.add(CustodiaDiscos(traslado_id=traslado.id, detalle_protesis=d.get("detalle", ""),
                              cant_paciente=d.get("cantPaciente") or 0, cant_discos=d.get("cantDiscos") or 0))
    for o in op:
        db.add(CustodiaOP(traslado_id=traslado.id, orden=o.get("orden", ""), op=o.get("op", ""),
                          descripcion=o.get("descripcion", ""), tipo=o.get("tipo", ""),
                          usuario=o.get("usuario", ""), observaciones=o.get("observaciones", "")))

    db.commit()
    db.refresh(traslado)
    return traslado


def puede_firmar_recibido(user: Empleado, traslado: CustodiaTraslado) -> bool:
    """Firma "recibido": un administrador, o un manager cuya área asignada en Parámetros sea el
    área de entrada del traslado (quien recibe el material)."""
    if user.rol in ("admin", "superadmin"):
        return True
    return bool(user.area_custodia) and user.area_custodia.strip().upper() == (traslado.area_entrada or "").strip().upper()


def confirmar_entrada(db: Session, traslado: CustodiaTraslado, user: Empleado) -> str | None:
    if traslado.anulado:
        return "Este traslado fue anulado."
    if traslado.confirmado_entrada:
        return "Este traslado ya fue confirmado."
    if not puede_firmar_recibido(user, traslado):
        return (f"Solo un manager del área {nombre_propio(traslado.area_entrada)} (o un administrador) "
                "puede firmar el recibido de este traslado.")
    traslado.confirmado_entrada = True
    traslado.confirmado_por_id = user.id
    traslado.confirmado_en = datetime.utcnow()
    db.commit()
    return None


def anular_traslado(db: Session, traslado: CustodiaTraslado, user: Empleado, motivo: str = "") -> str | None:
    if traslado.anulado:
        return "Este traslado ya estaba anulado."
    motivo = (motivo or "").strip()
    if len(motivo) < 5:
        return "Escribe el motivo de la anulación (mínimo 5 caracteres)."
    traslado.motivo_anulacion = motivo[:500]
    traslado.anulado = True
    traslado.anulado_por_id = user.id
    traslado.anulado_en = datetime.utcnow()
    db.commit()
    return None


def consultar(db: Session, tipo: str, area_salida: str = "", estado: str = "activos",
             fecha_inicio: date | None = None, fecha_fin: date | None = None) -> list[CustodiaTraslado]:
    q = db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
    if area_salida and area_salida != "TODAS":
        q = q.filter(CustodiaTraslado.area_salida == area_salida)
    if estado == "ACTIVOS":
        q = q.filter(CustodiaTraslado.anulado.is_(False))
    elif estado == "ANULADOS":
        q = q.filter(CustodiaTraslado.anulado.is_(True))
    if tipo == "rango" and fecha_inicio and fecha_fin:
        q = q.filter(CustodiaTraslado.fecha >= fecha_inicio, CustodiaTraslado.fecha <= fecha_fin)
    q = q.order_by(CustodiaTraslado.id.desc())
    q = q.limit(30 if tipo != "rango" else LIMITE_CONSULTA_RANGO)
    return q.all()


# Tope de filas para "Rango fechas" en Consulta traslado (evita traer miles de filas de una vez).
LIMITE_CONSULTA_RANGO = 2000
# Tope de consecutivos por impresión en "Imprimir por rango".
LIMITE_TICKETS_RANGO = 300


def _nombre_firma(emp) -> str:
    """Primer nombre y primer apellido del empleado que firma (ej. 'Carlos Barreto')."""
    if not emp:
        return ""
    partes = [(emp.nombres or "").split()[:1], (emp.apellidos or "").split()[:1]]
    return nombre_propio(" ".join(p[0] for p in partes if p))


def serializar_traslado(t: CustodiaTraslado) -> dict:
    return {
        "id": t.id, "colaborador": t.colaborador, "idColaborador": t.id_colaborador,
        "areaCreacion": t.area_creacion, "ordenes": ", ".join(o.numero_orden for o in t.ordenes),
        "lineas": [{"numeroOrden": o.numero_orden, "cantidad": o.cantidad_discos} for o in t.ordenes],
        "cantidad": sum(o.cantidad_discos for o in t.ordenes), "fecha": t.fecha.isoformat(),
        "hora": t.hora.strftime("%H:%M") if t.hora else "", "usuario": t.usuario,
        "areaSalida": t.area_salida, "areaEntrada": t.area_entrada, "motivo": t.motivo,
        "estado": t.estado_texto, "anulado": t.anulado, "confirmadoEntrada": t.confirmado_entrada,
        # Firmas del documento: entrega = quien registró (área salida); recibe = quien confirmó (área entrada).
        "entregaEmail": t.creado_por.email if t.creado_por else "",
        "entregaNombre": _nombre_firma(t.creado_por),
        "recibeEmail": t.confirmado_por.email if (t.confirmado_entrada and t.confirmado_por) else "",
        "recibeNombre": _nombre_firma(t.confirmado_por) if t.confirmado_entrada else "",
        # Anulación: quién, cuándo y por qué
        "anuladoPor": nombre_propio(t.anulado_por.nombre_completo) if (t.anulado and t.anulado_por) else "",
        # anulado_en se guarda en UTC; Colombia es UTC-5 (sin horario de verano)
        "anuladoEn": (t.anulado_en - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if (t.anulado and t.anulado_en) else "",
        "motivoAnulacion": (t.motivo_anulacion or "") if t.anulado else "",
    }


def pendientes_entrada(db: Session) -> list[CustodiaTraslado]:
    return (db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
            .filter(CustodiaTraslado.anulado.is_(False), CustodiaTraslado.confirmado_entrada.is_(False))
            .order_by(CustodiaTraslado.id.desc()).all())


def _fecha_dt(f: date) -> datetime:
    return datetime.combine(f, datetime.min.time())


def estado_ordenes(db: Session, fecha_desde: date | None = None, fecha_hasta: date | None = None) -> dict:
    """Ubicación actual (neto > 0 por orden y área) y matriz Ent/Sal/Neto por orden.

    La base de datos suma los movimientos agrupados por (orden, área); Python solo arma la
    respuesta. Mismas reglas que antes: se excluyen áreas de legado/no inventario, y un traslado
    anulado sigue contando si fue anulado después de la fecha de corte (fecha_hasta)."""
    areas_base = areas_disponibles(db)
    areas_excl = areas_excluidas(db)
    T, L = CustodiaTraslado, CustodiaOrdenLinea

    vigente = T.anulado.is_(False)
    if fecha_hasta:
        vigente = or_(vigente, T.anulado_en >= datetime.combine(fecha_hasta + timedelta(days=1), time.min))
    filtros = [vigente]
    if fecha_desde:
        filtros.append(T.fecha >= fecha_desde)
    if fecha_hasta:
        filtros.append(T.fecha <= fecha_hasta)

    momento = cast(T.fecha, String) + literal(" ") + func.coalesce(cast(T.hora, String), literal("00:00"))
    cantidad = func.coalesce(L.cantidad_discos, 0.0)

    def movimientos(columna_area, es_entrada: bool):
        return (select(L.numero_orden.label("orden"), columna_area.label("area"),
                       (cantidad if es_entrada else literal(0.0)).label("ent"),
                       (literal(0.0) if es_entrada else cantidad).label("sal"),
                       momento.label("momento"))
                .join(T, L.traslado_id == T.id)
                .where(and_(*filtros), columna_area.isnot(None), columna_area != ""))

    mov = union_all(movimientos(T.area_entrada, True), movimientos(T.area_salida, False)).subquery()
    filas = db.execute(select(mov.c.orden, mov.c.area, func.sum(mov.c.ent), func.sum(mov.c.sal), func.max(mov.c.momento))
                       .group_by(mov.c.orden, mov.c.area)).all()

    resultado, matrix, areas_extra = [], {}, set()
    for orden, area, ent, sal, ultimo in filas:
        if area in areas_excl:
            continue
        ent, sal = float(ent or 0), float(sal or 0)
        neto = ent - sal
        ultimo = (ultimo or "")[:16]
        f_iso, h_iso = (ultimo[:10], ultimo[11:16] or "00:00") if ultimo else ("", "00:00")
        if round(neto, 3) > 0:
            resultado.append({"orden": orden, "ubicacion": area, "cantidad": round(neto, 3),
                              "fechaStr": f"{f_iso} {h_iso}", "fIso": f_iso, "hIso": h_iso})
        matrix.setdefault(orden, {})[area] = {"ent": ent, "sal": sal, "net": neto}
        if area not in areas_base:
            areas_extra.add(area)

    areas_matrix = areas_base + sorted(areas_extra)
    matrix_out = []
    for orden, por_area in matrix.items():
        fila = {"orden": orden, "TOTAL": round(sum(c["net"] for c in por_area.values()), 3)}
        for area in areas_matrix:
            c = por_area.get(area)
            fila[area] = ({"ent": round(c["ent"], 3), "sal": round(c["sal"], 3), "net": round(c["net"], 3)}
                          if c else {"ent": 0.0, "sal": 0.0, "net": 0.0})
        matrix_out.append(fila)

    return {"data": resultado, "matrix": matrix_out, "areasMatrix": areas_matrix}


AREA_FINAL = "EMPAQUE"  # ubicación que se considera "orden terminada"


def consultar_orden(db: Session, numero_orden: str, fecha_desde: date | None = None,
                    fecha_hasta: date | None = None) -> dict:
    """Para una orden puntual: su total esperado (según lo pegado en Resumen general al
    registrar, o la cantidad indicada al crearla -- no depende del rango de fechas), cuánto
    ya llegó a EMPAQUE (terminado) dentro del rango, y el resto (en proceso: lo que sigue
    circulando por producción o aún no se ha registrado)."""
    target = numero_orden.strip().upper()

    total_resumen = (db.query(func.coalesce(func.sum(CustodiaResumen.total), 0.0))
                     .join(CustodiaTraslado, CustodiaResumen.traslado_id == CustodiaTraslado.id)
                     .filter(CustodiaResumen.orden == target, CustodiaTraslado.anulado.is_(False))
                     .scalar()) or 0.0

    ubicaciones = [u for u in estado_ordenes(db, fecha_desde, fecha_hasta)["data"] if u["orden"] == target]
    terminado = round(sum(u["cantidad"] for u in ubicaciones if u["ubicacion"] == AREA_FINAL), 3)
    tiene_total = total_resumen > 0

    return {
        "orden": target,
        "total": round(total_resumen, 3) if tiene_total else None,
        "terminado": terminado,
        "enProceso": round(total_resumen - terminado, 3) if tiene_total else None,
        "ubicaciones": [{"area": u["ubicacion"], "cantidad": u["cantidad"]} for u in ubicaciones],
    }


def viaje_orden(db: Session, numero_orden: str) -> list[dict]:
    target = numero_orden.strip().upper()
    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
         .filter(CustodiaTraslado.anulado.is_(False))
         .filter(CustodiaOrdenLinea.numero_orden.ilike(f"%{target}%")))

    viaje = []
    for linea, traslado in q.all():
        viaje.append({
            "fechaHoraStr": f"{traslado.fecha.isoformat()} {traslado.hora.strftime('%H:%M') if traslado.hora else ''}",
            "areaSalida": traslado.area_salida, "areaEntrada": traslado.area_entrada,
            "cantidad": linea.cantidad_discos, "motivo": traslado.motivo, "colaborador": traslado.colaborador,
        })
    viaje.sort(key=lambda v: v["fechaHoraStr"])
    return viaje


def dashboard(db: Session, fecha_desde: date | None = None, fecha_hasta: date | None = None) -> dict:
    """Por área: existencias iniciales (balance acumulado antes de fecha_desde), entradas/salidas
    dentro del rango [fecha_desde, fecha_hasta], y existencia neta a fecha_hasta (iniciales +
    entradas - salidas). Devuelve TODAS las áreas observadas; el front filtra localmente qué mostrar.
    Las sumas las hace la base de datos (GROUP BY), sin traer cada línea a Python."""
    motivos = motivos_disponibles(db)
    data_por_area: dict[str, dict] = {}
    T, L = CustodiaTraslado, CustodiaOrdenLinea

    def area(a: str) -> dict:
        return data_por_area.setdefault(a, {"existenciasIniciales": 0.0, "entrada": 0.0, "salida": 0.0, "neto": 0.0,
                                            "motivos": {m: 0.0 for m in motivos}})

    def sumas(columnas, *filtros):
        return (db.query(*columnas, func.coalesce(func.sum(L.cantidad_discos), 0.0))
                .join(T, L.traslado_id == T.id)
                .filter(T.anulado.is_(False), *filtros)
                .group_by(*columnas).all())

    if fecha_desde:
        for a, total in sumas([T.area_entrada], T.fecha < fecha_desde):
            if a:
                area(a)["existenciasIniciales"] += float(total)
        for a, total in sumas([T.area_salida], T.fecha < fecha_desde):
            if a:
                area(a)["existenciasIniciales"] -= float(total)

    en_rango = []
    if fecha_desde:
        en_rango.append(T.fecha >= fecha_desde)
    if fecha_hasta:
        en_rango.append(T.fecha <= fecha_hasta)
    for a, total in sumas([T.area_entrada], *en_rango):
        if a:
            area(a)["entrada"] += float(total)
    for a, motivo, total in sumas([T.area_salida, T.motivo], *en_rango):
        if a:
            d = area(a)
            d["salida"] += float(total)
            d["motivos"][motivo] = d["motivos"].get(motivo, 0.0) + float(total)

    for d in data_por_area.values():
        d["neto"] = d["existenciasIniciales"] + d["entrada"] - d["salida"]

    return {"dataPorArea": data_por_area}


def tickets_rango(db: Session, inicio: int, fin: int) -> list[CustodiaTraslado]:
    return (db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
            .filter(CustodiaTraslado.id >= inicio, CustodiaTraslado.id <= fin)
            .order_by(CustodiaTraslado.id).all())


def catalogo_discos(db: Session) -> list[dict]:
    """Catálogo activo, para la calculadora de discos en el registro."""
    filas = (db.query(CustodiaFactorDisco).filter(CustodiaFactorDisco.activo == 1)
             .order_by(CustodiaFactorDisco.orden).all())
    return [{"detalle": f.detalle, "factor": f.factor} for f in filas]


def detalles_por_traslado(traslado: CustodiaTraslado) -> dict:
    return {
        "resumen": [{"orden": r.orden, "descripcion": r.descripcion, "paciente": r.paciente,
                    "total": r.total} for r in traslado.resumen],
        "discos": [{"detalle": d.detalle_protesis, "cantPaciente": d.cant_paciente,
                   "cantDiscos": d.cant_discos} for d in traslado.discos],
        "op": [{"op": o.op, "descripcion": o.descripcion, "orden": o.orden, "tipo": o.tipo,
               "usuario": o.usuario, "observaciones": o.observaciones} for o in traslado.op],
    }


def notificar_traslado_pendiente(traslado_id: int) -> None:
    """Envía un mensaje directo de Zoho Cliq a los managers del área de entrada: tienen un traslado
    por firmar. Se ejecuta en segundo plano después de guardar (abre su propia sesión)."""
    from . import config
    from .database import SessionLocal
    from .zoho_cliq import enviar_cliq
    db = SessionLocal()
    try:
        t = db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes)).get(traslado_id)
        if not t or t.anulado or t.confirmado_entrada:
            return
        destinatarios = [e for e in db.query(Empleado).filter(Empleado.activo == 1).all()
                         if e.tiene_modulo("custodia") and e.rol not in ("admin", "superadmin")
                         and (e.area_custodia or "").strip().upper() == (t.area_entrada or "").strip().upper()]
        if not destinatarios:
            print(f"[Custodia] Traslado #{t.id}: ningún manager tiene asignada el área {t.area_entrada}; sin aviso.")
            return
        ordenes = ", ".join(o.numero_orden for o in t.ordenes) or "—"
        total = sum(o.cantidad_discos or 0 for o in t.ordenes)
        texto = (f"📦 *Traslado pendiente de firma* #{t.id:04d}\n"
                 f"{nombre_propio(t.area_salida)} → {nombre_propio(t.area_entrada)} · {total:g} discos\n"
                 f"Órdenes: {ordenes}\n"
                 f"Registrado por: {nombre_propio(t.colaborador)}\n"
                 f"Firma el recibido en: {config.BASE_URL}/custodia (Aprobaciones/Firmas)")
        for e in destinatarios:
            enviar_cliq(e.email, texto)
    except Exception as ex:  # un aviso fallido nunca debe afectar el registro
        print(f"[Custodia] Error enviando aviso del traslado #{traslado_id}: {ex}")
    finally:
        db.close()
