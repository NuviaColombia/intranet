"""Submódulos del módulo Producción (entrada en /inventario).

Única fuente para la página de entrada del módulo, el texto de su tarjeta en el portal y las
pestañas de Producción › Parámetros: para agregar un submódulo basta con añadirlo aquí
(en "parametros", el id de cada panel de custodia_parametros.html y su título).
"""

SUBMODULOS_PRODUCCION = [
    {"slug": "custodia", "nombre": "Cambio de custodia", "icono": "🔄", "descripcion": "Traslados de material entre áreas",
     "url": "/custodia", "activo": True,
     "parametros": [("managers", "👤 Accesos"), ("areas", "🏭 Áreas"), ("discos", "💿 Catálogo de discos"),
                    ("motivos", "📋 Motivos"), ("saldos", "📥 Saldos iniciales"), ("limpiar", "🧹 Limpiar pruebas")]},
    {"slug": "consumo", "nombre": "Seguimiento de consumo", "icono": "📊", "descripcion": "Próximamente",
     "url": None, "activo": False, "parametros": []},
]


def resumen_submodulos_produccion() -> str:
    """Texto de la tarjeta del portal: los nombres de los submódulos activos, separados por ' · '."""
    return " · ".join(s["nombre"] for s in SUBMODULOS_PRODUCCION if s["activo"])
