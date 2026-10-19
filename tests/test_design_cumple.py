"""Cumpleaños (services_design_cumple): quién sale en el anuncio del día y cuántas veces lo ve cada persona.
Base SQLite en memoria; no toca la base real."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra los modelos)
from app import models_design  # noqa: F401
from app import services_design_cumple as scu
from app.database import Base
from app.models import EMPRESA_DESIGN, Empleado
from app.models_design import DesignFotoPerfil


class Cumple(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        scu._CACHE.clear(); scu._VISTOS.clear()
        self.n = 0

    def emp(self, nombres, apellidos, nac, foto=True, empresa=EMPRESA_DESIGN, activo=True):
        self.n += 1
        e = Empleado(nombres=nombres, apellidos=apellidos, email=f"p{self.n}@x.com", rol="empleado", activo=activo,
                     empresa=empresa, cargo="Diseñador", area="x", identificacion=str(self.n), fecha_nacimiento=nac)
        self.db.add(e); self.db.commit()
        if foto:
            self.db.add(DesignFotoPerfil(empleado_id=e.id, tipo="image/jpeg", datos=b"x")); self.db.commit()
        return e

    def test_nombre_corto(self):
        self.assertEqual(scu.nombre_corto("Cristian Andrés", "Guzman Pérez"), "Cristian Guzman")
        self.assertEqual(scu.nombre_corto("Ana", ""), "Ana")

    def test_sin_foto_otra_empresa_o_inactivo_no_se_anuncia(self):
        hoy = date(2026, 10, 19)
        a = self.emp("Ana", "Uno", date(1990, 10, 19))
        self.emp("Sin", "Foto", date(1991, 10, 19), foto=False)
        self.emp("Otra", "Empresa", date(1992, 10, 19), empresa="Nuvia Smiles Colombia SAS")
        self.emp("Ya", "Salio", date(1993, 10, 19), activo=False)
        self.emp("Otro", "Dia", date(1994, 10, 20))
        self.assertEqual([p["id"] for p in scu.de_hoy(self.db, hoy)], [a.id])
        mes = scu.personas_entre(self.db, date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(sorted(p["nombre"] for p in mes), ["Ana Uno", "Otro Dia", "Sin Foto"])
        self.assertFalse(next(p for p in mes if p["nombre"] == "Sin Foto")["tieneFoto"])

    def test_29_de_febrero(self):
        self.emp("Bis", "Siesto", date(1996, 2, 29))
        self.assertEqual(scu.personas_entre(self.db, date(2027, 2, 1), date(2027, 2, 28))[0]["fecha"], "2027-02-28")
        self.assertEqual(scu.personas_entre(self.db, date(2028, 2, 1), date(2028, 2, 29))[0]["fecha"], "2028-02-29")

    def test_una_vez_por_dia(self):
        hoy = scu.sd.ahora_colombia().date()
        self.emp("Ana", "Hoy", hoy.replace(year=1990))
        yo = self.emp("Yo", "Mismo", date(1990, 1, 1), foto=False)
        self.assertEqual(len(scu.pendiente(self.db, yo)), 1)
        scu.marcar_visto(self.db, yo)
        scu.marcar_visto(self.db, yo)   # dos pestañas: no falla
        self.assertEqual(scu.pendiente(self.db, yo), [])
        scu._VISTOS.clear()             # aunque se reinicie el servidor, queda en la base
        self.assertEqual(scu.pendiente(self.db, yo), [])

    def test_proximo_con_foto_salta_los_que_no_tienen(self):
        self.emp("Sin", "Foto", date(1990, 10, 20), foto=False)
        b = self.emp("Con", "Foto", date(1990, 10, 25))
        self.assertEqual([p["id"] for p in scu.proximo_con_foto(self.db, date(2026, 10, 19))], [b.id])


if __name__ == "__main__":
    unittest.main()
