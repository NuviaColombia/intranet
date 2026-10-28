"""N6 (28-oct-2026, Rosember): desde el 29-oct-2026 cuatro tablas (Material Change, Over Ti-bar, Dummy y Cirugías). Over Ti-bar
funciona como Material Change y Dummy como Cirugías; los días anteriores no cambian."""
import unittest
from datetime import date

from app import services_design as sd


class N6CuatroTablas(unittest.TestCase):
    def test_tabla_base(self):
        self.assertTrue(sd.es_tabla_etapas("tibar") and sd.es_tabla_etapas("material"))
        self.assertFalse(sd.es_tabla_etapas("dummy") or sd.es_tabla_etapas("principal"))
        self.assertEqual(sd.tabla_base("dummy"), "principal")

    def test_desde_el_29_y_solo_en_n6(self):
        self.assertTrue(sd.n6_separado(sd.AREA_N6, date(2026, 10, 29)))
        self.assertFalse(sd.n6_separado(sd.AREA_N6, date(2026, 10, 28)))
        self.assertFalse(sd.n6_separado(sd.AREA_N3, date(2026, 10, 29)))

    def test_orden_que_llega_pasa_a_su_tabla(self):
        self.assertEqual(sd.n6_tabla_de_producto("principal", "N6 - Dummy Set"), "dummy")
        self.assertEqual(sd.n6_tabla_de_producto("material", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "tibar")
        self.assertEqual(sd.n6_tabla_de_producto("principal", "N6 - Full Mouth G-CAM Remake"), "principal")
        self.assertEqual(sd.n6_tabla_de_producto("nightguard", "N6 - Full Mouth Zirk - Over Ti-Bar (8mm or less)"), "nightguard")

    def test_productos_por_tabla(self):
        p = sd.PRODUCTOS_N6_TABLA
        self.assertEqual((len(p["material"]), len(p["tibar"]), len(p["dummy"]), len(p["principal"])), (6, 1, 3, 15))

    def test_disenador_de_cada_etapa(self):
        from types import SimpleNamespace as O
        o = O(tabla="tibar", designer_id=1, z_designer_id=None, x_designer_id=2, n_designer_id=1)
        self.assertEqual(sd.disenadores_de_orden(o), [1, 2, 1])   # un caso por cada etapa en la que está
        o = O(tabla="dummy", designer_id=1, z_designer_id=5, x_designer_id=None, n_designer_id=None)
        self.assertEqual(sd.disenadores_de_orden(o), [1])   # Dummy y Cirugías tienen un solo Diseñador

    def test_el_estado_de_cada_etapa_llena_sus_horas(self):
        actual = {c: "" for c in sd.COLUMNAS_HORAS_ETAPAS}
        r = sd.horas_por_estado_etapas(actual, {"n_estado": "Initiated"}, {"n_estado": ""})
        self.assertEqual(list(r), ["n_hora_inicio"])   # solo la etapa de ese estado; Bite y las demás no se tocan
        r = sd.horas_por_estado_etapas({**actual, "z_hora_inicio": "09:00"}, {"z_estado": "Dr authorization"}, {"z_estado": "Initiated"})
        self.assertEqual(list(r), ["z_s_hold"])   # «Dr authorization» cuenta como Hold
        self.assertEqual(sd.horas_por_estado_etapas(actual, {"estado": "Initiated"}, {"estado": "Initiated"}), {})   # sin cambio de estado

    def test_notas_de_cada_etapa(self):
        import json
        from types import SimpleNamespace as O
        o = O(notas_etapas=json.dumps({"b": [{"id": "1", "t": "uno", "f": "x", "u": 7}, {"id": "2", "t": "  ", "f": "x", "u": 7}], "n": [{"id": "3", "t": "tres", "f": "x", "u": 8}]}))
        self.assertEqual(sd.notas_etapas_n(o), {"b": 1, "n": 1})   # las vacías no cuentan; las etapas sin notas no salen
        self.assertEqual(sd.notas_etapas_n(O(notas_etapas="")), {})
        self.assertEqual(sd.notas_etapas_n(O(notas_etapas="no es json")), {})
        v = sd.notas_etapas_vista(o, O(id=7), False)
        self.assertEqual([x["puedeBorrar"] for x in v["b"]], [True]) and self.assertNotIn("u", v["b"][0])   # sin autor; borra la suya
        self.assertTrue(sd.notas_etapas_vista(o, O(id=99), True)["n"][0]["puedeBorrar"])   # el manager borra cualquiera

    def test_produccion_como_hoy(self):
        self.assertEqual(sd.tipo_produccion("tibar", ""), "mc")
        self.assertEqual(sd.tipo_produccion("dummy", ""), "sx")


if __name__ == "__main__":
    unittest.main()
