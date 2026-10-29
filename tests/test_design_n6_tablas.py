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
        r = sd.horas_por_estado_etapas({**actual, "hora_inicio": "09:00", "hora_fin": "10:00"}, {"estado": "Dr authorization"}, {"estado": "Approved"})
        self.assertEqual(r, {})   # Dr authorization (lo pone el QC de Bite) no marca horas
        self.assertEqual(sd.horas_por_estado_etapas(actual, {"estado": "Initiated"}, {"estado": "Initiated"}), {})   # sin cambio de estado

    def test_hold_y_reinitiated(self):
        a = {c: "" for c in sd.COLUMNAS_HORAS_ETAPAS}
        a.update({"z_hora_inicio": "09:00", "z_s_hold": "09:30"})
        self.assertEqual(list(sd.horas_por_estado_etapas(a, {"z_estado": "Reinitiated"}, {"z_estado": "Hold"})), ["z_f_hold"])
        a.update({"z_f_hold": "10:00", "z_hold_minutos": 0})
        r = sd.horas_por_estado_etapas(a, {"z_estado": "Hold"}, {"z_estado": "Reinitiated"})
        self.assertEqual((r["z_hold_minutos"], r["z_f_hold"]), (30, ""))   # el Hold anterior pasa a T. Hold y empieza otro

    def test_changes_reabre_la_etapa(self):
        a = {c: "" for c in sd.COLUMNAS_HORAS_ETAPAS}
        a.update({"z_hora_inicio": "09:00", "z_hora_fin": "11:00", "z_s_hold": "09:30", "z_f_hold": "10:00", "z_hold_minutos": 0,
                  "z_min_previos": 15, "z_qc": True})
        r = sd.horas_por_estado_etapas(a, {"z_estado": "Changes"}, {"z_estado": "Approved"})
        self.assertEqual(r["z_min_previos"], 15 + 90)   # 2 h − 30 min de Hold, más el ciclo anterior
        self.assertEqual((r["z_hora_inicio"], r["z_hora_fin"], r["z_qc"]), ("", "", False))

    def test_flujo_y_espera(self):
        from types import SimpleNamespace as O
        ok = sd.transicion_n6_permitida
        self.assertTrue(ok("", "Ready to design", False) and ok("Ready to design", "Initiated", False) and ok("Hold", "Reinitiated", False))
        self.assertFalse(ok("Initiated", "Reinitiated", False) or ok("Hold", "Approved", False) or ok("Approved", "Changes", False))
        self.assertTrue(ok("Approved", "Changes", True) and ok("Hold", "Canceled", False) and ok("Initiated", "Skipped", False))
        base = dict(tabla="tibar", estado="", qc=False, z_estado="", z_qc=False, x_estado="", x_qc=False, n_estado="", n_qc=False)
        self.assertTrue(sd.en_espera_n6(O(**{**base, "estado": "Dr authorization", "qc": True})))
        self.assertFalse(sd.en_espera_n6(O(**{**base, "estado": "Approved"})))   # sin QC todavía no
        self.assertFalse(sd.en_espera_n6(O(**{**base, "estado": "Dr authorization", "qc": True, "z_estado": "Ready to design"})))
        self.assertFalse(sd.en_espera_n6(O(**{**base, "n_estado": "Approved", "n_qc": True})))   # Nightguard design: terminó

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
