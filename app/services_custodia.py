"""Lógica de negocio del módulo Custodia: traslados entre áreas de producción."""
from datetime import datetime, date
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from .models import Empleado
from .models_custodia import (CustodiaTraslado, CustodiaOrdenLinea, CustodiaResumen, CustodiaDiscos, CustodiaOP,
                              CustodiaFactorDisco, CustodiaArea, CustodiaMotivo)

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


def confirmar_entrada(db: Session, traslado: CustodiaTraslado, user: Empleado) -> str | None:
    if traslado.anulado:
        return "Este traslado fue anulado."
    if traslado.confirmado_entrada:
        return "Este traslado ya fue confirmado."
    traslado.confirmado_entrada = True
    traslado.confirmado_por_id = user.id
    traslado.confirmado_en = datetime.utcnow()
    db.commit()
    return None


def anular_traslado(db: Session, traslado: CustodiaTraslado, user: Empleado) -> str | None:
    if traslado.anulado:
        return "Este traslado ya estaba anulado."
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
    if tipo != "rango":
        q = q.limit(30)
    return q.all()


def serializar_traslado(t: CustodiaTraslado) -> dict:
    return {
        "id": t.id, "colaborador": t.colaborador, "idColaborador": t.id_colaborador,
        "areaCreacion": t.area_creacion, "ordenes": ", ".join(o.numero_orden for o in t.ordenes),
        "lineas": [{"numeroOrden": o.numero_orden, "cantidad": o.cantidad_discos} for o in t.ordenes],
        "cantidad": sum(o.cantidad_discos for o in t.ordenes), "fecha": t.fecha.isoformat(),
        "hora": t.hora.strftime("%H:%M") if t.hora else "", "usuario": t.usuario,
        "areaSalida": t.area_salida, "areaEntrada": t.area_entrada, "motivo": t.motivo,
        "estado": t.estado_texto, "anulado": t.anulado, "confirmadoEntrada": t.confirmado_entrada,
    }


def pendientes_entrada(db: Session) -> list[CustodiaTraslado]:
    return (db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
            .filter(CustodiaTraslado.anulado.is_(False), CustodiaTraslado.confirmado_entrada.is_(False))
            .order_by(CustodiaTraslado.id.desc()).all())


def _fecha_dt(f: date) -> datetime:
    return datetime.combine(f, datetime.min.time())


def estado_ordenes(db: Session, fecha_desde: date | None = None, fecha_hasta: date | None = None) -> dict:
    areas_base = areas_disponibles(db)
    areas_excl = areas_excluidas(db)

    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id))
    if fecha_desde:
        q = q.filter(CustodiaTraslado.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(CustodiaTraslado.fecha <= fecha_hasta)

    ubicacion_neta: dict[tuple[str, str], dict] = {}
    matrix: dict[str, dict[str, dict]] = {}
    areas_extra: set[str] = set()

    def _celda(orden: str, area: str) -> dict:
        matrix.setdefault(orden, {})
        matrix[orden].setdefault(area, {"ent": 0.0, "sal": 0.0, "net": 0.0})
        return matrix[orden][area]

    for linea, traslado in q.all():
        if traslado.anulado:
            valido_por_corte = (fecha_hasta and traslado.anulado_en
                               and traslado.anulado_en.date() > fecha_hasta)
            if not valido_por_corte:
                continue

        cantidad = linea.cantidad_discos or 0
        fecha_str = traslado.fecha.isoformat()
        hora_str = traslado.hora.strftime("%H:%M") if traslado.hora else "00:00"

        for area, signo in ((traslado.area_entrada, 1), (traslado.area_salida, -1)):
            if not area or area in areas_excl:
                continue
            key = (linea.numero_orden, area)
            if key not in ubicacion_neta:
                ubicacion_neta[key] = {"orden": linea.numero_orden, "ubicacion": area, "cantidad": 0.0,
                                       "fechaStr": f"{fecha_str} {hora_str}", "fIso": fecha_str, "hIso": hora_str}
            ubicacion_neta[key]["cantidad"] += signo * cantidad
            ubicacion_neta[key]["fechaStr"] = f"{fecha_str} {hora_str}"
            ubicacion_neta[key]["fIso"] = fecha_str
            ubicacion_neta[key]["hIso"] = hora_str

            celda = _celda(linea.numero_orden, area)
            if signo > 0:
                celda["ent"] += cantidad
            else:
                celda["sal"] += cantidad
            celda["net"] += signo * cantidad
            if area not in areas_base:
                areas_extra.add(area)

    resultado = [o for o in ubicacion_neta.values() if round(o["cantidad"], 3) > 0]
    for o in resultado:
        o["cantidad"] = round(o["cantidad"], 3)

    areas_matrix = areas_base + sorted(areas_extra)
    matrix_out = []
    for orden, por_area in matrix.items():
        fila = {"orden": orden,
               "TOTAL": round(sum(c["net"] for c in por_area.values()), 3)}
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
    entradas - salidas). Devuelve TODAS las áreas observadas; el front filtra localmente qué mostrar."""
    motivos = motivos_disponibles(db)
    data_por_area: dict[str, dict] = {}

    def init_area(a: str):
        if a and a not in data_por_area:
            data_por_area[a] = {"existenciasIniciales": 0.0, "entrada": 0.0, "salida": 0.0, "neto": 0.0,
                               "motivos": {m: 0.0 for m in motivos}}

    if fecha_desde:
        q_previo = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
                   .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
                   .filter(CustodiaTraslado.anulado.is_(False), CustodiaTraslado.fecha < fecha_desde))
        for linea, traslado in q_previo.all():
            cantidad = linea.cantidad_discos or 0
            if traslado.area_entrada:
                init_area(traslado.area_entrada)
                data_por_area[traslado.area_entrada]["existenciasIniciales"] += cantidad
            if traslado.area_salida:
                init_area(traslado.area_salida)
                data_por_area[traslado.area_salida]["existenciasIniciales"] -= cantidad

    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
         .filter(CustodiaTraslado.anulado.is_(False)))
    if fecha_desde:
        q = q.filter(CustodiaTraslado.fecha >= fecha_desde)
    if fecha_hasta:
        q = q.filter(CustodiaTraslado.fecha <= fecha_hasta)

    for linea, traslado in q.all():
        cantidad = linea.cantidad_discos or 0
        if traslado.area_entrada:
            init_area(traslado.area_entrada)
            data_por_area[traslado.area_entrada]["entrada"] += cantidad
        if traslado.area_salida:
            init_area(traslado.area_salida)
            data_por_area[traslado.area_salida]["salida"] += cantidad
            motivos_area = data_por_area[traslado.area_salida]["motivos"]
            motivos_area[traslado.motivo] = motivos_area.get(traslado.motivo, 0.0) + cantidad

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
