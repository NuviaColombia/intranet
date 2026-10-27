"""Carga del Schedule (26-oct-2026): la página pide varias cosas en paralelo al abrir; lo que se crea «una vez» no debe fallar si
dos peticiones lo intentan a la vez, y las peticiones adelantadas del inicio coinciden con las que hace schedule.js."""
import re
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado para las relaciones de models_design)
from app import models_design as md
from app import services_design_support as ssup
from app.database import Base

RAIZ = Path(__file__).resolve().parent.parent / "app"


class ConfigSupportEnParalelo(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.eng = eng
        self.db = sessionmaker(bind=eng)()

    def test_si_otra_peticion_la_crea_primero_se_usa_esa(self):
        otra = sessionmaker(bind=self.eng)()
        otra.add(md.DesignSupportConfig(id=1)); otra.commit()
        real_get, llamadas = self.db.get, []

        def get(modelo, ident, *a, **k):   # la primera lectura todavía no la ve (la otra petición la crea justo después)
            llamadas.append(1)
            return None if len(llamadas) == 1 else real_get(modelo, ident, *a, **k)
        self.db.get = get
        c = ssup.config(self.db)
        self.assertEqual(c.id, 1)
        self.assertEqual(self.db.query(md.DesignSupportConfig).count(), 1)

    def test_si_no_existe_se_crea(self):
        self.assertEqual(ssup.config(self.db).id, 1)
        self.assertEqual(self.db.query(md.DesignSupportConfig).count(), 1)


class PeticionesAdelantadas(unittest.TestCase):
    """El script del inicio de design_schedule.html adelanta teams, dia y catalogos con las MISMAS direcciones que arma
    schedule.js; si una cambia y la otra no, la petición adelantada se desperdicia (y se pide dos veces)."""

    def test_direcciones_iguales(self):
        html = (RAIZ / "templates" / "design_schedule.html").read_text(encoding="utf-8")
        js = (RAIZ / "static" / "design" / "schedule.js").read_text(encoding="utf-8")
        for adelantada, en_js in (("'/design/api/teams?area_id=' + aid", "'/design/api/teams?area_id=' + area.id"),
                                  ("'/design/api/dia?team_id=' + tid + '&fecha=' + iso", "'/design/api/dia?team_id=' + DS.teamId + '&fecha=' + fechaPedida"),
                                  ("'/design/api/catalogos?area_id=' + aid", "'/design/api/catalogos?area_id=' + areaId")):
            self.assertIn(adelantada, html, adelantada)
            self.assertIn(en_js, js, en_js)

    def test_lo_secundario_espera_al_dia(self):
        for n in ("asignaciones.js", "ayuda.js"):
            texto = (RAIZ / "static" / "design" / n).read_text(encoding="utf-8")
            self.assertIn("window.dsDespues", texto, n)
        js = (RAIZ / "static" / "design" / "schedule.js").read_text(encoding="utf-8")
        self.assertGreaterEqual(len(re.findall(r"window\.dsSoltar\(\)", js)), 2)   # al llegar el día y también si falla


if __name__ == "__main__":
    unittest.main()
