"""Pagos (dentro de Contabilidad): "Pagos programados → PDF" y "Separador de comprobantes" -- ver
docs/wiki/caja_menor.md. Ambas herramientas corren enteramente en el navegador (parseo de archivos
planos de banco, generación de PDF con jsPDF, separación de PDF con pdf.js/pdf-lib/JSZip); esta
página solo las sirve y las protege con el mismo permiso de Caja menor Nuvia."""
from fastapi import APIRouter, Depends, Request
from ..models import Empleado
from ..auth import require_modulo
from ..main_templates import templates

router = APIRouter()
require_pagos = require_modulo("caja_menor")


@router.get("/pagos")
def pagina_pagos(request: Request, user: Empleado = Depends(require_pagos)):
    return templates.TemplateResponse(request, "pagos.html", {"user": user, "es_pagos": True})
