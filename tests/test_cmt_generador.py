"""Comments N3: el texto que genera el formulario (Ready to mill y Everything is ok) no debe cambiar sin querer (28-oct-2026).

Toma las funciones del generador directamente de static/design/schedule.js (entre `var CMT_FIELDS` y `var CMT_TEMPLATES`),
las corre con node para cada caso de tests/cmt_casos.json y compara el texto exacto.

Los textos esperados son los que daba el generador el 28-oct-2026 (aprobados por Rosember como el comportamiento actual).
Si cambias el texto A PROPÓSITO, revisa el resultado y vuelve a generarlos:
    python tests/test_cmt_generador.py --regenerar
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
JS = RAIZ / "app" / "static" / "design" / "schedule.js"
CASOS = Path(__file__).resolve().parent / "cmt_casos.json"
INICIO, FIN = "  var CMT_FIELDS = [", "  var CMT_TEMPLATES = ["


def _bloque() -> str:
    s = JS.read_text(encoding="utf-8")
    a, b = s.find(INICIO), s.find(FIN)
    if a < 0 or b < a:
        raise AssertionError(f"No encontré el generador de Comments N3 entre «{INICIO.strip()}» y «{FIN.strip()}» en schedule.js")
    return s[a:b]


def generar(casos: list) -> list:
    """Corre el generador real con node y devuelve [{readyToMill, everythingOk}] por caso."""
    programa = _bloque() + """
const casos = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const lleno = c => { const f = {}; CMT_FIELDS.forEach(k => { f[k] = c[k] == null ? '' : String(c[k]); }); return f; };
process.stdout.write(JSON.stringify(casos.map(c => ({readyToMill: cmtGenReadyToMill(lleno(c.campos)), everythingOk: cmtGenEverythingOk(lleno(c.campos))}))));
"""
    r = subprocess.run(["node", "-e", programa], input=json.dumps(casos), capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise AssertionError("node falló al correr el generador:\n" + r.stderr[-2000:])
    return json.loads(r.stdout)


@unittest.skipIf(shutil.which("node") is None, "node no está instalado")
class GeneradorComentarios(unittest.TestCase):
    def test_textos_iguales_a_los_aprobados(self):
        casos = json.loads(CASOS.read_text(encoding="utf-8"))
        salida = generar(casos)
        for caso, obtenido in zip(casos, salida):
            with self.subTest(caso=caso["nombre"]):
                self.assertEqual(obtenido["readyToMill"], caso["readyToMill"], f"Ready to mill cambió en «{caso['nombre']}»")
                self.assertEqual(obtenido["everythingOk"], caso["everythingOk"], f"Everything is ok cambió en «{caso['nombre']}»")

    def test_todo_en_ingles(self):
        """Ninguna palabra en español dentro de los comentarios generados (antes salía «Medidas»)."""
        casos = json.loads(CASOS.read_text(encoding="utf-8"))
        for caso, obtenido in zip(casos, generar(casos)):
            texto = obtenido["readyToMill"] + " " + obtenido["everythingOk"]
            for palabra in ("Medidas", "Medida", "Paciente", "Orden"):
                self.assertNotIn(palabra, texto, caso["nombre"])


if __name__ == "__main__":
    if "--regenerar" in sys.argv:
        casos = json.loads(CASOS.read_text(encoding="utf-8"))
        for caso, obtenido in zip(casos, generar(casos)):
            caso.update(obtenido)
        CASOS.write_text(json.dumps(casos, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"Regenerados {len(casos)} casos en {CASOS.name}: revísalos antes de hacer commit.")
    else:
        unittest.main()
