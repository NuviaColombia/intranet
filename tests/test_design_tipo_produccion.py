"""Producción del día por tipo (22-oct-2026): en Nightguards / TC, el TC de N6 (Full Mouth Zirk - Over Ti-Bar) cuenta como Tc."""
import unittest

from app import services_design as sd


class TipoProduccion(unittest.TestCase):
    def test_tipos(self):
        t = sd.tipo_produccion
        self.assertEqual(t("nightguard", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "tc")
        self.assertEqual(t("nightguard", "n6 - full mouth zirk -  over ti-bar (8mm or less)"), "tc")
        self.assertEqual(t("nightguard", "N3 - TC"), "tc")
        self.assertEqual(t("nightguard", "N3 - NightGuard"), "ng")
        self.assertEqual(t("principal", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "sx")
        self.assertEqual(t(sd.TABLA_MATERIAL, "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "mc")


if __name__ == "__main__":
    unittest.main()
