"""Compras (inventario de Items): réplica de SST -- catálogo con búsqueda/SKU/categoría, carga
masiva por Excel y el flujo de ingreso/solicitud que deriva el stock sin tabla de saldo cacheado."""
import unittest
from datetime import date
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app import models  # noqa: F401
from app import models_compras  # noqa: F401
from app.models import Empleado
from app.models_compras import CompraItem, CATEGORIAS_COMPRAS
from app import services_compras as sc


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False)()


def _empleado(db, email="super@nuviasmiles.com", rol="superadmin"):
    e = Empleado(nombres="T", apellidos="P", email=email, rol=rol, empresa="Nuvia Smiles Colombia SAS",
                activo=1, cargo="x", area="x", identificacion=email[:10])
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def _xlsx(filas, encabezados=("nombre", "sku", "categoria", "unidad_conteo", "presentacion")):
    wb = Workbook()
    ws = wb.active
    ws.append(list(encabezados))
    for fila in filas:
        ws.append(fila)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


class Catalogo(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.db.add_all([
            CompraItem(nombre="Papel higiénico x12", sku="ASC-001", categoria="Aseo y Cafetería"),
            CompraItem(nombre="Mouse inalámbrico", sku="TEC-014", categoria="Tecnología"),
            CompraItem(nombre="Resma de papel carta", sku="OTR-003", categoria="Otros"),
        ])
        self.db.commit()

    def test_buscar_por_nombre(self):
        self.assertEqual([i.nombre for i in sc.catalogo(self.db, buscar="mouse")], ["Mouse inalámbrico"])

    def test_buscar_por_sku(self):
        self.assertEqual([i.nombre for i in sc.catalogo(self.db, buscar="ASC-001")], ["Papel higiénico x12"])

    def test_filtrar_por_categoria(self):
        self.assertEqual([i.nombre for i in sc.catalogo(self.db, categoria="Tecnología")], ["Mouse inalámbrico"])

    def test_sin_filtros_devuelve_todo(self):
        self.assertEqual(len(sc.catalogo(self.db)), 3)


class CrearEditarItem(unittest.TestCase):
    def setUp(self):
        self.db = _db()

    def test_crear_item_con_sku_y_categoria(self):
        it = sc.crear_item(self.db, "Guantes", "GTE-01", "Aseo y Cafetería", "UND", 1)
        self.assertEqual(it.sku, "GTE-01")
        self.assertEqual(it.categoria, "Aseo y Cafetería")

    def test_categoria_invalida_cae_a_otros(self):
        it = sc.crear_item(self.db, "Item raro", "", "Categoria Inventada", "UND", 1)
        self.assertEqual(it.categoria, "Otros")

    def test_no_duplica_nombre(self):
        sc.crear_item(self.db, "Item", "", "Otros", "UND", 1)
        self.assertIsNone(sc.crear_item(self.db, "Item", "", "Otros", "UND", 1))

    def test_editar_item_actualiza_sku_y_categoria(self):
        it = sc.crear_item(self.db, "Item", "VIEJO", "Otros", "UND", 1)
        sc.editar_item(self.db, it.id, "Item", "NUEVO", "Tecnología", "UND", 1)
        self.db.refresh(it)
        self.assertEqual(it.sku, "NUEVO")
        self.assertEqual(it.categoria, "Tecnología")


class ImportarExcel(unittest.TestCase):
    def setUp(self):
        self.db = _db()

    def test_fila_valida_crea_item(self):
        contenido = _xlsx([["Teclado", "TEC-020", "Tecnología", "UND", 1]])
        resultado = sc.importar_items_excel(self.db, contenido)
        self.assertEqual(resultado["creados"], 1)
        self.assertEqual(resultado["errores"], [])
        item = self.db.query(CompraItem).filter_by(nombre="Teclado").first()
        self.assertEqual(item.categoria, "Tecnología")

    def test_categoria_invalida_da_error_de_fila(self):
        contenido = _xlsx([["Item malo", "", "No Existe", "UND", 1]])
        resultado = sc.importar_items_excel(self.db, contenido)
        self.assertEqual(resultado["creados"], 0)
        self.assertEqual(len(resultado["errores"]), 1)
        self.assertIn("Fila 2", resultado["errores"][0])

    def test_categoria_vacia_usa_otros(self):
        contenido = _xlsx([["Item simple", "", "", "UND", 1]])
        resultado = sc.importar_items_excel(self.db, contenido)
        self.assertEqual(resultado["creados"], 1)
        item = self.db.query(CompraItem).filter_by(nombre="Item simple").first()
        self.assertEqual(item.categoria, "Otros")

    def test_upsert_por_nombre_no_duplica(self):
        sc.importar_items_excel(self.db, _xlsx([["Item", "V1", "Otros", "UND", 1]]))
        resultado = sc.importar_items_excel(self.db, _xlsx([["Item", "V2", "Otros", "UND", 1]]))
        self.assertEqual(resultado["creados"], 0)
        self.assertEqual(resultado["actualizados"], 1)
        self.assertEqual(self.db.query(CompraItem).filter_by(nombre="Item").count(), 1)
        item = self.db.query(CompraItem).filter_by(nombre="Item").first()
        self.assertEqual(item.sku, "V2")

    def test_falta_columna_nombre_no_truena(self):
        contenido = _xlsx([["X", "Y"]], encabezados=("sku", "categoria"))
        resultado = sc.importar_items_excel(self.db, contenido)
        self.assertEqual(resultado["creados"], 0)
        self.assertTrue(resultado["errores"])

    def test_categoria_valida_confirmadas(self):
        self.assertEqual(CATEGORIAS_COMPRAS, ("Aseo y Cafetería", "Tecnología", "Otros"))


class FlujoStock(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.user = _empleado(self.db)
        self.item = sc.crear_item(self.db, "Papel", "ASC-001", "Aseo y Cafetería", "PACK", 12)

    def test_stock_sube_con_ingreso_aprobado(self):
        ingreso = sc.crear_ingreso(self.db, self.user, self.item.id, 5, "PACK", date.today())
        self.assertEqual(sc.stock_a_fecha(self.db, date.today()).get(self.item.id, 0), 0)  # pendiente, no cuenta
        sc.aprobar_ingreso(self.db, ingreso, self.user)
        self.assertEqual(sc.stock_a_fecha(self.db, date.today())[self.item.id], 60.0)

    def test_stock_baja_con_solicitud_entregada(self):
        ingreso = sc.crear_ingreso(self.db, self.user, self.item.id, 5, "PACK", date.today())
        sc.aprobar_ingreso(self.db, ingreso, self.user)
        solicitud = sc.crear_solicitud(self.db, self.user, [{"itemId": self.item.id, "cantidad": 10, "unidadUsada": "UND"}])
        error = sc.entregar_solicitud(self.db, solicitud, self.user)
        self.assertIsNone(error)
        self.assertEqual(sc.stock_a_fecha(self.db, date.today())[self.item.id], 50.0)

    def test_entrega_rechaza_si_no_hay_stock_suficiente(self):
        solicitud = sc.crear_solicitud(self.db, self.user, [{"itemId": self.item.id, "cantidad": 1000, "unidadUsada": "UND"}])
        error = sc.entregar_solicitud(self.db, solicitud, self.user)
        self.assertIsNotNone(error)
        self.assertEqual(solicitud.estado, "pendiente")


if __name__ == "__main__":
    unittest.main()
