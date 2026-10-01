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
AREA_QC_FINAL = "QC FINAL"  # sus salidas llevan también la firma de DIR PRODUCCIÓN

# Orden genérica de material sin orden asignada; al sacarlo de un área se le puede asignar un número de orden.
ORDEN_STOCK = "STOCK"


def a_stock_si_entra_a_origen(lineas: list[dict], area_entrada: str) -> None:
    """Dir Producción maneja existencias como Stock: lo que le llega de otra área (con cualquier número de
    orden) entra como STOCK. En la salida se descuenta la orden original; en Dir Producción suma a STOCK."""
    if area_entrada != AREA_ORIGEN:
        return
    for linea in lineas:
        if linea["numero_orden"] != ORDEN_STOCK and not linea.get("orden_origen"):
            linea["orden_origen"], linea["numero_orden"] = linea["numero_orden"], ORDEN_STOCK


def _orden_salida():
    """Orden que descuenta en el área de salida: la de origen (ej. STOCK) si la línea la tiene."""
    return func.coalesce(CustodiaOrdenLinea.orden_origen, CustodiaOrdenLinea.numero_orden)


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
         .filter(or_(CustodiaOrdenLinea.numero_orden == orden, CustodiaOrdenLinea.orden_origen == orden),
                 CustodiaTraslado.anulado.is_(False)))
    saldo = 0.0
    for linea, traslado in q.all():
        if linea.numero_orden == orden and traslado.area_entrada == area and traslado.confirmado_entrada:
            saldo += linea.cantidad_discos
        if (linea.orden_origen or linea.numero_orden) == orden and traslado.area_salida == area:
            saldo -= linea.cantidad_discos
            if linea.ingreso_directo:  # orden nueva: entró a DIR Producción en el mismo registro
                saldo += linea.cantidad_discos
    return saldo


def validar_lineas_traslado(db: Session, lineas: list[dict], resumen: list[dict], area_salida: str) -> str | None:
    """Reglas de negocio antes de crear un traslado:
    - la cantidad movida por línea no puede superar el TOTAL conocido de la orden.
    - no se puede sacar una orden de un área si no se confirmó antes su entrada ahí,
      salvo que sea el primer movimiento de esa orden (recién creada, nada que recibir antes)
      o que el área de salida sea AREA_ORIGEN (ahí entra material nuevo, no se recibe de
      otra área, así que siempre se puede "entregar" -- incluso en lotes posteriores de
      una orden que ya existe)."""
    usado: dict[str, float] = {}  # lo que este mismo registro ya toma de cada orden de origen (ej. STOCK)
    for linea in lineas:
        orden = linea["numero_orden"]
        cantidad = linea["cantidad_discos"]
        origen = linea.get("orden_origen")
        if origen:
            # Se toma del Stock del área de salida y se le asigna un número de orden
            if orden == origen:
                return f"Asigna un número de orden distinto a {origen}."
            disponible = _saldo_confirmado(db, origen, area_salida) - usado.get(origen, 0.0)
            usado[origen] = usado.get(origen, 0.0) + cantidad
            if len([l for l in lineas if l.get("orden_origen") == origen]) > 1 and disponible + 1e-6 < cantidad:
                total = sum(l["cantidad_discos"] for l in lineas if l.get("orden_origen") == origen)
                return (f"En {nombre_propio(area_salida)} hay {round(max(_saldo_confirmado(db, origen, area_salida), 0), 3):g} "
                        f"disco(s) de {origen}; no alcanza para las {total:g} de estas órdenes.")
            if disponible + 1e-6 < cantidad:
                if orden == ORDEN_STOCK:  # pasa a Stock de Dir Producción
                    return (f"En {nombre_propio(area_salida)} hay {round(max(disponible, 0), 3):g} disco(s) de la orden {origen}; "
                            f"no puedes entregar {cantidad:g}.")
                return (f"En {nombre_propio(area_salida)} hay {round(max(disponible, 0), 3):g} disco(s) de {origen}; "
                        f"no puedes asignar {cantidad:g} a la orden {orden}.")
            continue

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


# ---------------- Stock por descripción ----------------
SIN_DESCRIPCION = "SIN DESCRIPCIÓN"


def _descripcion(texto: str) -> str:
    return " ".join(str(texto or "").split()).upper() or SIN_DESCRIPCION


def _sale_de_stock(linea: dict) -> bool:
    return (linea.get("orden_origen") or linea["numero_orden"]) == ORDEN_STOCK


def stock_por_descripcion(db: Session) -> dict[str, dict[str, float]]:
    """{área: {descripción: cantidad}} de lo asignado por descripción (las entradas cuentan al confirmarse)."""
    from .models_custodia import CustodiaStockDescripcion as SD
    filas = (db.query(SD.area, SD.descripcion, func.sum(SD.cantidad))
             .outerjoin(CustodiaTraslado, SD.traslado_id == CustodiaTraslado.id)
             .filter(or_(SD.traslado_id.is_(None),
                         and_(CustodiaTraslado.anulado.is_(False),
                              or_(SD.cantidad < 0, CustodiaTraslado.confirmado_entrada.is_(True)))))
             .group_by(SD.area, SD.descripcion).all())
    salida: dict[str, dict[str, float]] = {}
    for area, desc, total in filas:
        if abs(total or 0) > 1e-9:
            salida.setdefault(area, {})[desc] = round(float(total), 4)
    return salida


def inventario_stock(db: Session, area: str | None = None) -> list[dict]:
    """Stock de cada área: total, lo asignado por descripción y lo que queda «Sin descripción»."""
    por_desc = stock_por_descripcion(db)
    areas = [area] if area else list(dict.fromkeys(areas_disponibles(db) + list(por_desc)))
    salida = []
    for a in areas:
        total = round(_saldo_confirmado(db, ORDEN_STOCK, a), 4)
        descs = {d: c for d, c in por_desc.get(a, {}).items() if c > 1e-9}
        if total <= 1e-9 and not descs:
            continue
        asignado = sum(descs.values())
        salida.append({"area": a, "total": total, "sinDescripcion": round(max(total - asignado, 0), 4),
                       "descripciones": [{"descripcion": d, "cantidad": c} for d, c in sorted(descs.items())]})
    return salida


def validar_stock_descripciones(db: Session, area_salida: str, lineas: list[dict],
                                elegidas: list[dict]) -> tuple[str | None, list[tuple[str, float]]]:
    """Lo que sale del Stock debe decir de qué descripción sale (si el área tiene Stock con descripciones)."""
    total = round(sum(l["cantidad_discos"] for l in lineas if _sale_de_stock(l)), 4)
    if total <= 0:
        return None, []
    inv = (inventario_stock(db, area_salida) or [{"descripciones": [], "sinDescripcion": 0}])[0]
    disponibles = {d["descripcion"]: d["cantidad"] for d in inv["descripciones"]}
    disponibles[SIN_DESCRIPCION] = inv["sinDescripcion"]
    juntas: dict[str, float] = {}
    for e in elegidas or []:
        cantidad = round(float(e.get("cantidad") or 0), 4)
        if cantidad > 0:
            d = _descripcion(e.get("descripcion"))
            juntas[d] = juntas.get(d, 0) + cantidad
    if not juntas:
        if inv["descripciones"]:
            return (f"El Stock de {nombre_propio(area_salida)} tiene descripciones: elige de cuáles salen "
                    f"los {total:g} disco(s)."), []
        return None, [(SIN_DESCRIPCION, total)]
    suma = round(sum(juntas.values()), 4)
    if abs(suma - total) > 1e-6:
        return f"Las descripciones del Stock suman {suma:g} y la cantidad que sale del Stock es {total:g}.", []
    for d, c in juntas.items():
        if c > disponibles.get(d, 0) + 1e-6:
            return (f"En {nombre_propio(area_salida)} hay {disponibles.get(d, 0):g} disco(s) de Stock «{d.title() if d == SIN_DESCRIPCION else d}»; "
                    f"no puedes sacar {c:g}."), []
    return None, list(juntas.items())


def _repartir(fuentes: list[tuple[str, float]], cantidad: float) -> list[tuple[str, float]]:
    """Toma `cantidad` de las fuentes en orden (lo que sobra queda sin descripción)."""
    salida, falta = [], cantidad
    for d, c in fuentes:
        if falta <= 1e-9:
            break
        tomar = min(c, falta)
        salida.append((d, tomar))
        falta -= tomar
    if falta > 1e-9:
        salida.append((SIN_DESCRIPCION, falta))
    return salida


def _movimientos_stock(db: Session, traslado: CustodiaTraslado, lineas: list[dict], resumen: list[dict],
                       elegidas: list[tuple[str, float]], user: Empleado) -> None:
    from .models_custodia import CustodiaStockDescripcion as SD

    def agregar(area, desc, cantidad, tipo):
        if desc != SIN_DESCRIPCION and abs(cantidad) > 1e-9:
            db.add(SD(traslado_id=traslado.id, area=area, descripcion=desc, cantidad=round(cantidad, 4), tipo=tipo,
                      creado_por_id=user.id))

    for d, c in elegidas:  # sale del Stock del área de salida
        agregar(traslado.area_salida, d, -c, "SALIDA")
    restantes = list(elegidas)
    for l in lineas:
        if l["numero_orden"] != ORDEN_STOCK:
            continue
        origen = l.get("orden_origen")
        if not origen:  # Stock que pasa como Stock a otra área: lleva las mismas descripciones
            partes = _repartir(restantes, l["cantidad_discos"])
            usado = dict(partes)
            restantes = [(d, c - usado.get(d, 0)) for d, c in restantes if c - usado.get(d, 0) > 1e-9]
        else:  # una orden que entra al Stock (ej. a DIR Producción): toma las descripciones de su Resumen general
            fuentes = [(_descripcion(r.get("descripcion")), float(r.get("total") or 0)) for r in resumen
                       if str(r.get("orden") or "").strip().upper() == origen and (r.get("total") or 0) > 0]
            if not fuentes and len(lineas) == 1:  # Resumen pegado sin número de orden: es de la única orden del traslado
                fuentes = [(_descripcion(r.get("descripcion")), float(r.get("total") or 0)) for r in resumen
                           if not str(r.get("orden") or "").strip() and (r.get("total") or 0) > 0]
            partes = _repartir(fuentes, l["cantidad_discos"])
        for d, c in partes:
            agregar(traslado.area_entrada, d, c, "ENTRADA")


def limpiar_subtotales_duplicados(db: Session) -> list[tuple[int, str, float]]:
    """Quita del Resumen general las filas «orden + cantidad» que agregaba el guardado aunque ya se hubiera pegado
    el resumen de esa orden (salían sin descripción y duplicaban el total). Solo quita la fila si, a la vez:
    no tiene descripción ni paciente, en el mismo traslado hay otras filas de esa orden con descripción, y su total
    es igual a la cantidad de discos de esa orden en el traslado. Devuelve (traslado, orden, total) de lo quitado."""
    quitadas = []
    for t in db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.resumen), joinedload(CustodiaTraslado.ordenes)).all():
        cantidades: dict[str, float] = {}
        for o in t.ordenes:
            k = (o.numero_orden or "").strip().upper()
            cantidades[k] = cantidades.get(k, 0.0) + (o.cantidad_discos or 0)
        for r in list(t.resumen):
            k = (r.orden or "").strip().upper()
            if not k or (r.descripcion or "").strip() or (r.paciente or "").strip() or k not in cantidades:
                continue
            con_descripcion = [x for x in t.resumen if x is not r and (x.orden or "").strip().upper() == k
                               and (x.descripcion or "").strip()]
            if con_descripcion and abs((r.total or 0) - cantidades[k]) < 1e-6:
                quitadas.append((t.id, r.orden, r.total))
                db.delete(r)
    db.commit()
    return quitadas


def recalcular_entradas_stock(db: Session, traslado: CustodiaTraslado) -> int:
    """Vuelve a calcular lo que un traslado dejó en el Stock por descripción, desde su Resumen general
    (solo si ese traslado no tiene movimientos de Stock). Devuelve cuántos movimientos creó."""
    from .models_custodia import CustodiaStockDescripcion as SD
    if traslado.anulado or db.query(SD).filter(SD.traslado_id == traslado.id).first():
        return 0
    lineas = [{"numero_orden": o.numero_orden, "cantidad_discos": o.cantidad_discos, "orden_origen": o.orden_origen}
              for o in traslado.ordenes]
    if any(_sale_de_stock(l) for l in lineas):
        return 0  # las salidas del Stock necesitan que alguien diga de qué descripción salieron
    resumen = [{"orden": r.orden, "descripcion": r.descripcion, "total": r.total} for r in traslado.resumen]
    antes = len(db.new)
    _movimientos_stock(db, traslado, lineas, resumen, [], traslado.creado_por)
    creados = len(db.new) - antes
    db.commit()
    return creados


def leer_stock_inicial(texto: str) -> tuple[list[tuple[str, float]], list[str]]:
    """Filas «DESCRIPCIÓN  CANTIDAD» pegadas (tabulador, ; o la cantidad al final)."""
    filas, errores = [], []
    for n, linea in enumerate((texto or "").splitlines(), start=1):
        if not linea.strip():
            continue
        partes = [p.strip() for p in (linea.split("\t") if "\t" in linea else linea.split(";") if ";" in linea
                                      else linea.rsplit(None, 1)) if p.strip()]
        if len(partes) < 2:
            errores.append(f"Fila {n}: se espera descripción y cantidad: «{linea.strip()}»")
            continue
        desc, txt = " ".join(partes[:-1]), partes[-1]
        try:
            cantidad = float(txt.replace(".", "").replace(",", ".") if "," in txt else txt)
        except ValueError:
            if n == 1 and not filas:  # títulos
                continue
            errores.append(f"Fila {n}: la cantidad «{txt}» no es un número")
            continue
        if cantidad <= 0:
            errores.append(f"Fila {n}: la cantidad debe ser mayor que cero")
            continue
        filas.append((_descripcion(desc), cantidad))
    return filas, errores


def asignar_stock_inicial(db: Session, user: Empleado, area: str, filas: list[tuple[str, float]]) -> str | None:
    """Le pone descripción al Stock «Sin descripción» que ya tiene el área (inventario inicial)."""
    from .models_custodia import CustodiaStockDescripcion as SD
    inv = inventario_stock(db, area)
    libre = inv[0]["sinDescripcion"] if inv else 0
    suma = round(sum(c for _, c in filas), 4)
    if suma > libre + 1e-6:
        return (f"No se guardó: en {nombre_propio(area)} hay {libre:g} disco(s) de Stock sin descripción "
                f"y quieres asignar {suma:g}.")
    for d, c in filas:
        if d == SIN_DESCRIPCION:
            return "No se guardó: escribe la descripción de cada fila."
        db.add(SD(area=area, descripcion=d, cantidad=round(c, 4), tipo="INICIAL", creado_por_id=user.id))
    db.commit()
    return None


def crear_traslado(db: Session, user: Empleado, cabecera: dict, lineas: list[dict],
                   resumen: list[dict], discos: list[dict], op: list[dict],
                   stock_descripciones: list[tuple[str, float]] | None = None) -> CustodiaTraslado:
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
                                  cantidad_discos=linea["cantidad_discos"], orden_origen=linea.get("orden_origen") or None,
                                  ingreso_directo=bool(linea.get("ingreso_directo"))))
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
    _movimientos_stock(db, traslado, lineas, resumen, stock_descripciones or [], user)

    db.commit()
    db.refresh(traslado)
    return traslado


def puede_firmar_recibido(user: Empleado, traslado: CustodiaTraslado) -> bool:
    """Firma "recibido": un administrador, o un manager cuya área asignada en Parámetros sea el
    área de entrada del traslado (quien recibe el material)."""
    if user.rol in ("admin", "superadmin"):
        return True
    return user.tiene_area(traslado.area_entrada)  # cualquiera de sus áreas asignadas (máx. 2)


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


def puede_firmar_dir(user: Empleado) -> bool:
    """Firma DIR PRODUCCIÓN (salidas de QC FINAL): un administrador o quien tenga asignada el área DIR PRODUCCIÓN."""
    if user.rol in ("admin", "superadmin"):
        return True
    return AREA_ORIGEN in user.areas_custodia


def firmar_dir(db: Session, traslado: CustodiaTraslado, user: Empleado) -> str | None:
    if traslado.anulado:
        return "Este traslado fue anulado."
    if not traslado.requiere_firma_dir:
        return "Este traslado no necesita la firma de DIR Producción (solo las salidas de QC Final)."
    if traslado.dir_firmado_en:
        return "DIR Producción ya firmó este traslado."
    if not puede_firmar_dir(user):
        return "Solo quien tiene asignada el área DIR Producción (o un administrador) puede firmar este traslado."
    traslado.dir_firmado_por_id, traslado.dir_firmado_en = user.id, datetime.utcnow()
    db.commit()
    return None


def puede_firmar_algo(user: Empleado, t: CustodiaTraslado) -> bool:
    """¿Tiene esta persona una firma pendiente en el traslado? (recibido o DIR Producción)"""
    return ((not t.confirmado_entrada and puede_firmar_recibido(user, t))
            or (t.pendiente_dir and puede_firmar_dir(user)))


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
             fecha_inicio: date | None = None, fecha_fin: date | None = None,
             area_entrada: str = "") -> list[CustodiaTraslado]:
    q = db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
    if area_salida and area_salida != "TODAS":
        q = q.filter(CustodiaTraslado.area_salida == area_salida)
    if area_entrada and area_entrada != "TODAS":
        q = q.filter(CustodiaTraslado.area_entrada == area_entrada)
    if estado == "ACTIVOS":
        q = q.filter(CustodiaTraslado.anulado.is_(False))
    elif estado == "ANULADOS":
        q = q.filter(CustodiaTraslado.anulado.is_(True))
    if tipo == "rango" and fecha_inicio and fecha_fin:
        q = q.filter(CustodiaTraslado.fecha >= fecha_inicio, CustodiaTraslado.fecha <= fecha_fin)
    q = q.order_by(CustodiaTraslado.id.desc())
    q = q.limit(ULTIMOS_CONSULTA if tipo != "rango" else LIMITE_CONSULTA_RANGO)
    return q.all()


ULTIMOS_CONSULTA = 50  # «Últimos 50» de Consulta traslado

# Tope de filas para "Rango fechas" en Consulta traslado (evita traer miles de filas de una vez).
LIMITE_CONSULTA_RANGO = 2000
# Tope de consecutivos por impresión en "Imprimir por rango".
LIMITE_TICKETS_RANGO = 300


def cargo_people(emp) -> str:
    """Cargo del empleado tal como está en People (no se modifica)."""
    return (emp.cargo or "").strip() if emp else ""


def _sin_tildes(texto: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn").upper()


def cargo_coincide_con_area(cargo: str, area: str) -> bool:
    """True si el cargo de People menciona el área asignada (ej. "MANAGER GLAZE" y "GLAZE",
    "DIRECTOR DE PRODUCCION" y "DIR PRODUCCIÓN"). Sin área asignada no hay nada que comparar."""
    if not area:
        return True
    if "," in area:  # varias áreas asignadas: basta con que el cargo mencione una
        return any(cargo_coincide_con_area(cargo, a) for a in area.split(",") if a.strip())
    import re
    cargo_n = _sin_tildes(cargo)
    palabras = [p for p in re.split(r"[^A-Z0-9]+", _sin_tildes(area)) if len(p) >= 2 and p not in ("DE", "DEL", "LA")]
    return any(p in cargo_n for p in palabras)


def _nombre_firma(emp) -> str:
    """Primer nombre y primer apellido del empleado que firma (ej. 'Carlos Barreto')."""
    if not emp:
        return ""
    partes = [(emp.nombres or "").split()[:1], (emp.apellidos or "").split()[:1]]
    return nombre_propio(" ".join(p[0] for p in partes if p))


def _hora_firma(momento: datetime | None) -> str:
    """UTC → hora Colombia (UTC-5) con el formato de las firmas: 28/09/2026 07:24 PM."""
    return (momento - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if momento else ""


def serializar_traslado(t: CustodiaTraslado) -> dict:
    return {
        "id": t.id, "colaborador": t.colaborador, "idColaborador": t.id_colaborador,
        "areaCreacion": t.area_creacion, "ordenes": ", ".join(o.numero_orden + (f" (de {nombre_propio(o.orden_origen)})" if o.orden_origen else "") for o in t.ordenes),
        "lineas": [{"numeroOrden": o.numero_orden, "cantidad": o.cantidad_discos, "ordenOrigen": o.orden_origen or ""}
                   for o in t.ordenes],
        "cantidad": sum(o.cantidad_discos for o in t.ordenes), "fecha": t.fecha.isoformat(),
        "hora": t.hora.strftime("%H:%M") if t.hora else "", "usuario": t.usuario,
        "areaSalida": t.area_salida, "areaEntrada": t.area_entrada, "motivo": t.motivo,
        "estado": t.estado_texto, "anulado": t.anulado, "confirmadoEntrada": t.confirmado_entrada,
        # Firmas del documento: entrega = quien registró (área salida); recibe = quien confirmó (área entrada).
        "entregaEmail": t.creado_por.email if t.creado_por else "",
        "entregaNombre": _nombre_firma(t.creado_por),
        "entregaCargo": cargo_people(t.creado_por),
        "recibeEmail": t.confirmado_por.email if (t.confirmado_entrada and t.confirmado_por) else "",
        "recibeNombre": _nombre_firma(t.confirmado_por) if t.confirmado_entrada else "",
        "recibeCargo": cargo_people(t.confirmado_por) if t.confirmado_entrada else "",
        # Fecha y hora de cada firma (hora Colombia), como en el formato impreso
        "entregaEn": _hora_firma(t.creado_en) if t.creado_por else "",
        "recibeEn": _hora_firma(t.confirmado_en) if t.confirmado_entrada else "",
        # Firma de DIR PRODUCCIÓN (obligatoria en las salidas de QC FINAL)
        "requiereDir": t.requiere_firma_dir, "pendienteDir": t.pendiente_dir, "completo": t.completo,
        "dirEmail": t.dir_firmado_por.email if (t.dir_firmado_en and t.dir_firmado_por) else "",
        "dirNombre": _nombre_firma(t.dir_firmado_por) if t.dir_firmado_en else "",
        "dirEn": _hora_firma(t.dir_firmado_en),
        # Anulación: quién, cuándo y por qué
        "anuladoPor": nombre_propio(t.anulado_por.nombre_completo) if (t.anulado and t.anulado_por) else "",
        # anulado_en se guarda en UTC; Colombia es UTC-5 (sin horario de verano)
        "anuladoEn": (t.anulado_en - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M") if (t.anulado and t.anulado_en) else "",
        "motivoAnulacion": (t.motivo_anulacion or "") if t.anulado else "",
    }


def pendientes_entrada(db: Session) -> list[CustodiaTraslado]:
    """Traslados con alguna firma pendiente: el recibido del área de entrada o la de DIR Producción."""
    falta_dir = ((func.upper(CustodiaTraslado.area_salida) == AREA_QC_FINAL)
                 & (func.upper(CustodiaTraslado.area_entrada) != AREA_ORIGEN)
                 & CustodiaTraslado.dir_firmado_en.is_(None))
    return (db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes))
            .filter(CustodiaTraslado.anulado.is_(False), CustodiaTraslado.confirmado_entrada.is_(False) | falta_dir)
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
        # En la salida descuenta la orden de origen (ej. STOCK) si la línea se asignó desde Stock
        orden = L.numero_orden if es_entrada else func.coalesce(L.orden_origen, L.numero_orden)
        return (select(orden.label("orden"), columna_area.label("area"),
                       (cantidad if es_entrada else literal(0.0)).label("ent"),
                       (literal(0.0) if es_entrada else cantidad).label("sal"),
                       momento.label("momento"))
                .join(T, L.traslado_id == T.id)
                .where(and_(*filtros), columna_area.isnot(None), columna_area != ""))

    # Orden nueva desde DIR Producción: además de la salida, cuenta la entrada en DIR Producción (neto 0 allí)
    ingreso = (select(L.numero_orden.label("orden"), T.area_salida.label("area"), cantidad.label("ent"),
                      literal(0.0).label("sal"), momento.label("momento"))
               .join(T, L.traslado_id == T.id).where(and_(*filtros), L.ingreso_directo.is_(True)))
    mov = union_all(movimientos(T.area_entrada, True), movimientos(T.area_salida, False), ingreso).subquery()
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
         .filter(or_(CustodiaOrdenLinea.numero_orden.ilike(f"%{target}%"), CustodiaOrdenLinea.orden_origen.ilike(f"%{target}%"))))

    viaje = []
    for linea, traslado in q.all():
        nota = ""
        if linea.orden_origen and linea.numero_orden == ORDEN_STOCK:  # llegó a Dir Producción y pasó a Stock
            nota = (f"Pasó a Stock en {nombre_propio(traslado.area_entrada)}" if target in (linea.orden_origen or "")
                    else f"Llegó como Stock desde la orden {linea.orden_origen}")
        elif linea.ingreso_directo:
            nota = f"Orden nueva: ingresó a {nombre_propio(traslado.area_salida)}"
        elif linea.orden_origen:  # asignada desde Stock
            nota = (f"Tomado de {linea.orden_origen} y asignado a la orden {linea.numero_orden}"
                    if target in (linea.numero_orden or "") else f"Asignado a la orden {linea.numero_orden}")
        viaje.append({
            "fechaHoraStr": f"{traslado.fecha.isoformat()} {traslado.hora.strftime('%H:%M') if traslado.hora else ''}",
            "areaSalida": traslado.area_salida, "areaEntrada": traslado.area_entrada,
            "cantidad": linea.cantidad_discos, "motivo": traslado.motivo + (f" · {nota}" if nota else ""),
            "colaborador": traslado.colaborador,
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
        for a, total in sumas([T.area_salida], T.fecha < fecha_desde, L.ingreso_directo.is_(True)):
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
    # Órdenes nuevas que salen de DIR Producción: también entran ahí (se suma y se resta)
    for a, total in sumas([T.area_salida], *en_rango, L.ingreso_directo.is_(True)):
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


def notificar_traslado_pendiente(traslado_id: int, recordatorio: bool = False) -> bool:
    """Envía un mensaje directo de Zoho Cliq a los managers del área de entrada: tienen un traslado
    por firmar. Se ejecuta en segundo plano después de guardar (abre su propia sesión)."""
    from . import config
    from .database import SessionLocal
    db = SessionLocal()
    try:
        t = db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes)).get(traslado_id)
        if not t or t.anulado or t.confirmado_entrada:
            return False
        # Todos los que tienen asignada el área de entrada (incluidos administradores con esa área).
        from .acceso_produccion import tiene_submodulo
        destinatarios = [e for e in db.query(Empleado).filter(Empleado.activo == 1).all()
                         if tiene_submodulo(db, e, "custodia")
                         and e.tiene_area(t.area_entrada)]
        if not destinatarios:
            print(f"[Custodia] Traslado #{t.id}: ningún manager tiene asignada el área {t.area_entrada}; sin aviso.")
            return False
        ordenes = ", ".join(o.numero_orden for o in t.ordenes) or "—"
        total = sum(o.cantidad_discos or 0 for o in t.ordenes)
        texto = (f"{'🔔 *Recordatorio* · ' if recordatorio else ''}📦 *Traslado pendiente de firma* #{t.id:04d}\n"
                 f"{nombre_propio(t.area_salida)} → {nombre_propio(t.area_entrada)} · {total:g} discos\n"
                 f"Órdenes: {ordenes}\n"
                 f"Registrado por: {nombre_propio(t.colaborador)}\n"
                 f"Firma el recibido en: {config.BASE_URL}/custodia (Aprobaciones/Firmas)")
        # Desde el bot de Cliq (única vía de envío de la intranet), a todos en una sola llamada.
        from .zoho_cliq import enviar_cliq_varios
        return bool(enviar_cliq_varios([e.email for e in destinatarios], texto))
    except Exception as ex:  # un aviso fallido nunca debe afectar el registro
        print(f"[Custodia] Error enviando aviso del traslado #{traslado_id}: {ex}")
        return False
    finally:
        db.close()


def notificar_firma_dir_pendiente(traslado_id: int, recordatorio: bool = False) -> bool:
    """Aviso por Cliq (bot) a quienes tienen asignada DIR PRODUCCIÓN: una salida de QC FINAL espera su firma."""
    from . import config
    from .database import SessionLocal
    db = SessionLocal()
    try:
        t = db.query(CustodiaTraslado).options(joinedload(CustodiaTraslado.ordenes)).get(traslado_id)
        if not t or not t.pendiente_dir:
            return False
        from .acceso_produccion import tiene_submodulo
        destinatarios = [e for e in db.query(Empleado).filter(Empleado.activo == 1).all()
                         if tiene_submodulo(db, e, "custodia") and AREA_ORIGEN in e.areas_custodia]
        if not destinatarios:
            print(f"[Custodia] Traslado #{t.id}: nadie tiene asignada DIR PRODUCCIÓN para firmar; sin aviso.")
            return False
        ordenes = ", ".join(o.numero_orden for o in t.ordenes) or "—"
        total = sum(o.cantidad_discos or 0 for o in t.ordenes)
        texto = (f"{'🔔 *Recordatorio* · ' if recordatorio else ''}✍️ *Salida de QC Final pendiente de firma de DIR Producción* #{t.id:04d}\n"
                 f"{nombre_propio(t.area_salida)} → {nombre_propio(t.area_entrada)} · {total:g} discos\n"
                 f"Órdenes: {ordenes}\n"
                 f"Registrado por: {nombre_propio(t.colaborador)}\n"
                 f"Fírmala en: {config.BASE_URL}/custodia (Aprobaciones/Firmas)")
        from .zoho_cliq import enviar_cliq_varios
        return bool(enviar_cliq_varios([e.email for e in destinatarios], texto))
    except Exception as ex:  # un aviso fallido nunca debe afectar el registro
        print(f"[Custodia] Error enviando aviso DIR del traslado #{traslado_id}: {ex}")
        return False
    finally:
        db.close()


# ---------------- Saldos iniciales ----------------
# Se cargan como traslados ya recibidos desde el origen "SALDO INICIAL" (área de legado, no se muestra
# como área): así cada orden queda en su área con su cantidad y se puede seguir moviendo normalmente.
ORIGEN_SALDO_INICIAL = "SALDO INICIAL"


def leer_saldos(texto: str, areas_validas: list[str]) -> tuple[list[dict], list[str]]:
    """Lee filas "orden  cantidad  área" pegadas desde Excel (tabulador), con ";" o con espacios.
    Devuelve (filas, errores). Acepta coma decimal y omite la fila de encabezados."""
    filas, errores = [], []
    por_nombre = {a.strip().upper(): a for a in areas_validas}
    for n, linea in enumerate((texto or "").splitlines(), start=1):
        if not linea.strip():
            continue
        if "\t" in linea:
            partes = [p.strip() for p in linea.split("\t")]
        elif ";" in linea:
            partes = [p.strip() for p in linea.split(";")]
        else:
            partes = linea.split(None, 2)
        partes = [p for p in partes if p != ""]
        if len(partes) < 3:
            errores.append(f"Fila {n}: faltan datos (se espera orden, cantidad y área): «{linea.strip()}»")
            continue
        orden, cantidad_txt, area = partes[0].upper(), partes[1], " ".join(partes[2:]).strip().upper()
        try:
            cantidad = float(cantidad_txt.replace(".", "").replace(",", ".") if "," in cantidad_txt else cantidad_txt)
        except ValueError:
            if n == 1 or not filas:  # encabezados (No ORDEN / CANTIDAD / AREA)
                continue
            errores.append(f"Fila {n}: la cantidad «{cantidad_txt}» no es un número")
            continue
        if cantidad <= 0:
            errores.append(f"Fila {n}: la cantidad de la orden {orden} debe ser mayor que cero")
            continue
        if area not in por_nombre:
            errores.append(f"Fila {n}: el área «{area}» no existe en Parámetros › Áreas")
            continue
        filas.append({"orden": orden, "cantidad": round(cantidad, 3), "area": por_nombre[area]})
    return filas, errores


def saldos_ya_cargados(db: Session) -> int:
    return db.query(CustodiaTraslado).filter(CustodiaTraslado.area_salida == ORIGEN_SALDO_INICIAL,
                                             CustodiaTraslado.anulado.is_(False)).count()


def saldos_existentes(db: Session) -> set[tuple[str, str]]:
    """(orden, área) que ya tienen saldo inicial cargado (sin anular): no se pueden cargar otra vez."""
    return {(o.numero_orden.strip().upper(), t.area_entrada.strip().upper())
            for o, t in db.query(CustodiaOrdenLinea, CustodiaTraslado).join(CustodiaTraslado)
            .filter(CustodiaTraslado.area_salida == ORIGEN_SALDO_INICIAL, CustodiaTraslado.anulado.is_(False))}


def ultima_fecha_corte(db: Session) -> date | None:
    t = (db.query(CustodiaTraslado).filter(CustodiaTraslado.area_salida == ORIGEN_SALDO_INICIAL, CustodiaTraslado.anulado.is_(False))
         .order_by(CustodiaTraslado.id.desc()).first())
    return t.fecha if t else None


def saldos_repetidos(db: Session, filas: list[dict]) -> list[str]:
    """Filas que ya están cargadas (misma orden en la misma área) o repetidas dentro de lo pegado."""
    ya, vistas, errores = saldos_existentes(db), set(), []
    for f in filas:
        clave = (f["orden"].strip().upper(), f["area"].strip().upper())
        if clave in ya:
            errores.append(f"la orden {f['orden']} ya tiene saldo inicial en {nombre_propio(f['area'])}")
        elif clave in vistas:
            errores.append(f"la orden {f['orden']} está repetida en {nombre_propio(f['area'])}")
        vistas.add(clave)
    return errores


def cargar_saldos(db: Session, user: Empleado, filas: list[dict], fecha_corte: date) -> list[CustodiaTraslado]:
    """Un traslado por área (SALDO INICIAL → área), ya recibido, con sus órdenes y cantidades.
    Queda con la fecha de corte a las 00:00, para que todo movimiento de ese día o posterior vaya después."""
    por_area: dict[str, list[dict]] = {}
    for f in filas:
        por_area.setdefault(f["area"], []).append(f)
    creados = []
    for area, lineas in por_area.items():
        t = CustodiaTraslado(colaborador=nombre_propio(user.nombre_completo).upper(), id_colaborador=user.identificacion or "",
                             area_creacion=area, fecha=fecha_corte, hora=time(0, 0),
                             usuario=user.email or "", area_salida=ORIGEN_SALDO_INICIAL, area_entrada=area,
                             motivo=ORIGEN_SALDO_INICIAL, creado_por_id=user.id,
                             confirmado_entrada=True, confirmado_por_id=user.id, confirmado_en=datetime.utcnow())
        db.add(t)
        db.flush()
        for f in lineas:
            db.add(CustodiaOrdenLinea(traslado_id=t.id, numero_orden=f["orden"], cantidad_discos=f["cantidad"]))
        creados.append(t)
    db.commit()
    return creados
