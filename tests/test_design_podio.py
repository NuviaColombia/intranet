"""Inicio › podio de diseñadores (22-oct-2026): en N3 solo cuentan las Cirugías; Nightguards y TC no suman."""
import unittest
from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design_inicio as si
from app.database import Base


class Podio(unittest.TestCase):
    def test_n3_solo_cirugias(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        db = sessionmaker(bind=eng)()
        ps = [models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol="empleado", activo=True,
                              empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n) for n in ("Ana", "Beto", "Caro", "Dani")]
        db.add_all(ps); db.commit()
        ana, beto, caro, dani = ps
        n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); n2 = md.DesignArea(nombre="N2 Demodenture", formato="n2")
        db.add_all([n3, n2]); db.commit()
        t3 = md.DesignTeam(area_id=n3.id, nombre="Eq3", orden=1, activo=1); t2 = md.DesignTeam(area_id=n2.id, nombre="Eq2", orden=1, activo=1)
        db.add_all([t3, t2]); db.commit()
        for t, e in ((t3, ana), (t3, beto), (t2, caro), (t2, dani)):
            db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        i = 0
        for t, e, tabla, n in ((t3, ana, "principal", 5), (t3, ana, "nightguard", 1),     # Ana: 5 cirugías
                               (t3, beto, "principal", 3), (t3, beto, "nightguard", 9),   # Beto: 3 cirugías y muchos Ng/TC
                               (t2, caro, "principal", 4), (t2, dani, "nightguard", 6)):  # N2 sin cambios
            for _ in range(n):
                i += 1
                db.add(md.DesignOrden(team_id=t.id, fecha=date(2026, 10, 6), tabla=tabla, orden=f"O{i}", centro="C", producto="P",
                                      designer_id=e.id, estado="Approved", orden_visual=i))
        db.commit()
        r = si.ranking_disenadores_mes(db, datetime(2026, 10, 22, 10, 0), forzar=True)
        podio = {a["area"]: [(x["nombre"], x["casos"]) for x in a["podio"]] for a in r["areas"]}
        self.assertEqual(podio["N3 Prosthetic"], [("Ana X", 5), ("Beto X", 3)])
        self.assertEqual(podio["N2 Demodenture"], [("Dani X", 6), ("Caro X", 4)])


if __name__ == "__main__":
    unittest.main()
