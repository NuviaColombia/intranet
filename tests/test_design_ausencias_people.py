"""Ausencia automática desde People (services_design.ausencia_design_de, 20-oct-2026): cualquier permiso de día completo
aprobado en People se traduce a una opción del catálogo de ausencias de Design. No necesita base de datos."""
import unittest

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd

CATALOGO = ["Vacaciones", "Calamidad doméstica", "Licencia por luto", "Licencia por paternidad", "Descanso compensatorio",
            "Festivo compensatorio", "Incapacidad", "Suspensión", "Remunerada", "No remunerada", "Cumpleaños", "Grado",
            "Permiso personal"]


class AusenciaPeople(unittest.TestCase):
    def caso(self, tipo, vac=False):
        return sd.ausencia_design_de(tipo, vac, CATALOGO)

    def test_mismo_nombre_y_equivalentes(self):
        self.assertEqual(self.caso("Vacaciones", True), "Vacaciones")
        self.assertEqual(self.caso("Licencia de luto"), "Licencia por luto")
        self.assertEqual(self.caso("CALAMIDAD DOMESTICA"), "Calamidad doméstica")

    def test_por_palabra_clave(self):
        self.assertEqual(self.caso("Incapacidad médica"), "Incapacidad")
        self.assertEqual(self.caso("Licencia de maternidad"), "Licencia por paternidad")
        self.assertEqual(self.caso("Día de cumpleaños"), "Cumpleaños")
        self.assertEqual(self.caso("Licencia no remunerada"), "No remunerada")
        self.assertEqual(self.caso("Licencia remunerada"), "Remunerada")
        self.assertEqual(self.caso("Vacaciones colectivas"), "Vacaciones")

    def test_desconocido_es_permiso_personal(self):
        self.assertEqual(self.caso("Capacitación externa"), "Permiso personal")


if __name__ == "__main__":
    unittest.main()
