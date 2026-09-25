"""Submódulos del módulo Producción (entrada en /inventario).

Única fuente para la página de entrada del módulo y para el texto de su tarjeta en el portal:
para agregar un submódulo basta con añadirlo aquí.
"""

SUBMODULOS_PRODUCCION = [
    {"nombre": "Cambio de custodia", "icono": "🔄", "descripcion": "Traslados de material entre áreas",
     "url": "/custodia", "activo": True},
    {"nombre": "Seguimiento de consumo", "icono": "📊", "descripcion": "Próximamente",
     "url": None, "activo": False},
]


def resumen_submodulos_produccion() -> str:
    """Texto de la tarjeta del portal: los nombres de los submódulos activos, separados por ' · '."""
    return " · ".join(s["nombre"] for s in SUBMODULOS_PRODUCCION if s["activo"])
