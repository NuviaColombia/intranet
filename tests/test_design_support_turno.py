"""«🛟 Support Designer» (services_design_support.turno_activo, 20-oct-2026): qué turno de Support atiende a una hora."""
import unittest
from types import SimpleNamespace

from app import models  # noqa: F401  (registra los modelos)
from app import services_design_support as ss


def cfg(t1, t2):
    return SimpleNamespace(turno1_inicio=t1[0], turno1_fin=t1[1], turno2_inicio=t2[0], turno2_fin=t2[1])


class TurnoActivo(unittest.TestCase):
    def test_turno_que_corre(self):
        c = cfg(("07:00", "16:00"), ("16:00", "23:00"))
        self.assertEqual(ss.turno_activo(c, 9 * 60), 1)
        self.assertEqual(ss.turno_activo(c, 16 * 60), 2)
        self.assertEqual(ss.turno_activo(c, 22 * 60 + 59), 2)

    def test_fuera_de_turno_el_proximo(self):
        c = cfg(("07:00", "16:00"), ("16:00", "23:00"))
        self.assertEqual(ss.turno_activo(c, 5 * 60), 1)       # madrugada: el próximo en entrar es el 1
        self.assertEqual(ss.turno_activo(c, 23 * 60 + 30), 1)  # ya no queda ninguno hoy: el 1

    def test_turno_que_pasa_la_medianoche(self):
        c = cfg(("07:00", "15:00"), ("15:00", "01:00"))
        self.assertEqual(ss.turno_activo(c, 30), 2)
        self.assertEqual(ss.turno_activo(c, 20 * 60), 2)

    def test_turnos_cruzados_gana_el_que_acaba_de_entrar(self):
        c = cfg(("07:00", "17:00"), ("15:00", "23:00"))
        self.assertEqual(ss.turno_activo(c, 16 * 60), 2)


if __name__ == "__main__":
    unittest.main()
