"""Desempeño › hoja de la aprobadora Zulys (N3) y su equipo (28-oct-2026): se crea una sola vez desde la base."""
import json
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app.database import Base


class HojaZulys(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._perf_hoja_zulys["ok"] = False
        sd._reglas_invalidar()
        self.addCleanup(lambda: (sd._perf_hoja_zulys.update(ok=False), sd._reglas_invalidar()))
        self.mk = lambda nombres, apellidos, rol="empleado", activo=True: models.Empleado(
            nombres=nombres, apellidos=apellidos, email=f"{nombres}{apellidos}@x.com".replace(" ", ""), rol=rol, activo=activo,
            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=nombres + apellidos)
        self.zulys = self.mk("Zulys", "Perez Mora", "aprobador")
        self.ana, self.beto, self.cris = self.mk("Ana", "Lopez"), self.mk("Beto", "Diaz"), self.mk("Cris", "Rios", activo=False)
        self.otro = self.mk("Otro", "Equipo")
        self.db.add_all([self.zulys, self.ana, self.beto, self.cris, self.otro]); self.db.commit()
        self.n3 = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(self.n3); self.db.commit()
        self.equipo = self.nuevo_equipo("Eq Zulys", self.zulys, [self.ana, self.beto, self.cris, self.zulys])

    def nuevo_equipo(self, nombre, manager, gente):
        t = md.DesignTeam(area_id=self.n3.id, nombre=nombre, manager_id=manager.id, orden=1, activo=1)
        self.db.add(t); self.db.commit()
        for e in gente:
            self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=e.id))
        self.db.commit()
        return t

    def hojas(self):
        return self.db.query(md.DesignPerfSheet).filter_by(tipo="eval", nombre="N3 Zulys").all()

    def test_crea_la_hoja_con_el_equipo_y_los_meses_de_2026(self):
        sd.perf_hoja_zulys_una_vez(self.db)
        (h,) = self.hojas()
        self.assertEqual(json.loads(h.meses), [f"{m} 2026" for m in ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")])
        nombres = [e.nombre for e in sorted(h.empleados, key=lambda e: e.orden)]
        self.assertEqual(nombres, ["Ana Lopez", "Beto Diaz"])          # sin ella ni la persona inactiva

    def test_ella_ve_y_califica_solo_su_hoja(self):
        sd.perf_hoja_zulys_una_vez(self.db)
        (h,) = self.hojas()
        otra = md.DesignPerfSheet(nombre="N3 Luisa", tipo="eval", meses="[]", orden=9); self.db.add(otra); self.db.commit()
        self.assertTrue(sd.perf_sheet_visible(self.zulys, h))
        self.assertFalse(sd.perf_sheet_visible(self.zulys, otra))      # no la de otra aprobadora
        self.assertFalse(sd.perf_sheet_visible(self.ana, h))           # una diseñadora no
        fila = next(e for e in h.empleados if e.nombre == "Ana Lopez")
        self.assertTrue(sd.perf_puede_calificar(self.zulys, fila))

    def test_se_crea_una_sola_vez(self):
        sd.perf_hoja_zulys_una_vez(self.db)
        sd._perf_hoja_zulys["ok"] = False
        sd.perf_hoja_zulys_una_vez(self.db)
        self.assertEqual(len(self.hojas()), 1)
        h = self.hojas()[0]
        self.db.delete(h); self.db.commit()                            # si alguien la borra, no reaparece sola
        sd._perf_hoja_zulys["ok"] = False
        sd.perf_hoja_zulys_una_vez(self.db)
        self.assertEqual(len(self.hojas()), 0)

    def test_si_todavia_no_esta_como_manager_espera(self):
        self.equipo.manager_id = self.otro.id; self.db.commit()
        sd.perf_hoja_zulys_una_vez(self.db)
        self.assertEqual(self.hojas(), [])
        self.assertEqual(self.db.query(md.DesignConexionRegla).filter_by(clave=sd.PERF_HOJA_ZULYS["marca"]).count(), 0)   # sin marca: lo reintenta
        self.equipo.manager_id = self.zulys.id; self.db.commit()
        sd._perf_hoja_zulys["ok"] = False
        sd.perf_hoja_zulys_una_vez(self.db)
        self.assertEqual(len(self.hojas()), 1)

    def test_si_hay_dos_personas_con_ese_nombre_no_adivina(self):
        otra = self.mk("Zully", "Gomez", "aprobador"); self.db.add(otra); self.db.commit()
        self.nuevo_equipo("Eq Zully", otra, [self.otro])
        sd.perf_hoja_zulys_una_vez(self.db)
        self.assertEqual(self.hojas(), [])

    def test_perf_sheets_tambien_la_crea(self):
        sd.perf_sheets(self.db)
        self.assertEqual(len(self.hojas()), 1)


class CorreccionesDaniel(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()

    def test_quitar_shirliana_y_unir_duplicados_conservan_lo_calificado(self):
        h = md.DesignPerfSheet(nombre="N2 Daniel", tipo="eval", meses="[]", orden=1); self.db.add(h); self.db.commit()
        crit = md.DesignPerfCriterio(nombre="Calidad", orden=1); self.db.add(crit); self.db.commit()
        shir = md.DesignPerfEmpleado(sheet_id=h.id, nombre="Shirliana Rodriguez", orden=1); self.db.add(shir)
        pocas = md.DesignPerfEmpleado(sheet_id=h.id, nombre="Aylin Ejemplo", orden=2)
        llena = md.DesignPerfEmpleado(sheet_id=h.id, nombre="Aylin Ejemplo", orden=3)
        self.db.add_all([pocas, llena]); self.db.commit()
        self.db.add(md.DesignPerfCelda(empleado_id=llena.id, criterio_id=crit.id, mes_indice=0, nivel="ALTO")); self.db.commit()
        sd._correccion(self.db, {"op": "eliminar_fila", "hoja": "N2 Daniel", "nombre": "Shirliana Rodriguez", "motivo": "x"}, True, "Rosember")
        dup = {"op": "unir_duplicado", "hoja": "N2 Daniel", "nombre": "Aylin Ejemplo"}
        vista = sd._correccion(self.db, dup, False, "Rosember")
        self.assertEqual(vista["estado"], "pendiente")
        sd._correccion(self.db, dup, True, "Rosember")
        nombres = [e.nombre for e in self.db.query(md.DesignPerfEmpleado).filter_by(sheet_id=h.id).all()]
        self.assertEqual(nombres, ["Aylin Ejemplo"])
        queda = self.db.query(md.DesignPerfEmpleado).filter_by(sheet_id=h.id).one()
        self.assertEqual(queda.id, llena.id)   # la que tenía calificaciones


if __name__ == "__main__":
    unittest.main()
