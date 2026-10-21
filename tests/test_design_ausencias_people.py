"""Ausencia automática desde People (services_design.ausencia_design_de, 20-oct-2026): cualquier permiso de día completo
aprobado en People se traduce a una opción del catálogo de ausencias de Design. No necesita base de datos."""
import unittest

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd

CATALOGO = ["Vacaciones", "Calamidad doméstica", "Licencia por luto", "Licencia por paternidad", "Descanso compensatorio",
            "Festivo compensatorio", "Incapacidad", "Suspensión", "Remunerada", "No remunerada", "Cumpleaños", "Grado",
            "Permiso personal"]


class AusenciaPeople(unittest.TestCase):
    def caso(self, tipo, vac=False):
        return sd.ausencia_design_de(tipo, vac, CATALOGO)

    def test_mismo_nombre_y_equivalentes(self):
        self.assertEqual(self.caso("Vacaciones", True), "Vacaciones")
        self.assertEqual(self.caso("Licencia de luto"), "Licencia por luto")
        self.assertEqual(self.caso("CALAMIDAD DOMESTICA"), "Calamidad doméstica")

    def test_por_palabra_clave(self):
        self.assertEqual(self.caso("Incapacidad médica"), "Incapacidad")
        self.assertEqual(self.caso("Licencia de maternidad"), "Licencia por paternidad")
        self.assertEqual(self.caso("Día de cumpleaños"), "Cumpleaños")
        self.assertEqual(self.caso("Licencia no remunerada"), "No remunerada")
        self.assertEqual(self.caso("Licencia remunerada"), "Remunerada")
        self.assertEqual(self.caso("Vacaciones colectivas"), "Vacaciones")

    def test_desconocido_es_permiso_personal(self):
        self.assertEqual(self.caso("Capacitación externa"), "Permiso personal")


class SeguimientoPeople(unittest.TestCase):
    """21-oct-2026: una licencia aprobada por el jefe que espera el soporte de People ya es ausencia, y Support no sale
    en Seguimiento."""

    def setUp(self):
        from datetime import date, datetime
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from app import models_design as md
        from app.database import Base
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = db = sessionmaker(bind=eng)()
        mk = lambda n: models.Empleado(nombres=n, apellidos="X", email=n + "@x.com", rol="empleado", activo=1,
                                       empresa=models.EMPRESA_DESIGN, cargo="c", area="a", identificacion=n)
        self.kath, self.ana, self.sup = mk("Katherine"), mk("Ana"), mk("Soporte")
        db.add_all([self.kath, self.ana, self.sup]); db.flush()
        a3, asu = md.DesignArea(nombre=sd.AREA_N3, formato="dual"), md.DesignArea(nombre="Support", formato=sd.FORMATO_SUPPORT)
        db.add_all([a3, asu]); db.flush()
        t3, tsu = md.DesignTeam(area_id=a3.id, nombre="Eq N3"), md.DesignTeam(area_id=asu.id, nombre="Support Time")
        db.add_all([t3, tsu]); db.flush()
        db.add_all([md.DesignTeamDesigner(team_id=t3.id, empleado_id=self.kath.id), md.DesignTeamDesigner(team_id=t3.id, empleado_id=self.ana.id),
                    md.DesignTeamDesigner(team_id=tsu.id, empleado_id=self.sup.id), md.DesignTeamDesigner(team_id=t3.id, empleado_id=self.sup.id)])
        tp = models.TipoPermiso(nombre="Licencia de maternidad")
        db.add(tp); db.flush()
        self.hoy = date(2026, 10, 21)
        db.add(models.Solicitud(empleado_id=self.kath.id, tipo_id=tp.id, fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 12, 31),
                                dias=60, estado="pendiente_soporte"))
        db.commit()
        self.ahora = datetime(2026, 10, 21, 10, 0, tzinfo=sd.ZONA_COLOMBIA)

    def test_licencia_pendiente_de_soporte_es_ausencia(self):
        self.assertIn(self.kath.id, sd._permisos_aprobados_del_dia(self.db, [self.kath.id, self.ana.id], self.hoy))
        self.assertNotIn(self.ana.id, sd._permisos_aprobados_del_dia(self.db, [self.kath.id, self.ana.id], self.hoy))

    def test_support_no_sale_en_seguimiento(self):
        d = sd.seguimiento(self.db, self.ahora)
        ids = {p["id"] for p in d["disenadores"]}
        self.assertNotIn(self.sup.id, ids)
        self.assertIn(self.ana.id, ids)
        kath = next(p for p in d["disenadores"] if p["id"] == self.kath.id)
        self.assertTrue(kath.get("ausencia") or kath.get("estado") == "ausente", kath)


if __name__ == "__main__":
    unittest.main()
