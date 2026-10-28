"""N6 (28-oct-2026, Rosember): desde el 29-oct-2026 cuatro tablas (Material Change, Over Ti-bar, Dummy y Cirugías). Over Ti-bar
funciona como Material Change y Dummy como Cirugías; los días anteriores no cambian."""
import unittest
from datetime import date

from app import services_design as sd


class N6CuatroTablas(unittest.TestCase):
    def test_tabla_base(self):
        self.assertTrue(sd.es_tabla_etapas("tibar") and sd.es_tabla_etapas("material"))
        self.assertFalse(sd.es_tabla_etapas("dummy") or sd.es_tabla_etapas("principal"))
        self.assertEqual(sd.tabla_base("dummy"), "principal")

    def test_desde_el_29_y_solo_en_n6(self):
        self.assertTrue(sd.n6_separado(sd.AREA_N6, date(2026, 10, 29)))
        self.assertFalse(sd.n6_separado(sd.AREA_N6, date(2026, 10, 28)))
        self.assertFalse(sd.n6_separado(sd.AREA_N3, date(2026, 10, 29)))

    def test_orden_que_llega_pasa_a_su_tabla(self):
        self.assertEqual(sd.n6_tabla_de_producto("principal", "N6 - Dummy Set"), "dummy")
        self.assertEqual(sd.n6_tabla_de_producto("material", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "tibar")
        self.assertEqual(sd.n6_tabla_de_producto("principal", "N6 - Full Mouth G-CAM Remake"), "principal")
        self.assertEqual(sd.n6_tabla_de_producto("nightguard", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "nightguard")

    def test_productos_por_tabla(self):
        p = sd.PRODUCTOS_N6_TABLA
        self.assertEqual((len(p["material"]), len(p["tibar"]), len(p["dummy"]), len(p["principal"])), (6, 1, 3, 15))

    def test_produccion_como_hoy(self):
        self.assertEqual(sd.tipo_produccion("tibar", ""), "mc")
        self.assertEqual(sd.tipo_produccion("dummy", ""), "sx")


if __name__ == "__main__":
    unittest.main()
