"""Diagnóstico de producción (27-oct-2026, equipo de Dariana: 389 en Producción, 310 en Reparto): explica por persona por qué
«Producción del día» y Dashboard › Reparto de productos cuentan distinto, y su columna Reparto da lo mismo que el Dashboard."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_prod_diag as spd
from app.database import Base


class DiagProduccion(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.admin, self.dari, self.ivan, self.ana, self.otro = mk("Ad", "admin"), mk("Dari", "aprobador"), mk("Ivan"), mk("Ana"), mk("Otro")
        self.db.add_all([self.admin, self.dari, self.ivan, self.ana, self.otro]); self.db.commit()
        face = md.DesignArea(nombre="Face Design", formato="single")
        self.db.add(face); self.db.commit()
        self.t = md.DesignTeam(area_id=face.id, nombre="Eq Dari", manager_id=self.dari.id, orden=1, activo=1)
        self.t2 = md.DesignTeam(area_id=face.id, nombre="Eq Otro", manager_id=None, orden=2, activo=1)
        self.db.add_all([self.t, self.t2]); self.db.commit()
        self.db.add_all([md.DesignTeamDesigner(team_id=self.t.id, empleado_id=self.ivan.id),
                         md.DesignTeamDesigner(team_id=self.t.id, empleado_id=self.ana.id),
                         md.DesignTeamDesigner(team_id=self.t2.id, empleado_id=self.otro.id)]); self.db.commit()
        o = lambda team, quien, dia, **k: md.DesignOrden(team_id=team.id, fecha=date(2026, 10, dia), tabla="principal", orden=f"O{dia}",
                                                        paciente="P", centro=k.pop("centro", "Dublin"), producto=k.pop("producto", "Full Mouth"),
                                                        designer_id=quien.id, estado=k.pop("estado", "Approved"), **k)
        self.db.add_all([
            o(self.t, self.ivan, 5), o(self.t, self.ivan, 6),           # cuentan en los dos
            o(self.t, self.ivan, 7, centro=""),                         # fila incompleta: solo Producción
            o(self.t2, self.ivan, 8),                                   # Ivan prestado en otro equipo: solo Producción
            o(self.t, self.ivan, 9, estado="Skipped"),                  # skipped: ninguno
            o(self.t, self.dari, 10),                                   # caso de la manager: solo Producción
            o(self.t, self.otro, 11),                                   # alguien de afuera en este equipo: Reparto «Prestados»
            o(self.t, self.ana, 12),
        ]); self.db.commit()

    def test_reparto_cuenta_como_produccion(self):
        """27-oct-2026: el Reparto suma las filas a medio llenar, lo prestado afuera y el manager (en su fila)."""
        d = spd.diagnosticar(self.db, self.t.id, date(2026, 10, 1), date(2026, 10, 31), self.admin)
        f = {x["nombre"]: x for x in d["filas"]}
        self.assertEqual((f["Ivan X"]["prod"], f["Ivan X"]["rep"]), (4, 4))
        self.assertEqual((f["Ana X"]["prod"], f["Ana X"]["rep"]), (1, 1))
        self.assertEqual((f["Dari X"]["prod"], f["Dari X"]["rep"]), (1, 1))
        # lo único distinto: alguien de afuera en este equipo va en «Prestados»
        self.assertEqual((f["Otro X"]["prod"], f["Otro X"]["rep"]), (1, 0))
        self.assertTrue(f["Otro X"]["motivos"][0][0].startswith("Es de otro equipo"))
        self.assertEqual((d["totalProd"], d["totalRep"]), (7, 7))

    def test_manager_y_prestados_no_entran_en_la_equidad(self):
        r = sd.dashboard_reparto(self.db, self.admin, date(2026, 10, 1), date(2026, 10, 31), self.t.id)
        f = {x["nombre"]: x for x in r["filas"]}
        self.assertTrue(f["Dari X"]["manager"])
        self.assertEqual(f["Ivan X"]["fuera"], 1)
        self.assertEqual(sum(f["Ivan X"]["valoresEq"]), 3)    # sin el caso prestado en el otro equipo
        self.assertEqual(f["Ivan X"]["total"], 4)
        self.assertEqual(r["prestados"]["total"], 1)
        self.assertIn("(sin producto)", r["productos"] + ["(sin producto)"])

if __name__ == "__main__":
    unittest.main()
