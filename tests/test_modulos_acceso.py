"""Empleado.tiene_modulo(): reglas de acceso que no son solo "está en Empleado.modulos" -- un error
aquí no se nota en desarrollo (se prueba a mano con el propio usuario, que suele ser superadmin) y
solo aparece cuando alguien más intenta entrar.

Historia de la regla de Caja menor/Contabilidad (sirve de ejemplo de por qué esto se prueba aparte):
20-oct-2026, Carlos pidió que ni admin ni superadmin entraran automático -- 28-oct-2026, Oscar marcó
a una persona admin/superadmin esperando que así entrara a Contabilidad y no fue así, pidió que el
superadmin quedara exento -- mismo día, Carlos revirtió esa excepción: no todo superadmin necesita
Caja menor ni Producción (hay superadmin de People sin ninguna razón para entrar a ninguna de las
dos). La versión final: ni admin ni superadmin entran automático a Caja menor en sí ni a Producción,
pero sí pueden abrir /contabilidad y /pagos sin autorizarse (ver require_modulo_o_admin en
app/auth.py) porque esas pantallas no hacen nada sensible por sí solas."""
import unittest

from fastapi import HTTPException

from app.models import Empleado, EMPRESA_DESIGN
from app.auth import require_modulo_o_admin


def _empleado(rol="empleado", modulos="", empresa="Nuvia Smiles Colombia SAS"):
    return Empleado(nombres="Test", apellidos="Persona", email="test@nuviasmiles.com", rol=rol,
                     empresa=empresa, activo=1, cargo="x", area="x", identificacion="1", modulos=modulos)


class CajaMenorContabilidad(unittest.TestCase):
    def test_admin_sin_permiso_explicito_no_entra(self):
        self.assertFalse(_empleado(rol="admin").tiene_modulo("caja_menor"))

    def test_superadmin_sin_permiso_explicito_no_entra(self):
        self.assertFalse(_empleado(rol="superadmin").tiene_modulo("caja_menor"))

    def test_admin_con_casilla_marcada_si_entra(self):
        self.assertTrue(_empleado(rol="admin", modulos="caja_menor").tiene_modulo("caja_menor"))

    def test_empleado_sin_permiso_no_entra(self):
        self.assertFalse(_empleado(rol="empleado").tiene_modulo("caja_menor"))

    def test_empleado_con_permiso_si_entra(self):
        self.assertTrue(_empleado(rol="empleado", modulos="caja_menor").tiene_modulo("caja_menor"))


class Produccion(unittest.TestCase):
    """(28-oct-2026) Mismo patrón que Caja menor, llevado a Producción (pedido de Carlos): ni admin
    ni superadmin entran automático."""
    def test_admin_sin_permiso_explicito_no_entra(self):
        self.assertFalse(_empleado(rol="admin").tiene_modulo("custodia"))

    def test_superadmin_sin_permiso_explicito_no_entra(self):
        self.assertFalse(_empleado(rol="superadmin").tiene_modulo("custodia"))

    def test_admin_con_casilla_marcada_si_entra(self):
        self.assertTrue(_empleado(rol="admin", modulos="custodia").tiene_modulo("custodia"))

    def test_empleado_sin_permiso_no_entra(self):
        self.assertFalse(_empleado(rol="empleado").tiene_modulo("custodia"))

    def test_empleado_con_permiso_si_entra(self):
        self.assertTrue(_empleado(rol="empleado", modulos="custodia").tiene_modulo("custodia"))


class ContabilidadYPagosAbiertos(unittest.TestCase):
    """(28-oct-2026) /contabilidad y /pagos no exigen la autorización explícita de Caja menor: Oscar
    necesita abrir Pagos sin depender de eso. require_modulo_o_admin() es la excepción, distinta de
    require_modulo()."""
    def test_admin_entra_sin_autorizacion_explicita(self):
        checker = require_modulo_o_admin("caja_menor")
        self.assertEqual(checker(_empleado(rol="admin")).rol, "admin")

    def test_superadmin_entra_sin_autorizacion_explicita(self):
        checker = require_modulo_o_admin("caja_menor")
        self.assertEqual(checker(_empleado(rol="superadmin")).rol, "superadmin")

    def test_empleado_sin_permiso_no_entra(self):
        checker = require_modulo_o_admin("caja_menor")
        with self.assertRaises(HTTPException):
            checker(_empleado(rol="empleado"))

    def test_empleado_con_permiso_si_entra(self):
        checker = require_modulo_o_admin("caja_menor")
        self.assertEqual(checker(_empleado(rol="empleado", modulos="caja_menor")).rol, "empleado")


class DesignSchedule(unittest.TestCase):
    """No se toca con este cambio -- se deja como control para que un futuro ajuste de tiene_modulo
    no rompa esta otra excepción por accidente."""
    def test_superadmin_entra_sin_importar_empresa(self):
        self.assertTrue(_empleado(rol="superadmin", empresa="Nuvia Smiles Colombia SAS").tiene_modulo("design_schedule"))

    def test_otra_empresa_sin_permiso_no_entra(self):
        self.assertFalse(_empleado(rol="admin", empresa="Nuvia Smiles Colombia SAS").tiene_modulo("design_schedule"))

    def test_empresa_design_con_permiso_si_entra(self):
        self.assertTrue(_empleado(rol="empleado", empresa=EMPRESA_DESIGN, modulos="design_schedule").tiene_modulo("design_schedule"))

    def test_empresa_design_sin_permiso_no_entra(self):
        self.assertFalse(_empleado(rol="empleado", empresa=EMPRESA_DESIGN).tiene_modulo("design_schedule"))


if __name__ == "__main__":
    unittest.main()
