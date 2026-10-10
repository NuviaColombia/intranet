"""Training de Design: el contenido (app/static/training/data/*.json) tiene que respetar el formato, y los textos de la
interfaz tienen que existir en español e inglés. Si falla, un módulo está mal escrito (ver app/static/training/README.md)."""
import re
import unittest
from pathlib import Path
from app import services_design_training_validar as v

RAIZ = Path(__file__).resolve().parent.parent / "app" / "static" / "training"


class ContenidoTraining(unittest.TestCase):
    def test_modulos_validos(self):
        resultado = v.validar_todo()
        self.assertTrue(resultado, "no hay módulos de Training")
        for archivo, errores in resultado.items():
            self.assertEqual(errores, [], f"{archivo}: {errores[:5]}")

    def test_ids_de_glosario_y_slots_unicos(self):
        import json
        glos, slots = set(), set()
        for a in sorted(v.DATOS.glob("*.json")):
            d = json.loads(a.read_text(encoding="utf-8"))
            for g in d.get("glosario", []):
                self.assertNotIn(g["id"], glos, f"término repetido: {g['id']}")
                glos.add(g["id"])
            for l in d["lecciones"]:
                for p in l["pasos"]:
                    if p["t"] == "modelo3d":
                        self.assertNotIn(p["slot"], slots, f"espacio de modelo repetido: {p['slot']}")
                        slots.add(p["slot"])

    def test_textos_de_interfaz_en_los_dos_idiomas(self):
        lib = (RAIZ / "lib.js").read_text(encoding="utf-8")
        claves = lambda b: set(re.findall(r"\b([a-zA-Z0-9]+):\s*['\"`]", b))
        es = claves(lib[lib.index("  es: {"):lib.index("  en: {")])
        en = claves(lib[lib.index("  en: {"):lib.index("export function ui")])
        self.assertEqual(es, en, "faltan textos de interfaz en un idioma")
        usadas = set()
        for f in RAIZ.glob("*.js"):
            usadas |= set(re.findall(r"\bui\('([a-zA-Z0-9]+)'", f.read_text(encoding="utf-8")))
        self.assertEqual(usadas - es, set(), "hay textos de interfaz sin definir")


if __name__ == "__main__":
    unittest.main()
