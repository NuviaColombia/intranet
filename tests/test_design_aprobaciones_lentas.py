"""Dashboard › Aprobaciones (28-oct-2026): los aprobadores también la ven, pero solo con lo de sus equipos; los admins, todo."""
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_aprobacion as sap
from app.database import Base


class AprobacionesLentas(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol: models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.lia, self.leo, self.adm, self.ana = mk("Lia", "aprobador"), mk("Leo", "aprobador"), mk("Adm", "admin"), mk("Ana", "empleado")
        self.db.add_all([self.lia, self.leo, self.adm, self.ana]); self.db.commit()
        area = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(area); self.db.commit()
        self.t1 = md.DesignTeam(area_id=area.id, nombre="Eq Lia", manager_id=self.lia.id, orden=1, activo=1)
        self.t2 = md.DesignTeam(area_id=area.id, nombre="Eq Leo", manager_id=self.leo.id, orden=2, activo=1)
        self.db.add_all([self.t1, self.t2]); self.db.commit()
        hoy = sd.ahora_colombia().date()
        self.hoy = hoy
        for t, num in ((self.t1, "L1"), (self.t2, "E1")):   # aprobadas hace 3 horas y sin QC: cuentan como lentas
            self.db.add(md.DesignOrden(team_id=t.id, fecha=hoy, tabla="principal", orden=num, paciente="P", centro="Atlanta", producto="Full arch",
                                       designer_id=self.ana.id, estado="Approved", aprobada_en=datetime.utcnow() - timedelta(hours=3)))
        self.db.commit()

    def ordenes(self, **kw):
        r = sap.lentas(self.db, self.hoy, self.hoy, **kw)
        return sorted(x["orden"] for x in r["items"])

    def test_el_admin_ve_todos_los_equipos(self):
        self.assertEqual(self.ordenes(equipos=None), ["E1", "L1"])

    def test_un_aprobador_ve_solo_sus_equipos(self):
        self.assertEqual(self.ordenes(equipos=sd.equipos_dash_ids(self.db, self.lia)), ["L1"])
        self.assertEqual(self.ordenes(equipos=sd.equipos_dash_ids(self.db, self.leo)), ["E1"])

    def test_un_aprobador_no_puede_pedir_otro_equipo(self):
        # aunque pida el equipo de Leo por team_id, Lia no ve nada de él
        self.assertEqual(self.ordenes(team_id=self.t2.id, equipos=sd.equipos_dash_ids(self.db, self.lia)), [])

    def test_sin_equipos_no_ve_nada(self):
        self.assertEqual(self.ordenes(equipos=set()), [])


if __name__ == "__main__":
    unittest.main()
