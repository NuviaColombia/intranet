"""Producto «Training» (26-oct-2026): está en todas las áreas, al final de la lista, y una orden con ese producto se ve en
el Schedule pero no cuenta en ninguna parte (producto fantasma, solo para practicar)."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_produccion as sprod
from app.database import Base


class ProductoFantasma(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._productos_al_final["ok"] = False
        self.addCleanup(lambda: sd._productos_al_final.update(ok=False))
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.ana = mk("Lia", "aprobador"), mk("Ana")
        self.db.add_all([self.lia, self.ana]); self.db.commit()
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual")
        self.face = md.DesignArea(nombre="Face Design", formato="single")
        self.db.add_all([self.n3, self.face]); self.db.commit()
        self.db.add_all([md.DesignCatalogo(area_id=self.n3.id, tipo="producto", valor="Full arch", orden=1),
                         md.DesignCatalogo(area_id=self.face.id, tipo="producto", valor="Face scan", orden=1)])
        self.t3 = md.DesignTeam(area_id=self.n3.id, nombre="Eq Lia", manager_id=self.lia.id, orden=1, activo=1)
        self.db.add(self.t3); self.db.commit()
        self.db.add(md.DesignTeamDesigner(team_id=self.t3.id, empleado_id=self.ana.id)); self.db.commit()
        self.hoy = sd.ahora_colombia().date()

    def orden(self, producto, estado="Ready to design"):
        o = md.DesignOrden(team_id=self.t3.id, fecha=self.hoy, tabla="principal", orden=producto[:3], paciente="P", centro="Atlanta",
                           producto=producto, designer_id=self.ana.id, estado=estado)
        self.db.add(o); self.db.commit()
        return o

    def test_training_queda_al_final_en_todas_las_areas(self):
        sd.productos_al_final_una_vez(self.db)
        for area in (self.n3, self.face):
            prods = [c.valor for c in self.db.query(md.DesignCatalogo).filter_by(area_id=area.id, tipo="producto", activo=1)
                     .order_by(md.DesignCatalogo.orden)]
            self.assertEqual(prods[-1], "Training", area.nombre)

    def test_una_orden_training_no_cuenta(self):
        real, practica = self.orden("Full arch"), self.orden("Training")
        cuentan = {o.id for o in self.db.query(md.DesignOrden).filter(sd.filtro_orden_completa())}
        self.assertEqual(cuentan, {real.id})                                   # Dashboard, contadores, Reparto, Selección…
        self.assertEqual([x["orden"] for x in sd.mis_asignaciones(self.db, self.ana)["ordenes"]], [real.orden])   # casos asignados
        self.assertTrue(sd.es_producto_fantasma(" training "))
        self.assertFalse(sd.es_producto_fantasma("Training guide"))

    def test_n3_n2_produccion_no_lo_cuenta(self):
        self.orden("Full arch"); self.orden("Training")
        eq = next(e for e in sprod.produccion(self.db, self.hoy) if e["teamId"] == self.t3.id)
        self.assertEqual(eq["total"], 1)


if __name__ == "__main__":
    unittest.main()
