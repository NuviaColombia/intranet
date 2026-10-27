"""GeoVictoria (22-oct-2026): lectura del libro de asistencia, faltas de marca y avisos push (una sola vez)."""
import unittest
from datetime import date, datetime
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design_geovictoria as g
from app import services_design_push as sp
from app.database import Base

DIA = date(2026, 10, 22)


def usuario(ident, marcas, turno=("070000", "160000"), permiso=None, almuerzo_fijo=False):
    p = DIA.strftime("%Y%m%d")
    tipos = {"e": ("Ingreso", "Entrada"), "sa": ("Salida", "SalidaColacion"), "ra": ("Ingreso", "EntradaColacion"), "s": ("Salida", "Salida")}
    shift = {"Type": "FixedShift", "Begins": p + turno[0], "Ends": p + turno[1], "Status": "enabled",
             "BreakType": "FixedLunch" if almuerzo_fijo else "FreeLunch", "BreakMinutes": "" if almuerzo_fijo else "60",
             "BreakStart": "13:00" if almuerzo_fijo else "00:00", "BreakEnd": "14:00" if almuerzo_fijo else "00:00"}
    return {"Identifier": ident, "PlannedInterval": [{
        "Date": p + "000000", "Shifts": [shift],
        "TimeOffs": [{"TimeOffTypeDescription": permiso}] if permiso else [],
        "Punches": [{"Type": tipos[k][0], "ShiftPunchType": tipos[k][1], "Date": p + h} for k, h in marcas]}]}


class Lectura(unittest.TestCase):
    def test_marcas_y_atraso(self):
        i = g.leer_dia(usuario("1", [("e", "071200"), ("sa", "120000"), ("ra", "125500")]), DIA)
        self.assertEqual(i["atrasoMin"], 12)
        self.assertEqual(g._hm(i["marcas"]["regresoAlm"]), "12:55")
        self.assertEqual(i["turno"]["almuerzoMin"], 60)

    def test_faltas(self):
        f = lambda u, h, m: [x["tipo"] for x in g.faltas(g.leer_dia(u, DIA), datetime(2026, 10, 22, h, m), 10)]
        self.assertEqual(f(usuario("1", []), 7, 9), [])                   # aún dentro de la tolerancia
        self.assertEqual(f(usuario("1", []), 7, 10), ["entrada"])
        self.assertEqual(f(usuario("1", [], permiso="Incapacidad"), 9, 0), [])   # con permiso no se avisa
        self.assertEqual(f(usuario("1", [("e", "070000"), ("sa", "120000")]), 13, 9), [])          # 60 + 10 min aún no
        self.assertEqual(f(usuario("1", [("e", "070000"), ("sa", "120000")]), 13, 10), ["almuerzo"])
        self.assertEqual(f(usuario("1", [("e", "070000"), ("sa", "130500")], almuerzo_fijo=True), 14, 10), ["almuerzo"])
        self.assertEqual(f(usuario("1", [("e", "070000"), ("sa", "120000"), ("ra", "125900")]), 16, 10), ["salida"])
        self.assertEqual(f(usuario("1", [("e", "070000"), ("s", "160200")]), 16, 30), [])
        self.assertEqual(f(usuario("1", []), 16, 30), [])                  # el turno ya terminó y nunca llegó: no es «salida»


def sin_tipo(u, *horas):
    """Las marcas de esas horas llegan SIN tipo de turno (como pasa con el almuerzo fuera de la hora fija de GeoVictoria)."""
    for p in u["PlannedInterval"][0]["Punches"]:
        if p["Date"][8:14] in horas:
            p["ShiftPunchType"] = "SinAsignar"
    return u


class AlmuerzoFueraDeLaHoraPuesta(unittest.TestCase):
    """26-oct-2026: con almuerzo fijo en GeoVictoria, quien almuerza a otra hora llega con marcas sin tipo; ahora la pareja
    salida + regreso a mitad del día se reconoce como almuerzo."""

    def marcas(self, u):
        m = g.leer_dia(u, DIA)["marcas"]
        return {k: g._hm(v) for k, v in m.items()}

    def test_pareja_sin_tipo_es_el_almuerzo(self):
        u = sin_tipo(usuario("1", [("e", "070000"), ("sa", "114000"), ("ra", "123500"), ("s", "160000")], almuerzo_fijo=True), "114000", "123500")
        self.assertEqual(self.marcas(u), {"entrada": "07:00", "salidaAlm": "11:40", "regresoAlm": "12:35", "salida": "16:00"})

    def test_todo_sin_tipo_tambien(self):
        u = sin_tipo(usuario("1", [("e", "070000"), ("sa", "114000"), ("ra", "123500"), ("s", "160000")], almuerzo_fijo=True),
                     "070000", "114000", "123500", "160000")
        self.assertEqual(self.marcas(u), {"entrada": "07:00", "salidaAlm": "11:40", "regresoAlm": "12:35", "salida": "16:00"})

    def test_antes_la_salida_del_almuerzo_se_tomaba_como_salida_del_dia(self):
        # sin la pareja completa (aún no regresa) todo queda como antes: la salida suelta cuenta como salida
        u = sin_tipo(usuario("1", [("e", "070000"), ("sa", "114000")], almuerzo_fijo=True), "114000")
        self.assertEqual(self.marcas(u), {"entrada": "07:00", "salidaAlm": "", "regresoAlm": "", "salida": "11:40"})

    def test_dos_marcas_sin_tipo_son_entrada_y_salida(self):
        u = sin_tipo(usuario("1", [("e", "070000"), ("s", "160000")]), "070000", "160000")
        self.assertEqual(self.marcas(u), {"entrada": "07:00", "salidaAlm": "", "regresoAlm": "", "salida": "16:00"})

    def test_una_pausa_muy_larga_o_muy_corta_no_es_almuerzo(self):
        larga = sin_tipo(usuario("1", [("e", "070000"), ("sa", "110000"), ("ra", "140000"), ("s", "160000")]), "110000", "140000")   # 3 h
        self.assertEqual(self.marcas(larga)["salidaAlm"], "")
        corta = sin_tipo(usuario("1", [("e", "070000"), ("sa", "110000"), ("ra", "110500"), ("s", "160000")]), "110000", "110500")   # 5 min
        self.assertEqual(self.marcas(corta)["salidaAlm"], "")

    def test_si_ya_hay_marcas_de_almuerzo_con_tipo_no_se_toca(self):
        u = usuario("1", [("e", "070000"), ("sa", "120000"), ("ra", "130000"), ("s", "160000")])
        self.assertEqual(self.marcas(u), {"entrada": "07:00", "salidaAlm": "12:00", "regresoAlm": "13:00", "salida": "16:00"})

    def test_el_almuerzo_inferido_llega_al_schedule_y_a_las_marcas_crudas(self):
        u = sin_tipo(usuario("1", [("e", "070000"), ("sa", "114000"), ("ra", "123500"), ("s", "160000")], almuerzo_fijo=True), "114000", "123500")
        info = g.leer_dia(u, DIA)
        self.assertEqual(g._almuerzo_esperado(info["marcas"]), ("11:40", "12:35"))
        self.assertIn("11:40 Salida · SinAsignar", info["crudas"])
        self.assertEqual(g.faltas(info, datetime(2026, 10, 22, 14, 0), 10), [])    # ya regresó: no hay aviso de almuerzo


class Avisos(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, ced: models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol="empleado", activo=True,
                                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=ced)
        self.ana, self.luis = mk("Ana", "1.234.567"), mk("Luis", "999")
        self.db.add_all([self.ana, self.luis]); self.db.commit()
        a = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(a); self.db.commit()
        t = md.DesignTeam(area_id=a.id, nombre="Eq", manager_id=self.luis.id, orden=1, activo=1); self.db.add(t); self.db.commit()
        self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=self.ana.id)); self.db.commit()
        g._hoy.update(fecha=None, t=0.0, datos={}); g._enviados.update(fecha=None, claves=set()); g._usuarios.update(t=0.0, lista=[])
        self.envios = []
        def _env(db, ids, *a, **k):
            self.envios.append((sorted(ids), a[0], k.get("fijo")))
            return {"enviados": len(ids), "fallidos": 0, "borrados": 0, "sinSuscripcion": 0}
        for p in (mock.patch.object(sp, "enviar", side_effect=_env),
                  mock.patch.object(g, "_post", side_effect=self._api)):
            p.start(); self.addCleanup(p.stop)
        self.marcas = []

    def _api(self, c, ruta, cuerpo):
        if ruta == "/User/List":
            return [{"Identifier": "1234567", "Enabled": "1", "Name": "Ana", "LastName": "X"}, {"Identifier": "555", "Enabled": "1", "Name": "Otro"}]
        return {"Users": [usuario("1234567", self.marcas)]}

    def configurar(self, avisos=True):
        g.guardar(self.db, {"key": "k", "secret": "s", "avisos": avisos, "tolerancia": 10}, self.luis)

    def test_cruce_por_cedula(self):
        self.configurar()
        c = g.cruce(self.db)
        self.assertEqual(c["pares"], {self.ana.id: "1234567"})     # «1.234.567» = «1234567»
        self.assertEqual([x["nombre"] for x in c["sinGeoVictoria"]], ["Luis X"])
        self.assertEqual(len(c["sinPlataforma"]), 1)

    def test_aviso_a_la_persona_y_su_manager_una_sola_vez(self):
        self.configurar()
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 15)), [f"{self.ana.id}|entrada"])
        self.assertEqual([(e[0], e[2]) for e in self.envios], [([self.ana.id], True), ([self.luis.id], True)])
        self.assertIn("entrada", self.envios[0][1].lower())
        g._hoy["t"] = 0
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 20)), [])   # ya se avisó
        g._enviados.update(fecha=None, claves=set())                              # como si el servidor se reiniciara
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 25)), [])   # quedó guardado en la base
        self.assertEqual(len(self.envios), 2)

    def test_no_avisa_si_marco_despues_de_la_ultima_consulta(self):
        """27-oct-2026: las marcas en memoria pueden tener hasta 5 min; antes de avisar se vuelven a pedir."""
        self.configurar()
        self.marcas = []
        g.hoy(self.db, datetime(2026, 10, 22, 7, 5))          # consulta de las 7:05: todavía sin entrada
        self.marcas = [("e", "065800")]                       # en GeoVictoria ya aparece la entrada de las 6:58
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 12)), [])
        self.assertEqual(self.envios, [])
        self.assertEqual(g._hm(g._hoy["datos"][self.ana.id]["marcas"]["entrada"]), "06:58")   # Seguimiento ve la marca

    def test_si_la_ultima_consulta_fallo_no_avisa_con_datos_viejos(self):
        self.configurar()
        self.marcas = []
        g.hoy(self.db, datetime(2026, 10, 22, 7, 5))
        g._hoy["error"] = "ReadTimeout"                       # la consulta siguiente falló: lo de memoria es viejo
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 15)), [])
        self.assertEqual(self.envios, [])
        g._hoy["error"] = ""; g._hoy["t"] = 0                 # vuelve a consultar bien y la entrada sigue faltando: avisa
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 16)), [f"{self.ana.id}|entrada"])

    def test_sin_avisos_activos_no_envia_pero_trae_marcas(self):
        self.configurar(avisos=False)
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 15)), [])
        self.assertEqual(self.envios, [])
        self.assertEqual(g.para_seguimiento(self.ana.id, datetime(2026, 10, 22, 7, 15), 10)["faltas"][0]["tipo"], "entrada")

    def test_el_secreto_no_sale(self):
        self.configurar()
        p = g.publico(self.db)
        self.assertNotIn("secret", p)
        self.assertTrue(p["tieneSecreto"])
        g.guardar(self.db, {"key": "k", "secret": "", "avisos": True, "tolerancia": 15}, self.luis)   # vacío conserva
        self.assertEqual(g.config(self.db)["secret"], "s")


    def test_horario_sin_asignar_recuerda_al_manager(self):
        from app import services_design as sd
        p = mock.patch.object(sd, "festivos", return_value=set()); p.start(); self.addCleanup(p.stop)
        self.configurar()
        self.sin_turno = True
        def api(c, ruta, cuerpo):
            if ruta == "/User/List":
                return [{"Identifier": "1234567", "Enabled": "1", "Name": "Ana", "LastName": "X"}]
            dia = cuerpo["StartDate"][:8]
            shifts = [] if self.sin_turno else [{"Type": "NotWorking", "Begins": dia + "000000", "Ends": dia + "235900"}]
            return {"Users": [{"Identifier": "1234567", "PlannedInterval": [{"Date": dia + "000000", "Shifts": shifts, "TimeOffs": [], "Punches": []}]}]}
        g._post.side_effect = api
        # jueves 22 a las 7:15: hoy no tiene horario → un push a su manager
        nuevos = g.revisar(self.db, datetime(2026, 10, 22, 7, 15))
        self.assertEqual(nuevos, [f"horario-hoy|2026-10-22|{self.luis.id}"])
        self.assertEqual(self.envios[-1][0], [self.luis.id])
        self.assertIn("horario", self.envios[-1][1].lower())
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 8, 0)), [])   # una sola vez al día
        # a las 3 p. m. se revisa el día siguiente hábil (viernes 23)
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 15, 5)), [f"horario-manana|2026-10-23|{self.luis.id}"])
        # descanso («No trabaja») no es «sin horario»
        self.sin_turno = False
        g._hoy.update(fecha=None, t=0.0); g._enviados.update(fecha=None, claves=set())
        self.db.query(md.DesignConexionRegla).filter(md.DesignConexionRegla.clave.like("gv_avisos_%")).delete(synchronize_session=False); self.db.commit()
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 7, 15)), [])
        # sábado: no se revisa
        self.sin_turno = True
        g._hoy.update(fecha=None, t=0.0)
        self.assertEqual([k for k in g.revisar(self.db, datetime(2026, 10, 24, 7, 15)) if k.startswith("horario-hoy")], [])


    def _reiniciar(self):
        g._hoy.update(fecha=None, t=0.0, datos={}); g._enviados.update(fecha=None, claves=set())
        self.db.query(md.DesignConexionRegla).filter(md.DesignConexionRegla.clave.like("gv_avisos_%")).delete(synchronize_session=False)
        self.db.commit(); self.envios.clear()

    def test_permisos_de_la_plataforma_no_avisan(self):
        from datetime import time as _t
        self.configurar()
        vac = models.TipoPermiso(nombre="Vacaciones", es_vacaciones=1); cita = models.TipoPermiso(nombre="Cita médica")
        self.db.add_all([vac, cita]); self.db.commit()
        # 1) vacaciones aprobadas en People (día completo): nada, ni entrada ni «sin horario»
        s1 = models.Solicitud(empleado_id=self.ana.id, tipo_id=vac.id, fecha_inicio=DIA, fecha_fin=DIA, dias=1, estado="aprobada")
        self.db.add(s1); self.db.commit()
        self.assertEqual([k for k in g.revisar(self.db, datetime(2026, 10, 22, 7, 30)) if "|entrada" in k], [])
        self.assertEqual(self.envios, [])
        self.assertIn("Vacaciones", g.para_seguimiento(self.ana.id, datetime(2026, 10, 22, 7, 30), 10)["permisos"])
        self.db.delete(s1); self.db.commit(); self._reiniciar()
        # 2) ausencia marcada en Tiempos libres del Schedule
        t = self.db.query(md.DesignTeam).first()
        b = md.DesignBreak(team_id=t.id, empleado_id=self.ana.id, fecha=DIA, tipo_ausencia="Calamidad doméstica")
        self.db.add(b); self.db.commit()
        self.assertEqual([k for k in g.revisar(self.db, datetime(2026, 10, 22, 7, 30)) if "|entrada" in k], [])
        self.db.delete(b); self.db.commit(); self._reiniciar()
        # 3) permiso por horas de 7:00 a 9:00: no se avisa mientras dura; a las 9:10 sin marca, sí
        self.db.add(models.Solicitud(empleado_id=self.ana.id, tipo_id=cita.id, fecha_inicio=DIA, fecha_fin=DIA, dias=0.25,
                                     hora_inicio=_t(7, 0), hora_fin=_t(9, 0), estado="aprobada")); self.db.commit()
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 8, 0)), [])
        g._hoy["t"] = 0
        self.assertEqual(g.revisar(self.db, datetime(2026, 10, 22, 9, 10)), [f"{self.ana.id}|entrada"])


    def test_almuerzo_pasa_a_tiempos_libres(self):
        self.configurar(avisos=False)
        t = self.db.query(md.DesignTeam).first()
        self.marcas = [("e", "070000"), ("sa", "120500")]
        g.revisar(self.db, datetime(2026, 10, 22, 12, 30))   # aún no regresa: se anota 1 hora
        b = self.db.query(md.DesignBreak).filter_by(team_id=t.id, empleado_id=self.ana.id, fecha=DIA).one()
        self.assertEqual((b.almuerzo_inicio, b.almuerzo_fin), ("12:05", "13:05"))
        self.marcas = [("e", "070000"), ("sa", "120500"), ("ra", "125000")]   # regresó antes de la hora
        g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 22, 13, 0)); self.db.refresh(b)
        self.assertEqual(b.almuerzo_fin, "12:50")
        self.marcas = [("e", "070000"), ("sa", "120500"), ("ra", "133000")]   # se pasó: queda 1 hora
        g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 22, 13, 40)); self.db.refresh(b)
        self.assertEqual(b.almuerzo_fin, "13:05")
        b.almuerzo_inicio, b.almuerzo_fin = "11:00", "11:45"; self.db.commit()   # lo cambió alguien a mano: se respeta
        g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 22, 14, 0)); self.db.refresh(b)
        self.assertEqual((b.almuerzo_inicio, b.almuerzo_fin), ("11:00", "11:45"))

    def test_estado_almuerzo_explica_por_que_no_llego(self):
        """Columna «Almuerzo en el Schedule» (26-oct-2026): ok / pendiente / a mano / sin marca / sin equipo / apagado."""
        self.configurar(avisos=False)
        ahora = datetime(2026, 10, 22, 12, 30)
        estado = lambda activo=True: g.estado_almuerzo(self.db, DIA, g._hoy["datos"], activo)[self.ana.id]
        self.marcas = [("e", "070000")]
        g.hoy(self.db, ahora, forzar=True)
        self.assertEqual(estado()["codigo"], "sin_marca")                       # no ha salido a almorzar
        self.marcas = [("e", "070000"), ("sa", "120500")]
        g.hoy(self.db, ahora, forzar=True)
        self.assertEqual(estado()["codigo"], "pendiente")                       # marcó, pero aún no se pasa
        self.assertEqual(estado(activo=False)["codigo"], "apagado")             # casilla apagada
        g.revisar(self.db, ahora)
        e = estado()
        self.assertEqual((e["codigo"], e["corto"]), ("ok", "12:05 – 13:05"))
        t = self.db.query(md.DesignTeam).first()
        b = self.db.query(md.DesignBreak).filter_by(team_id=t.id, empleado_id=self.ana.id, fecha=DIA).one()
        b.almuerzo_inicio, b.almuerzo_fin = "11:00", "11:45"; self.db.commit()   # escrito a mano antes: no se pisa
        e = estado()
        self.assertEqual((e["codigo"], e["corto"]), ("a_mano", "A mano 11:00"))
        self.assertIn("12:05", e["texto"])
        # sin equipo: Luis es manager, no está como diseñador en ningún equipo
        datos = {self.luis.id: {"marcas": {"salidaAlm": datetime(2026, 10, 22, 12, 0), "regresoAlm": None}, "turno": None}}
        self.assertEqual(g.estado_almuerzo(self.db, DIA, datos, True)[self.luis.id]["codigo"], "sin_equipo")
        # almuerzo fijo: no marca la salida a colación y el texto lo dice
        datos = {self.ana.id: {"marcas": {"salidaAlm": None, "regresoAlm": None}, "turno": {"almuerzoFijoFin": datetime(2026, 10, 22, 14, 0)}}}
        e = g.estado_almuerzo(self.db, DIA, datos, True)[self.ana.id]
        self.assertEqual(e["codigo"], "sin_marca")
        self.assertIn("fijo", e["texto"])

    def test_reporte_de_llegadas_tarde(self):
        self.configurar(avisos=False)
        def api(c, ruta, cuerpo):
            if ruta == "/User/List":
                return [{"Identifier": "1234567", "Enabled": "1", "Name": "Ana", "LastName": "X"}]
            return [{"Identifier": "1234567", "SpecialDays": [
                {"Date": "20261005000000", "Absent": "False", "HasDelay": "True", "Delay": "00:12"},
                {"Date": "20261007000000", "Absent": "False", "HasDelay": "True", "Delay": "00:20"},
                {"Date": "20261008000000", "Absent": "False", "HasDelay": "False", "Delay": "00:00"}]}]
        g._post.side_effect = api
        r = g.reporte_mes(self.db, "2026-09", datetime(2026, 10, 22, 9, 0))   # mes cerrado: se guarda
        self.assertTrue(r["cerrado"])
        self.assertEqual([(p["nombre"], p["veces"], p["minutos"], p["max"]) for p in r["personas"]], [("Ana X", 2, 32, 20)])
        self.assertEqual(r["masDe15"], 1)
        self.assertEqual(r["equipos"][0]["manager"], "Luis X")
        g._post.side_effect = lambda *a: (_ for _ in ()).throw(RuntimeError("no debería consultar"))
        self.assertEqual(g.reporte_mes(self.db, "2026-09", datetime(2026, 10, 22, 9, 0))["total"], 2)   # sale de lo guardado


    def test_inconsistencias_del_mes_los_viernes(self):
        self.configurar()
        def dia(d, n, turno=True, permiso=False):
            f = f"202610{d:02d}"
            return {"Date": f + "000000", "Shifts": [{"Type": "FixedShift" if turno else "NotWorking", "Status": "enabled"}],
                    "TimeOffs": [{"TimeOffTypeDescription": "Vacaciones"}] if permiso else [],
                    "Punches": [{"Date": f + "07%02d00" % i} for i in range(n)]}
        def api(c, ruta, cuerpo):
            if ruta == "/User/List":
                return [{"Identifier": "1234567", "Enabled": "1"}]
            return {"Users": [{"Identifier": "1234567", "Weeks": [{"Intervals": [
                dia(1, 4), dia(2, 2),            # completo / sin almuerzo: bien
                dia(5, 3), dia(6, 0), dia(7, 1),  # falta una marca, sin marcas, solo entrada
                dia(8, 0, turno=False), dia(9, 0, permiso=True)]}]}]}
        g._post.side_effect = api
        r = g.inconsistencias(self.db, date(2026, 10, 1), date(2026, 10, 22))
        self.assertEqual([(x["fecha"][-2:], x["tipo"]) for x in r[self.ana.id]],
                         [("05", "incompleto"), ("06", "sin_marcas"), ("07", "incompleto")])
        with mock.patch.object(g, "avisar_inconsistencias", wraps=g.avisar_inconsistencias) as av:
            g.revisar(self.db, datetime(2026, 10, 22, 15, 0))          # jueves: no
            g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 23, 14, 59))   # viernes antes de las 3: no
            self.assertEqual(av.call_count, 0)
            g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 23, 15, 0))
            g._hoy["t"] = 0; g.revisar(self.db, datetime(2026, 10, 23, 16, 0))    # una sola vez por viernes
            self.assertEqual(av.call_count, 1)
        push = [e for e in self.envios if "inconsistencias" in e[1]]
        self.assertEqual([e[0] for e in push], [[self.luis.id]])


    def test_reporte_excluye_a_rosember_y_leidy(self):
        self.configurar(avisos=False)
        self.ana.nombres, self.ana.apellidos = "Leidy Johana", "Rodríguez"
        self.db.commit()
        g._post.side_effect = lambda c, ruta, cuerpo: ([{"Identifier": "1234567", "Enabled": "1"}] if ruta == "/User/List" else
                                                       [{"Identifier": "1234567", "SpecialDays": [{"Date": "20260905000000", "HasDelay": "True", "Delay": "00:12"}]}])
        self.assertEqual(g.reporte_mes(self.db, "2026-09", datetime(2026, 10, 22, 9, 0))["personas"], [])
        self.assertTrue(g._excluido_reporte("Rosember Jhoan Bravo Marentes"))
        self.assertFalse(g._excluido_reporte("Leidy Gómez"))


if __name__ == "__main__":
    unittest.main()
