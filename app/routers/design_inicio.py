"""Página de Inicio de Design (/design/inicio) con editor tipo WordPress (solo admins: borrador, vista previa,
publicar, historial, plantillas), biblioteca de medios y muro interno. La ven todos los que tienen Design.
Se incluye desde routers/design_schedule.py (mismo router, mismo cupo de concurrencia)."""
import re
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..models_design import DesignInicioMedio, DesignInicioMuro
from ..main_templates import templates
from .. import services_design_inicio as si
from .design_schedule import require_modulo, require_admin, _RutaDesign

router = APIRouter(route_class=_RutaDesign)


def require_publicador(user: Empleado = Depends(require_modulo("design_schedule"))) -> Empleado:
    """Admins y las personas autorizadas a publicar en el muro (si.PUBLICADORES_MURO)."""
    if not si.es_publicador(user):
        raise HTTPException(403, "No tienes permiso para publicar en el muro.")
    return user

_ESTATICOS = Path(__file__).resolve().parent.parent / "static" / "inicio"


def _version_estaticos() -> str:
    try:
        return str(int(max(f.stat().st_mtime for f in _ESTATICOS.iterdir() if f.is_file())))
    except (OSError, ValueError):
        return "1"


@router.get("/design/inicio")
def pagina_inicio(request: Request, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Página principal de Design (tarjeta de Módulos y logo). Los admins la editan con ?editar=1."""
    editor = si.es_editor(user)
    return templates.TemplateResponse(request, "design_inicio.html", {
        "user": user, "es_design": True, "pagina": si.publicada(db), "editor": editor, "vivo": si.vivo(db),
        "modo_editar": editor and request.query_params.get("editar") == "1", "version": _version_estaticos()})


# ---------- Borrador, publicar e historial (admins) ----------

class BorradorIn(BaseModel):
    contenido: dict
    version: int
    forzar: bool = False


@router.get("/design/api/inicio/borrador")
def api_borrador(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return si.estado(db)


@router.post("/design/api/inicio/borrador")
def api_borrador_guardar(payload: BorradorIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        p = si.guardar_borrador(db, user, payload.contenido, payload.version, payload.forzar)
    except si.Conflicto as c:
        return JSONResponse(status_code=409, content={"detail": f"{c.pagina.actualizado_por or 'Otra persona'} guardó cambios en la página "
                                                                "después de que la abriste.", "version": c.pagina.version})
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"version": p.version, "actualizadoEn": p.actualizado_en.isoformat()}


@router.post("/design/api/inicio/publicar")
def api_publicar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        p = si.publicar(db, user)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"publicadoEn": p.publicado_en.isoformat(), "publicadoPor": p.publicado_por}


@router.post("/design/api/inicio/descartar")
def api_descartar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    si.descartar(db, user)
    return si.estado(db)


@router.get("/design/api/inicio/versiones")
def api_versiones(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return si.versiones(db)


@router.post("/design/api/inicio/versiones/{version_id}/restaurar")
def api_version_restaurar(version_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        si.restaurar_version(db, user, version_id)
    except KeyError:
        raise HTTPException(404, "Esa versión no existe.")
    return si.estado(db)


# ---------- En vivo ----------

@router.get("/design/api/inicio/vivo")
def api_vivo(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """La página abierta pregunta cada pocos segundos si cambió lo publicado o el muro."""
    return si.vivo(db)


@router.get("/design/api/inicio/publicada")
def api_publicada(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return {"contenido": si.publicada(db), **si.vivo(db)}


class PresenciaIn(BaseModel):
    sel: str = Field("", max_length=60)
    salir: bool = False


@router.post("/design/api/inicio/presencia")
def api_presencia(payload: PresenciaIn, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    """Editor: avisa que sigue editando (y qué tiene elegido) y recibe la versión del borrador y los otros editores."""
    if payload.salir:
        si.salir_editor(user)
        return {"ok": True}
    return si.presencia(db, user, payload.sel)


# ---------- Medios ----------

@router.get("/design/api/inicio/medios")
def api_medios(user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    return si.medios(db)


@router.post("/design/api/inicio/medios")
async def api_medio_subir(archivo: UploadFile = File(...), ancho: int = Form(0), alto: int = Form(0),
                          user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    datos = await archivo.read(si.MAX_ENVIO_DIRECTO + 1 if (archivo.content_type or '').startswith('video') else si.MAX_IMAGEN + 1)
    try:
        m = si.medio_crear(db, user, archivo.filename or "archivo", archivo.content_type or "", datos, ancho, alto)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return si.medio_resumen(m)


class SubidaIn(BaseModel):
    nombre: str = Field("", max_length=255)
    mime: str = Field("", max_length=60)
    tamano: int = 0
    ancho: int = 0
    alto: int = 0


@router.post("/design/api/inicio/medios/subida")
def api_subida_iniciar(payload: SubidaIn, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    """Videos por partes (paso 1 de 3): el navegador avisa el nombre, el tipo y el tamaño."""
    try:
        return si.subida_iniciar(db, payload.nombre, payload.mime, payload.tamano)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/design/api/inicio/medios/subida/{subida}/parte/{n}")
async def api_subida_parte(subida: str, n: int, request: Request, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    """Paso 2: cada pedazo de 4 MB, uno por uno (así el servidor nunca tiene el video entero en memoria)."""
    if int(request.headers.get("content-length") or 0) > si.PARTE:
        raise HTTPException(413, "Parte demasiado grande.")
    datos = b""
    async for trozo in request.stream():
        datos += trozo
        if len(datos) > si.PARTE:
            raise HTTPException(413, "Parte demasiado grande.")
    try:
        si.subida_parte(db, subida, n, datos)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/design/api/inicio/medios/subida/{subida}/fin")
def api_subida_fin(subida: str, payload: SubidaIn, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    """Paso 3: se revisa que llegaron todas las partes y queda en la biblioteca."""
    try:
        return si.medio_resumen(si.subida_fin(db, user, subida, payload.nombre, payload.mime, payload.ancho, payload.alto))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/design/api/inicio/medios/{medio_id}/eliminar")
def api_medio_eliminar(medio_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db)):
    if not si.medio_eliminar(db, medio_id):
        raise HTTPException(404, "No existe.")
    return {"ok": True}


TROZO_VIDEO = 4 * 1024 * 1024


@router.get("/design/inicio/medio/{medio_id}")
def medio(medio_id: int, request: Request, user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Imagen o video de la página de Inicio. Los videos responden por partes (Range) para poder adelantarlos."""
    m = db.query(DesignInicioMedio).filter(DesignInicioMedio.id == medio_id).first()   # sin el archivo: se lee abajo solo lo necesario
    if not m:
        raise HTTPException(404, "No existe.")
    total = m.tamano or db.query(func.length(DesignInicioMedio.datos)).filter(DesignInicioMedio.id == medio_id).scalar() or 0
    cab = {"Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes"}
    if m.mime == "image/svg+xml":
        cab["Content-Security-Policy"] = "script-src 'none'"
    # los .mov (H.264) se entregan como mp4 para que Chrome, Edge y Firefox los reproduzcan
    mime = "video/mp4" if m.mime == "video/quicktime" else m.mime
    rango = request.headers.get("range", "")
    mt = re.match(r"bytes=(\d*)-(\d*)$", rango.strip())
    por_partes = m.tipo == "video" and si.medio_por_partes(db, medio_id)
    if mt and total:
        ini = int(mt.group(1)) if mt.group(1) else max(0, total - int(mt.group(2) or 0))
        fin = int(mt.group(2)) if mt.group(1) and mt.group(2) else total - 1
        fin = min(fin, total - 1, ini + TROZO_VIDEO - 1)   # por partes: un video de 100 MB no se carga entero en memoria
        if ini > fin:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        if por_partes:
            parte = si.medio_leer(db, medio_id, ini, fin)
        else:
            parte = db.query(func.substr(DesignInicioMedio.datos, ini + 1, fin - ini + 1)).filter(DesignInicioMedio.id == medio_id).scalar() or b""
        cab["Content-Range"] = f"bytes {ini}-{ini + len(parte) - 1}/{total}"
        return Response(bytes(parte), status_code=206, media_type=mime, headers=cab)
    if por_partes:
        # sin Range: se entrega pedazo por pedazo (nunca el video entero en memoria)
        def trozos():
            for k in range(0, total, si.PARTE):
                yield si.medio_leer(db, medio_id, k, min(total, k + si.PARTE) - 1)
        return StreamingResponse(trozos(), media_type=mime, headers={**cab, "Content-Length": str(total)})
    datos = db.query(DesignInicioMedio.datos).filter(DesignInicioMedio.id == medio_id).scalar() or b""
    return Response(bytes(datos), media_type=mime, headers=cab)


# ---------- Ranking de equipos del mes ----------

@router.get("/design/api/inicio/ranking")
def api_ranking(user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    """Equipos con más casos aprobados del mes (para el bloque Cifras). Se recalcula como máximo cada hora."""
    return si.ranking_mes(db)


# ---------- Muro ----------

class MuroIn(BaseModel):
    titulo: str = Field("", max_length=200)
    texto: str = Field("", max_length=20000)
    imagen: str = Field("", max_length=300)
    fijado: bool = False
    bloque: str = Field("", max_length=40, pattern=r"^[A-Za-z0-9_-]*$")  # bloque de Novedades donde se publica


@router.get("/design/api/inicio/muro")
def api_muro(limite: int = 50, bloque: str = "", user: Empleado = Depends(require_modulo("design_schedule")), db: Session = Depends(get_db)):
    return {"publicaciones": si.muro(db, limite, user, bloque[:40]), "puedePublicar": si.es_publicador(user), "emojis": si.EMOJIS_MURO}


@router.post("/design/api/inicio/muro")
def api_muro_crear(payload: MuroIn, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    try:
        datos = payload.model_dump()
        return si.muro_resumen(si.muro_guardar(db, user, datos, bloque=datos.pop("bloque", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))


def _post_modificable(db: Session, user: Empleado, post_id: int):
    x = db.get(DesignInicioMuro, post_id)
    if not x or not x.activo:
        raise HTTPException(404, "La publicación no existe.")
    if not si.puede_modificar_post(user, x):
        raise HTTPException(403, "Solo puedes modificar tus propias publicaciones.")
    return x


@router.post("/design/api/inicio/muro/{post_id}")
def api_muro_editar(post_id: int, payload: MuroIn, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    _post_modificable(db, user, post_id)
    try:
        return si.muro_resumen(si.muro_guardar(db, user, payload.model_dump(), post_id))
    except KeyError:
        raise HTTPException(404, "La publicación no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/design/api/inicio/muro/{post_id}/eliminar")
def api_muro_eliminar(post_id: int, user: Empleado = Depends(require_publicador), db: Session = Depends(get_db)):
    _post_modificable(db, user, post_id)
    if not si.muro_eliminar(db, post_id):
        raise HTTPException(404, "La publicación no existe.")
    return {"ok": True}


class ReaccionIn(BaseModel):
    emoji: str = Field(max_length=16)


@router.post("/design/api/inicio/muro/{post_id}/reaccion")
def api_muro_reaccionar(post_id: int, payload: ReaccionIn, user: Empleado = Depends(require_modulo("design_schedule")),
                        db: Session = Depends(get_db)):
    """Cualquiera con Design reacciona (o quita su reacción) con uno de los 5 emojis del muro."""
    try:
        return si.muro_reaccionar(db, user, post_id, payload.emoji)
    except KeyError:
        raise HTTPException(404, "La publicación no existe.")
    except ValueError as e:
        raise HTTPException(400, str(e))
