"""Accounts Payable: reglas de negocio (estados, permisos de aprobación, import del histórico de Excel).
Lo más delicado es no inventar datos del histórico de Carlos/Leslie/Oscar -- un estado mal clasificado
dispara (o deja de disparar) avisos reales a personas reales."""
import io
import unittest
from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app import models  # noqa: F401
from app import models_pagos  # noqa: F401
from app.models import Empleado
from app.models_pagos import CuentaPorPagar, ESTADO_PENDIENTE, ESTADO_APROBADO, ESTADO_PAGADO, ESTADO_OTRO
from app import services_pagos_ap as sa


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, autoflush=False)()


def _empleado(db, email, rol="empleado"):
    e = Empleado(nombres="T", apellidos="P", email=email, rol=rol, empresa="Nuvia Smiles Colombia SAS",
                activo=1, cargo="x", area="x", identificacion=email[:10])
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


class Permisos(unittest.TestCase):
    def test_oscar_y_leslie_pueden_aprobar(self):
        self.assertTrue(sa.puede_aprobar(Empleado(email="oscaralmanza@nuviasmiles.com", rol="empleado")))
        self.assertTrue(sa.puede_aprobar(Empleado(email="leslie.manotas@nuvia.app", rol="empleado")))

    def test_superadmin_puede_aprobar_aunque_no_sea_leslie_u_oscar(self):
        self.assertTrue(sa.puede_aprobar(Empleado(email="otro@nuviasmiles.com", rol="superadmin")))

    def test_un_empleado_cualquiera_no_puede_aprobar(self):
        self.assertFalse(sa.puede_aprobar(Empleado(email="otro@nuviasmiles.com", rol="admin")))
        self.assertFalse(sa.puede_aprobar(Empleado(email="otro@nuviasmiles.com", rol="empleado")))


class FlujoEstados(unittest.TestCase):
    def setUp(self):
        self.db = _db()
        self.actor = _empleado(self.db, "contabilidad@nuviasmiles.com")
        self.oscar = _empleado(self.db, "oscaralmanza@nuviasmiles.com")

    def test_crear_queda_pendiente(self):
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Uno", 100000)
        self.assertEqual(c.estado, ESTADO_PENDIENTE)
        self.assertEqual(c.proveedor_nombre, "PROVEEDOR UNO")

    def test_crear_sin_proveedor_o_valor_falla(self):
        with self.assertRaises(sa.Conflicto):
            sa.crear(self.db, self.actor, "Smiles", "", 100000)
        with self.assertRaises(sa.Conflicto):
            sa.crear(self.db, self.actor, "Smiles", "Proveedor", 0)
        with self.assertRaises(sa.Conflicto):
            sa.crear(self.db, self.actor, "OtraEmpresa", "Proveedor", 100)

    def test_aprobar_marca_quien_y_cuando(self):
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Dos", 50000)
        c = sa.aprobar(self.db, self.oscar, c.id)
        self.assertEqual(c.estado, ESTADO_APROBADO)
        self.assertEqual(c.aprobado_por, "Oscar")
        self.assertEqual(c.fecha_aprobacion, date.today())

    def test_no_se_puede_aprobar_dos_veces(self):
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Tres", 50000)
        sa.aprobar(self.db, self.oscar, c.id)
        with self.assertRaises(sa.Conflicto):
            sa.aprobar(self.db, self.oscar, c.id)

    def test_rechazar_pasa_a_otro_con_motivo(self):
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Cuatro", 50000)
        c = sa.rechazar(self.db, self.oscar, c.id, "No corresponde a este mes")
        self.assertEqual(c.estado, ESTADO_OTRO)
        self.assertEqual(c.estado_original, "Rejected")
        self.assertIn("No corresponde a este mes", c.comentarios)

    def test_pagar_requiere_estar_aprobado(self):
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Cinco", 50000)
        with self.assertRaises(sa.Conflicto):
            sa.marcar_pagado(self.db, self.actor, c.id)
        sa.aprobar(self.db, self.oscar, c.id)
        c = sa.marcar_pagado(self.db, self.actor, c.id)
        self.assertEqual(c.estado, ESTADO_PAGADO)
        self.assertEqual(c.fecha_pago, date.today())

    def test_listar_y_resumen_filtran_por_estado_y_empresa(self):
        sa.crear(self.db, self.actor, "Smiles", "A", 1000)
        design = sa.crear(self.db, self.actor, "Design", "B", 2000)
        sa.aprobar(self.db, self.oscar, design.id)
        pendientes = sa.listar(self.db, estado=ESTADO_PENDIENTE)
        self.assertEqual(len(pendientes), 1)
        self.assertEqual(sa.listar(self.db, empresa="Design")[0]["empresa"], "Design")
        resumen = sa.resumen_conteos(self.db)
        self.assertEqual(resumen[ESTADO_PENDIENTE], 1)
        self.assertEqual(resumen[ESTADO_APROBADO], 1)
        self.assertEqual(resumen["TODOS"], 2)

    def test_crear_no_revienta_aunque_cliq_y_push_no_esten_configurados(self):
        # Zoho Cliq y el push no están configurados en pruebas -- no debe lanzar, solo avisar en consola.
        c = sa.crear(self.db, self.actor, "Smiles", "Proveedor Seis", 1000)
        self.assertEqual(c.estado, ESTADO_PENDIENTE)


class Clasificacion(unittest.TestCase):
    def test_paid_y_ap(self):
        self.assertEqual(sa._clasificar("Paid"), (ESTADO_PAGADO, ""))
        self.assertEqual(sa._clasificar("paid "), (ESTADO_PAGADO, ""))
        self.assertEqual(sa._clasificar("AP"), (ESTADO_APROBADO, ""))

    def test_casos_raros_quedan_como_otro_con_el_texto_original(self):
        self.assertEqual(sa._clasificar("Rejected"), (ESTADO_OTRO, "Rejected"))
        self.assertEqual(sa._clasificar("Postponed"), (ESTADO_OTRO, "Postponed"))
        self.assertEqual(sa._clasificar("Credit"), (ESTADO_OTRO, "Credit"))
        self.assertEqual(sa._clasificar("Quote"), (ESTADO_OTRO, "Quote"))
        self.assertEqual(sa._clasificar("-"), (ESTADO_OTRO, "-"))
        self.assertEqual(sa._clasificar(None), (ESTADO_OTRO, ""))


class ParseoNumeros(unittest.TestCase):
    def test_valor_con_comas_de_texto(self):
        self.assertEqual(sa._num("37,156,700"), 37156700.0)

    def test_valor_numerico(self):
        self.assertEqual(sa._num(2923741.0), 2923741.0)

    def test_valor_none_es_cero(self):
        self.assertEqual(sa._num(None), 0.0)

    def test_usd_error_de_formula_es_none(self):
        self.assertIsNone(sa._usd("#VALUE!"))
        self.assertIsNone(sa._usd(None))
        self.assertEqual(sa._usd(769.4), 769.4)

    def test_nit_float_entero_a_texto_sin_decimal(self):
        self.assertEqual(sa._texto(900147238.0), "900147238")
        self.assertEqual(sa._texto(None), "")


class ImportarExcel(unittest.TestCase):
    """Construye un .xlsx mínimo con la misma forma que ACCOUNTS PAYABLE.xlsx (9 filas de resumen,
    fila 10 encabezado, datos desde la fila 11) para probar el import sin depender del archivo real."""

    def _xlsx(self, filas_ap_smiles, filas_ap_design=None):
        import openpyxl
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        def llenar(nombre, filas):
            ws = wb.create_sheet(nombre)
            for _ in range(9):
                ws.append([None])
            ws.append(["+", "TYPE OF MOVIMENT", "ID", "PROVEEDOR", "CATEGORY", "DETAIL", "DOCUMENT", "VALUE",
                      "USD", "EXPIRATION DATE", "APROVAL", "STATE", "PAYMENT DAY", "COMMENTS"])
            for f in filas:
                ws.append(f)

        llenar("AP SMILES", filas_ap_smiles)
        if filas_ap_design is not None:
            llenar("AP DESIGN", filas_ap_design)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def setUp(self):
        self.db = _db()
        self.admin = _empleado(self.db, "admin@nuviasmiles.com", rol="superadmin")

    def test_importa_pagados_y_aprobados_y_omite_lo_demas(self):
        filas = [
            [datetime(2023, 9, 11), "For Payment", 900147238.0, "APORTES EN LINEA", None, "Pago seg social", None,
            "37,156,700", "#VALUE!", None, None, "Paid", datetime(2023, 9, 11), None],
            [datetime(2023, 9, 18), "For Payment", 901537808.0, "GEOMETRICA SAS", None, "Mantenimiento", None,
            185919.0, 48.9, None, None, "AP", None, None],
            [datetime(2023, 9, 20), "For Payment", None, "PROVEEDOR X", None, "Algo raro", None, 5000.0,
            None, None, None, "Rejected", None, None],
        ]
        resumen = sa.importar_excel(self.db, self.admin, self._xlsx(filas))
        self.assertEqual(resumen["leidas"], 3)
        self.assertEqual(resumen["importadas"], 3)
        self.assertEqual(resumen["duplicadas"], 0)
        filas_db = self.db.query(CuentaPorPagar).order_by(CuentaPorPagar.id).all()
        self.assertEqual([f.estado for f in filas_db], [ESTADO_PAGADO, ESTADO_APROBADO, ESTADO_OTRO])
        self.assertEqual(filas_db[0].valor, 37156700.0)
        self.assertIsNone(filas_db[0].valor_usd)
        self.assertEqual(filas_db[2].estado_original, "Rejected")

    def test_reimportar_no_duplica(self):
        filas = [[datetime(2023, 9, 11), "For Payment", 900147238.0, "APORTES EN LINEA", None, "Pago seg social",
                 None, 100000.0, None, None, None, "Paid", None, None]]
        contenido = self._xlsx(filas)
        r1 = sa.importar_excel(self.db, self.admin, contenido)
        r2 = sa.importar_excel(self.db, self.admin, contenido)
        self.assertEqual(r1["importadas"], 1)
        self.assertEqual(r2["importadas"], 0)
        self.assertEqual(r2["duplicadas"], 1)
        self.assertEqual(self.db.query(CuentaPorPagar).count(), 1)

    def test_fila_vacia_se_omite(self):
        filas = [[None] * 14]
        resumen = sa.importar_excel(self.db, self.admin, self._xlsx(filas))
        self.assertEqual(resumen["leidas"], 0)
        self.assertEqual(resumen["importadas"], 0)

    def test_dos_empresas_quedan_separadas(self):
        smiles = [[datetime(2023, 9, 11), "For Payment", 1.0, "A", None, "Detalle A", None, 1000.0, None, None, None, "Paid", None, None]]
        design = [[datetime(2023, 9, 11), "For Payment", 2.0, "B", None, "Detalle B", None, 2000.0, None, None, None, "AP", None, None]]
        resumen = sa.importar_excel(self.db, self.admin, self._xlsx(smiles, design))
        self.assertEqual(resumen["importadas"], 2)
        self.assertEqual({f.empresa for f in self.db.query(CuentaPorPagar).all()}, {"Smiles", "Design"})


if __name__ == "__main__":
    unittest.main()
