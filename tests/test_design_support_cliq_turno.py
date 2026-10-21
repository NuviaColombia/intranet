"""Aviso «Support en turno» en Cliq (services_design_cliq.avisar_turno_si_corresponde, 20-oct-2026): al empezar cada turno,
una sola vez, solo los días del turno y sin festivos. Base SQLite en memoria; Cliq simulado."""
import os
import unittest
from datetime import date, datetime
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra los modelos)
from app import models_design as md
from app import services_design as sd
from app import services_design_cliq as sc
from app.database import Base


class AvisoTurno(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        a = models.Empleado(nombres="Diego Andres", apellidos="Sampayo Fontalvo", email="d@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="Support", area="x", identificacion="1")
        b = models.Empleado(nombres="Ana", apellidos="Uno", email="a@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="Support", area="x", identificacion="2")
        self.db.add_all([a, b]); self.db.commit()
        self.db.add(md.DesignSupportConfig(id=1, turno1_nombre="Diurno", turno1_inicio="07:00", turno1_fin="16:30",
                                           turno2_nombre="Nocturno", turno2_inicio="21:00", turno2_fin="07:00", dias="0,1,2,3,4",
                                           persona_a_id=b.id, persona_b_id=a.id, ref_fecha=date(2026, 10, 12), ref_turno1="a",
                                           semanas=4, cliq_canales="supportnuviacolombiacom"))
        self.db.commit()
        self.enviados = []
        for p in (mock.patch.object(sc, "configurado", return_value=True),
                  mock.patch.object(sc, "enviar_canal", side_effect=lambda k, t, c=None: self.enviados.append((k, t)) or (True, "Enviado.")),
                  mock.patch.object(sd, "festivos", return_value={date(2026, 10, 22)})):
            p.start(); self.addCleanup(p.stop)

    def test_al_empezar_el_turno_una_sola_vez(self):
        self.assertIsNone(sc.avisar_turno_si_corresponde(self.db, datetime(2026, 10, 20, 20, 59)))
        self.assertEqual(sc.avisar_turno_si_corresponde(self.db, datetime(2026, 10, 20, 21, 2)), 2)
        self.assertIsNone(sc.avisar_turno_si_corresponde(self.db, datetime(2026, 10, 20, 21, 3)))
        (canal, texto), = self.enviados
        self.assertEqual(canal, "supportnuviacolombiacom")
        self.assertIn("*Diego Andres Sampayo Fontalvo* — Nocturno", texto)
        self.assertIn("9:00 pm – 7:00 am · Lun a Vie", texto)
        self.assertIn("pasa a turno diurno", texto)

    def test_fin_de_semana_y_festivo_no(self):
        self.assertIsNone(sc.avisar_turno_si_corresponde(self.db, datetime(2026, 10, 24, 7, 5)))   # sábado
        self.assertIsNone(sc.avisar_turno_si_corresponde(self.db, datetime(2026, 10, 22, 7, 5)))   # festivo
        self.assertEqual(self.enviados, [])

    def test_canales(self):
        self.assertEqual(sc.canales_turno(" #uno\nDos, uno\n\n"), ["uno", "Dos"])


if __name__ == "__main__":
    unittest.main()
