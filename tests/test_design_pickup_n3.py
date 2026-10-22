"""N3 › Cirugías (21-oct-2026): Pickup received marca START, Ready to design marca RTD y de Pickup no se salta a diseño."""
import unittest
from unittest import mock
from datetime import datetime

from app import services_design as sd


class PickupN3(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(sd, "ahora_colombia", return_value=datetime(2026, 10, 21, 9, 15)); p.start(); self.addCleanup(p.stop)

    def test_start_y_rtd(self):
        f = sd.articulacion_por_estado
        self.assertEqual(f("N3 Prosthetic", "principal", {}, "Pickup received"), {"art_start": "09:15"})
        self.assertEqual(f("N3 Prosthetic", "principal", {"art_start": "08:00"}, "Pickup received"), {})       # no pisa lo escrito
        self.assertEqual(f("N3 Prosthetic", "principal", {"art_start": "08:00"}, "Ready to design"), {"art_rtd": "09:15"})
        self.assertEqual(f("N3 Prosthetic", "principal", {"art_start": "08:00", "art_rtd": "08:30"}, "Ready to design"), {})
        self.assertEqual(f("N3 Prosthetic", "principal", {}, "Ready to design"), {})                            # sin START no hay RTD
        self.assertEqual(f("N3 Prosthetic", "nightguard", {}, "Pickup received"), {})
        self.assertEqual(f("N6 Material Changes", "principal", {}, "Pickup received"), {})

    def test_no_salta_de_pickup(self):
        s = sd.pickup_salta
        for nuevo in ("Initiated", "Hold", "Approved", "Bite ready"):
            self.assertTrue(s("N3 Prosthetic", "principal", "Pickup received", nuevo), nuevo)
        for nuevo in ("Ready to design", "Order Entered", "Canceled", "Skipped", "Pickup received"):
            self.assertFalse(s("N3 Prosthetic", "principal", "Pickup received", nuevo), nuevo)
        self.assertFalse(s("N3 Prosthetic", "principal", "Ready to design", "Initiated"))
        self.assertFalse(s("N3 Prosthetic", "nightguard", "Pickup received", "Initiated"))


if __name__ == "__main__":
    unittest.main()
