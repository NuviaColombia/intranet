"""Face → N2 (21-oct-2026): solo la hoja de hoy de Face pasa a N2, y una vez se quitan de N2 las copias del 21-oct que
llegaron desde hojas viejas de Face si N2 no las había empezado. Base SQLite en memoria."""
import unittest
from datetime import date, datetime
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra los modelos)
from app import models_design as md
from app import services_design as sd
from app.database import Base


class FaceN2(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = db = sessionmaker(bind=eng)()
        af, a2 = md.DesignArea(nombre="Face Design", formato="single"), md.DesignArea(nombre="N2 Demodenture", formato="n2")
        db.add_all([af, a2]); db.flush()
        self.tf, self.t2 = md.DesignTeam(area_id=af.id, nombre="Face A"), md.DesignTeam(area_id=a2.id, nombre="N2 A")
        db.add_all([self.tf, self.t2]); db.commit()
        p = mock.patch.object(sd, "ahora_colombia", return_value=datetime(2026, 10, 21, 10, 0, tzinfo=sd.ZONA_COLOMBIA))
        p.start(); self.addCleanup(p.stop)
        sd._face_n2_viejas["ok"] = False

    def orden(self, team, fecha, numero, **kw):
        o = md.DesignOrden(team_id=team.id, fecha=fecha, tabla="principal", orden=numero, centro="Dallas", producto="Face", **kw)
        self.db.add(o); self.db.commit()
        return o

    def test_hoja_vieja_no_pasa_a_n2(self):
        vieja = self.orden(self.tf, date(2026, 10, 6), "F1")
        self.assertIsNone(sd.copiar_face_a_n2(self.db, vieja, None))

    def test_quita_las_copias_de_hojas_viejas_sin_empezar(self):
        dia = date(2026, 10, 21)
        casos = [("V1", date(2026, 10, 6), {}), ("V2", date(2026, 10, 6), {"estado": "Initiated", "hora_inicio": "08:00"}),
                 ("H1", dia, {})]
        ids = {}
        for num, f_face, extra in casos:
            face = self.orden(self.tf, f_face, num)
            n2 = self.orden(self.t2, dia, num, **extra)
            self.db.add(md.DesignCopiaFace(n2_orden_id=n2.id, face_orden_id=face.id, estado="activa", face_equipo="Face A"))
            ids[num] = n2.id
        self.db.commit()
        self.assertEqual(sd.face_n2_viejas_una_vez(self.db), 1)
        self.assertIsNone(self.db.get(md.DesignOrden, ids["V1"]))       # vieja y sin empezar: se quita
        self.assertIsNotNone(self.db.get(md.DesignOrden, ids["V2"]))    # vieja pero N2 ya la empezó: se queda
        self.assertIsNotNone(self.db.get(md.DesignOrden, ids["H1"]))    # de la hoja de hoy: se queda
        sd._face_n2_viejas["ok"] = False
        self.assertEqual(sd.face_n2_viejas_una_vez(self.db), 0)          # una sola vez


if __name__ == "__main__":
    unittest.main()
