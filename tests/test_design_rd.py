"""Removable Denture (services_design.rd_horas_por_estado, 20-oct-2026): las horas se llenan con el estado por etapa,
Bite design (columnas de siempre) → Denture design (columnas z_). No necesita base de datos."""
import unittest
from unittest import mock

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd


class EtapasRD(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(sd, "ahora_colombia", return_value=sd.datetime(2026, 10, 20, 9, 30))
        p.start(); self.addCleanup(p.stop)

    def test_bite_design(self):
        self.assertEqual(sd.rd_horas_por_estado({"etapa": "Bite design"}, "Initiated"), {"hora_inicio": "09:30"})
        c = sd.rd_horas_por_estado({"etapa": "Bite design", "hora_inicio": "08:00"}, "Approved")
        self.assertEqual(c, {"hora_fin": "09:30", "etapa": "Denture design", "estado": "Ready to design"})

    def test_denture_design(self):
        base = {"etapa": "Denture design", "hora_inicio": "08:00", "hora_fin": "09:00"}
        self.assertEqual(sd.rd_horas_por_estado(base, "Initiated"), {"z_hora_inicio": "09:30"})
        self.assertEqual(sd.rd_horas_por_estado({**base, "z_hora_inicio": "09:10"}, "Approved"), {"z_hora_fin": "09:30"})
        self.assertEqual(sd.rd_horas_por_estado(base, "Hold"), {"z_s_hold": "09:30"})

    def test_sin_etapa_empieza_en_bite(self):
        self.assertEqual(sd.rd_horas_por_estado({"etapa": ""}, "Initiated"), {"hora_inicio": "09:30", "etapa": "Bite design"})


if __name__ == "__main__":
    unittest.main()
