"""Removable Denture (26-oct-2026): cuando Nestor aprueba la copia, el aviso push llega al manager del equipo de origen y
al diseñador de la orden original (no a quien aprueba)."""
import unittest
from datetime import date
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_push as spush
from app.database import Base


class AvisoRdAprobada(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.ana, self.nestor = mk("Lia", "aprobador"), mk("Ana"), mk("Nestor")
        self.db.add_all([self.lia, self.ana, self.nestor]); self.db.commit()
        n3, rd = md.DesignArea(nombre="N3 Prosthetic", formato="dual"), md.DesignArea(nombre="Removable Denture", formato="dual")
        self.db.add_all([n3, rd]); self.db.commit()
        t3 = md.DesignTeam(area_id=n3.id, nombre="Eq Lia", manager_id=self.lia.id, orden=1, activo=1)
        trd = md.DesignTeam(area_id=rd.id, nombre="RD", manager_id=None, orden=1, activo=1)
        self.db.add_all([t3, trd]); self.db.commit()
        hoy = date(2026, 10, 26)
        self.original = md.DesignOrden(team_id=t3.id, fecha=hoy, tabla="principal", orden="A1", producto="Removable", designer_id=self.ana.id)
        self.copia = md.DesignOrden(team_id=trd.id, fecha=hoy, tabla="material", orden="A1", producto="Removable",
                                    designer_id=self.nestor.id, estado="Approved")
        self.db.add_all([self.original, self.copia]); self.db.commit()
        self.db.add(md.DesignCopiaRD(rd_orden_id=self.copia.id, origen_orden_id=self.original.id, origen_team_id=t3.id)); self.db.commit()

    def test_avisa_al_manager_y_al_disenador_de_la_orden(self):
        with mock.patch.object(spush, "enviar_en_segundo_plano") as env:
            sd.push_rd_aprobada(self.db, self.copia, self.nestor)
        ids, titulo = env.call_args[0][0], env.call_args[0][1]
        self.assertEqual(ids, sorted([self.lia.id, self.ana.id]))
        self.assertIn("aprobada", titulo)

    def test_no_se_avisa_a_quien_aprueba(self):
        self.original.designer_id = self.nestor.id; self.db.commit()   # si el diseñador de la orden es quien aprueba
        with mock.patch.object(spush, "enviar_en_segundo_plano") as env:
            sd.push_rd_aprobada(self.db, self.copia, self.nestor)
        self.assertEqual(env.call_args[0][0], [self.lia.id])


if __name__ == "__main__":
    unittest.main()
