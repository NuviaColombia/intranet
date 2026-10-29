"""Reportes de QC por diseñador (28-oct-2026): «Principales hallazgos» cuenta por categoría igual que el Dashboard."""
import unittest

from app import services_design_reporte_qc as srq


class Categorias(unittest.TestCase):
    def test_cada_parte_cuenta_y_sin_titulo_es_otros(self):
        self.assertEqual(srq.categorias(["HTML: a\nTO PRINT: b", "TO PRINT: c", "PLATAFORMA: d; e", "suelto", ""]),
                         [("PLATAFORMA", 2), ("TO PRINT", 2), ("HTML", 1), ("Otros", 1)])


if __name__ == "__main__":
    unittest.main()
