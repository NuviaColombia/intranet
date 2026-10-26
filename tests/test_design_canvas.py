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


    def test_compartir_copia_solo_el_formato(self):
        import json
        from unittest import mock
        from app import services_design_push as spush
        foto = {"src": "data:image/png;base64,AAAA"}
        sd.canvas_guardar_doc(self.db, self.hoja.id, {"titulo": "Formato David",
                                                      "frames": [{"id": "f1", "x": 0, "y": 0, "w": 10, "h": 10, "img": foto}],
                                                      "elements": [{"id": "t1", "type": "text", "text": "Nota"}, {"id": "i1", "img": foto}]}, self.ana)
        with mock.patch.object(spush, "enviar_en_segundo_plano") as env:
            self.assertEqual(sd.canvas_compartir(self.db, self.hoja.id, self.ana, str(self.beto.id)), [self.beto.id])
        self.assertEqual(env.call_args[0][0], [self.beto.id])
        copias = self.db.query(md.DesignCanvasDoc).filter_by(empleado_id=self.beto.id).all()
        copia = next(c for c in copias if c.titulo == "Formato David")
        self.assertIn("(de Ana X)", copia.nombre)
        self.assertIsNone(json.loads(copia.frames)[0]["img"])                         # sin fotos
        self.assertEqual([e["id"] for e in json.loads(copia.elements)], ["t1"])       # sin anotaciones con imagen
        self.assertGreater(len(copias), 1)                                             # recibió también sus hojas base
        self.assertIsNotNone(json.loads(self.db.get(md.DesignCanvasDoc, self.hoja.id).frames)[0]["img"])   # la original sigue igual

    def test_compartir_con_el_area_y_no_con_otra_area(self):
        from unittest import mock
        from app import services_design_push as spush
        otra = md.DesignArea(nombre="N2 Demodenture", formato="n2"); self.db.add(otra); self.db.commit()
        ext = models.Empleado(nombres="Ext", apellidos="X", email="ext@x.com", rol="empleado", activo=True,
                              empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="ext")
        self.db.add(ext); self.db.commit()
        t2 = md.DesignTeam(area_id=otra.id, nombre="N2", manager_id=None, orden=1, activo=1); self.db.add(t2); self.db.commit()
        self.db.add(md.DesignTeamDesigner(team_id=t2.id, empleado_id=ext.id)); self.db.commit()
        with mock.patch.object(spush, "enviar_en_segundo_plano"):
            self.assertEqual(sorted(sd.canvas_compartir(self.db, self.hoja.id, self.ana, "area")), sorted([self.beto.id, self.lia.id]))
            with self.assertRaises(ValueError):
                sd.canvas_compartir(self.db, self.hoja.id, self.ana, str(ext.id))       # otra área
            with self.assertRaises(ValueError):
                sd.canvas_compartir(self.db, self.hoja.id, self.beto, "area")           # la hoja no es suya


if __name__ == "__main__":
    unittest.main()
