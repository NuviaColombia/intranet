"""Dashboard › Tendencia por equipo (21-oct-2026): solo cuentan las órdenes completas en estado Approved."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class Tendencia(unittest.TestCase):
    def test_solo_approved(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        admin = models.Empleado(nombres="Ana", apellidos="Admin", email="a@x.com", rol="admin", activo=True,
                                empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        db.add(admin); db.commit()
        area = md.DesignArea(nombre="N3 Prosthetic", formato="n3"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        dia = date(2026, 10, 20)
        for i, estado in enumerate(["Approved", " approved ", "Started", "Hold", "Canceled", "Bite design"]):
            db.add(md.DesignOrden(team_id=t.id, fecha=dia, tabla="principal", orden=f"O{i}", centro="C", producto="P",
                                  designer_id=admin.id, estado=estado, orden_visual=i))
        db.commit()
        d = sd.dashboard_tendencia(db, admin, area.id, None, date(2026, 10, 19), date(2026, 10, 21))
        self.assertEqual(d["series"][0]["valores"], [0, 2, 0])
        self.assertEqual(d["series"][0]["total"], 2)


if __name__ == "__main__":
    unittest.main()
