"""Total de una orden (Fin − Inicio − Hold) cuando el caso pasó noches en Hold (orden 242472, 19-oct-2026).
Las horas se guardan sin fecha: «Fin − Inicio» pierde días enteros y el Total salía 0h 0m. services_design._menos_hold
suma los días que falten, sin pasar de los que la orden lleva desde que se creó. No necesita base de datos."""
import unittest
from datetime import date
from types import SimpleNamespace

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd


def orden(creada, fecha):
    return SimpleNamespace(fecha=fecha, fecha_creada=creada)


class TotalConHold(unittest.TestCase):
    def test_varias_noches_en_hold(self):
        # Inicio 15:00 · Hold 16:00 → 9:00 del otro día · Hold 9:30 → 9:00 del tercer día · Fin 10:00 = 1h + 0,5h + 1h
        tf = sd._entre("15:00", "10:00")                                   # 19h (perdió un día)
        hold = sd._entre("16:00", "09:00") + sd._entre("09:30", "09:00")   # 17h + 23,5h
        self.assertEqual(sd._menos_hold(orden(date(2026, 10, 15), date(2026, 10, 17)), tf, hold), 150)

    def test_orden_del_mismo_dia_no_cambia(self):
        self.assertEqual(sd._menos_hold(orden(date(2026, 10, 19), date(2026, 10, 19)), 30, 60), 0)
        self.assertEqual(sd._menos_hold(orden(None, date(2026, 10, 19)), 30, 60), 0)

    def test_caso_normal(self):
        self.assertEqual(sd._menos_hold(orden(date(2026, 10, 19), date(2026, 10, 19)), 180, 45), 135)
        self.assertEqual(sd._menos_hold(orden(date(2026, 10, 18), date(2026, 10, 19)), 1200, 1020), 180)   # 1 noche en Hold: ya salía bien

    def test_no_pasa_de_los_dias_que_lleva(self):
        self.assertEqual(sd._menos_hold(orden(date(2026, 10, 18), date(2026, 10, 19)), 60, 3000), 0)


if __name__ == "__main__":
    unittest.main()
