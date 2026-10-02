"""
⚠️  Prueba de protección: ORIGEN DE LOS DATOS DEL EQUIPO DE DISEÑO.

Openings (Parámetros › Openings) es la base de datos de asignación de centros a los equipos de Design, y
Parámetros › Equipos es el origen de los managers y diseñadores del Schedule. De ahí salen el desplegable
Centro del Schedule y los centros de cada hoja de Pre-Approved, y los cambios de Equipos llegan a Openings.

Esta prueba falla a propósito si alguien cambia el código que lee o escribe esos datos. Si falla:
  1. NO actualices los valores de abajo para que pase.
  2. Valida el cambio con Rosember (equipo de Design): cambiar estos puntos de origen puede dañar el
     funcionamiento de la plataforma para el equipo de diseño.
  3. Solo con su aprobación, actualiza las huellas con:  python tests/test_design_origenes.py --huellas

Corre sin base de datos ni dependencias:  python -m unittest tests/test_design_origenes.py  (o pytest).
"""
import ast
import hashlib
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MENSAJE = ("\n\n⚠️  Cambió el origen de los datos del equipo de diseño ({}).\n"
           "    Valida esta modificación con Rosember antes de continuar: puede dañar el funcionamiento de la\n"
           "    plataforma para el equipo de diseño (Openings → Schedule / Pre-Approved, Equipos → Openings).\n")

# (archivo, nombre de la función o clase; "*" = el archivo completo)
PROTEGIDOS = [
    ("app/services_design_origenes.py", "*"),
    ("app/services_design.py", "centros_de_equipo"),
    ("app/services_design.py", "_openings_filas_cache"),
    ("app/routers/design_schedule.py", "api_openings_celda"),
    ("app/routers/design_schedule.py", "api_openings_eliminar_fila"),
    ("app/routers/design_schedule.py", "api_pa_openings"),
    ("app/routers/design_schedule.py", "api_pa_openings_aplicar"),
    ("app/routers/design_schedule.py", "editar_equipo"),
    ("app/routers/design_schedule.py", "toggle_equipo"),
    ("app/routers/design_schedule.py", "api_pac_mover_centro"),
    ("app/routers/design_schedule.py", "api_pac_intercambiar_centro"),
    ("app/models_design.py", "DesignTeam"),
    ("app/models_design.py", "DesignTeamDesigner"),
    ("app/models_design.py", "DesignOpeningsHoja"),
    ("app/models_design.py", "DesignOpeningsColumna"),
    ("app/models_design.py", "DesignOpeningsFila"),
]
# Líneas que deben seguir existiendo tal cual (las conexiones)
CONEXIONES = [
    ("app/services_design.py", 'salida["centros"] = centros_de_equipo(db, team)'),
    ("app/templates/design_schedule.html", "if (tipo === 'centro' && DS.diaData && Array.isArray(DS.diaData.centros)) return Promise.resolve(DS.diaData.centros);"),
    ("app/routers/design_schedule.py", "from .. import services_design_origenes as so"),
]

HUELLAS = {
    "app/services_design_origenes.py:*": "d53cf0290f06dd3d",
    "app/services_design.py:centros_de_equipo": "973cfef086be1c96",
    "app/services_design.py:_openings_filas_cache": "2eaebe0d6ecdb458",
    "app/routers/design_schedule.py:api_openings_celda": "255bc93a8ae05fed",
    "app/routers/design_schedule.py:api_openings_eliminar_fila": "5db4e708d9cb84f4",
    "app/routers/design_schedule.py:api_pa_openings": "85efe8212b3666a0",
    "app/routers/design_schedule.py:api_pa_openings_aplicar": "224cff512c9b0f7c",
    "app/routers/design_schedule.py:editar_equipo": "847fd0e600ceb94b",
    "app/routers/design_schedule.py:toggle_equipo": "4695d44322610dd7",
    "app/routers/design_schedule.py:api_pac_mover_centro": "97e74fc37e0ef9c6",
    "app/routers/design_schedule.py:api_pac_intercambiar_centro": "c8681f36fee5e8a4",
    "app/models_design.py:DesignTeam": "6148aff236ceedad",
    "app/models_design.py:DesignTeamDesigner": "c31b539ebac86828",
    "app/models_design.py:DesignOpeningsHoja": "7c489f3aa26a06aa",
    "app/models_design.py:DesignOpeningsColumna": "9e6f9fabc0a94abd",
    "app/models_design.py:DesignOpeningsFila": "96b79c697dafbb7a",
}


def _fuente(archivo: str, nombre: str) -> str | None:
    texto = (RAIZ / archivo).read_text(encoding="utf-8")
    if nombre == "*":
        return texto
    for nodo in ast.walk(ast.parse(texto)):
        if isinstance(nodo, (ast.FunctionDef, ast.ClassDef)) and nodo.name == nombre:
            return ast.get_source_segment(texto, nodo)
    return None


def huella(archivo: str, nombre: str) -> str | None:
    f = _fuente(archivo, nombre)
    if f is None:
        return None
    normal = "\n".join(l.rstrip() for l in f.replace("\r\n", "\n").split("\n")).strip()
    return hashlib.sha256(normal.encode("utf-8")).hexdigest()[:16]


class OrigenDeDatosDesign(unittest.TestCase):
    def test_codigo_protegido_sin_cambios(self):
        for archivo, nombre in PROTEGIDOS:
            clave = f"{archivo}:{nombre}"
            with self.subTest(clave):
                self.assertEqual(huella(archivo, nombre), HUELLAS[clave], MENSAJE.format(clave))

    def test_conexiones_presentes(self):
        for archivo, linea in CONEXIONES:
            with self.subTest(archivo):
                self.assertIn(linea, (RAIZ / archivo).read_text(encoding="utf-8"), MENSAJE.format(f"{archivo}: {linea}"))


if __name__ == "__main__":
    if "--huellas" in sys.argv:  # solo después de validarlo con Rosember
        for archivo, nombre in PROTEGIDOS:
            print(f'    "{archivo}:{nombre}": "{huella(archivo, nombre)}",')
    else:
        unittest.main()
