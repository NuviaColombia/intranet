"""Mural (22-oct-2026): push fijo por cada aviso publicado a todo Design; prueba solo a quien administra."""
import unittest
from datetime import datetime, timedelta
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design_mural as smu
from app import services_design_push as sp
from app.database import Base


class MuralPush(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, email, empresa=models.EMPRESA_DESIGN, rol="empleado", mods="design_schedule": models.Empleado(
            nombres=n, apellidos="X", email=email, rol=rol, activo=True, empresa=empresa, cargo="x", area="x", identificacion=n, modulos=mods)
        self.ros = mk("Ros", "rosember@nuviasmiles.com", rol="admin")
        self.a, self.b = mk("Ana", "a@x.com"), mk("Beto", "b@x.com")
        self.fuera = mk("Otro", "o@x.com", empresa="Otra", mods="")
        self.db.add_all([self.ros, self.a, self.b, self.fuera]); self.db.commit()
        self.envios, self.fondo = [], []
        for p in (mock.patch.object(sp, "enviar", side_effect=lambda db, ids, *a, **k: self.envios.append((sorted(ids), a, k)) or
                                    {"enviados": len(ids), "fallidos": 0, "borrados": 0, "sinSuscripcion": 0}),
                  mock.patch.object(sp, "enviar_en_segundo_plano", side_effect=lambda ids, *a, **k: self.fondo.append((sorted(ids), a, k)))):
            p.start(); self.addCleanup(p.stop)

    def aviso(self, titulo, publicado=False, hace_dias=0):
        a = md.DesignMuralAviso(titulo=titulo, mime="image/webp", ancho=1, alto=1, tamano=1, datos=b"x", orden=1, creado_por_id=self.ros.id,
                                publicado=publicado, publicado_en=datetime.utcnow() - timedelta(days=hace_dias) if publicado else None)
        self.db.add(a); self.db.commit()
        return a

    def test_prueba_solo_a_mi_un_push_fijo_por_aviso_nuevo(self):
        for t in ("Uno", "Dos", "Tres"):
            self.aviso(t, publicado=True)
        self.aviso("Viejo", publicado=True, hace_dias=10)   # ya no es «Nuevo»
        self.aviso("Borrador")
        r = smu.avisar_nuevos(self.db, self.ros, prueba=True)
        self.assertEqual(r["avisos"], 3)
        self.assertEqual([e[0] for e in self.envios], [[self.ros.id]] * 3)
        self.assertEqual(len({e[1][3] for e in self.envios}), 3)          # etiqueta distinta: no se reemplazan entre sí
        self.assertTrue(all(e[2]["fijo"] for e in self.envios))           # se quedan hasta que los cierren
        self.assertTrue(all(e[1][2].startswith("/design/mural?aviso=") for e in self.envios))

    def test_a_todos_y_al_publicar(self):
        self.aviso("Uno", publicado=True)
        smu.avisar_nuevos(self.db, self.ros, prueba=False)
        self.assertEqual(self.envios[0][0], sorted([self.a.id, self.b.id]))   # todo Design menos quien lo envía
        b = self.aviso("Nuevo aviso")
        smu.editar(self.db, b.id, publicado=True, quien=self.ros)
        self.assertEqual(self.fondo[0][0], sorted([self.a.id, self.b.id]))
        self.aviso("Otro borrador"); self.aviso("Y otro")
        self.assertEqual(smu.publicar_borradores(self.db, quien=self.ros), 2)
        self.assertEqual(len(self.fondo), 3)   # uno por aviso publicado


if __name__ == "__main__":
    unittest.main()
