"""Dashboard › Tendencia por equipo (21-oct-2026): solo cuentan las órdenes completas en estado Approved."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class Tendencia(unittest.TestCase):
    def test_solo_approved(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        admin = models.Empleado(nombres="Ana", apellidos="Admin", email="a@x.com", rol="admin", activo=True,
                                empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        db.add(admin); db.commit()
        area = md.DesignArea(nombre="N3 Prosthetic", formato="n3"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        dia = date(2026, 10, 20)
        for i, estado in enumerate(["Approved", " approved ", "Started", "Hold", "Canceled", "Bite design"]):
            db.add(md.DesignOrden(team_id=t.id, fecha=dia, tabla="principal", orden=f"O{i}", centro="C", producto="P",
                                  designer_id=admin.id, estado=estado, orden_visual=i))
        db.commit()
        d = sd.dashboard_tendencia(db, admin, area.id, None, date(2026, 10, 19), date(2026, 10, 21))
        self.assertEqual(d["series"][0]["valores"], [0, 2, 0])
        self.assertEqual(d["series"][0]["total"], 2)


    def test_qc_por_disenador(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        a = models.Empleado(nombres="Ana", apellidos="Admin", email="a@x.com", rol="admin", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        b = models.Empleado(nombres="Beto", apellidos="Dos", email="b@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="2")
        db.add_all([a, b]); db.commit()
        area = md.DesignArea(nombre="N6 Material Changes", formato="n6"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        filas = [(b.id, "", True, "Contacto", False, "", "Approved"), (b.id, "", True, "Margen", True, "Color", "Approved"),
                 (a.id, "", True, "Eje", False, "", "Approved"), (a.id, "", True, "", False, "", "Approved"),
                 (a.id, "", False, "No marcado", False, "", "Approved"), (b.id, "", True, "X", False, "", "Canceled"),
                 (None, "Pedro Prestado", True, "Y", False, "", "Approved")]
        for i, (did, pres, qc, rep, zqc, zrep, est) in enumerate(filas):
            db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 5 + i % 3), tabla="principal", orden=f"O{i}", centro="C",
                                  producto="P", designer_id=did, designer_prestado=pres, estado=est, qc=qc, qc_reporte=rep,
                                  z_qc=zqc, z_qc_reporte=zrep, orden_visual=i))
        db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 9, 30), tabla="principal", orden="Vieja", centro="C", producto="P",
                              designer_id=a.id, estado="Approved", qc=True, qc_reporte="Fuera del mes", orden_visual=99))
        db.commit()
        d = sd.dashboard_qc_disenadores(db, a, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual([(x["nombre"], x["reportes"]) for x in d["disenadores"]],
                         [("Beto Dos", 3), ("Ana Admin", 1), ("Pedro Prestado", 1)])
        self.assertEqual(d["total"], 5)


    def test_reparto_por_equipo(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        ps = [models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol="admin" if n == "Ana" else "empleado", activo=True,
                              empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n) for n in ("Ana", "Beto", "Caro", "Dani")]
        db.add_all(ps); db.commit()
        ana, beto, caro, dani = ps
        area = md.DesignArea(nombre="N3 Prosthetic", formato="n3"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        for e in (beto, caro):
            db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        casos = [(beto, "Ng")] * 4 + [(caro, "Ng")] * 4 + [(beto, "TC")] * 6 + [(caro, "TC")] * 1 + [(dani, "TC")] * 2 + [(beto, "ng ")] * 0
        casos += [(caro, "TC")]
        for i, (e, p) in enumerate(casos):
            db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 6), tabla="principal", orden=f"O{i}", centro="C", producto=p,
                                  designer_id=e.id, estado="Started", orden_visual=i))
        db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 6), tabla="principal", orden="C", centro="C", producto="Ng",
                              designer_id=beto.id, estado="Canceled", orden_visual=99))
        db.commit()
        d = sd.dashboard_reparto(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual(d["teamId"], t.id)
        self.assertEqual(d["productos"], ["TC", "Ng"])
        self.assertEqual([(f["nombre"], f["valores"], f["total"]) for f in d["filas"]], [("Beto X", [6, 4], 10), ("Caro X", [2, 4], 6)])
        self.assertEqual((d["prestados"]["valores"], d["totales"]), ([2, 0], [10, 8, 18]))
        self.assertEqual([e["nivel"] for e in d["equidad"]], ["algo", "pareja", "pareja"])
        eq = sd.dashboard_reparto  # casos chicos: 1 contra 0 es pareja; 3 contra 0 con 2 diseñadores son pocos casos
        db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 7), tabla="principal", orden="Z1", centro="C", producto="Zeta",
                              designer_id=beto.id, estado="Started", orden_visual=200)); db.commit()
        d = eq(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual(d["equidad"][d["productos"].index("Zeta")]["nivel"], "pareja")
        for i in range(2):
            db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 7), tabla="principal", orden=f"Z{i + 2}", centro="C", producto="Zeta",
                                  designer_id=beto.id, estado="Started", orden_visual=201 + i))
        db.commit()
        d = eq(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual(d["equidad"][d["productos"].index("Zeta")]["nivel"], "pocos")
        self.assertEqual(d["prestados"]["quienes"], [{"nombre": "Dani X (sin equipo)", "casos": 2}])
        t.manager_id = dani.id; db.commit()   # el aprobador no cuenta: ni fila, ni prestado, ni total
        d = sd.dashboard_reparto(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertIsNone(d["prestados"])
        self.assertNotIn("Dani X", [f["nombre"] for f in d["filas"]])
        self.assertEqual(d["casos"], sum(f["total"] for f in d["filas"]))


    def test_reparto_n6_divide_bite_y_zirconia(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        ana = models.Empleado(nombres="Ana", apellidos="X", email="a@x.com", rol="admin", activo=True,
                              empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        db.add(ana); db.commit()
        area = md.DesignArea(nombre=sd.AREA_N6, formato="n6"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=ana.id))
        for i, etapa in enumerate([sd.ETAPA_BITE, sd.ETAPA_ZIRCONIA, sd.ETAPA_ZIRCONIA]):
            db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 6), tabla=sd.TABLA_MATERIAL, orden=f"M{i}", centro="C",
                                  producto="N6 - Material Change Single 24Z", designer_id=ana.id, estado="Started", etapa=etapa, orden_visual=i))
        db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 6), tabla="principal", orden="P", centro="C", producto="Ng",
                              designer_id=ana.id, estado="Started", orden_visual=9))
        db.commit()
        d = sd.dashboard_reparto(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual(dict(zip(d["productos"], d["filas"][0]["valores"])),
                         {"N6 - Material Change Single 24Z · Bite design": 3, "N6 - Material Change Single 24Z · Zirconia design": 2, "Ng": 1})


    def test_reparto_descuenta_ausencias(self):
        """Caro estuvo 10 de 15 días hábiles de vacaciones (People) y 1 día con calamidad (Tiempos libres): con 4 días
        disponibles le corresponde mucho menos que a Beto, y su reparto es parejo aunque tenga menos casos."""
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        ps = [models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol="admin" if n == "Ana" else "empleado", activo=True,
                              empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n) for n in ("Ana", "Beto", "Caro", "Eva")]
        db.add_all(ps); db.commit()
        ana, beto, caro, eva = ps
        area = md.DesignArea(nombre="N3 Prosthetic", formato="n3"); db.add(area); db.commit()
        t = md.DesignTeam(area_id=area.id, nombre="Eq", orden=1, activo=1); db.add(t); db.commit()
        for e in (beto, caro, eva):
            db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        vac = models.TipoPermiso(nombre="Vacaciones", es_vacaciones=1); db.add(vac); db.commit()
        db.add(models.Solicitud(empleado_id=caro.id, tipo_id=vac.id, fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 14),
                                dias=10, estado="aprobada"))
        db.add(models.Solicitud(empleado_id=eva.id, tipo_id=vac.id, fecha_inicio=date(2026, 9, 20), fecha_fin=date(2026, 10, 30),
                                dias=30, estado="aprobada"))   # todo el periodo: no cuenta
        db.add(md.DesignBreak(team_id=t.id, empleado_id=caro.id, fecha=date(2026, 10, 15), tipo_ausencia="Calamidad doméstica"))
        db.add(md.DesignAusenciaTipo(nombre="Vacaciones", orden=1))
        i = 0
        for e, n in ((beto, 14), (caro, 4)):
            for _ in range(n):
                i += 1
                db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 16), tabla="principal", orden=f"O{i}", centro="C",
                                      producto="Ng", designer_id=e.id, estado="Started", orden_visual=i))
        db.commit()
        d = sd.dashboard_reparto(db, ana, date(2026, 10, 1), date(2026, 10, 21))
        self.assertEqual(d["habiles"], 15)
        f = {x["nombre"]: x for x in d["filas"]}
        self.assertEqual((f["Beto X"]["dias"], f["Caro X"]["dias"], f["Eva X"]["dias"]), (15, 4, 0))
        self.assertEqual(f["Caro X"]["ausencias"], [{"tipo": "Vacaciones", "dias": 10}, {"tipo": "Calamidad doméstica", "dias": 1}])
        self.assertEqual(f["Caro X"]["esperado"][0], round(18 * 4 / 19, 1))
        self.assertEqual(d["equidad"][0]["nivel"], "pareja")   # sin descontar ausencias habría sido 14 contra 4 (y 0): desigual


if __name__ == "__main__":
    unittest.main()
