"""Desempeño › N6 Marlene (28-oct-2026): los títulos de mes de esa hoja pasan de 2025 a 2026, una sola vez, sin tocar las
calificaciones ni las demás hojas."""
import json
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado para las relaciones)
from app import models_design as md
from app import services_design as sd
from app import services_design_seleccion as ssel
from app.database import Base

MESES_2025 = ["Ene 2025", "Feb 2025", "Mar 2025", "Abr 2025", "May 2025", "Jun 2025", "Jul 2025", "Ago 2025", "Sep 2025", "Oct 2025", "Nov 2025", "Dic 2025"]


class MesesMarlene(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._perf_meses_2026["ok"] = False
        self.addCleanup(lambda: sd._perf_meses_2026.update(ok=False))

    def hoja(self, nombre, meses):
        h = md.DesignPerfSheet(nombre=nombre, tipo="eval", meses=json.dumps(meses), orden=1)
        self.db.add(h); self.db.commit()
        return h

    def meses(self, h):
        self.db.refresh(h)
        return json.loads(h.meses)

    def test_cambia_el_ano_solo_en_n6_marlene(self):
        marlene = self.hoja("N6 Marlene", MESES_2025)
        otra = self.hoja("N3 Luisa", MESES_2025)               # otra hoja con 2025: no se toca
        sd.perf_meses_2026_una_vez(self.db)
        self.assertEqual(self.meses(marlene), [m.replace("2025", "2026") for m in MESES_2025])
        self.assertEqual(self.meses(otra), MESES_2025)

    def test_las_calificaciones_se_quedan_en_su_mes(self):
        h = self.hoja("N6 Marlene", MESES_2025)
        crit = md.DesignPerfCriterio(nombre="Calidad", orden=1); self.db.add(crit); self.db.commit()
        fila = md.DesignPerfEmpleado(sheet_id=h.id, nombre="Ana", orden=1); self.db.add(fila); self.db.commit()
        self.db.add(md.DesignPerfCelda(empleado_id=fila.id, criterio_id=crit.id, mes_indice=9, nivel="ALTO")); self.db.commit()
        sd.perf_meses_2026_una_vez(self.db)
        celda = self.db.query(md.DesignPerfCelda).one()
        self.assertEqual((celda.mes_indice, celda.nivel), (9, "ALTO"))
        # y ahora la Selección asistida encuentra octubre de 2026 en esa hoja (antes buscaba «Oct 2026» y solo había «Oct 2025»)
        self.assertEqual(ssel._indice_mes(self.meses(h), 2026, 10), 9)

    def test_se_hace_una_sola_vez(self):
        h = self.hoja("N6 Marlene", MESES_2025)
        sd.perf_meses_2026_una_vez(self.db)
        marca = self.db.query(md.DesignConexionRegla).filter_by(clave=sd.PERF_MESES_2026["marca"]).one()
        self.assertIn("Oct 2025", json.loads(marca.valor)[0]["antes"])   # queda anotado cómo estaba
        # si alguien vuelve a poner 2025 a mano, no se vuelve a cambiar
        h.meses = json.dumps(["Ene 2025"]); self.db.commit()
        sd._perf_meses_2026["ok"] = False
        sd.perf_meses_2026_una_vez(self.db)
        self.assertEqual(self.meses(h), ["Ene 2025"])

    def test_si_la_hoja_no_existe_espera(self):
        sd.perf_meses_2026_una_vez(self.db)
        self.assertEqual(self.db.query(md.DesignConexionRegla).filter_by(clave=sd.PERF_MESES_2026["marca"]).count(), 0)
        marlene = self.hoja("N6 Marlene", MESES_2025)           # cuando aparece, se corrige
        sd._perf_meses_2026["ok"] = False
        sd.perf_meses_2026_una_vez(self.db)
        self.assertIn("Oct 2026", self.meses(marlene))

    def test_los_titulos_sin_2025_no_cambian(self):
        h = self.hoja("N6 Marlene", ["Ene 2026", "Feb 2026", "Totales"])
        sd.perf_meses_2026_una_vez(self.db)
        self.assertEqual(self.meses(h), ["Ene 2026", "Feb 2026", "Totales"])


if __name__ == "__main__":
    unittest.main()
