"""Comments N3 (28-oct-2026): las plantillas son de cada diseñador. La primera vez cada uno recibe su copia de las que había
(las «base»), con sus favoritos; nadie ve, edita ni borra las de otra persona."""
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


class PlantillasIndividuales(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.javier, self.ana, self.admin = mk("Javier"), mk("Ana"), mk("Ad", "admin")
        self.db.add_all([self.javier, self.ana, self.admin]); self.db.commit()
        # plantillas de hoy: una fija del formato y una creada por el equipo (quedan como base)
        self.fija = md.DesignComentarioTemplate(nombre="Fija", texto="{PO}\nfija", es_fija=1, orden=1)
        self.eq = md.DesignComentarioTemplate(nombre="Del equipo", texto="hola", es_fija=0, orden=2, creado_por="Ana X")
        self.db.add_all([self.fija, self.eq]); self.db.commit()
        self.db.add(md.DesignFavorito(empleado_id=self.javier.id, tipo="cmt_template", cmt_template_id=self.eq.id)); self.db.commit()

    def nombres(self, u):
        return [t.nombre for t in sd.cmt_templates_listar(self.db, u.id)]

    def test_cada_uno_recibe_su_copia_y_conserva_favoritos(self):
        lj = sd.cmt_templates_listar(self.db, self.javier.id)
        self.assertEqual([t.nombre for t in lj], ["Fija", "Del equipo"])
        self.assertTrue(all(t.empleado_id == self.javier.id for t in lj))
        copia_eq = next(t for t in lj if t.nombre == "Del equipo")
        self.assertIn(copia_eq.id, sd.favoritos_activos(self.db, self.javier.id)["cmtTemplates"])   # el favorito pasó a su copia
        self.assertEqual(self.nombres(self.ana), ["Fija", "Del equipo"])
        self.assertEqual(len(sd.cmt_templates_listar(self.db, self.javier.id)), 2)                   # no se vuelve a copiar

    def test_lo_que_crea_o_cambia_uno_no_lo_ve_el_otro(self):
        self.nombres(self.javier); self.nombres(self.ana)
        sd.cmt_template_crear(self.db, "Mía", "texto", "Javier X", self.javier.id)
        tj = next(t for t in sd.cmt_templates_listar(self.db, self.javier.id) if t.nombre == "Fija")
        sd.cmt_template_editar(self.db, tj.id, "Fija editada", "otro", self.javier.id)
        self.assertEqual(self.nombres(self.javier), ["Fija editada", "Del equipo", "Mía"])
        self.assertEqual(self.nombres(self.ana), ["Fija", "Del equipo"])

    def test_no_se_puede_tocar_la_de_otro(self):
        ta = sd.cmt_templates_listar(self.db, self.ana.id)[1]
        self.nombres(self.javier)
        self.assertIsNone(sd.cmt_template_editar(self.db, ta.id, "x", "x", self.javier.id))
        self.assertFalse(sd.cmt_template_eliminar(self.db, ta.id, "Javier X", self.javier.id))
        with self.assertRaises(HTTPException):
            rds.api_cmt_template_editar(ta.id, rds.CmtTemplateIn(nombre="x", texto="x"), self.javier, self.db)
        with self.assertRaises(HTTPException):   # tampoco un admin
            rds.api_cmt_template_eliminar(ta.id, self.admin, self.db)
        with self.assertRaises(HTTPException):
            rds.api_favorito_toggle_cmt_template(ta.id, self.javier, self.db)
        self.assertEqual(self.nombres(self.ana), ["Fija", "Del equipo"])

    def test_la_fija_propia_no_se_borra_y_la_papelera_devuelve_a_su_dueno(self):
        lj = sd.cmt_templates_listar(self.db, self.javier.id)
        self.assertFalse(sd.cmt_template_eliminar(self.db, lj[0].id, "Javier X", self.javier.id))   # fija
        self.assertTrue(sd.cmt_template_eliminar(self.db, lj[1].id, "Javier X", self.javier.id))
        self.assertEqual(self.nombres(self.javier), ["Fija"])
        tr = self.db.query(md.DesignTrash).order_by(md.DesignTrash.id.desc()).first()
        import json
        self.assertTrue(sd._trash_restaurar_cmt_template(self.db, json.loads(tr.payload))); self.db.commit()
        self.assertEqual(self.nombres(self.javier), ["Fija", "Del equipo"])
        self.assertEqual(self.nombres(self.ana), ["Fija", "Del equipo"])


if __name__ == "__main__":
    unittest.main()
