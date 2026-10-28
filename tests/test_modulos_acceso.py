"""Empleado.tiene_modulo(): reglas de acceso que no son solo "está en Empleado.modulos" -- un error
aquí no se nota en desarrollo (se prueba a mano con el propio usuario, que suele ser superadmin) y
solo aparece cuando alguien más intenta entrar. Caso real: Oscar marcó a una persona admin/superadmin
esperando que así entrara a Contabilidad y no fue así (28-oct-2026) -- motivó anular la regla de
Carlos para superadmin, dejándola solo para admin."""
import unittest

from app.models import Empleado, EMPRESA_DESIGN


def _empleado(rol="empleado", modulos="", empresa="Nuvia Smiles Colombia SAS"):
    return Empleado(nombres="Test", apellidos="Persona", email="test@nuviasmiles.com", rol=rol,
                     empresa=empresa, activo=1, cargo="x", area="x", identificacion="1", modulos=modulos)


class CajaMenorContabilidad(unittest.TestCase):
    def test_superadmin_entra_siempre(self):
        self.assertTrue(_empleado(rol="superadmin").tiene_modulo("caja_menor"))

    def test_admin_sin_permiso_explicito_no_entra(self):
        self.assertFalse(_empleado(rol="admin").tiene_modulo("caja_menor"))

    def test_admin_con_casilla_marcada_si_entra(self):
        self.assertTrue(_empleado(rol="admin", modulos="caja_menor").tiene_modulo("caja_menor"))

    def test_empleado_sin_permiso_no_entra(self):
        self.assertFalse(_empleado(rol="empleado").tiene_modulo("caja_menor"))

    def test_empleado_con_permiso_si_entra(self):
        self.assertTrue(_empleado(rol="empleado", modulos="caja_menor").tiene_modulo("caja_menor"))


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
