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

    def test_explica_cada_diferencia(self):
        d = spd.diagnosticar(self.db, self.t.id, date(2026, 10, 1), date(2026, 10, 31))
        f = {x["nombre"]: x for x in d["filas"]}
        ivan = f["Ivan X"]
        self.assertEqual((ivan["prod"], ivan["rep"], ivan["dif"]), (4, 2, 2))
        motivos = dict((m, n) for m, n in ivan["motivos"])
        self.assertEqual(sum(motivos.values()), 2)
        self.assertTrue(any(m.startswith("Fila incompleta") for m in motivos))
        self.assertTrue(any(m.startswith("Lo hizo prestado en el equipo Eq Otro") for m in motivos))
        self.assertEqual((f["Dari X"]["prod"], f["Dari X"]["rep"]), (1, 0))
        self.assertTrue(f["Dari X"]["manager"])
        self.assertEqual((f["Otro X"]["prod"], f["Otro X"]["rep"]), (1, 0))
        self.assertEqual(d["prestados"], 1)
        self.assertEqual((d["totalProd"], d["totalRep"]), (7, 4))

    def test_reparto_coincide_con_el_dashboard(self):
        d = spd.diagnosticar(self.db, self.t.id, date(2026, 10, 1), date(2026, 10, 31))
        r = sd.dashboard_reparto(self.db, self.admin, date(2026, 10, 1), date(2026, 10, 31), self.t.id)
        dash = {x["nombre"]: x["total"] for x in r["filas"]}
        for x in d["filas"]:
            if x["miembro"] and not x["manager"]:
                self.assertEqual(x["rep"], dash.get(x["nombre"], 0), x["nombre"])
        self.assertEqual(d["prestados"], r["prestados"]["total"] if r["prestados"] else 0)


if __name__ == "__main__":
    unittest.main()
