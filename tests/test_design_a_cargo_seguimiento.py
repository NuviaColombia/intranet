"""Dejar a cargo (28-oct-2026): quien está a cargo de un equipo hoy queda como un aprobador. No puede estar disponible: sin
casos propios no sale en Seguimiento, no cuenta en la capacidad del equipo y no se ofrece como libre en «Pedir ayuda»."""
import unittest
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_ayuda as say
from app.database import Base


class ACargoNoEstaDisponible(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._DELEG_CACHE["v"] = None
        self.addCleanup(lambda: sd._DELEG_CACHE.update(v=None))
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.leo, self.ana, self.beto, self.cris = mk("Lia", "aprobador"), mk("Leo", "aprobador"), mk("Ana"), mk("Beto"), mk("Cris")
        self.db.add_all([self.lia, self.leo, self.ana, self.beto, self.cris]); self.db.commit()
        n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(n3); self.db.commit()
        self.t1 = md.DesignTeam(area_id=n3.id, nombre="Eq Lia", manager_id=self.lia.id, orden=1, activo=1)
        self.t2 = md.DesignTeam(area_id=n3.id, nombre="Eq Leo", manager_id=self.leo.id, orden=2, activo=1)
        self.db.add_all([self.t1, self.t2]); self.db.commit()
        for t, gente in ((self.t1, (self.ana, self.beto)), (self.t2, (self.cris,))):
            for e in gente:
                self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        self.db.commit()
        self.hoy = sd.ahora_colombia().date()
        self.ahora = datetime.combine(self.hoy, datetime.min.time()).replace(hour=10)

    def a_cargo(self, quien, team=None):
        self.assertIsNone(sd.guardar_delegacion(self.db, team or self.t1, quien.id, self.hoy, self.hoy, "Lia X"))

    def nombres_seguimiento(self):
        return {p["nombre"]: p["grupo"] for p in sd.seguimiento(self.db, ahora=self.ahora)["disenadores"]}

    def test_sin_a_cargo_aparece_libre(self):
        self.assertEqual(self.nombres_seguimiento().get("Ana X"), "libre")

    def test_a_cargo_sin_casos_no_sale_en_seguimiento(self):
        self.a_cargo(self.ana)
        s = self.nombres_seguimiento()
        self.assertNotIn("Ana X", s)                 # queda como un aprobador sin casos: no sale
        self.assertEqual(s.get("Beto X"), "libre")   # los demás siguen igual

    def test_a_cargo_con_casos_si_sale_con_lo_que_hace(self):
        self.a_cargo(self.ana)
        self.db.add(md.DesignOrden(team_id=self.t1.id, fecha=self.hoy, tabla="principal", orden="A1", paciente="P", centro="Atlanta",
                                   producto="Full arch", designer_id=self.ana.id, estado="Initiated"))
        self.db.commit()
        self.assertEqual(self.nombres_seguimiento().get("Ana X"), "ocupado")

    def test_a_cargo_de_otro_equipo_tampoco_sale(self):
        self.a_cargo(self.cris, self.t1)             # Cris es de Eq Leo pero cubre Eq Lia
        self.assertNotIn("Cris X", self.nombres_seguimiento())

    def test_no_cuenta_en_la_capacidad_del_equipo(self):
        antes = {e["teamId"]: len(e["enTurno"]) for e in sd.seguimiento_equipos(self.db, ahora=self.ahora)}
        self.assertEqual(antes[self.t1.id], 2)
        self.a_cargo(self.ana)
        despues = {e["teamId"]: [p["nombre"] for p in e["enTurno"]] for e in sd.seguimiento_equipos(self.db, ahora=self.ahora)}
        self.assertEqual(despues[self.t1.id], ["Beto X"])

    def test_no_se_ofrece_como_libre_en_pedir_ayuda(self):
        # Leo pide ayuda a Eq Lia (Ana y Beto libres); si Ana queda a cargo de Eq Lia, solo queda Beto
        libres = [x["nombre"] for x in say.libres_n3(self.db, excluir_equipo_id=self.t2.id, area_id=self.t1.area_id)]
        self.assertEqual(sorted(libres), ["Ana X", "Beto X"])
        self.a_cargo(self.ana)
        libres = [x["nombre"] for x in say.libres_n3(self.db, excluir_equipo_id=self.t2.id, area_id=self.t1.area_id)]
        self.assertEqual(libres, ["Beto X"])


if __name__ == "__main__":
    unittest.main()
