"""Centro de avisos (services_design_avisos, 20-oct-2026): los avisos que ya existían pasan al Centro, cada mensaje sale
una sola vez en su momento (turno de Support, cambio de turno, programado), con sus variables y a sus grupos, y queda en
el historial. Base SQLite en memoria; Cliq simulado."""
import unittest
from datetime import date, datetime
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra los modelos)
from app import models_design as md
from app import services_design as sd
from app import services_design_avisos as sa
from app import services_design_cliq as sc
from app.database import Base


class Centro(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sa._sembrado["ok"] = False
        a = models.Empleado(nombres="Diego Andres", apellidos="Sampayo Fontalvo", email="d@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="Support", area="x", identificacion="1")
        b = models.Empleado(nombres="Ana", apellidos="Uno", email="a@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="Support", area="x", identificacion="2")
        self.db.add_all([a, b]); self.db.commit()
        self.db.add(md.DesignSupportConfig(id=1, turno1_nombre="Diurno", turno1_inicio="07:00", turno1_fin="16:30",
                                           turno2_nombre="Nocturno", turno2_inicio="21:00", turno2_fin="07:00", dias="0,1,2,3,4",
                                           persona_a_id=b.id, persona_b_id=a.id, ref_fecha=date(2026, 10, 12), ref_turno1="a",
                                           semanas=4, cliq_canales="supportnuviacolombiacom"))
        self.db.commit()
        self.enviados = []
        for p in (mock.patch.object(sc, "configurado", return_value=True),
                  mock.patch.object(sc, "enviar_canal", side_effect=lambda k, t, c=None, b=None: self.enviados.append(("canal", k, t)) or (True, "Enviado.")),
                  mock.patch.object(sc, "enviar_persona", side_effect=lambda k, t, c=None, b=None: self.enviados.append(("persona", k, t)) or (True, "Enviado.")),
                  mock.patch.object(sd, "festivos", return_value={date(2026, 10, 22)})):
            p.start(); self.addCleanup(p.stop)

    def test_siembra_los_avisos_de_antes(self):
        d = sa.todo(self.db)
        self.assertEqual([g["nombre"] for g in d["grupos"]], ["Support"])
        self.assertEqual(d["grupos"][0]["destinos"], [{"id": d["grupos"][0]["destinos"][0]["id"], "tipo": "canal", "valor": "supportnuviacolombiacom"}])
        self.assertEqual([m["sistema"] for m in d["mensajes"]], ["support_turno", "support_cambio"])
        sa._sembrado["ok"] = False
        sa.todo(self.db)   # otra vez (otra instancia): no duplica
        self.assertEqual(self.db.query(md.DesignCliqMensaje).count(), 2)

    def test_turno_una_sola_vez_con_mencion(self):
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 20, 20, 59)), [])
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 20, 21, 2)), ["support_en_turno_2026-10-20_2"])
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 20, 21, 3)), [])
        (tipo, canal, texto), = self.enviados
        self.assertEqual(texto, "🛟 *Support Designer en turno*\n{@d@x.com} — Nocturno\n🕘 9:00 pm – 7:00 am  (Colombia Time)")
        h = sa.historial(self.db)
        self.assertEqual((h[0]["destino"], h[0]["ok"], h[0]["origen"]), ("supportnuviacolombiacom", True, "auto"))

    def test_si_el_envio_se_cae_reintenta_el_minuto_siguiente(self):
        with mock.patch.object(sa, "enviar", side_effect=RuntimeError("caída")):
            with self.assertRaises(RuntimeError):
                sa.revisar(self.db, datetime(2026, 10, 21, 7, 0))
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 21, 7, 1)), ["support_en_turno_2026-10-21_1"])
        self.assertIn("— Diurno", self.enviados[0][2])

    def test_fin_de_semana_festivo_y_pausado_no(self):
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 24, 7, 5)), [])   # sábado
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 22, 7, 5)), [])   # festivo
        m = self.db.query(md.DesignCliqMensaje).filter_by(sistema="support_turno").one()
        sa.activar(self.db, m.id, False, "Yo")
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 21, 7, 5)), [])
        self.assertEqual(self.enviados, [])

    def test_cambio_de_turno_el_dia_de_la_rotacion(self):
        sa.todo(self.db)
        m = self.db.query(md.DesignCliqMensaje).filter_by(sistema="support_turno").one()
        sa.activar(self.db, m.id, False, "Yo")
        self.assertEqual(sa.revisar(self.db, datetime(2026, 11, 9, 7, 1)), ["support_cambio_2026-11-09"])
        self.assertIn("🔄 *Cambio de turno de Support* — lun 9 nov", self.enviados[0][2])

    def test_programado_semanal_grupo_con_persona_y_editar(self):
        sa.todo(self.db)
        g = sa.guardar_grupo(self.db, {"nombre": "Managers", "destinos": [{"tipo": "canal", "valor": "#n3"}, {"tipo": "persona", "valor": "a@x.com"},
                                                                         {"tipo": "canal", "valor": "n3"}]}, "Yo")
        self.assertEqual([(d.tipo, d.valor) for d in self.db.query(md.DesignCliqDestino).filter_by(grupo_id=g.id)], [("canal", "n3"), ("persona", "a@x.com")])
        m = sa.guardar_mensaje(self.db, {"nombre": "Reunión", "texto": "Hoy {fecha}: reunión. Support: {nombre}", "disparador": "programado",
                                         "progTipo": "semanal", "progHora": "8:00", "progDias": [1], "grupos": [g.id]}, "Yo")
        self.assertEqual(m.prog_hora, "08:00")
        for x in self.db.query(md.DesignCliqMensaje).filter(md.DesignCliqMensaje.sistema.isnot(None)):
            sa.activar(self.db, x.id, False, "Yo")
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 20, 8, 10)), [f"cliq_msg_{m.id}_2026-10-20_08:00"])
        self.assertEqual([(t, k) for t, k, _ in self.enviados], [("canal", "n3"), ("persona", "a@x.com")])
        self.assertEqual(self.enviados[0][2], "Hoy mar 20 oct: reunión. Support: Ana Uno")
        self.assertEqual(sa.revisar(self.db, datetime(2026, 10, 21, 8, 10)), [])   # miércoles no
        with self.assertRaises(ValueError):
            sa.guardar_mensaje(self.db, {"nombre": "X", "texto": "y", "disparador": "programado", "progTipo": "semanal", "progHora": "08:00"}, "Yo")

    def test_sistema_no_se_borra_y_grupo_borrado_sale_de_los_mensajes(self):
        d = sa.todo(self.db)
        m = next(x for x in d["mensajes"] if x["sistema"])
        self.assertIsNotNone(sa.eliminar_mensaje(self.db, m["id"]))
        sa.eliminar_grupo(self.db, d["grupos"][0]["id"])
        self.assertEqual(self.db.get(md.DesignCliqMensaje, m["id"]).grupos, "")

    def test_variables_desconocidas_se_dejan(self):
        self.assertEqual(sa.armar("Hola {nombre} {otra}", {"nombre": "Ana"}), "Hola Ana {otra}")


if __name__ == "__main__":
    unittest.main()
