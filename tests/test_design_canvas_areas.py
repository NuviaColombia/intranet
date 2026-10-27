"""Canvas (27-oct-2026): cada persona ve solo las áreas de sus equipos (N3 no ve N2 ni Face); admins y Support ven todas.
Las hojas se reordenan también soltándolas a la derecha de otra (Tablero)."""
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base
from app.routers import design_schedule as rds


class CanvasAreas(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.admin, self.mgr3, self.ana, self.sam, self.nadie = mk("Ad", "admin"), mk("Mgr", "aprobador"), mk("Ana"), mk("Sam"), mk("Nadie")
        self.db.add_all([self.admin, self.mgr3, self.ana, self.sam, self.nadie]); self.db.commit()
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual")
        self.n2 = md.DesignArea(nombre="N2 Demodenture", formato="n2")
        self.face = md.DesignArea(nombre="Face Design", formato="single")
        self.sup = md.DesignArea(nombre="Support", formato=sd.FORMATO_SUPPORT)
        self.db.add_all([self.n3, self.n2, self.face, self.sup]); self.db.commit()
        t3 = md.DesignTeam(area_id=self.n3.id, nombre="Eq N3", manager_id=self.mgr3.id, orden=1, activo=1)
        ts = md.DesignTeam(area_id=self.sup.id, nombre="Support", manager_id=None, orden=1, activo=1)
        self.db.add_all([t3, ts]); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=t3.id, empleado_id=self.ana.id),
                         md.DesignTeamDesigner(team_id=ts.id, empleado_id=self.sam.id)]); self.db.commit()

    def test_cada_quien_ve_las_areas_de_su_equipo(self):
        self.assertEqual(sd.canvas_areas_permitidas(self.db, self.ana), {self.n3.id})
        self.assertEqual(sd.canvas_areas_permitidas(self.db, self.mgr3), {self.n3.id})
        self.assertEqual(sd.canvas_areas_permitidas(self.db, self.nadie), set())

    def test_admins_y_support_ven_todas(self):
        self.assertIsNone(sd.canvas_areas_permitidas(self.db, self.admin))
        self.assertIsNone(sd.canvas_areas_permitidas(self.db, self.sam))

    def test_el_servidor_no_entrega_hojas_de_otra_area(self):
        with self.assertRaises(HTTPException) as c:
            rds.api_canvas_docs(self.n2.id, None, self.ana, self.db)
        self.assertEqual(c.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            rds.api_canvas_crear(rds.CanvasCrearIn(areaId=self.face.id), self.ana, self.db)
        self.assertTrue(len(rds.api_canvas_docs(self.n3.id, None, self.ana, self.db)) > 0)   # la suya sí
        self.assertEqual(rds.api_canvas_areas(self.ana, self.db), {"todas": False, "ids": [self.n3.id]})

    def test_mover_antes_y_despues(self):
        docs = rds.api_canvas_docs(self.n3.id, None, self.ana, self.db)
        ids = [d["id"] for d in docs]
        orden = lambda: [d["id"] for d in sd.canvas_docs(self.db, self.n3.id, self.ana)]
        self.assertTrue(sd.canvas_mover_doc(self.db, ids[0], ids[-1], self.ana, despues=True))   # la primera al final
        self.assertEqual(orden(), ids[1:] + [ids[0]])
        self.assertTrue(sd.canvas_mover_doc(self.db, ids[0], ids[1], self.ana))                  # y de vuelta antes de la 2.ª
        self.assertEqual(orden(), ids)


if __name__ == "__main__":
    unittest.main()
