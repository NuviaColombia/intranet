"""Evaluación de desempeño (People): estructura de aprobadores, anonimato de la Evaluación 360,
permisos sobre el Plan de mejora y recordatorios automáticos de noviembre/mayo."""
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app import models  # noqa: F401
from app import models_evaluacion  # noqa: F401
from app.models import Empleado
from app.models_evaluacion import EvaluacionRecordatorioEnviado
from app import services_evaluacion as se


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False)()


def _empleado(db, nombres="T", aprobador1=None, aprobador2=None, activo=1, email=None):
    e = Empleado(nombres=nombres, apellidos="P", email=email or f"{nombres.lower()}@nuviasmiles.com",
                rol="empleado", empresa="Nuvia Smiles Colombia SAS", activo=activo, cargo="x", area="x",
                identificacion=f"id-{nombres}-{id(object())}",
                aprobador1_id=aprobador1.id if aprobador1 else None,
                aprobador2_id=aprobador2.id if aprobador2 else None)
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


class JefesYEquipo(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.jefe = _empleado(self.db, "Jefe")
        self.empleado = _empleado(self.db, "Empleado", aprobador1=self.jefe)

    def test_jefes_a_evaluar_incluye_al_aprobador(self):
        self.assertEqual([j.id for j in se.jefes_a_evaluar(self.empleado)], [self.jefe.id])

    def test_sin_aprobadores_lista_vacia(self):
        self.assertEqual(se.jefes_a_evaluar(self.jefe), [])

    def test_deduplica_si_aprobador1_y_aprobador2_son_la_misma_persona(self):
        e = _empleado(self.db, "Dup", aprobador1=self.jefe)
        e.aprobador2_id = self.jefe.id
        self.db.commit()
        self.db.refresh(e)
        self.assertEqual([j.id for j in se.jefes_a_evaluar(e)], [self.jefe.id])

    def test_excluye_aprobador_inactivo(self):
        jefe_inactivo = _empleado(self.db, "Inactivo", activo=0)
        e = _empleado(self.db, "ConJefeInactivo", aprobador1=jefe_inactivo)
        self.assertEqual(se.jefes_a_evaluar(e), [])

    def test_equipo_a_evaluar_coincide_con_empleados_a_cargo(self):
        from app.services import empleados_a_cargo
        self.assertEqual([e.id for e in se.equipo_a_evaluar(self.db, self.jefe)],
                         [e.id for e in empleados_a_cargo(self.db, self.jefe)])

    def test_tiene_equipo(self):
        self.assertTrue(se.tiene_equipo(self.db, self.jefe))
        self.assertFalse(se.tiene_equipo(self.db, self.empleado))

    def test_lideres_activos_incluye_solo_con_subordinado_activo(self):
        jefe_sin_equipo = _empleado(self.db, "SinEquipo")
        ids = {l.id for l in se.lideres_activos(self.db)}
        self.assertIn(self.jefe.id, ids)
        self.assertNotIn(jefe_sin_equipo.id, ids)
        self.assertNotIn(self.empleado.id, ids)  # empleado no es aprobador de nadie


class Ciclos(unittest.TestCase):
    def setUp(self):
        self.db = _db()

    def test_no_abre_fuera_de_noviembre_mayo(self):
        self.assertIsNone(se.abrir_ciclo_si_corresponde(self.db, date(2026, 10, 15)))
        self.assertIsNone(se.abrir_ciclo_si_corresponde(self.db, date(2026, 4, 1)))

    def test_abre_en_noviembre_y_mayo(self):
        c1 = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 3))
        c2 = se.abrir_ciclo_si_corresponde(self.db, date(2027, 5, 20))
        self.assertEqual(c1.etiqueta, "Noviembre 2026")
        self.assertEqual(c2.etiqueta, "Mayo 2027")

    def test_idempotente(self):
        c1 = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 1))
        c2 = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 28))
        self.assertEqual(c1.id, c2.id)

    def test_ciclo_actual_es_el_mas_reciente(self):
        se.abrir_ciclo_si_corresponde(self.db, date(2025, 11, 1))
        mas_reciente = se.abrir_ciclo_si_corresponde(self.db, date(2026, 5, 1))
        self.assertEqual(se.ciclo_actual(self.db).id, mas_reciente.id)


class GuardarRespuestas(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.ciclo = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 1))
        self.jefe = _empleado(self.db, "Jefe")
        self.empleado = _empleado(self.db, "Empleado", aprobador1=self.jefe)
        self.ajeno = _empleado(self.db, "Ajeno")

    def test_guardar_360_rechaza_evaluado_que_no_es_jefe(self):
        r, error = se.guardar_360(self.db, self.ciclo, self.empleado, self.ajeno, [3] * 12)
        self.assertIsNone(r)
        self.assertIn("jefes", error)

    def test_guardar_360_rechaza_longitud_incorrecta(self):
        r, error = se.guardar_360(self.db, self.ciclo, self.empleado, self.jefe, [3] * 11)
        self.assertIsNone(r)

    def test_guardar_360_rechaza_valores_fuera_de_rango(self):
        r, error = se.guardar_360(self.db, self.ciclo, self.empleado, self.jefe, [3] * 11 + [6])
        self.assertIsNone(r)

    def test_guardar_360_ok_y_upsert(self):
        r, error = se.guardar_360(self.db, self.ciclo, self.empleado, self.jefe, [4] * 12)
        self.assertIsNone(error)
        self.assertEqual(r.comp_1, 4)
        r2, error2 = se.guardar_360(self.db, self.ciclo, self.empleado, self.jefe, [5] * 12)
        self.assertIsNone(error2)
        self.assertEqual(r.id, r2.id)  # mismo registro, no duplicado
        from app.models_evaluacion import Evaluacion360Respuesta
        self.assertEqual(self.db.query(Evaluacion360Respuesta).count(), 1)

    def test_guardar_equipo_rechaza_si_no_esta_a_cargo(self):
        r, error = se.guardar_equipo(self.db, self.ciclo, self.jefe, self.ajeno, [3, 3, 3], "")
        self.assertIsNone(r)
        self.assertIn("cargo", error)

    def test_guardar_equipo_ok_y_upsert(self):
        r, error = se.guardar_equipo(self.db, self.ciclo, self.jefe, self.empleado, [5, 4, 3], "Bien")
        self.assertIsNone(error)
        r2, error2 = se.guardar_equipo(self.db, self.ciclo, self.jefe, self.empleado, [3, 3, 3], "Mejoró")
        self.assertEqual(r.id, r2.id)
        from app.models_evaluacion import EvaluacionEquipoRespuesta
        self.assertEqual(self.db.query(EvaluacionEquipoRespuesta).count(), 1)
        self.assertEqual(r2.observacion, "Mejoró")


class Promedio360(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.ciclo = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 1))
        self.lider = _empleado(self.db, "Lider")

    def test_sin_evaluadores(self):
        resultado = se.promedio_360(self.db, self.ciclo, self.lider)
        self.assertEqual(resultado["n_evaluadores"], 0)
        self.assertIsNone(resultado["promedio_general"])

    def test_con_evaluadores_promedia_y_no_expone_evaluador(self):
        e1 = _empleado(self.db, "E1", aprobador1=self.lider)
        e2 = _empleado(self.db, "E2", aprobador1=self.lider)
        e3 = _empleado(self.db, "E3", aprobador1=self.lider)
        se.guardar_360(self.db, self.ciclo, e1, self.lider, [2] * 12)
        se.guardar_360(self.db, self.ciclo, e2, self.lider, [4] * 12)
        se.guardar_360(self.db, self.ciclo, e3, self.lider, [3] * 12)
        resultado = se.promedio_360(self.db, self.ciclo, self.lider)
        self.assertEqual(resultado["n_evaluadores"], 3)
        self.assertAlmostEqual(resultado["promedio_general"], 3.0)
        self.assertAlmostEqual(resultado["competencias"][0]["promedio"], 3.0)
        self.assertEqual(resultado["competencias"][0]["nivel"], "Regular")
        self.assertNotIn("evaluador_id", str(resultado))


class CambioDeJefeAMitadDeCiclo(unittest.TestCase):
    def test_respuesta_vieja_no_se_altera_y_jefes_a_evaluar_cambia(self):
        db = _db()
        ciclo = se.abrir_ciclo_si_corresponde(db, date(2026, 11, 1))
        jefe_a = _empleado(db, "JefeA")
        jefe_b = _empleado(db, "JefeB")
        empleado = _empleado(db, "Empleado", aprobador1=jefe_a)
        r, _ = se.guardar_360(db, ciclo, empleado, jefe_a, [4] * 12)
        rid = r.id

        empleado.aprobador1_id = jefe_b.id
        db.commit()
        db.refresh(empleado)

        from app.models_evaluacion import Evaluacion360Respuesta
        vieja = db.get(Evaluacion360Respuesta, rid)
        self.assertEqual(vieja.comp_1, 4)  # intacta
        self.assertEqual([j.id for j in se.jefes_a_evaluar(empleado)], [jefe_b.id])
        # ya no puede volver a evaluar a jefe_a (ya no es su jefe)
        _, error = se.guardar_360(db, ciclo, empleado, jefe_a, [1] * 12)
        self.assertIsNotNone(error)


class PermisosPlan(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.jefe = _empleado(self.db, "Jefe")
        self.lider = _empleado(self.db, "Lider", aprobador1=self.jefe)
        self.rrhh = _empleado(self.db, "Rrhh", email="pamela.manzurroca@nuviasmiles.com")
        self.admin = _empleado(self.db, "Admin")
        self.admin.rol = "superadmin"
        self.ajeno = _empleado(self.db, "Ajeno")
        self.db.commit()

    def test_puede_ver_plan(self):
        self.assertTrue(se.puede_ver_plan(self.lider, self.lider))      # el propio líder
        self.assertTrue(se.puede_ver_plan(self.jefe, self.lider))       # su jefe
        self.assertTrue(se.puede_ver_plan(self.admin, self.lider))      # superadmin
        self.assertTrue(se.puede_ver_plan(self.rrhh, self.lider))       # RR.HH.
        self.assertFalse(se.puede_ver_plan(self.ajeno, self.lider))     # sin relación

    def test_puede_editar_plan_excluye_al_propio_lider(self):
        self.assertFalse(se.puede_editar_plan(self.lider, self.lider))
        self.assertTrue(se.puede_editar_plan(self.jefe, self.lider))
        self.assertTrue(se.puede_editar_plan(self.admin, self.lider))
        self.assertFalse(se.puede_editar_plan(self.ajeno, self.lider))

    def test_puede_firmar(self):
        self.assertTrue(se.puede_firmar("lider", self.lider, self.lider))
        self.assertFalse(se.puede_firmar("lider", self.jefe, self.lider))
        self.assertTrue(se.puede_firmar("jefe", self.jefe, self.lider))
        self.assertFalse(se.puede_firmar("jefe", self.ajeno, self.lider))
        self.assertTrue(se.puede_firmar("rrhh", self.rrhh, self.lider))
        self.assertTrue(se.puede_firmar("rrhh", self.admin, self.lider))  # superadmin respalda a RR.HH.
        self.assertFalse(se.puede_firmar("rrhh", self.jefe, self.lider))


class PlanObtenerOCrear(unittest.TestCase):
    def test_crea_filas_hijas_fijas(self):
        db = _db()
        ciclo = se.abrir_ciclo_si_corresponde(db, date(2026, 11, 1))
        lider = _empleado(db, "Lider")
        plan = se.plan_obtener_o_crear(db, lider, ciclo)
        self.assertEqual(len(plan.notas_competencias), len(se.COMPETENCIAS_360))
        self.assertEqual(len(plan.acciones), se.N_ACCIONES)
        self.assertEqual(len(plan.seguimientos), se.N_SEGUIMIENTOS)
        otra_vez = se.plan_obtener_o_crear(db, lider, ciclo)
        self.assertEqual(plan.id, otra_vez.id)  # no duplica


class Recordatorios(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.ciclo = se.abrir_ciclo_si_corresponde(self.db, date(2026, 11, 1))
        self.jefe = _empleado(self.db, "Jefe")
        self.empleado = _empleado(self.db, "Empleado", aprobador1=self.jefe)

    @patch("app.services_evaluacion.enviar_correo", return_value=True)
    @patch("app.services_evaluacion.enviar_cliq", return_value=True)
    def test_envia_solo_a_quien_tiene_pendientes(self, mock_cliq, mock_correo):
        n = se.enviar_recordatorios(self.db, self.ciclo)
        self.assertEqual(n, 2)  # jefe (pendiente de equipo) y empleado (pendiente de jefe)
        self.assertEqual(mock_cliq.call_count, 2)

    @patch("app.services_evaluacion.enviar_correo", return_value=True)
    @patch("app.services_evaluacion.enviar_cliq", return_value=True)
    def test_sin_email_no_rompe_ni_cuenta(self, mock_cliq, mock_correo):
        sin_email = Empleado(nombres="SinMail", apellidos="P", email="", rol="empleado",
                             empresa="Nuvia Smiles Colombia SAS", activo=1, cargo="x", area="x",
                             identificacion="sinmail", aprobador1_id=self.jefe.id)
        self.db.add(sin_email)
        self.db.commit()
        n = se.enviar_recordatorios(self.db, self.ciclo)
        self.assertEqual(n, 2)  # sin_email no cuenta, pero tampoco truena

    @patch("app.services_evaluacion.enviar_correo", return_value=True)
    @patch("app.services_evaluacion.enviar_cliq", return_value=True)
    def test_no_reenvia_antes_de_dias_entre_recordatorios(self, mock_cliq, mock_correo):
        se.enviar_recordatorios(self.db, self.ciclo)
        mock_cliq.reset_mock()
        n = se.enviar_recordatorios(self.db, self.ciclo)
        self.assertEqual(n, 0)
        self.assertEqual(mock_cliq.call_count, 0)

    @patch("app.services_evaluacion.enviar_correo", return_value=True)
    @patch("app.services_evaluacion.enviar_cliq", return_value=True)
    def test_reenvia_pasados_los_dias(self, mock_cliq, mock_correo):
        se.enviar_recordatorios(self.db, self.ciclo)
        marca = self.db.get(EvaluacionRecordatorioEnviado, (self.ciclo.id, self.jefe.id))
        marca.enviado_en = datetime.utcnow() - timedelta(days=se.DIAS_ENTRE_RECORDATORIOS + 1)
        self.db.commit()
        n = se.enviar_recordatorios(self.db, self.ciclo)
        self.assertEqual(n, 1)  # solo el jefe, al que ya le tocaba de nuevo


if __name__ == "__main__":
    unittest.main()
