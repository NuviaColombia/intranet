"""Módulo Contabilidad: aterrizaje (/contabilidad) que agrupa Caja menor Nuvia y Pagos (próximamente)
-- ver docs/wiki/caja_menor.md. Mismo patrón que /activos (templates/activos.html)."""
from fastapi import APIRouter, Depends, Request
from ..models import Empleado
from ..auth import require_modulo_o_admin
from ..main_templates import templates

router = APIRouter()
# Reutiliza el mismo permiso que ya existe para Caja menor Nuvia -- Pagos (aún sin funcionalidad
# propia) no tiene permiso separado; cuando lo tenga, ver "Contabilidad" en docs/wiki/caja_menor.md.
# (28-oct-2026) Esta pantalla no hace nada sensible por sí sola -- cualquier admin/superadmin la ve
# aunque no esté autorizado a entrar a Caja menor (ver require_modulo_o_admin).
require_contabilidad = require_modulo_o_admin("caja_menor")


@router.get("/contabilidad")
def pagina_contabilidad(request: Request, user: Empleado = Depends(require_contabilidad)):
    return templates.TemplateResponse(request, "contabilidad.html", {"user": user, "es_portal": True, "es_contabilidad": True})
