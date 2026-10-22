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


if __name__ == "__main__":
    unittest.main()
