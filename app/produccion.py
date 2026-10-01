"""Submódulos del módulo Producción (entrada en /inventario).

Única fuente para la página de entrada del módulo, el texto de su tarjeta en el portal y las
pestañas de Producción › Parámetros: para agregar un submódulo basta con añadirlo aquí
(en "parametros", el id de cada panel de custodia_parametros.html y su título).
"""

SUBMODULOS_PRODUCCION = [
    {"slug": "custodia", "nombre": "Cambio de custodia", "icono": "🔄", "descripcion": "Traslados de material entre áreas",
     "url": "/custodia", "activo": True,
     "parametros": [("managers", "👤 Accesos"), ("areas", "🏭 Áreas"), ("discos", "💿 Catálogo de discos"),
                    ("motivos", "📋 Motivos"), ("saldos", "📥 Saldos iniciales")]},
    {"slug": "consumo", "nombre": "Seguimiento de consumo", "icono": "📊",
     "descripcion": "Consumo de materias primas por técnico", "url": "/consumo", "activo": True,
     "parametros": [("c_accesos", "👤 Accesos"), ("c_tecnicos", "👷 Técnicos"), ("c_materias", "🧪 Materias primas"),
                    ("c_tipos", "🔢 Tipos de producto")]},
    {"slug": "conteo", "nombre": "Conteo inventario mensual", "icono": "📋",
     "descripcion": "Conteo mensual de materiales por área y bodega", "url": "/conteo", "activo": True,
     "parametros": [("n_accesos", "👤 Accesos (managers)"), ("n_director", "🏭 Director, área contable y WorkDrive"),
                    ("n_materiales", "🧪 Materiales"),
                    ("n_bodegas", "🏬 Bodegas")]},
]


def resumen_submodulos_produccion() -> str:
    """Texto de la tarjeta del portal: los nombres de los submódulos activos, separados por ' · '."""
    return " · ".join(s["nombre"] for s in SUBMODULOS_PRODUCCION if s["activo"])
