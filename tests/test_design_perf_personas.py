"""Desempeño (26-oct-2026): aprobadores y admins agregan, renombran y quitan personas; hoja «N3 Leonardo»."""
import json
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class Base_(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._perf_hoja_leonardo["ok"] = False
        sd._reglas_invalidar()
        self.addCleanup(lambda: (sd._perf_hoja_leonardo.update(ok=False), sd._reglas_invalidar()))
        self.mk = lambda nombres, apellidos, rol="empleado", activo=True: models.Empleado(
            nombres=nombres, apellidos=apellidos, email=f"{nombres}{apellidos}@x.com".replace(" ", ""), rol=rol, activo=activo,
            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=nombres + apellidos)
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(self.n3); self.db.commit()

    def equipo(self, nombre, manager, gente):
        t = md.DesignTeam(area_id=self.n3.id, nombre=nombre, manager_id=manager.id, orden=1, activo=1)
        self.db.add(t); self.db.commit()
        for e in gente:
            self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        self.db.commit()
        return t


class HojaLeonardo(Base_):
    def test_crea_la_hoja_con_su_equipo_y_la_ve_solo_el(self):
        leo, a, b = self.mk("Leonardo", "Gomez", "aprobador"), self.mk("Ana", "Ruiz"), self.mk("Beto", "Mora")
        self.db.add_all([leo, a, b]); self.db.commit()
        self.equipo("Eq Leo", leo, [a, b, leo])
        sd.perf_sheets(self.db)
        (h,) = self.db.query(md.DesignPerfSheet).filter_by(nombre="N3 Leonardo").all()
        self.assertEqual([e.nombre for e in sorted(h.empleados, key=lambda e: e.orden)], ["Ana Ruiz", "Beto Mora"])
        self.assertEqual(json.loads(h.meses)[0], "Ene 2026")
        self.assertTrue(sd.perf_sheet_visible(leo, h))
        self.assertFalse(sd.perf_sheet_visible(a, h))
        sd._perf_hoja_leonardo["ok"] = False
        sd.perf_hoja_leonardo_una_vez(self.db)                       # una sola vez
        self.assertEqual(self.db.query(md.DesignPerfSheet).filter_by(nombre="N3 Leonardo").count(), 1)


class Personas(Base_):
    def setUp(self):
        super().setUp()
        self.paula, self.admin = self.mk("Paula", "Parra", "aprobador"), self.mk("Ro", "Admin", "admin")
        self.otra = self.mk("Marta", "Lis", "aprobador")
        self.db.add_all([self.paula, self.admin, self.otra]); self.db.commit()
        self.h = md.DesignPerfSheet(nombre="N3 Paula", tipo="eval", meses=json.dumps(["Ene 2026"] * 12), orden=1)
        self.dm = md.DesignPerfSheet(nombre="DESIGN MANAGERS", tipo="eval", meses="[]", orden=2)
        self.db.add_all([self.h, self.dm]); self.db.commit()
        self.javier = md.DesignPerfEmpleado(sheet_id=self.h.id, nombre="Javier Lopez", orden=1)
        self.ella = md.DesignPerfEmpleado(sheet_id=self.h.id, nombre="Paula Parra", orden=2)
        self.db.add_all([self.javier, self.ella]); self.db.commit()
        crit = md.DesignPerfCriterio(nombre="Calidad", orden=1); self.db.add(crit); self.db.commit()
        self.db.add(md.DesignPerfCelda(empleado_id=self.javier.id, criterio_id=crit.id, mes_indice=0, nivel="ALTO")); self.db.commit()
        sd._guardar_regla(self.db, "hoja_manager", "N3 Paula", json.dumps({"area": "N3 Prosthetic", "manager": "Paula Parra"}), "t")
        sd._reglas_invalidar()

    def test_quien_puede_gestionar(self):
        self.assertTrue(sd.perf_puede_gestionar_hoja(self.paula, self.h))
        self.assertTrue(sd.perf_puede_gestionar_hoja(self.admin, self.h))
        self.assertFalse(sd.perf_puede_gestionar_hoja(self.otra, self.h))       # otra aprobadora no
        self.assertFalse(sd.perf_puede_gestionar_hoja(self.paula, self.dm))     # DESIGN MANAGERS es de los admins
        self.assertTrue(sd.perf_puede_gestionar_hoja(self.admin, self.dm))
        self.assertFalse(sd.perf_puede_calificar(self.paula, self.ella))        # ni a sí misma

    def test_agregar_renombrar_y_no_repetir(self):
        e, err = sd.perf_agregar_persona(self.db, self.h, "  Nueva   Persona ")
        self.assertIsNone(err)
        self.assertEqual(e.nombre, "Nueva Persona")
        self.assertEqual(len(json.loads(e.totales_mes)), 12)
        self.assertEqual(e.orden, 3)
        _, err = sd.perf_agregar_persona(self.db, self.h, "javier lópez")
        self.assertIn("ya está", err)
        self.assertIsNone(sd.perf_renombrar_persona(self.db, self.javier, "Javier Andrés Lopez"))
        self.assertEqual(self.javier.nombre, "Javier Andrés Lopez")
        self.assertIn("ya está", sd.perf_renombrar_persona(self.db, self.javier, "Nueva Persona"))
        self.assertTrue(sd.perf_agregar_persona(self.db, self.h, "   ")[1])

    def test_quitar_deja_la_fila_en_la_papelera(self):
        sd.perf_quitar_persona(self.db, self.javier, "Paula Parra")
        self.assertEqual([e.nombre for e in self.db.query(md.DesignPerfEmpleado).filter_by(sheet_id=self.h.id)], ["Paula Parra"])
        t = self.db.query(md.DesignTrash).filter_by(modulo="perf-emp").one()
        self.assertIn("Javier Lopez", t.etiqueta)
        self.assertEqual(self.db.query(md.DesignPerfCelda).count(), 0)


if __name__ == "__main__":
    unittest.main()
