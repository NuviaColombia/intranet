"""Cambios digitales (28-oct-2026): el tipo de cambio («Occlusal ant») y el doctor no salen repetidos aunque estén escritos con
otras mayúsculas, tildes, espacios o título (Dr., Dra.)."""
import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registra Empleado para los mapeos)
from app import models_design as md
from app import services_design_cambios as sc
from app.database import Base


class Duplicados(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()

    def cambio(self, tipo, n=1, doctor="Dr X", centro="Dublin"):
        for i in range(n):
            self.db.add(md.DesignCambioDigital(fecha=date(2026, 10, 5), orden=f"O{i}", paciente="P", centro=centro, doctor=doctor,
                                               producto="Full", tipo_cambio=tipo, detalle="d", origen="DOC"))
        self.db.commit()

    def test_claves(self):
        self.assertEqual(sc.clave_tipo("Occlusal Ant "), sc.clave_tipo("occlusal  ant"))
        self.assertEqual(sc.clave_doctor("Dr. Smith"), sc.clave_doctor("Dr  SMITH"))
        self.assertEqual(sc.clave_doctor("Dra. Pérez"), sc.clave_doctor("Perez"))
        self.assertNotEqual(sc.clave_doctor("Dr. Smith"), sc.clave_doctor("Dr. Smyth"))

    def test_tipos_sin_repetidos_con_la_grafia_mas_usada(self):
        self.cambio("Occlusal ant", 3); self.cambio("Occlusal Ant ", 1); self.cambio("occlusal  ant", 1); self.cambio("Midline", 2)
        tipos = sc.listar(self.db)["tipos"]
        self.assertEqual(tipos, ["Midline", "Occlusal ant"])

    def test_filtrar_por_tipo_incluye_las_variantes(self):
        self.cambio("Occlusal ant", 3); self.cambio("Occlusal Ant ", 2); self.cambio("Midline", 1)
        self.assertEqual(sc.listar(self.db, tipo="Occlusal ant")["total"], 5)
        self.assertEqual(sc.listar(self.db, tipo="Midline")["total"], 1)

    def test_doctores_sin_repetidos(self):
        area = md.DesignArea(nombre="N3 Prosthetic", formato="dual"); self.db.add(area); self.db.commit()
        hoja = md.DesignPreApprovedSheet(area_id=area.id, nombre="Hoja", orden=1); self.db.add(hoja); self.db.commit()
        self.db.add(md.DesignPreApprovedCentro(sheet_id=hoja.id, nombre="Dublin", span=4, orden=1))
        for i, n in enumerate(["Dr. Smith", "Dr Smith", "DR. SMITH", "Dra. Pérez", "Perez"]):
            self.db.add(md.DesignPreApprovedDoctor(sheet_id=hoja.id, nombre=n, orden=i + 1))
        self.db.commit()
        self.db.expire_all()
        # el centro agrupa los 4 primeros doctores: «Dr. Smith» (tres formas) y «Dra. Pérez»
        self.assertEqual(sc.doctores_de_centro(self.db, "Dublin"), ["Dr. Smith", "Dra. Pérez"])


if __name__ == "__main__":
    unittest.main()
