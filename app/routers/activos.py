"""Módulo Activos: /activos (aterrizaje, Smiles próximamente / Design) y /activos/design (inventario
de hardware de TI, migrado desde un proyecto aparte -- ver docs/wiki/activos.md)."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..concurrencia import RutaGeneral
from ..database import get_db
from ..models import Empleado
from ..auth import get_current_user, require_modulo
from ..main_templates import templates
from .. import services_activos as sa
from .. import services_activos_mantenimiento as sm
from .. import services_activos_consultas as sc
from .. import services_activos_excel as se

router = APIRouter(route_class=RutaGeneral)
require_activos = require_modulo("activos")


def _manejar(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except sa.NoEncontrado as e:
        raise HTTPException(404, str(e))
    except sa.Conflicto as e:
        raise HTTPException(409, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- Aterrizaje ----------

@router.get("/activos")
def pagina_activos(request: Request, user: Empleado = Depends(require_activos)):
    return templates.TemplateResponse(request, "activos.html", {"user": user, "es_portal": True})


@router.get("/activos/design")
def pagina_activos_design(request: Request, user: Empleado = Depends(require_activos)):
    return templates.TemplateResponse(request, "activos_design.html", {"user": user})


# ---------- Resumen ----------

@router.get("/activos/design/api/resumen")
def api_resumen(user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.obtener_resumen(db)


@router.get("/activos/design/api/mantenimientos/estado")
def api_estado_mantenimiento(user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_estado_mantenimiento, db)


# ---------- Equipos ----------

class EquipoEntrada(BaseModel):
    asset_tag: str = Field(min_length=1, max_length=40)
    tipo_equipo: str
    marca: str
    modelo: str = Field(alias="modelo", max_length=120)
    serial_number: str
    sistema_operativo: str | None = None
    observaciones: str | None = None
    procesador: str | None = None
    memoria_ram: str | None = None
    almacenamiento: str | None = None

    model_config = {"populate_by_name": True}


class AsignacionEquipoEntrada(BaseModel):
    asset_tag: str
    id_usuario: int | None = Field(default=None, gt=0)
    motivo: str


class MotivoEntrada(BaseModel):
    motivo: str


class RetiroEquipoEntrada(MotivoEntrada):
    asset_tag: str


class EstadoEquipoEntrada(BaseModel):
    asset_tag: str
    nuevo_estado: str
    motivo: str | None = None


@router.get("/activos/design/api/equipos")
def api_equipos(busqueda: str = "", area: str = "", departamento: str = "", estado: str = "", tipo: str = "", dongle: str = "",
                user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_equipos(db, busqueda, area or None, departamento or None, estado or None, tipo or None, dongle or None)


@router.get("/activos/design/api/equipos/exportar")
def api_equipos_exportar(busqueda: str = "", area: str = "", departamento: str = "", estado: str = "", tipo: str = "", dongle: str = "",
                         user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    datos = se.exportar_equipos(db, busqueda, area or None, departamento or None, estado or None, tipo or None, dongle or None)
    return Response(datos, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=equipos_activos.xlsx"})


@router.post("/activos/design/api/equipos", status_code=201)
def api_equipo_registrar(payload: EquipoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    e = _manejar(sa.registrar_equipo, db, user, payload.asset_tag, payload.tipo_equipo, payload.marca, payload.modelo,
                payload.serial_number, payload.sistema_operativo, payload.observaciones, payload.procesador,
                payload.memoria_ram, payload.almacenamiento)
    return {"mensaje": "Equipo registrado correctamente.", "asset_tag": e.asset_tag}


@router.post("/activos/design/api/equipos/asignar")
def api_equipo_asignar(payload: AsignacionEquipoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.asignar_equipo, db, user, payload.asset_tag, payload.id_usuario, payload.motivo)
    return {"mensaje": "Cambio registrado correctamente."}


@router.post("/activos/design/api/equipos/retirar")
def api_equipo_retirar(payload: RetiroEquipoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.retirar_equipo, db, user, payload.asset_tag, payload.motivo)
    return {"mensaje": "Equipo retirado correctamente."}


@router.post("/activos/design/api/equipos/mantenimiento")
def api_equipo_estado(payload: EstadoEquipoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    e = _manejar(sa.actualizar_estado_equipo, db, user, payload.asset_tag, payload.nuevo_estado, payload.motivo)
    return {"mensaje": "Estado actualizado.", "asset_tag": e.asset_tag, "estado": e.estado}


@router.get("/activos/design/api/equipos/{asset_tag}")
def api_equipo_obtener(asset_tag: str, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_ficha_equipo, db, asset_tag)["equipo"]


@router.put("/activos/design/api/equipos/{asset_tag}")
def api_equipo_actualizar(asset_tag: str, payload: EquipoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    if payload.asset_tag != asset_tag:
        raise HTTPException(400, "El Asset Tag no coincide.")
    _manejar(sa.actualizar_equipo, db, user, asset_tag, payload.tipo_equipo, payload.marca, payload.modelo,
            payload.serial_number, payload.sistema_operativo, payload.observaciones, payload.procesador,
            payload.memoria_ram, payload.almacenamiento)
    return {"mensaje": "Equipo actualizado.", "asset_tag": asset_tag}


@router.get("/activos/design/api/equipos/{asset_tag}/ficha")
def api_equipo_ficha(asset_tag: str, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_ficha_equipo, db, asset_tag)


@router.get("/activos/design/api/equipos/{asset_tag}/acta")
def api_equipo_contexto_acta(asset_tag: str, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_contexto_acta_equipo, db, asset_tag)


@router.get("/activos/design/api/retirados")
def api_retirados_equipos(busqueda: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_equipos_retirados(db, busqueda)


@router.get("/activos/design/api/retirados/usuarios")
def api_retirados_usuarios(busqueda: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_usuarios_retirados(db, busqueda)


# ---------- Actas digitales ----------

class ActaEntregaEntrada(BaseModel):
    asset_tag: str
    id_usuario: int = Field(gt=0)
    firma_base64: str = Field(min_length=40, max_length=2_000_000)
    observaciones: str | None = None


@router.post("/activos/design/api/actas/generar", status_code=201)
def api_acta_generar(payload: ActaEntregaEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    if not payload.firma_base64.startswith("data:image/png;base64,"):
        raise HTTPException(400, "La firma debe ser una imagen PNG.")
    from .. import models_activos as ma
    import base64
    try:
        base64.b64decode(payload.firma_base64.split(",", 1)[1])
    except Exception:
        raise HTTPException(400, "La firma no es un PNG válido.")
    e = sc.obtener_contexto_acta_equipo(db, payload.asset_tag)   # valida vigencia en el momento de archivar
    if e["usuario"]["id_usuario"] != payload.id_usuario:
        raise HTTPException(409, "El equipo ya no está asignado a ese usuario. Actualiza la página e inténtalo de nuevo.")
    acta = ma.ActivosActaEntrega(asset_tag=payload.asset_tag, empleado_id=payload.id_usuario,
                                 firma_base64=payload.firma_base64, observaciones=payload.observaciones, tipo_acta="ENTREGA")
    db.add(acta)
    sa.auditar(db, user, "Acta de entrega", f"Acta de entrega de {payload.asset_tag} a empleado #{payload.id_usuario}.")
    db.commit()
    db.refresh(acta)
    return {"mensaje": "Acta archivada correctamente.", "id_acta": acta.id_acta, "fecha": acta.fecha, "tipo_acta": "ENTREGA"}


@router.get("/activos/design/api/actas/{id_acta}/firma")
def api_acta_firma(id_acta: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    firma = sc.obtener_firma_acta(db, id_acta)
    if not firma or "," not in firma:
        raise HTTPException(404, "No existe esa firma.")
    import base64
    datos = base64.b64decode(firma.split(",", 1)[1])
    return Response(datos, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


# ---------- Mantenimientos ----------

class MantenimientoEntrada(BaseModel):
    asset_tag: str
    tipo_mantenimiento: str
    estado_mantenimiento: str
    fecha_programada: date
    fecha_realizada: date | None = None
    descripcion_falla: str
    acciones_realizadas: str = ""
    responsable: str


class MantenimientoActualizacion(BaseModel):
    tipo_mantenimiento: str | None = None
    estado_mantenimiento: str | None = None
    fecha_programada: date | None = None
    fecha_realizada: date | None = None
    descripcion_falla: str | None = None
    acciones_realizadas: str | None = None
    responsable: str | None = None
    devolver_stock: bool = False


class CompletarEntrada(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    acciones_realizadas: str | None = None
    fecha_realizada: date | None = None


@router.get("/activos/design/api/mantenimientos")
def api_mantenimientos(estado: str = "", fecha_desde: date | None = None, fecha_hasta: date | None = None, asset_tag: str = "",
                       user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.listar_mantenimientos, db, estado or None, fecha_desde, fecha_hasta, asset_tag)


@router.post("/activos/design/api/mantenimientos/completar")
def api_mantenimientos_completar(payload: CompletarEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    r = _manejar(sm.completar_mantenimientos, db, user, payload.ids, payload.acciones_realizadas, payload.fecha_realizada)
    return {"mensaje": f"{r['completados']} mantenimiento(s) completado(s).", **r}


@router.get("/activos/design/api/mantenimientos/{id_mantenimiento}")
def api_mantenimiento_obtener(id_mantenimiento: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_mantenimiento, db, id_mantenimiento)


@router.post("/activos/design/api/mantenimientos", status_code=201)
def api_mantenimiento_registrar(payload: MantenimientoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    m = _manejar(sm.registrar_mantenimiento, db, user, payload.model_dump())
    return {"mensaje": "Mantenimiento registrado.", "id_mantenimiento": m.id_mantenimiento}


@router.put("/activos/design/api/mantenimientos/{id_mantenimiento}")
def api_mantenimiento_actualizar(id_mantenimiento: int, payload: MantenimientoActualizacion,
                                 user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    datos = payload.model_dump(exclude_unset=True)
    devolver_stock = datos.pop("devolver_stock", False)
    r = _manejar(sm.actualizar_mantenimiento, db, user, id_mantenimiento, datos, devolver_stock)
    return {"mensaje": "Mantenimiento actualizado.", **r}


# ---------- Grupos y jornadas ----------

class GrupoEntrada(BaseModel):
    integrantes: list[int] = Field(max_length=500)


class JornadaEntrada(BaseModel):
    id_lider: int = Field(gt=0)
    tipo_mantenimiento: str = "PREVENTIVO"
    fecha_programada: date
    responsable: str
    descripcion: str | None = None
    asset_tags: list[str] | None = Field(default=None, max_length=500)
    frecuencia_meses: int | None = None


class JornadaActualizacion(BaseModel):
    fecha_programada: date | None = None
    responsable: str | None = None
    descripcion: str | None = None
    frecuencia_meses: int | None = None


@router.get("/activos/design/api/grupos")
def api_grupos(user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_grupos(db)


@router.get("/activos/design/api/grupos/{id_lider}")
def api_grupo_obtener(id_lider: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_grupo, db, id_lider)


@router.put("/activos/design/api/grupos/{id_lider}")
def api_grupo_actualizar(id_lider: int, payload: GrupoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.actualizar_grupo, db, user, id_lider, payload.integrantes)
    return {"mensaje": "Grupo actualizado."}


@router.get("/activos/design/api/jornadas")
def api_jornadas(estado: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_jornadas(db, estado or None)


@router.post("/activos/design/api/jornadas", status_code=201)
def api_jornada_crear(payload: JornadaEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    j = _manejar(sm.programar_jornada, db, user, payload.id_lider, payload.tipo_mantenimiento, payload.fecha_programada,
                payload.responsable, payload.descripcion, payload.asset_tags, payload.frecuencia_meses)
    return {"mensaje": "Solicitud programada.", "id_jornada": j.id_jornada}


@router.get("/activos/design/api/jornadas/{id_jornada}")
def api_jornada_obtener(id_jornada: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_jornada, db, id_jornada)


@router.put("/activos/design/api/jornadas/{id_jornada}")
def api_jornada_actualizar(id_jornada: int, payload: JornadaActualizacion, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    datos = payload.model_dump(exclude_unset=True)
    _manejar(sm.actualizar_jornada, db, user, id_jornada, datos)
    return {"mensaje": "Solicitud actualizada."}


@router.post("/activos/design/api/jornadas/{id_jornada}/anular")
def api_jornada_anular(id_jornada: int, payload: MotivoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sm.anular_jornada, db, user, id_jornada, payload.motivo)
    return {"mensaje": "Solicitud anulada."}


# ---------- Dongles ----------

class DongleEntrada(BaseModel):
    numero_dongle: str
    serial_number: str
    version_exocad: str = "N/A"
    modulos: str | None = Field(default=None, max_length=2000)


class DongleActualizacion(BaseModel):
    serial_number: str | None = None
    version_exocad: str | None = None
    modulos: str | None = Field(default=None, max_length=2000)


class AsignacionDongleEntrada(BaseModel):
    numero_dongle: str
    asset_tag: str | None = None
    motivo: str


@router.get("/activos/design/api/dongles")
def api_dongles(busqueda: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_dongles(db, busqueda)


@router.post("/activos/design/api/dongles", status_code=201)
def api_dongle_registrar(payload: DongleEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    d = _manejar(sa.registrar_dongle, db, user, payload.numero_dongle, payload.serial_number, payload.version_exocad, payload.modulos)
    return {"mensaje": "Dongle registrado correctamente.", "id_dongle": d.id_dongle}


@router.post("/activos/design/api/dongles/asignar")
def api_dongle_asignar(payload: AsignacionDongleEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.asignar_dongle, db, user, payload.numero_dongle, payload.asset_tag, payload.motivo)
    return {"mensaje": "Cambio registrado correctamente."}


@router.put("/activos/design/api/dongles/{numero_dongle}")
def api_dongle_actualizar(numero_dongle: str, payload: DongleActualizacion, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.actualizar_datos_dongle, db, user, numero_dongle, payload.serial_number, payload.version_exocad, payload.modulos)
    return {"mensaje": "Dongle actualizado."}


@router.get("/activos/design/api/dongles/{numero}/historial")
def api_dongle_historial(numero: str, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sa.consultar_uso_dongle, db, numero)


# ---------- Usuarios (perfiles de Activos) ----------

class PerfilAltaEntrada(BaseModel):
    empleado_id: int = Field(gt=0)
    jumpcloud_username: str | None = None
    id_area: int | None = Field(default=None, gt=0)


class PerfilActualizacion(BaseModel):
    jumpcloud_username: str | None = None
    id_area: int | None = None
    id_lider: int | None = None
    personaje: str | None = None
    personaje_variante: int = 0
    personaje_piel: int | None = None


@router.get("/activos/design/api/usuarios")
def api_usuarios(busqueda: str = "", area: str = "", departamento: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_usuarios(db, busqueda, area or None, departamento or None)


@router.get("/activos/design/api/empleados-disponibles")
def api_empleados_disponibles(busqueda: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    """Para el selector de "+ Registrar usuario": empleados de Design que aún no están en Activos."""
    return sc.listar_empleados_disponibles(db, busqueda)


@router.post("/activos/design/api/usuarios", status_code=201)
def api_usuario_registrar(payload: PerfilAltaEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    p = _manejar(sa.dar_alta_perfil, db, user, payload.empleado_id, payload.jumpcloud_username, payload.id_area)
    return {"mensaje": "Usuario registrado en Activos.", "id_usuario": p.empleado_id}


@router.get("/activos/design/api/usuarios/{id}")
def api_usuario_obtener(id: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_perfil, db, id)


@router.put("/activos/design/api/usuarios/{id}")
def api_usuario_actualizar(id: int, payload: PerfilActualizacion, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    datos = payload.model_dump(exclude_unset=True)
    if "id_area" in datos:
        datos["id_area_id"] = datos.pop("id_area")
    if "id_lider" in datos:
        datos["id_lider_id"] = datos.pop("id_lider")
    _manejar(sa.actualizar_perfil, db, user, id, datos)
    return {"mensaje": "Usuario actualizado."}


@router.post("/activos/design/api/usuarios/{id}/retirar")
def api_usuario_retirar(id: int, payload: MotivoEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.retirar_perfil, db, user, id, payload.motivo)
    return {"mensaje": "Usuario retirado."}


@router.post("/activos/design/api/usuarios/{id}/reactivar")
def api_usuario_reactivar(id: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    p = _manejar(sa.reactivar_perfil, db, user, id)
    from ..models import Empleado as Emp
    emp = db.get(Emp, p.empleado_id)
    return {"mensaje": f"{emp.nombre_completo} fue reactivado."}


@router.get("/activos/design/api/usuarios/{id}/activos")
def api_usuario_activos(id: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return _manejar(sc.obtener_activos_usuario, db, id)


@router.get("/activos/design/api/usuarios/{id}/actas")
def api_usuario_actas(id: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_actas_usuario(db, id)


# ---------- Áreas ----------

class AreaEntrada(BaseModel):
    nombre_area: str
    id_area_padre: int | None = Field(default=None, gt=0)
    aplica_software_diseno: bool = False
    requiere_exocad: bool = False


@router.get("/activos/design/api/areas")
def api_areas(busqueda: str = "", user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    return sc.listar_areas(db, busqueda)


@router.post("/activos/design/api/areas", status_code=201)
def api_area_registrar(payload: AreaEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    a = _manejar(sa.registrar_area, db, user, payload.nombre_area, payload.id_area_padre, payload.aplica_software_diseno, payload.requiere_exocad)
    return {"mensaje": "Área registrada.", "id_area": a.id_area}


@router.put("/activos/design/api/areas/{id}")
def api_area_actualizar(id: int, payload: AreaEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    _manejar(sa.actualizar_area, db, user, id, payload.nombre_area, payload.id_area_padre, payload.aplica_software_diseno, payload.requiere_exocad)
    return {"mensaje": "Área actualizada."}


@router.delete("/activos/design/api/areas/{id}")
def api_area_eliminar(id: int, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    nombre = _manejar(sa.eliminar_area, db, user, id)
    return {"mensaje": f"Área {nombre} eliminada."}


# ---------- Auditoría (reemplaza "historial y respaldos") ----------

@router.get("/activos/design/api/auditoria")
def api_auditoria(user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    from .. import models_activos as ma
    filas = db.query(ma.ActivosAuditoria).order_by(ma.ActivosAuditoria.id.desc()).limit(300).all()
    empleados = {e.id: e for e in db.query(Empleado).filter(Empleado.id.in_([f.empleado_id for f in filas if f.empleado_id] or [0])).all()}
    return [{"id": f.id, "fecha": f.fecha, "accion": f.accion, "descripcion": f.descripcion,
            "quien": empleados[f.empleado_id].nombre_completo if f.empleado_id in empleados else None} for f in filas]


# ---------- Excel ----------

@router.get("/activos/design/api/exportar/inventario")
def api_exportar_inventario(user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    datos = se.exportar_inventario(db)
    return Response(datos, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=inventario_completo.xlsx"})


@router.post("/activos/design/api/excel/comparar")
async def api_excel_comparar(request: Request, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    contenido = await request.body()
    if not contenido or contenido[:2] != b"PK":
        raise HTTPException(400, "El archivo no parece un libro de Excel (.xlsx) válido.")
    return _manejar(se.comparar_inventario_excel, db, contenido)


class SincronizacionEntrada(BaseModel):
    cambios: list[dict] = Field(min_length=1, max_length=2000)


@router.post("/activos/design/api/excel/sincronizar")
def api_excel_sincronizar(payload: SincronizacionEntrada, user: Empleado = Depends(require_activos), db: Session = Depends(get_db)):
    aplicados = se.sincronizar_cambios(db, user, payload.cambios)
    return {"mensaje": f"{aplicados} cambio(s) aplicado(s).", "aplicados": aplicados}
