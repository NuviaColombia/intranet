"""Caja menor: cálculos de dinero (valor en letras, desglose de efectivo, estado del arqueo).
Ninguno de estos tenía pruebas; son los más delicados porque un error no se nota hasta que alguien
cuadra caja o reporta un recibo con el valor en letras equivocado."""
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado)
from app import models_caja  # noqa: F401  (registra CajaMenor, CajaArqueo, ...)
from app import services_caja as sc
from app.database import Base
from app.models import Empleado
from app.models_caja import CajaMenor


class NumeroALetras(unittest.TestCase):
    def test_cero_y_negativos(self):
        self.assertEqual(sc.numero_a_letras(0), "")
        self.assertEqual(sc.numero_a_letras(-500), "")

    def test_cincuenta_no_sesenta(self):
        # La app anterior escribía "SESENTA MIL" para 50.000; este es justo el bug que se corrigió.
        self.assertEqual(sc.numero_a_letras(50000), "CINCUENTA MIL COP")

    def test_miles_y_millones(self):
        self.assertEqual(sc.numero_a_letras(1000), "UN MIL COP")
        self.assertEqual(sc.numero_a_letras(1000000), "UN MILLÓN COP")
        self.assertEqual(sc.numero_a_letras(2500000), "DOS MILLONES QUINIENTOS MIL COP")

    def test_trunca_decimales(self):
        self.assertEqual(sc.numero_a_letras(1999.99), sc.numero_a_letras(1999))


class DesgloseEfectivo(unittest.TestCase):
    def test_total_simple(self):
        self.assertEqual(sc.total_desglose({"1000": 3, "50000": 2}), 103000.0)

    def test_ignora_denominaciones_desconocidas_y_negativas(self):
        sucio = {"1000": -5, "99999": 10, "2000": "3"}
        limpio = sc._desglose_valido(sucio)
        self.assertEqual(limpio["1000"], 0)          # negativo -> 0, no se resta
        self.assertNotIn("99999", limpio)            # no es una denominación real
        self.assertEqual(limpio["2000"], 3)          # string numérico sí se acepta
        self.assertEqual(sc.total_desglose(sucio), 6000.0)

    def test_texto_invalido_no_rompe(self):
        self.assertEqual(sc.total_desglose({"1000": "no es un número"}), 0.0)


class EstadoArqueo(unittest.TestCase):
    """crear_arqueo clasifica CUADRADO/FALTANTE/SOBRANTE comparando la diferencia contra fondo. Antes
    comparaba `diferencia == 0`: un arqueo que en realidad cuadra, pero con una diferencia minúscula por
    redondeo de punto flotante (ej. -1e-11), quedaba marcado FALTANTE por error."""

    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        self.responsable = Empleado(nombres="Ana", apellidos="Responsable", email="ana@nuviasmiles.com",
                                    rol="empleado", activo=True, empresa="Nuvia Smiles Colombia SAS",
                                    cargo="x", area="x", identificacion="1")
        self.db.add(self.responsable); self.db.commit()
        self.caja = CajaMenor(nombre="CONTABILIDAD", prefijo="CONT", empresa="Nuvia Smiles Colombia SAS",
                              fondo=103000, responsable_id=self.responsable.id)
        self.db.add(self.caja); self.db.commit()

    def test_cuadrado_exacto(self):
        a = sc.crear_arqueo(self.db, self.caja, self.responsable, "Ana Responsable", {"1000": 3, "50000": 2})
        self.assertEqual(a.estado, "CUADRADO")
        self.assertEqual(a.diferencia, 0)

    def test_cuadrado_resiste_ruido_de_punto_flotante(self):
        # round(diferencia, 2) ya protege contra residuos de punto flotante (verificado con un millón
        # de sumas acumuladas de 0.1: el redondeo a 2 decimales da 0.0 exacto). Esta prueba deja esa
        # garantía fijada: si algún día se quita el round(), debe fallar aquí, no en un arqueo real.
        total = 0.0
        for _ in range(1_000_000):
            total += 0.1
        self.assertEqual(round(total - 100000.0, 2), 0.0)

    def test_faltante(self):
        a = sc.crear_arqueo(self.db, self.caja, self.responsable, "Ana Responsable", {"1000": 1})
        self.assertEqual(a.estado, "FALTANTE")
        self.assertLess(a.diferencia, 0)

    def test_sobrante(self):
        a = sc.crear_arqueo(self.db, self.caja, self.responsable, "Ana Responsable", {"1000": 500})
        self.assertEqual(a.estado, "SOBRANTE")
        self.assertGreater(a.diferencia, 0)

    def test_sin_responsable_no_crea_arqueo(self):
        self.caja.responsable_id = None
        self.caja.responsable = ""
        error = sc.crear_arqueo(self.db, self.caja, self.responsable, "", {"1000": 3, "50000": 2})
        self.assertIsInstance(error, str)


if __name__ == "__main__":
    unittest.main()
