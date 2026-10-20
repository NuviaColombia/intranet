"""N3 › Cirugías: para poner Approved la fila debe estar completa (services_design.faltan_para_aprobar, 19-oct-2026).
No necesita base de datos."""
import unittest

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd

COMPLETA = {"orden": "A1", "paciente": "P", "centro": "Dallas", "producto": "N3 - Single 24Z", "designer_id": 7,
            "art_start": "07:00", "art_rtd": "07:40", "hora_inicio": "08:00", "critico": "Min Thickness; Implant angled"}


class AprobarN3(unittest.TestCase):
    def test_completa_se_aprueba(self):
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "principal", COMPLETA), [])

    def test_faltan_columnas(self):
        v = {**COMPLETA, "art_start": "", "critico": "  "}
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "principal", v), ["START", "Crítico"])

    def test_disenador_prestado_cuenta(self):
        v = {**COMPLETA, "designer_id": None, "designer_prestado": "Ana (otro equipo)"}
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "principal", v), [])
        self.assertIn("Diseñador", sd.faltan_para_aprobar("N3 Prosthetic", "principal", {**v, "designer_prestado": ""}))

    def test_hold_en_pareja(self):
        v = {**COMPLETA, "s_hold": "09:00", "f_hold": ""}
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "principal", v), ["Re-initiated (hay Start hold)"])
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "principal", {**v, "f_hold": "09:30"}), [])

    def test_solo_cirugias_de_n3(self):
        vacia = {}
        self.assertEqual(sd.faltan_para_aprobar("N3 Prosthetic", "nightguard", vacia), [])
        self.assertEqual(sd.faltan_para_aprobar("N6 Material Changes", "principal", vacia), [])
        self.assertEqual(sd.faltan_para_aprobar("Face Design", "principal", vacia), [])


if __name__ == "__main__":
    unittest.main()
