"""Catálogo de hallazgos de QC (26-oct-2026): la lista de N3 se reemplaza una sola vez por la reorganizada en 4 títulos,
igual en todas las tablas; N6 no cambia y lo que se agregue después se conserva."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado para las relaciones de los modelos de Design)
from app import models_design as md
from app import services_design_qc as sq
from app.database import Base


class CatalogoN3(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual")
        self.n6 = md.DesignArea(nombre="N6 Material Changes", formato="dual")
        self.db.add_all([self.n3, self.n6]); self.db.commit()

    def titulos(self, area, tabla="principal", producto=""):
        return [(t["titulo"], [i["texto"] for i in t["items"]]) for t in sq.catalogo(self.db, area.id, tabla, producto)]

    def test_n3_queda_solo_con_la_lista_nueva_en_todas_las_tablas(self):
        esperado = [(t, items) for t, items in sq.REEMPLAZOS[0][2]]
        self.assertEqual([t for t, _ in esperado], ["Diseño", "Evidencias", "Comentarios /reportes", "To mill"])
        self.assertEqual(sum(len(i) for _, i in esperado), 31)
        self.assertEqual(self.titulos(self.n3), esperado)                                  # Cirugías
        self.assertEqual(self.titulos(self.n3, "nightguard", "Nightguard upper"), esperado)  # Nightguards
        self.assertEqual(self.titulos(self.n3, "nightguard", "TC"), esperado)                # TC
        viejos = {r.hallazgo for r in self.db.query(md.DesignQcCatalogo).filter_by(area_id=self.n3.id, activo=0)}
        self.assertIn("Comentario en plataforma y cliq con degree incorrecto", viejos)       # la lista anterior salió

    def test_n6_no_cambia(self):
        titulos_n6 = [t for t, _ in self.titulos(self.n6)]
        self.assertIn("REPORTES QC PLATAFORMA", titulos_n6)
        self.assertNotIn("Comentarios /reportes", titulos_n6)

    def test_lo_que_se_agrega_despues_se_conserva(self):
        self.titulos(self.n3)   # aplica el reemplazo
        sq.agregar_hallazgo(self.db, self.n3.id, "To mill", "Hallazgo agregado por un aprobador")
        self.assertIn("Hallazgo agregado por un aprobador", dict(self.titulos(self.n3))["To mill"])


    def test_eliminar_titulo_y_editar_hallazgo(self):
        self.titulos(self.n3)
        self.assertEqual(sq.eliminar_titulo(self.db, self.n3.id, "To mill"), 4)
        self.assertNotIn("To mill", dict(self.titulos(self.n3)))
        with self.assertRaises(KeyError):
            sq.eliminar_titulo(self.db, self.n3.id, "To mill")   # ya no está
        item = sq.catalogo(self.db, self.n3.id)[0]["items"][0]
        sq.editar_hallazgo(self.db, item["id"], "Cambios incorrectos")
        self.assertEqual(dict(self.titulos(self.n3))["Diseño"][0], "Cambios incorrectos")
        otro = sq.catalogo(self.db, self.n3.id)[0]["items"][1]
        with self.assertRaises(ValueError):
            sq.editar_hallazgo(self.db, otro["id"], "cambios incorrectos")   # repetido en el mismo título


if __name__ == "__main__":
    unittest.main()
