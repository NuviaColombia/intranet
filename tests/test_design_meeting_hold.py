"""N2 (Rosember, 27-oct-2026): de «Meeting» se puede pasar a Hold aunque la orden no se haya iniciado. Sin Inicio no se anota
Start hold, así al pasar a Initiated se anota el Inicio normal y el Total no se daña."""
import unittest
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base
from app.routers import design_schedule as rds


class MeetingHold(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        self.admin = models.Empleado(nombres="Ad", apellidos="X", email="ad@x.com", rol="admin", activo=True,
                                     empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="ad")
        self.db.add(self.admin); self.db.commit()
        n2 = md.DesignArea(nombre="N2 Demodenture", formato=sd.FORMATO_N2)
        self.db.add(n2); self.db.commit()
        self.team = md.DesignTeam(area_id=n2.id, nombre="Eq N2", manager_id=self.admin.id, orden=1, activo=1)
        self.db.add(self.team); self.db.commit()
        self.hoy = sd.ahora_colombia().date()

    def orden(self, estado):
        o = md.DesignOrden(team_id=self.team.id, fecha=self.hoy, fecha_creada=self.hoy, tabla="principal", orden="N1", paciente="P",
                           centro="C", producto="Full", designer_id=self.admin.id, estado=estado)
        self.db.add(o); self.db.commit()
        return o

    def estado(self, o, nuevo):
        return rds.api_actualizar_orden(o.id, rds.OrdenIn(teamId=self.team.id, fecha=self.hoy.isoformat(), estado=nuevo), self.admin, self.db)

    def test_de_meeting_a_hold_y_luego_initiated(self):
        o = self.orden("Meeting")
        r = self.estado(o, "Hold")
        self.assertEqual(r["estado"], "Hold")
        self.assertEqual(r["sHold"], "")            # sin Inicio no se anota Start hold
        r = self.estado(o, "Initiated")
        self.assertTrue(r["horaInicio"])            # el Inicio llega con Initiated
        self.assertEqual(r["fHold"], "")

    def test_sin_iniciar_y_sin_meeting_sigue_bloqueado(self):
        o = self.orden("Order Entered")
        with self.assertRaises(HTTPException) as c:
            self.estado(o, "Hold")
        self.assertEqual(c.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
