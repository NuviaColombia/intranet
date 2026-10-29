"""Calendario de Design (29-oct-2026): los aprobadores ven las vacaciones de los demás aprobadores, para no entorpecer la
producción. Un aprobador NO ve las ausencias de personas de otros equipos (que no son vacaciones), ni los motivos."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_calendario as scal
from app.database import Base


class VacacionesDeAprobadores(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = db = sessionmaker(bind=eng)()
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=n + "@x.com", rol=rol, activo=1,
                                                       empresa=models.EMPRESA_DESIGN, cargo="c", area="a", identificacion=n)
        self.ap1 = mk("Aprobadora1", "aprobador")          # manager de Eq 1
        self.ap2 = mk("Aprobador2", "aprobador")           # manager de Eq 2
        self.dis2 = mk("Diseñadora2")                       # diseñadora de Eq 2
        self.dis1 = mk("Diseñador1")                        # diseñador de Eq 1 (solo lo ve Aprobadora1)
        self.tipo_vac = models.TipoPermiso(nombre="Vacaciones", es_vacaciones=1)
        self.tipo_cita = models.TipoPermiso(nombre="Cita médica")
        db.add_all([self.ap1, self.ap2, self.dis2, self.dis1, self.tipo_vac, self.tipo_cita]); db.flush()
        a = md.DesignArea(nombre=sd.AREA_N3, formato="dual"); db.add(a); db.flush()
        self.eq1 = md.DesignTeam(area_id=a.id, nombre="Eq 1", manager_id=self.ap1.id, activo=1, orden=1)
        self.eq2 = md.DesignTeam(area_id=a.id, nombre="Eq 2", manager_id=self.ap2.id, activo=1, orden=2)
        db.add_all([self.eq1, self.eq2]); db.flush()
        db.add_all([md.DesignTeamDesigner(team_id=self.eq1.id, empleado_id=self.dis1.id),
                    md.DesignTeamDesigner(team_id=self.eq2.id, empleado_id=self.dis2.id)])
        db.add_all([
            models.Solicitud(empleado_id=self.ap2.id, tipo_id=self.tipo_vac.id, fecha_inicio=date(2026, 11, 3), fecha_fin=date(2026, 11, 7),
                             dias=5, estado="aprobada"),                                  # vacaciones de otro aprobador
            models.Solicitud(empleado_id=self.dis2.id, tipo_id=self.tipo_vac.id, fecha_inicio=date(2026, 11, 4), fecha_fin=date(2026, 11, 4),
                             dias=1, estado="aprobada"),                                  # vacaciones de una diseñadora de otro equipo
            models.Solicitud(empleado_id=self.dis2.id, tipo_id=self.tipo_cita.id, fecha_inicio=date(2026, 11, 5), fecha_fin=date(2026, 11, 5),
                             dias=1, estado="aprobada", motivo="privado"),                # cita médica: no es vacaciones
        ])
        db.commit()

    def ausencias(self, u):
        return scal.ausencias(self.db, u, date(2026, 11, 1), date(2026, 11, 30))

    def test_un_aprobador_ve_las_vacaciones_de_los_otros_aprobadores(self):
        aus = self.ausencias(self.ap1)
        nombres = {(a["person_name"], a["type"]) for a in aus}
        self.assertIn(("Aprobador2 X", "vacaciones"), nombres)

    def test_no_ve_vacaciones_ni_ausencias_de_diseñadoras_de_otros_equipos(self):
        aus = self.ausencias(self.ap1)
        self.assertNotIn("Diseñadora2 X", {a["person_name"] for a in aus})     # solo los aprobadores de otros equipos
        self.assertFalse(any(a["notes"] == "privado" for a in aus))

    def test_un_diseñador_no_ve_vacaciones_de_otros(self):
        aus = self.ausencias(self.dis1)
        self.assertFalse(any(a["person_name"] == "Aprobador2 X" for a in aus))
        self.assertFalse(any(a["person_name"] == "Diseñadora2 X" for a in aus))

    def test_las_personas_del_filtro_incluyen_a_los_aprobadores(self):
        nombres = {p["name"] for p in scal.personas(self.db, self.ap1)}
        self.assertIn("Aprobador2 X", nombres)


if __name__ == "__main__":
    unittest.main()
