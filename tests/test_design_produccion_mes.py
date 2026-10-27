"""Producción del día (27-oct-2026): junto al número del día se ve lo que lleva cada diseñador en el mes. El servidor da lo de los
días anteriores del mes por persona y tipo; la pantalla le suma el día elegido."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class ProduccionMes(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.mgr, self.ana, self.bob = mk("Mgr", "aprobador"), mk("Ana"), mk("Bob")
        self.db.add_all([self.mgr, self.ana, self.bob]); self.db.commit()
        n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual")
        self.db.add(n3); self.db.commit()
        self.t1 = md.DesignTeam(area_id=n3.id, nombre="Eq 1", manager_id=self.mgr.id, orden=1, activo=1)
        self.t2 = md.DesignTeam(area_id=n3.id, nombre="Eq 2", manager_id=self.mgr.id, orden=2, activo=1)
        self.db.add_all([self.t1, self.t2]); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=self.t1.id, empleado_id=self.ana.id),
                         md.DesignTeamDesigner(team_id=self.t2.id, empleado_id=self.bob.id)]); self.db.commit()

    def orden(self, dia, team, quien, tabla="principal", estado="", producto="Full arch"):
        self.db.add(md.DesignOrden(team_id=team.id, fecha=date(2026, 10, dia), tabla=tabla, orden=f"O{dia}", paciente="P", centro="C",
                                   producto=producto, designer_id=quien.id, estado=estado))
        self.db.commit()

    def test_suma_los_dias_anteriores_del_mes_por_tipo(self):
        self.orden(5, self.t1, self.ana); self.orden(6, self.t1, self.ana)
        self.orden(6, self.t1, self.ana, tabla="nightguard", producto="Nightguard")
        self.orden(7, self.t1, self.ana, tabla="nightguard", producto="TC Upper")
        r = sd.produccion_mes_previa(self.db, self.t1, date(2026, 10, 27))
        self.assertEqual(r[self.ana.id], {"sx": 2, "tc": 1, "ng": 1, "mc": 0})

    def test_no_cuenta_el_dia_elegido_ni_otros_meses_ni_canceladas(self):
        self.orden(27, self.t1, self.ana)                        # el día elegido lo suma la pantalla
        self.db.add(md.DesignOrden(team_id=self.t1.id, fecha=date(2026, 9, 30), tabla="principal", orden="S", paciente="P",
                                   centro="C", producto="Full arch", designer_id=self.ana.id)); self.db.commit()
        self.orden(8, self.t1, self.ana, estado="Canceled")
        self.orden(9, self.t1, self.ana, producto="Training")    # «Training» no cuenta
        self.assertEqual(sd.produccion_mes_previa(self.db, self.t1, date(2026, 10, 27)), {})

    def test_el_dia_1_no_hay_acumulado_previo(self):
        self.orden(1, self.t1, self.ana)
        self.assertEqual(sd.produccion_mes_previa(self.db, self.t1, date(2026, 10, 1)), {})

    def test_cuentan_los_casos_prestados_en_otros_equipos(self):
        self.orden(5, self.t2, self.ana)                         # Ana hizo un caso prestado en el equipo 2
        self.orden(6, self.t1, self.ana)
        r = sd.produccion_mes_previa(self.db, self.t1, date(2026, 10, 27))
        self.assertEqual(r[self.ana.id]["sx"], 2)
        self.assertNotIn(self.bob.id, r)                         # y no se mezcla con los de Bob en su propio equipo

    def test_un_diseñador_solo_ve_lo_suyo(self):
        self.orden(5, self.t1, self.ana); self.orden(5, self.t1, self.mgr)
        r = sd.produccion_mes_previa(self.db, self.t1, date(2026, 10, 27), solo_empleado_id=self.ana.id)
        self.assertEqual(list(r), [self.ana.id])


if __name__ == "__main__":
    unittest.main()
