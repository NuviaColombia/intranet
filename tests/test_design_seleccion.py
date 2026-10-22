"""Desempeño › Selección asistida (21-oct-2026): percentiles por área, suavizado de tasas, ausencias y categorías."""
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_seleccion as ssel
from app.database import Base


class Seleccion(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        p = mock.patch.object(sd, "ahora_colombia", return_value=datetime(2026, 11, 5, 10, 0)); p.start(); self.addCleanup(p.stop)

    def emp(self, nombre, rol="empleado"):
        e = models.Empleado(nombres=nombre, apellidos="X", email=f"{nombre}@x.com", rol=rol, activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=nombre)
        self.db.add(e); self.db.commit()
        return e

    def equipo(self, area, nombre, manager, miembros):
        a = self.db.query(md.DesignArea).filter_by(nombre=area).first()
        if not a:
            a = md.DesignArea(nombre=area, formato="n3"); self.db.add(a); self.db.commit()
        t = md.DesignTeam(area_id=a.id, nombre=nombre, manager_id=manager.id, orden=1, activo=1); self.db.add(t); self.db.commit()
        for m in miembros:
            self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=m.id))
        self.db.commit()
        return t

    def casos(self, t, e, n, hallazgos=0, inicio=0):
        dias = [date(2026, 10, 1) + timedelta(days=i) for i in range(31) if (date(2026, 10, 1) + timedelta(days=i)).weekday() < 5]
        for i in range(n):
            self.db.add(md.DesignOrden(team_id=t.id, fecha=dias[i % len(dias)], tabla="principal", orden=f"{e.nombres}{inicio + i}",
                                       centro="C", producto="Crown", designer_id=e.id, estado="Approved",
                                       qc=True, qc_reporte="Hallazgo" if i < hallazgos else "", orden_visual=i))
        self.db.commit()

    def test_categorias_y_reglas(self):
        admin = self.emp("Admin", "admin")
        luisa, paula, sofi = self.emp("Luisa", "aprobador"), self.emp("Paula", "aprobador"), self.emp("Sofi", "aprobador")
        a, b, c, d = self.emp("Ana"), self.emp("Beto"), self.emp("Caro"), self.emp("Dani")
        f1, f2, poco = self.emp("Fede"), self.emp("Gina"), self.emp("Poco")
        t3 = self.equipo("N3 Prosthetic", "Eq Luisa", luisa, [a, b, poco])
        t6 = self.equipo("N6 Material Changes", "Eq Paula", paula, [c, d])
        tf = self.equipo("Face Design", "Eq Sofi", sofi, [f1, f2])
        self.casos(t3, a, 60, hallazgos=1)    # mucho y casi sin hallazgos
        self.casos(t3, b, 40, hallazgos=8)
        self.casos(t3, poco, 4)               # no llega al mínimo de casos
        self.casos(t6, c, 30, hallazgos=0)
        self.casos(t6, d, 30, hallazgos=6)
        self.casos(tf, f1, 25, hallazgos=0)
        self.casos(tf, f2, 50, hallazgos=1)
        r = ssel.analizar(self.db, 2026, 10)
        cat = {x["clave"]: x for x in r["categorias"]}
        self.assertEqual(r["habiles"], 22)
        self.assertEqual(cat["n3n6"]["candidatos"][0]["nombre"], "Ana X")
        self.assertIn(cat["n3n6b"]["candidatos"][0]["nombre"], ("Caro X",))
        self.assertEqual(cat["n2face"]["candidatos"][0]["nombre"], "Gina X")
        self.assertEqual({x["nombre"] for x in r["noCompiten"]}, {"Poco X"})
        self.assertTrue(all(x["area"] in ("N3 Prosthetic", "N6 Material Changes") for x in cat["n3n6"]["candidatos"]))
        self.assertEqual([m["nombre"] for m in cat["manager"]["candidatos"]][:3].__len__(), 3)
        g = cat["n3n6"]["candidatos"][0]
        self.assertTrue(g["porQue"]["fuertes"])
        self.assertIn("Evaluación del líder", g["faltan"])   # no hay hojas de Desempeño: el peso se reparte

    def test_ausencias_no_castigan(self):
        self.emp("Admin", "admin")
        m = self.emp("Luisa", "aprobador")
        a, b = self.emp("Ana"), self.emp("Beto")
        t = self.equipo("N3 Prosthetic", "Eq", m, [a, b])
        vac = models.TipoPermiso(nombre="Vacaciones", es_vacaciones=1); self.db.add(vac); self.db.commit()
        self.db.add(models.Solicitud(empleado_id=b.id, tipo_id=vac.id, fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 9),
                                     dias=7, estado="aprobada")); self.db.commit()
        self.casos(t, a, 44)          # 22 días: 2 por día
        self.casos(t, b, 33)          # 15 días disponibles: 2,2 por día → más productivo aunque hizo menos
        r = ssel.analizar(self.db, 2026, 10)
        n3 = next(x for x in r["categorias"] if x["clave"] == "n3n6")["candidatos"]
        p = {x["nombre"]: x["percentiles"]["productividad"] for x in n3}
        self.assertGreater(p["Beto X"], p["Ana X"])

    def test_mes_anterior_y_suavizado(self):
        self.assertEqual(ssel.mes_anterior(date(2026, 11, 3)), (2026, 10))
        self.assertEqual(ssel.mes_anterior(date(2027, 1, 15)), (2026, 12))
        # 0 hallazgos en 3 casos no es mejor que 2 en 80 cuando el área tiene 5 %
        self.assertGreater(ssel._suavizada(0, 3, 0.05), ssel._suavizada(2, 80, 0.05) - 0.03)
        self.assertEqual(ssel._indice_mes(["Ene 2026", "Oct 2026", "Nov 2026"], 2026, 10), 1)
        self.assertEqual(ssel._indice_mes(["Septiembre", "Octubre"], 2026, 10), 1)
        self.assertIsNone(ssel._indice_mes(["Oct 2025"], 2026, 10))


if __name__ == "__main__":
    unittest.main()
