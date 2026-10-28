"""Pagos (dentro de Contabilidad): "Pagos programados → PDF" y "Separador de comprobantes" -- ver
docs/wiki/caja_menor.md. Ambas herramientas corren enteramente en el navegador (parseo de archivos
planos de banco, generación de PDF con jsPDF, separación de PDF con pdf.js/pdf-lib/JSZip); esta
página solo las sirve y las protege con el mismo permiso de Caja menor Nuvia."""
from fastapi import APIRouter, Depends, Request
from ..models import Empleado
from ..auth import require_modulo_o_admin
from ..main_templates import templates

router = APIRouter()
# (28-oct-2026) Pedido de Carlos: Pagos sigue abierto a cualquier admin/superadmin aunque no esté
# autorizado a entrar a Caja menor -- Oscar lo usa a diario y no debe depender de esa autorización
# (ver require_modulo_o_admin). La restricción real (ni admin ni superadmin entran automático) es
# solo para Caja menor en sí (/caja-menor).
require_pagos = require_modulo_o_admin("caja_menor")


@router.get("/pagos")
def pagina_pagos(request: Request, user: Empleado = Depends(require_pagos)):
    return templates.TemplateResponse(request, "pagos.html", {"user": user, "es_pagos": True})
