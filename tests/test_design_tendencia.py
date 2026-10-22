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


    def test_qc_por_disenador(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        a = models.Empleado(nombres="Ana", apellidos="Admin", email="a@x.com", rol="admin", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        b = models.Empleado(nombres="Beto", apellidos="Dos", email="b@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="2")
        db.add_all([a, b]); db.commit()
        area = md.DesignArea(nombre="N6 Material Changes", formato="n6"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        filas = [(b.id, "", True, "Contacto", False, "", "Approved"), (b.id, "", True, "Margen", True, "Color", "Approved"),
                 (a.id, "", True, "Eje", False, "", "Approved"), (a.id, "", True, "", False, "", "Approved"),
                 (a.id, "", False, "No marcado", False, "", "Approved"), (b.id, "", True, "X", False, "", "Canceled"),
                 (None, "Pedro Prestado", True, "Y", False, "", "Approved")]
        for i, (did, pres, qc, rep, zqc, zrep, est) in enumerate(filas):
            db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 5 + i % 3), tabla="principal", orden=f"O{i}", centro="C",
                                  producto="P", designer_id=did, designer_prestado=pres, estado=est, qc=qc, qc_reporte=rep,
                                  z_qc=zqc, z_qc_reporte=zrep, orden_visual=i))
        db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 9, 30), tabla="principal", orden="Vieja", centro="C", producto="P",
                              designer_id=a.id, estado="Approved", qc=True, qc_reporte="Fuera del mes", orden_visual=99))
        db.commit()
        d = sd.dashboard_qc_disenadores(db, a, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual([(x["nombre"], x["reportes"]) for x in d["disenadores"]],
                         [("Beto Dos", 3), ("Ana Admin", 1), ("Pedro Prestado", 1)])
        self.assertEqual(d["total"], 5)


if __name__ == "__main__":
    unittest.main()
