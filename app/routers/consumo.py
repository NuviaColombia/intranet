"""Producción › Seguimiento de consumo: entregas de frascos, jornada diaria y reportes.
Sus parámetros (accesos, técnicos, materias primas, tipos) están en Producción › Parámetros."""
import csv
import io
from datetime import date
from fastapi import APIRouter, Request, Depends, HTTPException, Form
from ..concurrencia import RutaGeneral
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_consumo import ConsumoMateria, ConsumoTipo, ConsumoTecnico, ConsumoManager, ConsumoEntrega
from ..auth import require_admin
from ..acceso_produccion import require_admin_produccion, require_submodulo, ProduccionAcceso, MODULO_PRODUCCION
from ..formato import nombre_propio
from ..main_templates import templates
from .. import services_consumo as sc
from .. import acceso_secciones as acs

router = APIRouter(route_class=RutaGeneral)  # tope de concurrencia: app/concurrencia.py
SUB = "consumo"


@router.get("/consumo")
def pagina(request: Request, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_tipos(db)
    puede = sc.puede_entregar(db, user)
    secciones = [s for s in acs.secciones_de(db, user, SUB) if puede or s not in ("entrega", "consulta")]
    return templates.TemplateResponse(request, "consumo.html", {
        "user": user, "es_consumo": True, "puede_entregar": puede, "area_manager": sc.area_manager(db, user),
        "secciones": secciones, "consumo_tab_inicial": secciones[0] if secciones else ""})


@router.get("/consumo/api/datos")
def api_datos(user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    sc.asegurar_tipos(db)
    area = sc.area_manager(db, user)
    return {
        "tecnicos": [{"id": t.id, "nombre": nombre_propio(t.empleado.nombre_completo), "area": t.area}
                     for t in sc.tecnicos_visibles(db, user)],
        "materias": [{"id": m.id, "descripcion": m.descripcion, "presentacion": m.presentacion, "contenido": m.contenido,
                      "area": m.area, "mideArcos": bool(m.mide_arcos)} for m in sc.materias_activas(db)],
        "tipos": [{"id": str(t.id), "nombre": t.nombre} for t in sc.tipos_activos(db)],
        "areaManager": area, "esAdmin": sc.es_admin(user), "puedeEntregar": sc.puede_entregar(db, user),
        "manager": nombre_propio(user.nombre_completo), "hoy": sc.hoy_colombia().isoformat(),
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
def api_crear_entrega(payload: EntregaIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'entrega')
    datos = payload.model_dump()
    e = sc.crear_entrega(db, user, datos)
    if isinstance(e, str):
        raise HTTPException(400, e)
    return {"mensaje": f"✅ Entrega registrada. Consecutivo n.º {e.id:04d} ({len(e.frascos)} frasco(s)).", "entrega": sc.serializar_entrega(e)}


@router.get("/consumo/api/entregas")
def api_entregas(user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'consulta')
    visibles = {t.id for t in sc.tecnicos_visibles(db, user)}
    entregas = (db.query(ConsumoEntrega).filter(ConsumoEntrega.tecnico_id.in_(visibles or [0]))
                .order_by(ConsumoEntrega.id.desc()).limit(1000).all())
    return {"data": [sc.serializar_entrega(e) for e in entregas]}


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
def api_jornada(tecnico_id: int, fecha: str, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    t = _tecnico(db, user, tecnico_id)
    return {"frascos": sc.frascos_para_jornada(db, t, _fecha(fecha))}


class FilaJornadaIn(BaseModel):
    frasco_id: int
    arcos: dict = {}
    consumido: bool = False


class JornadaIn(BaseModel):
    tecnico_id: int
    fecha: str
    filas: list[FilaJornadaIn] = []


@router.post("/consumo/api/jornada")
def api_guardar_jornada(payload: JornadaIn, user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'jornada')
    t = _tecnico(db, user, payload.tecnico_id)
    error = sc.guardar_jornada(db, user, t, _fecha(payload.fecha), [f.model_dump() for f in payload.filas])
    if error:
        raise HTTPException(400, error)
    return {"mensaje": "✅ Jornada guardada. Si vuelves a abrir este día, puedes corregirla."}


def _rango(desde: str, hasta: str) -> tuple[date | None, date | None]:
    return (_fecha(desde) if desde else None), (_fecha(hasta) if hasta else None)


@router.get("/consumo/api/reportes")
def api_reportes(desde: str = "", hasta: str = "", tecnico_id: int = 0, materia_id: int = 0,
                 user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'reportes')
    d, h = _rango(desde, hasta)
    return sc.reportes(db, d, h, tecnico_id or None, materia_id or None, user)


@router.get("/consumo/api/reportes/exportar")
def api_exportar(desde: str = "", hasta: str = "", tecnico_id: int = 0, materia_id: int = 0,
                 user: Empleado = Depends(require_submodulo(SUB)), db: Session = Depends(get_db)):
    acs.exigir(db, user, "consumo", 'reportes')
    d, h = _rango(desde, hasta)
    r = sc.reportes(db, d, h, tecnico_id or None, materia_id or None, user)
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
    w.writerow(["FRASCOS EN USO"])
    w.writerow(["Técnico", "Área", "Materia prima", "Lote", "Ref", "Serie", "Fecha entrega", "Días abierto", "Arcos acumulados"])
    for x in r["wip"]:
        w.writerow([x["tecnico"], x["area"], x["materia"], x["lote"], x["ref"], x["serie"], x["fechaEntrega"], x["dias"], x["acumulado"]])
    salida.seek(0)
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="seguimiento_consumo.csv"'})


# ---------------- Parámetros (Producción › Parámetros › Seguimiento de consumo) ----------------

VOLVER = "/inventario/parametros?tab={tab}&msg={msg}"


def _volver(tab: str, msg: str) -> RedirectResponse:
    return RedirectResponse(VOLVER.format(tab=tab, msg=msg), status_code=303)


def _texto(v: str) -> str:
    return (v or "").strip().upper()


@router.post("/inventario/parametros/consumo/materias")
def crear_materia(user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db), descripcion: str = Form(...),
                  presentacion: str = Form(""), contenido: str = Form(""), area: str = Form(""), mide_arcos: str = Form("")):
    if not _texto(descripcion):
        return _volver("c_materias", "No se guardó: escribe la descripción.")
    orden = db.query(ConsumoMateria).count() + 1
    db.add(ConsumoMateria(descripcion=_texto(descripcion), presentacion=_texto(presentacion), contenido=_texto(contenido),
                          area=_texto(area), mide_arcos=bool(mide_arcos), orden=orden))
    db.commit()
    return _volver("c_materias", "Materia prima agregada.")


@router.post("/inventario/parametros/consumo/materias/{materia_id}")
def editar_materia(materia_id: int, user: Empleado = Depends(require_admin_produccion), db: Session = Depends(get_db),
                   descripcion: str = Form(...), presentacion: str = Form(""), contenido: str = Form(""), area: str = Form(""),
                   mide_arcos: str = Form("")):
    m = db.get(ConsumoMateria, materia_id)
    if m and _texto(descripcion):
        m.descripcion, m.presentacion, m.contenido, m.area = _texto(descripcion), _texto(presentacion), _texto(contenido), _texto(area)
        m.mide_arcos = bool(mide_arcos)
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
                   empleado_id: int = Form(...), area: str = Form("")):
    """Da acceso a Seguimiento de consumo. Con área = manager de esa área (entrega y registra jornadas);
    sin área = solo registra su propia jornada (si es técnico)."""
    e = db.get(Empleado, empleado_id)
    if not e or not e.activo:
        return _volver("c_accesos", "No se guardó: elige una persona de la lista.")
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
    return _volver("c_accesos", f"Acceso a Seguimiento de consumo dado a {nombre_propio(e.nombre_completo)}.")


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
