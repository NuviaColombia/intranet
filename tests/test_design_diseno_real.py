"""Tiempo de diseño con hora real (27-oct-2026, orden 244834): las horas del horario se guardan sin fecha y un Hold de varios
días se medía mal (21h 15m en vez de los días reales). Ahora, desde el primer Initiated, se suman los tramos reales en
Initiated y el Hold nunca entra."""
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base
from app.routers import design_schedule as rds


class DisenoReal(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        self.admin = models.Empleado(nombres="Ad", apellidos="X", email="ad@x.com", rol="admin", activo=True,
                                     empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="ad")
        self.ana = models.Empleado(nombres="Ana", apellidos="X", email="ana@x.com", rol="empleado", activo=True,
                                   empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="ana")
        self.db.add_all([self.admin, self.ana]); self.db.commit()
        area = md.DesignArea(nombre="Face Design", formato=sd.FORMATO_SINGLE)
        self.db.add(area); self.db.commit()
        self.team = md.DesignTeam(area_id=area.id, nombre="Eq", manager_id=self.admin.id, orden=1, activo=1)
        self.db.add(self.team); self.db.commit()
        self.hoy = sd.ahora_colombia().date()
        self.o = md.DesignOrden(team_id=self.team.id, fecha=self.hoy, fecha_creada=self.hoy - timedelta(days=4), tabla="principal",
                                orden="244834", paciente="P", centro="C", producto="Full Mouth", designer_id=self.ana.id)
        self.db.add(self.o); self.db.commit()

    def estado(self, nuevo, **otros):
        return rds.api_actualizar_orden(self.o.id, rds.OrdenIn(teamId=self.team.id, fecha=self.hoy.isoformat(), estado=nuevo, **otros), self.admin, self.db)

    def atrasar(self, **delta):
        """Simula que el tramo abierto lleva ese tiempo corriendo."""
        self.db.refresh(self.o)
        self.o.diseno_desde = self.o.diseno_desde - timedelta(**delta)
        self.db.commit()

    def test_hold_de_varios_dias_no_cuenta_como_diseno(self):
        self.estado("Initiated"); self.atrasar(hours=2)
        self.estado("Hold")                                   # 2 h de diseño y luego 4 días en Hold
        self.db.refresh(self.o)
        self.assertAlmostEqual(self.o.diseno_min, 120, delta=1)
        self.assertIsNone(self.o.diseno_desde)
        self.estado("Initiated"); self.atrasar(minutes=45)    # vuelve y trabaja 45 min
        r = self.estado("Approved")
        self.assertAlmostEqual(r["disenoMin"], 165, delta=1)
        self.assertAlmostEqual(sd.duracion_orden_min(self.o, sd.FORMATO_SINGLE), 165, delta=1)

    def test_dos_hold_seguidos_suman_cada_tramo(self):
        self.estado("Initiated"); self.atrasar(minutes=30); self.estado("Hold")
        self.estado("Initiated"); self.atrasar(minutes=20); self.estado("Hold")
        self.estado("Initiated"); self.atrasar(minutes=10); self.estado("Approved")
        self.db.refresh(self.o)
        self.assertAlmostEqual(self.o.diseno_min, 60, delta=1)

    def test_de_hold_directo_a_approved_no_suma_el_hold(self):
        self.estado("Initiated"); self.atrasar(minutes=50); self.estado("Hold")
        self.estado("Approved")
        self.db.refresh(self.o)
        self.assertAlmostEqual(self.o.diseno_min, 50, delta=1)

    def test_corregir_una_hora_a_mano_vuelve_al_calculo_de_siempre(self):
        self.estado("Initiated"); self.atrasar(hours=1)
        self.estado("Approved", horaFin="23:00")              # el manager escribe el Fin a mano
        self.db.refresh(self.o)
        self.assertIsNone(self.o.diseno_min)
        self.assertIsNone(self.o.diseno_desde)

    def test_orden_que_ya_venia_iniciada_no_se_mide(self):
        self.o.estado, self.o.hora_inicio = "Initiated", "10:00"; self.db.commit()   # antes de esta función
        self.estado("Hold"); self.estado("Initiated"); self.estado("Approved")
        self.db.refresh(self.o)
        self.assertIsNone(self.o.diseno_min)

    def test_sin_fin_el_total_queda_en_cero(self):
        self.estado("Initiated")
        self.db.refresh(self.o)
        self.assertEqual(sd.duracion_orden_min(self.o, sd.FORMATO_SINGLE), 0)


if __name__ == "__main__":
    unittest.main()
