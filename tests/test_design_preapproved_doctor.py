"""Pre-Approved › «+ Doctor» (27-oct-2026): con un centro elegido, el doctor nuevo queda al final de las columnas de ese
centro (los centros siguientes se corren); sin centro elegido, al final de la hoja como antes."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado para las relaciones)
from app import models_design as md
from app import services_design as sd
from app.database import Base


class AgregarDoctor(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        area = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(area); self.db.commit()
        self.hoja = md.DesignPreApprovedSheet(area_id=area.id, nombre="Hoja"); self.db.add(self.hoja); self.db.commit()
        # FREMONT (2 doctores) · ATLANTA (1) · DALLAS (2)
        self.centros = {}
        for orden, (nombre, span) in enumerate((("FREMONT", 2), ("ATLANTA", 1), ("DALLAS", 2)), start=1):
            c = md.DesignPreApprovedCentro(sheet_id=self.hoja.id, nombre=nombre, span=span, orden=orden)
            self.db.add(c); self.centros[nombre] = c
        n = 0
        for nombre, span in (("FREMONT", 2), ("ATLANTA", 1), ("DALLAS", 2)):
            for k in range(span):
                n += 1
                self.db.add(md.DesignPreApprovedDoctor(sheet_id=self.hoja.id, nombre=f"{nombre[:3]}{k + 1}", orden=n * 10))   # con huecos
        self.db.commit()

    def nombres(self):
        return [d.nombre for d in sd._pac_doctores_ordenados(self.db, self.hoja.id)]

    def spans(self):
        self.db.expire_all()
        return [(c.nombre, c.span) for c in sd._pac_centros_ordenados(self.db, self.hoja.id)]

    def test_en_el_centro_elegido_queda_en_sus_columnas(self):
        d = sd.preapproved_agregar_doctor(self.db, self.hoja.id, nombre="Dr. Nuevo", centro_id=self.centros["FREMONT"].id)
        # FREMONT era [FRE1, FRE2]: el nuevo va al final de esas columnas, antes de ATLANTA
        self.assertEqual(self.nombres(), ["FRE1", "FRE2", "Dr. Nuevo", "ATL1", "DAL1", "DAL2"])
        self.assertEqual(self.spans(), [("FREMONT", 3), ("ATLANTA", 1), ("DALLAS", 2)])
        self.assertEqual([x.orden for x in sd._pac_doctores_ordenados(self.db, self.hoja.id)], [1, 2, 3, 4, 5, 6])
        self.assertEqual(d.nombre, "Dr. Nuevo")

    def test_en_un_centro_del_medio_y_en_el_ultimo(self):
        sd.preapproved_agregar_doctor(self.db, self.hoja.id, nombre="A+", centro_id=self.centros["ATLANTA"].id)
        self.assertEqual(self.nombres(), ["FRE1", "FRE2", "ATL1", "A+", "DAL1", "DAL2"])
        sd.preapproved_agregar_doctor(self.db, self.hoja.id, nombre="D+", centro_id=self.centros["DALLAS"].id)
        self.assertEqual(self.nombres()[-1], "D+")
        self.assertEqual(self.spans(), [("FREMONT", 2), ("ATLANTA", 2), ("DALLAS", 3)])

    def test_sin_centro_elegido_va_al_final_como_antes(self):
        sd.preapproved_agregar_doctor(self.db, self.hoja.id, nombre="Fin")
        self.assertEqual(self.nombres(), ["FRE1", "FRE2", "ATL1", "DAL1", "DAL2", "Fin"])
        self.assertEqual(self.spans(), [("FREMONT", 2), ("ATLANTA", 1), ("DALLAS", 3)])

    def test_las_celdas_siguen_a_su_doctor(self):
        fila = md.DesignPreApprovedFila(sheet_id=self.hoja.id, criterio="VDO", orden=1); self.db.add(fila); self.db.commit()
        atl = next(d for d in sd._pac_doctores_ordenados(self.db, self.hoja.id) if d.nombre == "ATL1")
        self.db.add(md.DesignPreApprovedCelda(fila_id=fila.id, doctor_id=atl.id, valor="always ask")); self.db.commit()
        sd.preapproved_agregar_doctor(self.db, self.hoja.id, centro_id=self.centros["FREMONT"].id)
        celda = self.db.query(md.DesignPreApprovedCelda).filter_by(fila_id=fila.id).one()
        self.assertEqual((celda.doctor_id, celda.valor), (atl.id, "always ask"))   # sigue en ATL1, aunque su columna se corrió

    def test_un_centro_de_otra_hoja_no_vale(self):
        otra = md.DesignPreApprovedSheet(area_id=self.hoja.area_id, nombre="Otra"); self.db.add(otra); self.db.commit()
        c = md.DesignPreApprovedCentro(sheet_id=otra.id, nombre="X", span=1, orden=1); self.db.add(c); self.db.commit()
        with self.assertRaises(ValueError):
            sd.preapproved_agregar_doctor(self.db, self.hoja.id, centro_id=c.id)


if __name__ == "__main__":
    unittest.main()
