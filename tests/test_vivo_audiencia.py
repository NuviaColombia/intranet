"""Privacidad del Schedule en vivo: los avisos que llevan datos de órdenes solo llegan a quien puede ver ese equipo
(administrador y manager: todas las órdenes; diseñador: solo las suyas). No necesita base de datos.
Si falla, alguien está recibiendo órdenes que no debería ver: revisar services_design_vivo.publicar_ord."""
import json
import unittest

from app import models  # noqa: F401  (registra los modelos antes de importar el servicio)
from app import services_design_vivo as sv


def _sub(uid, ver_todo=False, gest=(), training=()):
    return sv._Sub(None, None, {"uid": uid, "ver_todo": ver_todo, "gest": set(gest), "training": set(training)})


class AudienciaDeOrdenes(unittest.TestCase):
    def setUp(self):
        self.recibido = {}
        self._enviar, self._destinos = sv._enviar, sv._destinos
        sv._enviar = lambda sub, datos: self.recibido.setdefault(sub.uid, []).append(json.loads(datos))
        self.subs = [_sub(1, ver_todo=True), _sub(2, gest={10}), _sub(3), _sub(4), _sub(5, gest={20})]
        sv._destinos = lambda: self.subs

    def tearDown(self):
        sv._enviar, sv._destinos = self._enviar, self._destinos

    def ordenes(self, uid):
        return [o["id"] for lote in self.recibido.get(uid, []) for m in lote if m["t"] == "ord" for o in m["o"]]

    def test_cada_quien_recibe_solo_lo_que_ve(self):
        ordenes = [{"id": 100, "notas": "de la persona 3"}, {"id": 101, "notas": "de la persona 4"}]
        sv.publicar_ord(10, "2026-10-19", ordenes, [], {100: {3}, 101: {4}}, training=False)
        self.assertEqual(self.ordenes(1), [100, 101], "el administrador ve todas")
        self.assertEqual(self.ordenes(2), [100, 101], "el manager del equipo ve todas")
        self.assertEqual(self.ordenes(3), [100], "un diseñador recibe solo la suya")
        self.assertEqual(self.ordenes(4), [101])
        self.assertNotIn(5, self.recibido, "el manager de OTRO equipo no recibe nada")

    def test_reasignada_llega_a_quien_la_tenia_y_a_quien_la_recibe(self):
        sv.publicar_ord(10, "2026-10-19", [{"id": 100, "designerId": 4}], [], {100: {3, 4}}, training=False)
        self.assertEqual(self.ordenes(3), [100], "quien la tenía recibe el cambio para quitarla de su pantalla")
        self.assertEqual(self.ordenes(4), [100])

    def test_orden_sin_diseñador_solo_la_ven_managers_y_admins(self):
        sv.publicar_ord(10, "2026-10-19", [{"id": 102}], [], {102: set()}, training=False)
        self.assertEqual(self.ordenes(1), [102])
        self.assertEqual(self.ordenes(2), [102])
        self.assertNotIn(3, self.recibido)
        self.assertNotIn(4, self.recibido)

    def test_borrada_llega_solo_a_quien_la_veia(self):
        sv.publicar_ord(10, "2026-10-19", [], [100], {100: {3}}, training=False)
        borradas = lambda uid: [i for lote in self.recibido.get(uid, []) for m in lote if m["t"] == "ord" for i in m["x"]]
        self.assertEqual(borradas(2), [100])
        self.assertEqual(borradas(3), [100])
        self.assertNotIn(4, self.recibido)

    def test_training_lo_ve_todo_el_mundo(self):
        sv.publicar_ord(30, "2026-10-19", [{"id": 200}], [], {200: {3}}, training=True)
        for uid in (1, 2, 3, 4, 5):
            self.assertEqual(self.ordenes(uid), [200])

    def test_el_aviso_de_siempre_va_marcado_para_las_pantallas_nuevas(self):
        sv.publicar_ord(10, "2026-10-19", [{"id": 100}], [], {100: {3}}, training=False)
        msgs = self.recibido[2][0]
        self.assertEqual([m["t"] for m in msgs], ["ord", "dia"])
        self.assertEqual(msgs[1].get("p"), 1)

    def test_tiempos_libres_avisan_solo_al_equipo_y_a_la_persona(self):
        sv.publicar_dia(10, "2026-10-19", {3})
        self.assertEqual(sorted(self.recibido), [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
