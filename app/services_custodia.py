"""Lógica de negocio del módulo Custodia: traslados entre áreas de producción."""
from datetime import datetime, date
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from .models import Empleado
from .models_custodia import (CustodiaTraslado, CustodiaOrdenLinea, CustodiaResumen, CustodiaDiscos, CustodiaOP,
                              CustodiaFactorDisco)

AREAS_ESTANDAR = ["MILLING", "CORTE", "SINTERING/SANDBLAST", "GLAZE", "CRISTALES", "QC FINAL",
                  "DIR PRODUCCIÓN", "DIR PRODUCCIÓN - DAÑADO", "EMPAQUE", "BODEGA"]

# Áreas que no representan una ubicación real de inventario (se excluyen de "ubicación actual" y la matriz)
AREAS_EXCLUIDAS = {"INICIAL", "SALDO INICIAL", "EMPAQUE"}

MOTIVOS = ["PRODUCCIÓN NORMAL", "MERMA/DAÑO", "DEVOLUCIÓN"]


def areas_disponibles(db: Session) -> list[str]:
    extra = set()
    for (a,) in db.query(CustodiaTraslado.area_salida).distinct():
        if a and a not in AREAS_ESTANDAR:
            extra.add(a)
    for (a,) in db.query(CustodiaTraslado.area_entrada).distinct():
        if a and a not in AREAS_ESTANDAR:
            extra.add(a)
    return AREAS_ESTANDAR + sorted(extra)


def verificar_orden_existente(db: Session, numero_orden_raw: str) -> bool:
    ordenes_buscadas = [o.strip().upper() for o in numero_orden_raw.split("-") if o.strip()]
    if not ordenes_buscadas:
        return False
    existe = (db.query(CustodiaOrdenLinea)
              .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
              .filter(CustodiaOrdenLinea.numero_orden.in_(ordenes_buscadas), CustodiaTraslado.anulado.is_(False))
              .first())
    return existe is not None


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


def estado_ordenes(db: Session, fecha_corte: date | None) -> dict:
    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id))
    if fecha_corte:
        q = q.filter(CustodiaTraslado.fecha <= fecha_corte)

    ubicacion_neta: dict[tuple[str, str], dict] = {}
    matrix: dict[str, dict[str, dict]] = {}
    areas_extra: set[str] = set()

    def _celda(orden: str, area: str) -> dict:
        matrix.setdefault(orden, {})
        matrix[orden].setdefault(area, {"ent": 0.0, "sal": 0.0, "net": 0.0})
        return matrix[orden][area]

    for linea, traslado in q.all():
        if traslado.anulado:
            valido_por_corte = (fecha_corte and traslado.anulado_en
                               and traslado.anulado_en.date() > fecha_corte)
            if not valido_por_corte:
                continue

        cantidad = linea.cantidad_discos or 0
        fecha_str = traslado.fecha.isoformat()
        hora_str = traslado.hora.strftime("%H:%M") if traslado.hora else "00:00"

        for area, signo in ((traslado.area_entrada, 1), (traslado.area_salida, -1)):
            if not area or area in AREAS_EXCLUIDAS:
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
            if area not in AREAS_ESTANDAR:
                areas_extra.add(area)

    resultado = [o for o in ubicacion_neta.values() if round(o["cantidad"], 3) > 0]
    for o in resultado:
        o["cantidad"] = round(o["cantidad"], 3)

    areas_matrix = AREAS_ESTANDAR + sorted(areas_extra)
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


def dashboard(db: Session, fecha_corte: date | None) -> dict:
    """Totales de entrada/salida/neto y motivos por área, hasta (e incluyendo) la fecha de
    corte. Devuelve TODAS las áreas observadas; el front filtra localmente qué mostrar."""
    q = (db.query(CustodiaOrdenLinea, CustodiaTraslado)
         .join(CustodiaTraslado, CustodiaOrdenLinea.traslado_id == CustodiaTraslado.id)
         .filter(CustodiaTraslado.anulado.is_(False)))
    if fecha_corte:
        q = q.filter(CustodiaTraslado.fecha <= fecha_corte)

    data_por_area: dict[str, dict] = {}

    def init_area(a: str):
        if a and a not in data_por_area:
            data_por_area[a] = {"entrada": 0.0, "salida": 0.0, "neto": 0.0,
                               "motivos": {m: 0.0 for m in MOTIVOS}}

    for linea, traslado in q.all():
        cantidad = linea.cantidad_discos or 0
        if traslado.area_entrada:
            init_area(traslado.area_entrada)
            data_por_area[traslado.area_entrada]["entrada"] += cantidad
            data_por_area[traslado.area_entrada]["neto"] += cantidad
        if traslado.area_salida:
            init_area(traslado.area_salida)
            data_por_area[traslado.area_salida]["salida"] += cantidad
            data_por_area[traslado.area_salida]["neto"] -= cantidad
            motivos = data_por_area[traslado.area_salida]["motivos"]
            motivos[traslado.motivo] = motivos.get(traslado.motivo, 0.0) + cantidad

    return {"dataPorArea": data_por_area}


def tickets_rango(db: Session, inicio: int, fin: int) -> list[CustodiaTraslado]:
    return (db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
            .filter(CustodiaTraslado.id >= inicio, CustodiaTraslado.id <= fin)
            .order_by(CustodiaTraslado.id).all())


def catalogo_discos(db: Session) -> list[dict]:
    filas = db.query(CustodiaFactorDisco).order_by(CustodiaFactorDisco.orden).all()
    return [{"detalle": f.detalle, "factor": f.factor} for f in filas]


def detalles_por_traslado(traslado: CustodiaTraslado) -> dict:
    return {
        "resumen": [{"orden": r.orden, "descripcion": r.descripcion, "paciente": r.paciente,
                    "total": r.total, "vSalida": "SI" if r.verificado_salida else "NO",
                    "vEntrada": "SI" if r.verificado_entrada else "NO"} for r in traslado.resumen],
        "discos": [{"detalle": d.detalle_protesis, "cantPaciente": d.cant_paciente,
                   "cantDiscos": d.cant_discos} for d in traslado.discos],
        "op": [{"op": o.op, "descripcion": o.descripcion, "orden": o.orden, "tipo": o.tipo,
               "usuario": o.usuario, "observaciones": o.observaciones} for o in traslado.op],
    }
