"""Producción del día de N2 para los diseñadores del equipo (Rosember, 29-oct-2026): cada diseñador de N2 ve los números de todo
su equipo, con las mismas reglas que «Producción del día» del manager (sin canceladas; los casos prestados cuentan para quien
los hizo). Solo cuentas: la tabla del Schedule sigue mostrando solo los casos propios."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class ProduccionDiaEquipoN2(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = db = sessionmaker(bind=eng)()
        mk = lambda n: models.Empleado(nombres=n, apellidos="X", email=n + "@x.com", rol="empleado", activo=1,
                                       empresa=models.EMPRESA_DESIGN, cargo="c", area="a", identificacion=n)
        self.ana, self.beto, self.carla = mk("Ana"), mk("Beto"), mk("Carla")
        db.add_all([self.ana, self.beto, self.carla]); db.flush()
        n2 = md.DesignArea(nombre=sd.AREA_HTML, formato=md.FORMATO_N2); db.add(n2); db.flush()
        self.eq = md.DesignTeam(area_id=n2.id, nombre="Eq N2", orden=1, activo=1)
        otro = md.DesignTeam(area_id=n2.id, nombre="Eq N2 B", orden=2, activo=1)
        db.add_all([self.eq, otro]); db.flush()
        db.add_all([md.DesignTeamDesigner(team_id=self.eq.id, empleado_id=self.ana.id),
                    md.DesignTeamDesigner(team_id=self.eq.id, empleado_id=self.beto.id)])
        self.dia = date(2026, 10, 29)
        db.add_all([
            md.DesignOrden(team_id=self.eq.id, fecha=self.dia, tabla="principal", orden="1", paciente="P", centro="Atlanta",
                           producto="Full arch", designer_id=self.ana.id, estado="Initiated"),
            md.DesignOrden(team_id=self.eq.id, fecha=self.dia, tabla="nightguard", orden="2", paciente="P", centro="Atlanta",
                           producto="TC", designer_id=self.beto.id, estado="Approved"),
            md.DesignOrden(team_id=self.eq.id, fecha=self.dia, tabla="principal", orden="3", paciente="P", centro="Atlanta",
                           producto="Full arch", designer_id=self.ana.id, estado="Canceled"),   # cancelada: no cuenta
            md.DesignOrden(team_id=otro.id, fecha=self.dia, tabla="principal", orden="4", paciente="P", centro="Atlanta",
                           producto="Full arch", designer_id=self.ana.id, estado="Approved"),   # prestada a otro equipo: sí cuenta
        ])
        db.commit()
        self.filas = {f["id"]: f for f in sd.produccion_dia_equipo(db, self.eq, self.dia)}

    def test_cuenta_cada_diseñador_del_equipo(self):
        self.assertEqual(self.filas[self.ana.id]["casos"], 2)           # 1 propia + 1 prestada en otro equipo
        self.assertEqual(self.filas[self.ana.id]["prestados"], 1)
        self.assertEqual(self.filas[self.ana.id]["tipos"]["sx"], 2)

    def test_tipos_de_nightguard_y_tc(self):
        self.assertEqual(self.filas[self.beto.id]["casos"], 1)
        self.assertEqual(self.filas[self.beto.id]["tipos"]["tc"], 1)

    def test_no_cuenta_canceladas(self):
        self.assertEqual(sum(f["casos"] for f in self.filas.values()), 3)

    def test_nombre_corto_y_forma_del_schedule(self):
        self.assertEqual(self.filas[self.ana.id]["nombre"], "Ana X")
        self.assertEqual(set(self.filas[self.ana.id]), {"id", "nombre", "casos", "prestados", "tipos"})

    def test_incluye_a_diseñador_sin_casos(self):
        self.db.add(md.DesignTeamDesigner(team_id=self.eq.id, empleado_id=self.carla.id)); self.db.commit()
        filas = {f["id"]: f for f in sd.produccion_dia_equipo(self.db, self.eq, self.dia)}
        self.assertEqual(filas[self.carla.id]["casos"], 0)


if __name__ == "__main__":
    unittest.main()
