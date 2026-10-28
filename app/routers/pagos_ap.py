"""Accounts Payable: API dentro de Pagos -- ver app/services_pagos_ap.py y docs/wiki/caja_menor.md."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Empleado
from ..auth import require_modulo
from .. import services_pagos_ap as sa

router = APIRouter()
require_pagos = require_modulo("caja_menor")


def _manejar(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except sa.NoEncontrado as e:
        raise HTTPException(404, str(e))
    except sa.Conflicto as e:
        raise HTTPException(400, str(e))


def _require_admin_ap(user: Empleado = Depends(require_pagos)) -> Empleado:
    if user.rol not in ("admin", "superadmin"):
        raise HTTPException(403, "Requiere rol de administrador.")
    return user


@router.get("/pagos/api/ap")
def api_listar(empresa: str = "", estado: str = "", busqueda: str = "",
               user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    return {"filas": sa.listar(db, estado, empresa, busqueda), "resumen": sa.resumen_conteos(db, empresa),
            "puedeAprobar": sa.puede_aprobar(user)}


class CuentaEntrada(BaseModel):
    empresa: str
    proveedor_nombre: str = Field(min_length=1, max_length=200)
    proveedor_nit: str = Field("", max_length=30)
    categoria: str = Field("", max_length=100)
    detalle: str = Field("", max_length=2000)
    documento: str = Field("", max_length=100)
    valor: float
    fecha_vencimiento: date | None = None
    comentarios: str = Field("", max_length=2000)


@router.post("/pagos/api/ap", status_code=201)
def api_crear(payload: CuentaEntrada, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    c = _manejar(sa.crear, db, user, payload.empresa, payload.proveedor_nombre, payload.valor, payload.proveedor_nit,
                 payload.categoria, payload.detalle, payload.documento, payload.fecha_vencimiento, payload.comentarios)
    return sa._fila(c)


@router.post("/pagos/api/ap/{id}/aprobar")
def api_aprobar(id: int, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    if not sa.puede_aprobar(user):
        raise HTTPException(403, "Solo Leslie, Oscar o un superadmin pueden aprobar.")
    return sa._fila(_manejar(sa.aprobar, db, user, id))


class MotivoEntrada(BaseModel):
    motivo: str = Field("", max_length=500)


@router.post("/pagos/api/ap/{id}/rechazar")
def api_rechazar(id: int, payload: MotivoEntrada, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    if not sa.puede_aprobar(user):
        raise HTTPException(403, "Solo Leslie, Oscar o un superadmin pueden rechazar.")
    return sa._fila(_manejar(sa.rechazar, db, user, id, payload.motivo))


@router.post("/pagos/api/ap/{id}/pagar")
def api_pagar(id: int, user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    return sa._fila(_manejar(sa.marcar_pagado, db, user, id))


@router.get("/pagos/api/ap/reporte")
def api_reporte(desde: date | None = None, hasta: date | None = None, tercero: str = "",
                montoMin: float | None = None, montoMax: float | None = None,
                user: Empleado = Depends(require_pagos), db: Session = Depends(get_db)):
    return {"meses": sa.reporte_pagos(db, desde, hasta, tercero, montoMin, montoMax)}


@router.post("/pagos/api/ap/importar")
async def api_importar(archivo: UploadFile = File(...), user: Empleado = Depends(_require_admin_ap), db: Session = Depends(get_db)):
    if not archivo.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "El archivo debe ser un Excel (.xlsx).")
    contenido = await archivo.read()
    try:
        return sa.importar_excel(db, user, contenido)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")
