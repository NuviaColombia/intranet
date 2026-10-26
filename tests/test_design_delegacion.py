"""Dejar a cargo (26-oct-2026): además de los diseñadores del equipo, «Otra persona…» deja a cargo a alguien de la MISMA
área (diseñador de otro equipo o manager); nunca a alguien de otra área."""
import unittest
from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class Delegacion(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        # la caché de delegaciones es global: sin limpiarla, otras pruebas (GeoVictoria) verían las de aquí
        sd._DELEG_CACHE["v"] = None
        self.addCleanup(lambda: sd._DELEG_CACHE.update(v=None))
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.leo, self.ivan = mk("Lia", "aprobador"), mk("Leo", "aprobador"), mk("Ivan", "aprobador")
        self.ana, self.beto, self.ciro = mk("Ana"), mk("Beto"), mk("Ciro")
        self.db.add_all([self.lia, self.leo, self.ivan, self.ana, self.beto, self.ciro]); self.db.commit()
        n3, n2 = md.DesignArea(nombre="N3 Prosthetic", formato="dual"), md.DesignArea(nombre="N2 Demodenture", formato="n2")
        self.db.add_all([n3, n2]); self.db.commit()
        eq = lambda area, nombre, man, gente: self._equipo(area, nombre, man, gente)
        self.t1 = eq(n3, "Eq Lia", self.lia, [self.ana])
        self.t2 = eq(n3, "Eq Leo", self.leo, [self.beto])
        self.t3 = eq(n2, "Eq Ivan", self.ivan, [self.ciro])
        self.hoy = sd.ahora_colombia().date()

    def _equipo(self, area, nombre, man, gente):
        t = md.DesignTeam(area_id=area.id, nombre=nombre, manager_id=man.id, orden=1, activo=1)
        self.db.add(t); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id) for e in gente]); self.db.commit()
        return t

    def test_candidatos_son_de_la_misma_area_y_no_del_equipo(self):
        c = {x["nombre"]: x["equipo"] for x in sd.candidatos_delegacion(self.db, self.t1)}
        self.assertEqual(c, {"Beto X": "Eq Leo", "Leo X": "Eq Leo (manager)"})   # ni Ana (del equipo) ni los de N2

    def test_guardar_a_otra_persona_de_la_misma_area(self):
        self.assertIsNone(sd.guardar_delegacion(self.db, self.t1, self.beto.id, self.hoy, self.hoy + timedelta(days=1), "Lia X"))
        self.assertEqual(sd.delegacion_de(self.db, self.t1)["nombre"], "Beto X")
        self.db.refresh(self.t1)
        self.assertTrue(sd.gestiona_equipo(self.beto, self.t1))   # Beto ya gestiona el Schedule de Lia

    def test_no_deja_a_alguien_de_otra_area(self):
        err = sd.guardar_delegacion(self.db, self.t1, self.ciro.id, self.hoy, self.hoy, "Lia X")
        self.assertIn("misma área", err)


if __name__ == "__main__":
    unittest.main()
