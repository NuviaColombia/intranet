"""Comments N3 (29-oct-2026): cada plantilla de nota aplica a «los demás productos», Nightguard o TC («aplica_a»), y un admin puede
borrar cualquier plantilla de su lista (también las 11 originales, que antes nadie podía borrar)."""
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


class PlantillasPorProducto(unittest.TestCase):
    def setUp(self):
        sd._cmt_aplica_ok["ok"] = False   # la marca «ya se hizo» vive en memoria: cada prueba tiene su propia base
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.ana, self.admin = mk("Ana"), mk("Ad", "admin")
        self.db.add_all([self.ana, self.admin]); self.db.commit()
        # las notas de hoy (base): una fija general, la fija de Nightguard y tres creadas por el equipo con nombres escritos distinto
        for i, (nombre, fija) in enumerate([("Hold", 1), ("NG Design Ready to print", 1), ("BITE DE NG FINALIZADO", 0),
                                            ("Ng Hold esperando Pc", 0), ("TC Ready to mill", 0), ("Midline hacia la derecha", 1)], start=1):
            self.db.add(md.DesignComentarioTemplate(nombre=nombre, texto="x", es_fija=fija, orden=i))
        self.db.commit()

    def aplica(self, u):
        return {t.nombre: t.aplica_a for t in sd.cmt_templates_listar(self.db, u.id)}

    def test_las_de_nightguard_y_tc_se_reconocen_por_el_nombre(self):
        self.assertEqual(self.aplica(self.ana), {"Hold": "", "NG Design Ready to print": "ng", "BITE DE NG FINALIZADO": "ng",
                                                 "Ng Hold esperando Pc": "ng", "TC Ready to mill": "tc", "Midline hacia la derecha": ""})

    def test_quien_ya_tenia_su_copia_tambien_queda_marcado(self):
        # una persona que ya recibió su copia antes de existir la columna (aplica_a vacío en todas)
        sd._cmt_sembrar(self.db, self.ana.id)
        self.assertTrue(all(not t.aplica_a for t in self.db.query(md.DesignComentarioTemplate).filter_by(empleado_id=self.ana.id)))
        self.assertEqual(self.aplica(self.ana)["TC Ready to mill"], "tc")
        self.assertEqual(self.aplica(self.ana)["Hold"], "")

    def test_crear_y_editar_guardan_aplica_a(self):
        t = sd.cmt_template_crear(self.db, "Mi nota", "texto", "Ana X", self.ana.id, aplica_a="ng")
        self.assertEqual(t.aplica_a, "ng")
        sd.cmt_template_editar(self.db, t.id, "Mi nota", "texto", self.ana.id, aplica_a="tc")
        self.assertEqual(self.db.get(md.DesignComentarioTemplate, t.id).aplica_a, "tc")
        sd.cmt_template_editar(self.db, t.id, "Mi nota 2", "texto", self.ana.id)           # un cliente viejo no manda el dato: no cambia
        self.assertEqual(self.db.get(md.DesignComentarioTemplate, t.id).aplica_a, "tc")
        sd.cmt_template_editar(self.db, t.id, "Mi nota 2", "texto", self.ana.id, aplica_a="")
        self.assertEqual(self.db.get(md.DesignComentarioTemplate, t.id).aplica_a, "")
        self.assertEqual(sd.cmt_template_crear(self.db, "Rara", "x", "Ana X", self.ana.id, aplica_a="otra cosa").aplica_a, "")   # solo '', ng o tc

    def test_las_nuevas_copias_salen_ya_marcadas(self):
        self.aplica(self.ana)
        otra = models.Empleado(nombres="Zoe", apellidos="X", email="zoe@x.com", rol="empleado", activo=True,
                               empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="zoe")
        self.db.add(otra); self.db.commit()
        self.assertEqual(self.aplica(otra)["BITE DE NG FINALIZADO"], "ng")

    def test_solo_un_admin_borra_las_fijas(self):
        lista = {t.nombre: t for t in sd.cmt_templates_listar(self.db, self.ana.id)}
        self.assertFalse(sd.cmt_template_eliminar(self.db, lista["Hold"].id, "Ana X", self.ana.id))                    # fija: no
        self.assertTrue(sd.cmt_template_eliminar(self.db, lista["BITE DE NG FINALIZADO"].id, "Ana X", self.ana.id))   # propia del equipo: sí
        lista = {t.nombre: t for t in sd.cmt_templates_listar(self.db, self.admin.id)}
        self.assertTrue(lista["Hold"].es_fija)
        r = rds.api_cmt_templates_listar(self.admin, self.db)
        self.assertTrue(all(x["puedeBorrar"] for x in r))                                                              # al admin se le ofrece borrar todas
        r_ana = rds.api_cmt_templates_listar(self.ana, self.db)
        self.assertEqual({x["nombre"]: x["puedeBorrar"] for x in r_ana}["Hold"], False)
        self.assertEqual({x["nombre"]: x["puedeBorrar"] for x in r_ana}["Ng Hold esperando Pc"], True)
        self.assertEqual(rds.api_cmt_template_eliminar(lista["Hold"].id, self.admin, self.db), {"mensaje": "Eliminada."})
        self.assertNotIn("Hold", [t.nombre for t in sd.cmt_templates_listar(self.db, self.admin.id)])
        with self.assertRaises(HTTPException):                                                                         # Ana sigue sin poder
            rds.api_cmt_template_eliminar(next(t.id for t in sd.cmt_templates_listar(self.db, self.ana.id) if t.nombre == "Hold"), self.ana, self.db)
        self.assertIn("Hold", [t.nombre for t in sd.cmt_templates_listar(self.db, self.ana.id)])                       # su lista no se tocó

    def test_la_papelera_devuelve_aplica_a(self):
        t = sd.cmt_template_crear(self.db, "Para TC", "x", "Ana X", self.ana.id, aplica_a="tc")
        sd.cmt_template_eliminar(self.db, t.id, "Ana X", self.ana.id)
        self.assertTrue(sd._trash_restaurar_cmt_template(self.db, {"template": {"nombre": "Para TC", "texto": "x", "creado_por": "Ana X", "aplica_a": "tc"},
                                                                  "empleado_id": self.ana.id}))
        self.db.commit()
        self.assertEqual(self.aplica(self.ana)["Para TC"], "tc")


if __name__ == "__main__":
    unittest.main()
