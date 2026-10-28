"""Pre-Approved (28-oct-2026, Rosember): el equipo de Training es apoyo y diseña órdenes de cualquier centro de N3, así que ve
todas las hojas de N3, también en el 📋 de su Schedule. Las demás áreas no cambian."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class PreApprovedTraining(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.mgr, self.tom, self.nia = mk("Mgr", "aprobador"), mk("Tom"), mk("Nia")
        self.db.add_all([self.mgr, self.tom, self.nia]); self.db.commit()
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual")
        self.tr = md.DesignArea(nombre=sd.AREA_TRAINING, formato="dual")
        self.n2 = md.DesignArea(nombre="N2 Demodenture", formato="n2")
        self.db.add_all([self.n3, self.tr, self.n2]); self.db.commit()
        self.ttr = md.DesignTeam(area_id=self.tr.id, nombre="Training", manager_id=self.mgr.id, orden=1, activo=1)
        tn2 = md.DesignTeam(area_id=self.n2.id, nombre="Eq N2", orden=1, activo=1)
        self.db.add_all([self.ttr, tn2]); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=self.ttr.id, empleado_id=self.tom.id),
                         md.DesignTeamDesigner(team_id=tn2.id, empleado_id=self.nia.id)]); self.db.commit()
        h = md.DesignPreApprovedSheet(area_id=self.n3.id, nombre="N3 - Hoja", orden=1); self.db.add(h); self.db.commit()
        self.db.add_all([md.DesignPreApprovedCentro(sheet_id=h.id, nombre="Dallas", orden=0, span=1),
                         md.DesignPreApprovedDoctor(sheet_id=h.id, nombre="Dr. Uno", orden=0)]); self.db.commit()

    def test_training_ve_las_hojas_de_n3(self):
        for u in (self.tom, self.mgr):
            self.assertIn(self.n3.id, sd.preapproved_areas_permitidas(self.db, u), u.nombres)

    def test_el_boton_del_schedule_de_training_trae_la_hoja_de_n3(self):
        hojas = sd.preapproved_de_centro(self.db, self.tr.id, "Dallas", sd.preapproved_areas_permitidas(self.db, self.tom), self.ttr.id)
        self.assertEqual(len(hojas), 1)

    def test_otra_area_no_ve_n3(self):
        self.assertNotIn(self.n3.id, sd.preapproved_areas_permitidas(self.db, self.nia))


if __name__ == "__main__":
    unittest.main()
