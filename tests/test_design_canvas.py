"""Canvas (26-oct-2026): cada persona ve y edita solo sus hojas; el servidor guarda su respaldo privado y nadie más
lo ve (ni managers ni admins)."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class CanvasPrivado(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol: models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.ana, self.beto, self.lia, self.admin = mk("Ana", "empleado"), mk("Beto", "empleado"), mk("Lia", "aprobador"), mk("Adm", "admin")
        self.db.add_all([self.ana, self.beto, self.lia, self.admin]); self.db.commit()
        self.area = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(self.area); self.db.commit()
        t = md.DesignTeam(area_id=self.area.id, nombre="Eq", manager_id=self.lia.id, orden=1, activo=1); self.db.add(t); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id) for e in (self.ana, self.beto)]); self.db.commit()
        self.hoja = sd.canvas_crear_doc(self.db, self.area.id, "Mía", "", "", [], self.ana)

    def test_solo_el_dueno_ve_y_guarda(self):
        self.assertIsNotNone(sd.canvas_doc(self.db, self.hoja.id, self.ana))
        for otro in (self.beto, self.lia, self.admin):   # ni compañeros, ni su manager, ni un admin
            self.assertIsNone(sd.canvas_doc(self.db, self.hoja.id, otro))
            self.assertIsNone(sd.canvas_docs(self.db, self.area.id, otro, ver_de=self.ana.id))
            self.assertIsNone(sd.canvas_guardar_doc(self.db, self.hoja.id, {"nombre": "Ajena"}, otro))
            self.assertEqual(sd.canvas_personas_visibles(self.db, otro, self.area.id), [])
        self.assertIsNotNone(sd.canvas_guardar_doc(self.db, self.hoja.id, {"nombre": "Sigue siendo mía"}, self.ana))


if __name__ == "__main__":
    unittest.main()
