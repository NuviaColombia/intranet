"""Producción › Seguimiento de consumo: entregas de frascos, jornada diaria y reportes.
Sus parámetros (accesos, técnicos, materias primas, tipos) están en Producción › Parámetros."""
import csv
import io
from datetime import date
from fastapi import APIRouter, Request, Depends, HTTPException, Form
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_consumo import (ConsumoMateria, ConsumoTipo, ConsumoTecnico, ConsumoManager, ConsumoEntrega, ConsumoJornada,
                              ConsumoFrasco, ConsumoTraslado, ConsumoApertura)
from ..auth import require_admin
from ..acceso_produccion import require_admin_produccion, require_submodulo, ProduccionAcceso, MODULO_PRODUCCION
from ..formato import nombre_propio
from ..main_templates import templates
from .. import services_consumo as sc
from .. import acceso_secciones as acs

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py
SUB = "consumo"
COLUMNAS_NUEVAS = {"consumo_materias": {"medida": "VARCHAR(20) DEFAULT ''", "dias_alerta": "INTEGER DEFAULT 0"},
                   "consumo_entregas": {"prueba": "INTEGER DEFAULT 0"},
                   "consumo_frascos": {"tecnico_actual_id": "INTEGER REFERENCES consumo_tecnicos(id)"},
                   "consumo_jornadas": {"gotas": "FLOAT DEFAULT 0", "consumido": "INTEGER DEFAULT 0",
                                        "tecnico_id": "INTEGER REFERENCES consumo_tecnicos(id)",
                                        "observacion": "TEXT DEFAULT ''", "estado": "VARCHAR(20) DEFAULT 'ACTIVO'",
                                        "solicitud_motivo": "TEXT", "solicitado_por_id": "INTEGER REFERENCES empleados(id)",
                                        "solicitado_en": "TIMESTAMP", "respuesta": "TEXT",
                                        "anulado_por_id": "INTEGER REFERENCES empleados(id)", "anulado_en": "TIMESTAMP",
                                        "motivo_anulacion": "TEXT"}}


@router.on_event("startup")
def _columnas_consumo() -> None:
    from sqlalchemy import inspect, text
    from ..database import engine
    try:
        ConsumoTraslado.__table__.create(bind=engine, checkfirst=True)
        ConsumoApertura.__table__.create(bind=engine, checkfirst=True)
    except Exception as e:  # otro proceso la acaba de crear
        print(f"Consumo: tablas nuevas ({type(e).__name__}).")
    try:
        with engine.begin() as conn:
            for tabla, nuevas in COLUMNAS_NUEVAS.items():
                existentes = {c["name"] for c in inspect(engine).get_columns(tabla)}
                for nombre, tipo in nuevas.items():
                    if nombre not in existentes:
                        conn.execute(text(f"ALTER TABLE {tabla} ADD COLUMN {nombre} {tipo}"))
    except Exception as e:
        print(f"Consumo: columnas nuevas ({type(e).__name__}: {e}).")
    _varios_registros_por_dia(engine)


def _varios_registros_por_dia(engine) -> None:
    """Antes había un solo registro por frasco y día (restricción uq_consumo_jornada); ahora puede haber varios.
    Los registros anteriores que marcaron el frasco como consumido quedan con consumido=1."""
    from sqlalchemy import inspect, text
    from ..models_consumo import ConsumoJornada
    try:
        unicas = [u for u in inspect(engine).get_unique_constraints("consumo_jornadas")
                  if set(u.get("column_names") or []) == {"frasco_id", "fecha"}]
        if unicas and engine.dialect.name == "sqlite":  # SQLite no borra restricciones: se reconstruye la tabla
            columnas = [c["name"] for c in inspect(engine).get_columns("consumo_jornadas")]
            indices = [i["name"] for i in inspect(engine).get_indexes("consumo_jornadas") if i.get("name")]
            with engine.begin() as conn:
                for i in indices:
                    conn.execute(text(f"DROP INDEX IF EXISTS {i}"))
                conn.execute(text("ALTER TABLE consumo_jornadas RENAME TO consumo_jornadas_anterior"))
                ConsumoJornada.__table__.create(bind=conn)
                lista = ", ".join(c for c in columnas if c in ConsumoJornada.__table__.c)
                conn.execute(text(f"INSERT INTO consumo_jornadas ({lista}) SELECT {lista} FROM consumo_jornadas_anterior"))
                conn.execute(text("DROP TABLE consumo_jornadas_anterior"))
        elif unicas:
            with engine.begin() as conn:
                for u in unicas:
                    conn.execute(text(f"ALTER TABLE consumo_jornadas DROP CONSTRAINT IF EXISTS {u['name']}"))
        with engine.begin() as conn:
            conn.execute(text("UPDATE consumo_jornadas SET estado = 'ACTIVO' WHERE estado IS NULL"))
            conn.execute(text("UPDATE consumo_jornadas SET consumido = 1 WHERE (consumido IS NULL OR consumido = 0) AND EXISTS "
                              "(SELECT 1 FROM consumo_frascos f WHERE f.id = consumo_jornadas.frasco_id "
                              "AND f.estado = 'CONSUMIDO' AND f.consumido_en = consumo_jornadas.fecha)"))
    except Exception as e:
        print(f"Consumo: varios registros por día ({type(e).__name__}: {e}).")


COOKIE_PRUEBAS = "consumo_pruebas"


def _prueba(request: Request) -> bool:
    """Modo pruebas (por navegador): lo que se registra queda marcado como prueba y no se mezcla con lo real."""
    return request.cookies.get(COOKIE_PRUEBAS) == "1"


class ModoIn(BaseModel):
    activo: bool = False


@router.post("/consumo/api/modo-pruebas")
def api_modo_pruebas(payload: ModoIn, user: Empleado = Depends(require_submodulo(SUB))):
    r = JSONResponse({"mensaje": "🧪 Modo pruebas activado." if payload.activo else "Volviste a los datos reales.",
                      "modoPruebas": payload.activo})
    if payload.activo:
        r.set_cookie(COOKIE_PRUEBAS, "1", max_age=60 * 60 * 12, httponly=True, samesite="lax")
    else:
        r.delete_cookie(COOKIE_PRUEBAS)
    return r


@router.post("/consumo/api/pruebas/borrar")
def api_borrar_pruebas(user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    if not sc.puede_entregar(db, user):
        raise HTTPException(403, "Solo los managers o administradores borran los datos de prueba.")
    n = sc.limpiar_pruebas(db)
    return {"mensaje": f"🗑️ Datos de prueba borrados: {n['entregas']} entregas, {n['frascos']} frascos y {n['jornadas']} registros. "
                       "Los datos reales no se tocaron."}


class TrasladoIn(BaseModel):
    tecnico_id: int
    motivo: str = ""


@router.post("/consumo/api/frascos/{frasco_id}/trasladar")
def api_trasladar(frasco_id: int, payload: TrasladoIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'traslado')
    f = db.get(ConsumoFrasco, frasco_id)
    if not f:
        raise HTTPException(404, "Frasco no encontrado.")
    error = sc.trasladar_frasco(db, user, f, payload.tecnico_id, payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"🔁 Frasco {f.serie} trasladado a {nombre_propio(f.tecnico_vigente.empleado.nombre_completo)}. "
                       "Lo ya registrado sigue a nombre de quien lo produjo."}


@router.get("/consumo")
def pagina(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_tipos(db)
    puede = sc.puede_entregar(db, user)
    secciones = [s for s in acs.secciones_de(db, user, SUB) if puede or s not in ("entrega", "consulta", "traslado", "general", "sinregistro")]
    return templates.TemplateResponse(request, "consumo.html", {
        "user": user, "es_consumo": True, "puede_entregar": puede, "area_manager": sc.area_manager(db, user),
        "secciones": secciones, "consumo_tab_inicial": secciones[0] if secciones else "", "modo_pruebas": _prueba(request)})


@router.get("/consumo/api/datos")
def api_datos(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_tipos(db)
    area = sc.area_manager(db, user)
    return {
        "tecnicos": [{"id": t.id, "nombre": nombre_propio(t.empleado.nombre_completo), "area": t.area}
                     for t in sc.tecnicos_visibles(db, user)],
        "materias": [{"id": m.id, "descripcion": m.descripcion, "presentacion": m.presentacion, "contenido": m.contenido,
                      "area": m.area, "mideArcos": "arcos" in sc.medidas_de(m), "medidas": sc.medidas_de(m)} for m in sc.materias_activas(db)],
        "tipos": [{"id": str(t.id), "nombre": t.nombre} for t in sc.tipos_activos(db)],
        "areaManager": area, "esAdmin": sc.es_admin(user), "puedeEntregar": sc.puede_entregar(db, user),
        "puedeEditar": sc.puede_entregar(db, user) or sc.mi_tecnico(db, user) is not None,  # jornada
        "manager": nombre_propio(user.nombre_completo), "hoy": sc.hoy_colombia().isoformat(),
        "modoPruebas": _prueba(request),
        "areas": sorted({t.area for t in sc.tecnicos_visibles(db, user) if t.area}),
    }


class FrascoIn(BaseModel):
    materia_id: int
    lote: str = ""
    ref: str = ""
    serie: str = ""


class EntregaIn(BaseModel):
    fecha: str
    hora: str = ""
    tecnico_id: int
    observaciones: str = ""
    frascos: list[FrascoIn] = []


@router.post("/consumo/api/entregas")
def api_crear_entrega(payload: EntregaIn, request: Request, user: Empleado = Depends(require_submodulo(SUB)),
                      db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'entrega')
    datos = payload.model_dump()
    e = sc.crear_entrega(db, user, datos, _prueba(request))
    if isinstance(e, str):
        raise HTTPException(400, e)
    return {"mensaje": f"✅ Entrega registrada. Consecutivo n.º {e.id:04d} ({len(e.frascos)} frasco(s)).", "entrega": sc.serializar_entrega(e)}


@router.get("/consumo/api/entregas")
def api_entregas(request: Request, desde: str = "", hasta: str = "", tecnico_id: int = 0,
                 user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'consulta')
    d, h = _rango(desde, hasta)
    entregas = sc.listar_entregas(db, user, _prueba(request), d, h, tecnico_id or None)
    return {"data": [sc.serializar_entrega(e) for e in entregas], "limite": sc.ULTIMOS_CONSULTA}


def _solo_managers(db: Session, user: Empleado) -> None:
    if not sc.puede_entregar(db, user):
        raise HTTPException(403, "Esta sección es solo para managers y administradores.")


@router.get("/consumo/api/traslados/frascos")
def api_frascos_traslado(tecnico_id: int, request: Request, user: Empleado = Depends(require_submodulo(SUB)),
                         db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'traslado')
    _solo_managers(db, user)
    return {"frascos": sc.frascos_disponibles(db, _tecnico(db, user, tecnico_id), _prueba(request))}


class TrasladoVariosIn(BaseModel):
    frasco_ids: list[int] = []
    tecnico_id: int = 0
    motivo: str = ""


@router.post("/consumo/api/traslados")
def api_trasladar_varios(payload: TrasladoVariosIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'traslado')
    error = sc.trasladar_varios(db, user, payload.frasco_ids, payload.tecnico_id, payload.motivo)
    if error:
        raise HTTPException(400, error)
    destino = db.get(ConsumoTecnico, payload.tecnico_id)
    n = len(set(payload.frasco_ids))
    return {"mensaje": f"🔁 {n} frasco{'s' if n != 1 else ''} trasladado{'s' if n != 1 else ''} a "
                       f"{nombre_propio(destino.empleado.nombre_completo)}. Lo ya registrado sigue a nombre de quien lo produjo."}


@router.get("/consumo/api/traslados")
def api_historial_traslados(request: Request, desde: str = "", hasta: str = "", tecnico_id: int = 0,
                            user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'traslado')
    _solo_managers(db, user)
    d, h = _rango(desde, hasta)
    return {"data": sc.historial_traslados(db, user, _prueba(request), d, h, tecnico_id or None), "limite": sc.ULTIMOS_CONSULTA}


def _mes(anio: int, mes: int) -> tuple[int, int]:
    hoy = sc.hoy_colombia()
    anio, mes = anio or hoy.year, mes or hoy.month
    if not (1 <= mes <= 12 and 2000 <= anio <= 2100):
        raise HTTPException(400, "Mes inválido.")
    return anio, mes


@router.get("/consumo/api/sin-registro")
def api_sin_registro(request: Request, fecha: str = "", area: str = "", user: Empleado = Depends(require_submodulo(SUB)),
                     db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'sinregistro')
    _solo_managers(db, user)
    return sc.sin_registro(db, user, _fecha(fecha) if fecha else sc.hoy_colombia(), area, _prueba(request))


@router.get("/consumo/api/sin-registro/exportar")
def api_sin_registro_exportar(request: Request, fecha: str = "", area: str = "", user: Empleado = Depends(require_submodulo(SUB)),
                              db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'sinregistro')
    _solo_managers(db, user)
    r = sc.sin_registro(db, user, _fecha(fecha) if fecha else sc.hoy_colombia(), area, _prueba(request))
    salida = io.StringIO()
    salida.write("\ufeff")
    w = csv.writer(salida, delimiter=";")
    w.writerow([f"TÉCNICOS SIN REGISTRO DE JORNADA — {r['fecha']}"])
    w.writerow(["Técnico", "Área", "Frascos en uso", "Último registro", "Días desde el último registro"])
    for x in r["faltan"]:
        w.writerow([x["tecnico"], x["area"], " | ".join(x["frascos"]), x["ultimoRegistro"] or "Nunca",
                    "" if x["diasDesdeUltimo"] is None else x["diasDesdeUltimo"]])
    w.writerow([])
    w.writerow(["RESUMEN DEL MES (días hábiles)"])
    w.writerow(["Técnico", "Área", "Días sin registro", "Fechas"])
    for x in r["diario"]["filas"]:
        w.writerow([x["tecnico"], x["area"], x["faltas"], ", ".join(x["fechasFalta"])])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="sin_registro_{r["fecha"]}.csv"'})


@router.get("/consumo/api/general")
def api_general(request: Request, anio: int = 0, mes: int = 0, area: str = "", tecnico_id: int = 0,
                user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'general')
    _solo_managers(db, user)
    a, m = _mes(anio, mes)
    return sc.reporte_general(db, user, a, m, area, tecnico_id or None, _prueba(request))


@router.get("/consumo/api/general/exportar")
def api_general_exportar(request: Request, anio: int = 0, mes: int = 0, area: str = "", tecnico_id: int = 0,
                         user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'general')
    _solo_managers(db, user)
    a, m = _mes(anio, mes)
    r = sc.reporte_general(db, user, a, m, area, tecnico_id or None, _prueba(request))
    salida = io.StringIO()
    salida.write("\ufeff")
    w = csv.writer(salida, delimiter=";")
    nombres = [t["nombre"] for t in r["tipos"]]
    w.writerow([f"REPORTE GENERAL — {r['nombreMes'].upper()}"])
    w.writerow(["Puesto", "Técnico", "Área", "Arcos", *nombres, "Variación vs mes anterior (%)", "Días con registro",
                "Arcos por día", "Cumplimiento (%)", "Frascos consumidos", "Arcos por frasco", "Rendimiento vs área (%)",
                "Gotas", "Gotas por arco", "Gotas vs área (%)", "Duración frasco (días)", "Frascos en uso al cierre",
                "Con alerta de días", "Registros", "Solicitudes de anulación", "Anulados", "Error (%)", "Traslados recibidos",
                "Traslados entregados"])
    v = lambda x: "" if x is None else x  # noqa: E731
    for t in r["tecnicos"]:
        w.writerow([t["puesto"], t["tecnico"], t["area"], t["arcos"], *[t["tipos"].get(x["id"], 0) for x in r["tipos"]],
                    v(t["variacionArcos"]), t["dias"], v(t["arcosDia"]), v(t["cumplimiento"]), t["consumidos"], v(t["arcosPorFrasco"]),
                    v(t["rendimiento"]), t["gotas"], v(t["gotasPorArco"]), v(t["gotasIndice"]), v(t["duracion"]), t["enUso"],
                    t["alertas"], t["registros"], t["solicitudes"], t["anulados"], v(t["error"]), t["recibidos"], t["entregados"]])
    w.writerow([])
    w.writerow(["CONSUMO PROMEDIO POR MATERIA PRIMA Y TIPO DE ARCO"])
    w.writerow(["Materia prima", "Contenido", "Frascos consumidos", "Tipo", "Arcos", "Arcos por frasco", "Consumo por arco", "Gotas por arco"])
    for x in r["consumoTipo"]:
        for t in r["tipos"]:
            c = x["tipos"].get(t["id"])
            if c:
                w.writerow([x["materia"], f"{v(x['contenido'])} {x['unidad']}", x["frascos"], t["nombre"], c["arcos"], v(c["arcosPorFrasco"]),
                            v(c["consumoPorArco"]), v(c["gotasPorArco"])])
    w.writerow([])
    w.writerow(["RENDIMIENTO POR LOTE"])
    w.writerow(["Materia prima", "Lote", "Frascos", "Arcos", "Arcos por frasco", "Promedio de la materia"])
    for x in r["lotes"]:
        w.writerow([x["materia"], x["lote"], x["frascos"], x["arcos"], x["promedio"], x["promedioMateria"]])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="reporte_general_{a}_{m:02d}.csv"'})


class MotivoIn(BaseModel):
    motivo: str = ""


@router.post("/consumo/api/entregas/{entrega_id}/anular")
def api_anular(entrega_id: int, payload: MotivoIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'consulta')
    e = db.get(ConsumoEntrega, entrega_id)
    if not e:
        raise HTTPException(404, "Entrega no encontrada.")
    error = sc.anular_entrega(db, e, user, payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ Entrega n.º {e.id:04d} anulada.", "entrega": sc.serializar_entrega(e)}


def _tecnico(db: Session, user: Empleado, tecnico_id: int) -> ConsumoTecnico:
    t = db.get(ConsumoTecnico, tecnico_id)
    if not t or not sc.puede_gestionar_tecnico(db, user, t):
        raise HTTPException(403, "No puedes ver ni registrar la jornada de ese técnico.")
    return t


def _fecha(valor: str) -> date:
    try:
        return date.fromisoformat(valor)
    except ValueError:
        raise HTTPException(400, "Fecha inválida.")


@router.get("/consumo/api/jornada")
def api_jornada(tecnico_id: int, fecha: str, request: Request, user: Empleado = Depends(require_submodulo(SUB)),
                db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    t = _tecnico(db, user, tecnico_id)
    f, p = _fecha(fecha), _prueba(request)
    return {"frascos": sc.frascos_para_jornada(db, t, f, p),
            "puedeCorregir": sc.puede_corregir_jornada(db, user, t),
            "diaAbierto": sc.dia_abierto(db, user, t, f, p), "apertura": sc.serializar_apertura(sc.apertura_de(db, t.id, f, p)),
            "usuarioId": user.id, "esElTecnico": t.empleado_id == user.id}


def _registro(db: Session, registro_id: int) -> ConsumoJornada:
    r = db.get(ConsumoJornada, registro_id)
    if not r:
        raise HTTPException(404, "Registro no encontrado.")
    return r


@router.get("/consumo/api/jornada/solicitudes")
def api_solicitudes(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    return {"solicitudes": sc.solicitudes_pendientes(db, user, _prueba(request)),
            "aperturas": sc.aperturas_pendientes(db, user, _prueba(request))}


class AperturaIn(BaseModel):
    tecnico_id: int
    fecha: str
    motivo: str = ""


@router.post("/consumo/api/jornada/aperturas")
def api_solicitar_apertura(payload: AperturaIn, request: Request, user: Empleado = Depends(require_submodulo(SUB)),
                           db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    t = _tecnico(db, user, payload.tecnico_id)
    a = sc.solicitar_apertura(db, user, t, _fecha(payload.fecha), payload.motivo, _prueba(request))
    if isinstance(a, str):
        raise HTTPException(400, a)
    if not a.prueba:
        _avisar_apertura(db, a)
    return {"mensaje": f"📨 Solicitud enviada: el manager de tu área decide si abre el día {a.fecha.isoformat()}."}


def _avisar_apertura(db: Session, a: ConsumoApertura) -> None:
    try:
        from ..zoho_cliq import enviar_cliq_varios, boton_enlace
        from .. import config
        emails = [m.email for m in sc.managers_del_area(db, a.tecnico.area) if m.email]
        if emails:
            enviar_cliq_varios(emails, f"📅 *Solicitud para abrir un día — Seguimiento de consumo*\n"
                                       f"Técnico: {nombre_propio(a.tecnico.empleado.nombre_completo)} ({nombre_propio(a.tecnico.area)})\n"
                                       f"Día: {a.fecha.isoformat()}\nMotivo: {a.motivo}",
                               [boton_enlace("Revisar", f"{config.BASE_URL}/consumo?tab=jornada")])
    except Exception as e:
        print(f"Consumo: aviso de apertura de día ({type(e).__name__}: {e}).")


@router.post("/consumo/api/jornada/aperturas/{apertura_id}/{accion}")
def api_resolver_apertura(apertura_id: int, accion: str, payload: MotivoIn, user: Empleado = Depends(require_submodulo(SUB)),
                          db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    if accion not in ("aprobar", "rechazar"):
        raise HTTPException(404, "Acción no válida.")
    a = db.get(ConsumoApertura, apertura_id)
    if not a:
        raise HTTPException(404, "Solicitud no encontrada.")
    error = sc.resolver_apertura(db, user, a, accion == "aprobar", payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": f"✅ Día {a.fecha.isoformat()} abierto para {nombre_propio(a.tecnico.empleado.nombre_completo)} hasta el final de hoy."
            if accion == "aprobar" else "Solicitud rechazada: el día sigue cerrado."}


@router.post("/consumo/api/jornada/registros/{registro_id}/solicitar-anulacion")
def api_solicitar_anulacion(registro_id: int, payload: MotivoIn, user: Empleado = Depends(require_submodulo(SUB)),
                            db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    r = _registro(db, registro_id)
    error = sc.solicitar_anulacion(db, user, r, payload.motivo)
    if error:
        raise HTTPException(400, error)
    _avisar_solicitud(db, r)
    return {"mensaje": "📨 Solicitud enviada. El manager de tu área decide si se anula el registro."}


def _avisar_solicitud(db: Session, r: ConsumoJornada) -> None:
    """Aviso por Cliq al manager del área (si falla, la solicitud igual queda y sale en el recordatorio)."""
    try:
        from ..zoho_cliq import enviar_cliq_varios, boton_enlace
        from .. import config
        f = r.frasco
        if f.entrega.prueba:  # en modo pruebas no se envían avisos
            return
        tecnico = sc._tecnico_de(r)
        emails = [m.email for m in sc.managers_del_area(db, tecnico.area) if m.email]
        if not emails:
            return
        texto = (f"📨 *Solicitud de anulación — Seguimiento de consumo*\n"
                 f"Técnico: {nombre_propio(tecnico.empleado.nombre_completo)} ({nombre_propio(tecnico.area)})\n"
                 f"Registro del {r.fecha.isoformat()}: {f.materia.descripcion} · serie {f.serie} · {r.total:g} arcos · {r.gotas or 0:g} gotas\n"
                 f"Observación: {r.solicitud_motivo}")
        enviar_cliq_varios(emails, texto, [boton_enlace("Revisar", f"{config.BASE_URL}/consumo?tab=jornada")])
    except Exception as e:
        print(f"Consumo: aviso de solicitud de anulación ({type(e).__name__}: {e}).")


@router.post("/consumo/api/jornada/registros/{registro_id}/anular")
def api_anular_registro(registro_id: int, payload: MotivoIn, user: Empleado = Depends(require_submodulo(SUB)),
                        db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    error = sc.anular_registro(db, user, _registro(db, registro_id), payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "🚫 Registro anulado. Ya no cuenta en los acumulados ni en los reportes."}


@router.post("/consumo/api/jornada/registros/{registro_id}/rechazar")
def api_rechazar_solicitud(registro_id: int, payload: MotivoIn, user: Empleado = Depends(require_submodulo(SUB)),
                           db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    error = sc.rechazar_solicitud(db, user, _registro(db, registro_id), payload.motivo)
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "Solicitud rechazada: el registro sigue vigente."}


class FilaJornadaIn(BaseModel):
    frasco_id: int
    arcos: dict = {}
    gotas: float = 0
    consumido: bool = False
    observacion: str = ""


class JornadaIn(BaseModel):
    tecnico_id: int
    fecha: str
    filas: list[FilaJornadaIn] = []


@router.post("/consumo/api/jornada")
def api_guardar_jornada(payload: JornadaIn, request: Request, user: Empleado = Depends(require_submodulo(SUB)),
                        db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    t = _tecnico(db, user, payload.tecnico_id)
    error = sc.guardar_jornada(db, user, t, _fecha(payload.fecha), [f.model_dump() for f in payload.filas], _prueba(request))
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "✅ Registro guardado. Ya no se puede modificar: si hay un error, solicita la anulación al manager."}


def _rango(desde: str, hasta: str) -> tuple[date | None, date | None]:
    return (_fecha(desde) if desde else None), (_fecha(hasta) if hasta else None)


@router.get("/consumo/api/reportes")
def api_reportes(request: Request, desde: str = "", hasta: str = "", tecnico_id: int = 0, materia_id: int = 0,
                 user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'reportes')
    d, h = _rango(desde, hasta)
    return sc.reportes(db, d, h, tecnico_id or None, materia_id or None, user, _prueba(request))


@router.get("/consumo/api/reportes/exportar")
def api_exportar(request: Request, desde: str = "", hasta: str = "", tecnico_id: int = 0, materia_id: int = 0,
                 user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'reportes')
    _solo_managers(db, user)  # los técnicos no exportan
    d, h = _rango(desde, hasta)
    r = sc.reportes(db, d, h, tecnico_id or None, materia_id or None, user, _prueba(request))
    salida = io.StringIO()
    salida.write("﻿")
    w = csv.writer(salida, delimiter=";")
    nombres = [t["nombre"] for t in r["tipos"]]
    w.writerow(["PRODUCTIVIDAD POR TÉCNICO"])
    w.writerow(["Técnico", "Área", *nombres, "Total arcos", "Frascos consumidos", "Promedio arcos/frasco", "Días trabajados"])
    for t in r["tecnicos"]:
        w.writerow([t["tecnico"], t["area"], *[t["tipos"].get(x["id"], 0) for x in r["tipos"]], t["total"], t["consumidos"],
                    t["promedio"] if t["promedio"] is not None else "", t["dias"]])
    w.writerow([])
    w.writerow(["RENDIMIENTO POR MATERIA PRIMA Y LOTE (frascos consumidos)"])
    w.writerow(["Materia prima", "Lote", "Frascos", *nombres, "Total arcos", "Promedio arcos/frasco", "Promedio de la materia"])
    for m in r["lotes"]:
        w.writerow([m["materia"], m["lote"], m["frascos"], *[m["tipos"].get(x["id"], 0) for x in r["tipos"]], m["arcos"],
                    m["promedio"], m["promedioMateria"]])
    w.writerow([])
    w.writerow(["GOTAS USADAS"])
    w.writerow(["Técnico", "Área", "Materia prima", "Gotas", "Arcos", "Gotas por arco", "Promedio de la materia", "Días"])
    for g in r["gotas"]:
        w.writerow([g["tecnico"], g["area"], g["materia"], g["gotas"], g["arcos"] if g["mideArcos"] else "",
                    g["gotasPorArco"] if g["gotasPorArco"] is not None else "", g["promedioMateria"] or "", g["dias"]])
    w.writerow([])
    w.writerow(["FRASCOS EN USO"])
    w.writerow(["Técnico", "Área", "Materia prima", "Lote", "Ref", "Serie", "Fecha entrega", "Días abierto", "Arcos acumulados", "Gotas acumuladas"])
    for x in r["wip"]:
        w.writerow([x["tecnico"], x["area"], x["materia"], x["lote"], x["ref"], x["serie"], x["fechaEntrega"], x["dias"], x["acumulado"] if x["midesArcos"] else "", x["gotas"] if x["midesGotas"] else ""])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="seguimiento_consumo.csv"'})


# ---------------- Parámetros (Producción › Parámetros › Seguimiento de consumo) ----------------

VOLVER = "/inventario/parametros?tab={tab}&msg={msg}"


def _volver(tab: str, msg: str) -> RedirectResponse:
    return RedirectResponse(VOLVER.format(tab=tab, msg=msg), status_code=303)


def _texto(v: str) -> str:
    return (v or "").strip().upper()


@router.post("/inventario/parametros/consumo/limpiar")
def limpiar(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), confirmacion: str = Form("")):
    """Empezar desde cero (administradores): borra entregas, frascos y jornadas; conserva los parámetros."""
    if (confirmacion or "").strip().upper() != "BORRAR":
        return _volver("c_accesos", "No se borró nada: escribe BORRAR para confirmar.")
    from ..services import auditar
    n = sc.limpiar_movimientos(db)
    auditar(db, user.email, "Seguimiento de consumo: datos borrados (empezar desde cero)",
            f"{n['entregas']} entregas, {n['frascos']} frascos, {n['jornadas']} jornadas")
    db.commit()
    return _volver("c_accesos", f"🧹 Listo: se borraron {n['entregas']} entregas, {n['frascos']} frascos y {n['jornadas']} jornadas. "
                                "Managers, técnicos y materias primas se conservan.")


@router.post("/inventario/parametros/consumo/materias")
def crear_materia(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), descripcion: str = Form(...),
                  presentacion: str = Form(""), contenido: str = Form(""), area: str = Form(""), medida: list[str] = Form([]),
                  dias_alerta: int = Form(0)):
    if not _texto(descripcion):
        return _volver("c_materias", "No se guardó: escribe la descripción.")
    medida = sc.normalizar_medidas(medida)
    orden = db.query(ConsumoMateria).count() + 1
    db.add(ConsumoMateria(descripcion=_texto(descripcion), presentacion=_texto(presentacion), contenido=_texto(contenido),
                          area=_texto(area), medida=medida, mide_arcos="arcos" in medida, orden=orden,
                          dias_alerta=max(int(dias_alerta or 0), 0)))
    db.commit()
    return _volver("c_materias", "Materia prima agregada.")


@router.post("/inventario/parametros/consumo/materias/{materia_id}")
def editar_materia(materia_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db),
                   descripcion: str = Form(...), presentacion: str = Form(""), contenido: str = Form(""), area: str = Form(""),
                   medida: list[str] = Form([]), dias_alerta: int = Form(0)):
    m = db.get(ConsumoMateria, materia_id)
    if m and _texto(descripcion):
        m.descripcion, m.presentacion, m.contenido, m.area = _texto(descripcion), _texto(presentacion), _texto(contenido), _texto(area)
        m.medida = sc.normalizar_medidas(medida)
        m.mide_arcos = "arcos" in m.medida
        m.dias_alerta = max(int(dias_alerta or 0), 0)
        db.commit()
    return _volver("c_materias", "Materia prima actualizada.")


@router.post("/inventario/parametros/consumo/materias/{materia_id}/toggle")
def toggle_materia(materia_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db)):
    m = db.get(ConsumoMateria, materia_id)
    if m:
        m.activo = 0 if m.activo else 1
        db.commit()
    return _volver("c_materias", "Materia prima actualizada.")


@router.post("/inventario/parametros/consumo/tipos")
def crear_tipo(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), nombre: str = Form(...)):
    nombre = _texto(nombre)
    if nombre and not db.query(ConsumoTipo).filter(ConsumoTipo.nombre == nombre).first():
        db.add(ConsumoTipo(nombre=nombre, orden=db.query(ConsumoTipo).count() + 1))
        db.commit()
    return _volver("c_tipos", "Tipo de producto agregado.")


@router.post("/inventario/parametros/consumo/tipos/{tipo_id}")
def editar_tipo(tipo_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), nombre: str = Form(...)):
    t, nombre = db.get(ConsumoTipo, tipo_id), _texto(nombre)
    if t and nombre and not db.query(ConsumoTipo).filter(ConsumoTipo.nombre == nombre, ConsumoTipo.id != tipo_id).first():
        t.nombre = nombre
        db.commit()
    return _volver("c_tipos", "Tipo de producto actualizado.")


@router.post("/inventario/parametros/consumo/tipos/{tipo_id}/toggle")
def toggle_tipo(tipo_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db)):
    t = db.get(ConsumoTipo, tipo_id)
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return _volver("c_tipos", "Tipo de producto actualizado.")


def _dar_acceso_tecnico(db: Session, e: Empleado, secciones: list[str], user: Empleado) -> str | None:
    """El técnico entra a Seguimiento de consumo solo a las secciones elegidas."""
    from .. import acceso_secciones as acs
    elegidas = [s for s in acs.todas(SUB) if s in set(secciones)]
    if not elegidas:
        return "No se guardó: elige al menos una sección a la que entra el técnico."
    if MODULO_PRODUCCION not in e.modulos_lista:
        e.modulos = ",".join(e.modulos_lista + [MODULO_PRODUCCION])
    if not db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).first():
        db.add(ProduccionAcceso(empleado_id=e.id, submodulo=SUB))
    db.commit()
    return acs.guardar(db, e.id, SUB, elegidas, user)


@router.post("/inventario/parametros/consumo/tecnicos")
def agregar_tecnico(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db),
                    empleado_id: int = Form(...), area: str = Form(""), secciones: list[str] = Form([])):
    """Agrega el técnico con su área y le da acceso a Seguimiento de consumo en las secciones elegidas."""
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("c_tecnicos", "No se guardó: elige una persona de la lista.")
    if not _texto(area):
        return _volver("c_tecnicos", "No se guardó: elige el área del técnico.")
    if not secciones:
        return _volver("c_tecnicos", "No se guardó: elige al menos una sección a la que entra el técnico.")
    t = db.query(ConsumoTecnico).filter(ConsumoTecnico.empleado_id == e.id).first()
    if t:
        t.area, t.activo = _texto(area), 1
    else:
        db.add(ConsumoTecnico(empleado_id=e.id, area=_texto(area)))
    db.commit()
    error = _dar_acceso_tecnico(db, e, secciones, user)
    if error:
        return _volver("c_tecnicos", error)
    return _volver("c_tecnicos", f"{nombre_propio(e.nombre_completo)} agregado como técnico, con acceso a Seguimiento de consumo.")


@router.post("/inventario/parametros/consumo/tecnicos/{tecnico_id}/acceso")
def acceso_tecnico(tecnico_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db),
                   secciones: list[str] = Form([])):
    """Da acceso (con sus secciones) a un técnico que ya estaba en la lista sin acceso al submódulo."""
    t = db.get(ConsumoTecnico, tecnico_id)
    if not t or not t.empleado:
        return _volver("c_tecnicos", "Técnico no encontrado.")
    error = _dar_acceso_tecnico(db, t.empleado, secciones, user)
    return _volver("c_tecnicos", error or f"Acceso a Seguimiento de consumo dado a {nombre_propio(t.empleado.nombre_completo)}.")


@router.post("/inventario/parametros/consumo/tecnicos/{tecnico_id}")
def editar_tecnico(tecnico_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), area: str = Form("")):
    t = db.get(ConsumoTecnico, tecnico_id)
    if t and _texto(area):
        t.area = _texto(area)
        db.commit()
    return _volver("c_tecnicos", "Técnico actualizado.")


@router.post("/inventario/parametros/consumo/tecnicos/{tecnico_id}/toggle")
def toggle_tecnico(tecnico_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db)):
    t = db.get(ConsumoTecnico, tecnico_id)
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return _volver("c_tecnicos", "Técnico actualizado (sus registros se conservan).")


@router.post("/inventario/parametros/consumo/accesos")
def agregar_acceso(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db),
                   empleado_id: int = Form(...), area: str = Form(""), secciones: list[str] = Form([])):
    """Da acceso a Seguimiento de consumo como manager de un área: crea entregas, registra y corrige jornadas y anula
    (solo de su área), en las secciones elegidas. Los técnicos reciben su acceso en la pestaña Técnicos."""
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("c_accesos", "No se guardó: elige una persona de la lista.")
    if not _texto(area) and not sc.es_admin(e):
        return _volver("c_accesos", "No se guardó: elige el área del manager.")
    if MODULO_PRODUCCION not in e.modulos_lista:
        e.modulos = ",".join(e.modulos_lista + [MODULO_PRODUCCION])
    if not db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).first():
        db.add(ProduccionAcceso(empleado_id=e.id, submodulo=SUB))
    m = db.query(ConsumoManager).filter(ConsumoManager.empleado_id == e.id).first()
    if _texto(area):
        if m:
            m.area = _texto(area)
        else:
            db.add(ConsumoManager(empleado_id=e.id, area=_texto(area)))
    elif m:
        db.delete(m)
    db.commit()
    if secciones:  # al agregar se eligen sus secciones; al cambiar el área no se tocan
        error = acs.guardar(db, e.id, SUB, secciones, user)
        if error:
            return _volver("c_accesos", error)
    return _volver("c_accesos", f"{nombre_propio(e.nombre_completo)} quedó como manager de Seguimiento de consumo.")


@router.post("/inventario/parametros/consumo/accesos/{empleado_id}/quitar")
def quitar_acceso(empleado_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db)):
    e = db.get(Empleado, empleado_id)
    if e:
        db.query(ProduccionAcceso).filter_by(empleado_id=e.id, submodulo=SUB).delete()
        db.query(ConsumoManager).filter(ConsumoManager.empleado_id == e.id).delete()
        from .. import acceso_secciones as acs
        acs.quitar(db, e.id, SUB)
        if not db.query(ProduccionAcceso).filter(ProduccionAcceso.empleado_id == e.id).first():
            e.modulos = ",".join(m for m in e.modulos_lista if m != MODULO_PRODUCCION)
        db.commit()
    return _volver("c_accesos", "Acceso a Seguimiento de consumo quitado.")
