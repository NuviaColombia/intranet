"""Training (26-oct-2026): cuando un manager de N3 pasa un caso a Training, a la manager de Training (y a quien esté a
cargo hoy de ese equipo) le llega un aviso push para que lo asigne."""
import unittest
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base
from app.routers import design_schedule as rds


class AvisoTraining(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._DELEG_CACHE["v"] = None
        self.addCleanup(lambda: sd._DELEG_CACHE.update(v=None))
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.estefania, self.ana, self.tom = mk("Lia", "aprobador"), mk("Estefania", "aprobador"), mk("Ana"), mk("Tom")
        self.db.add_all([self.lia, self.estefania, self.ana, self.tom]); self.db.commit()
        n3, tr = md.DesignArea(nombre="N3 Prosthetic", formato="dual"), md.DesignArea(nombre=sd.AREA_TRAINING, formato="dual")
        self.db.add_all([n3, tr]); self.db.commit()
        self.t3 = md.DesignTeam(area_id=n3.id, nombre="Eq Lia", manager_id=self.lia.id, orden=1, activo=1)
        self.ttr = md.DesignTeam(area_id=tr.id, nombre="Training", manager_id=self.estefania.id, orden=1, activo=1)
        self.db.add_all([self.t3, self.ttr]); self.db.commit()
        self.db.add(md.DesignTeamDesigner(team_id=self.ttr.id, empleado_id=self.tom.id)); self.db.commit()
        self.hoy = sd.ahora_colombia().date()
        self.o = md.DesignOrden(team_id=self.t3.id, fecha=self.hoy, tabla="principal", orden="T1", paciente="Pac", centro="Atlanta",
                                producto="Full arch", designer_id=self.ana.id)
        self.db.add(self.o); self.db.commit()

    def pasar(self):
        destino = sd.mover_a_training(self.db, self.o, self.lia)
        with mock.patch.object(rds.spush, "enviar_en_segundo_plano") as env:
            rds._push_llego_a_training(self.db, self.o, destino, self.lia)
        return env

    def test_avisa_a_la_manager_de_training(self):
        env = self.pasar()
        ids, titulo, cuerpo = env.call_args[0][0], env.call_args[0][1], env.call_args[0][2]
        self.assertEqual(ids, [self.estefania.id])
        self.assertIn("Training", titulo)
        self.assertIn("T1", cuerpo)
        self.assertIn("Asígnalo", cuerpo)
        self.assertTrue(env.call_args.kwargs.get("fijo"))
        self.assertIsNone(self.o.designer_id)   # llega sin diseñador para que ella lo asigne

    def test_tambien_a_quien_esta_a_cargo_hoy(self):
        sd.guardar_delegacion(self.db, self.ttr, self.tom.id, self.hoy, self.hoy, "Estefania X")
        env = self.pasar()
        self.assertEqual(env.call_args[0][0], sorted([self.estefania.id, self.tom.id]))


if __name__ == "__main__":
    unittest.main()


class NightguardATraining(AvisoTraining):
    """27-oct-2026: también los Nightguards / TC pasan a Training (conservan su tabla)."""

    def test_nightguard_pasa_a_training_y_conserva_su_tabla(self):
        self.o.tabla = "nightguard"; self.db.commit()
        destino = sd.mover_a_training(self.db, self.o, self.lia)
        self.assertEqual(destino.id, self.ttr.id)
        self.assertEqual((self.o.team_id, self.o.tabla, self.o.designer_id), (self.ttr.id, "nightguard", None))

    def test_material_change_sigue_sin_pasar(self):
        self.o.tabla = "material"; self.db.commit()
        with self.assertRaises(ValueError):
            sd.mover_a_training(self.db, self.o, self.lia)
