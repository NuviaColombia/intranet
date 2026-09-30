"""PDF firmados del Conteo inventario mensual (fpdf2, sin dependencias del sistema):
- Acta del área: conteo del manager vs validación, diferencias y las dos firmas electrónicas.
- Consolidado del mes: lo validado por cada área, totales y las firmas de cada área y de quien validó."""
from datetime import datetime, timedelta
from pathlib import Path
from fpdf import FPDF
from .formato import nombre_propio

AZUL, GRIS, TEXTO = (26, 54, 93), (241, 245, 249), (17, 24, 39)
LOGO = Path(__file__).parent / "static" / "logos" / "nuvia-smiles.png"


def _t(texto) -> str:
    """Texto seguro para las fuentes base del PDF (latin-1): lo que no cabe se cambia por un equivalente."""
    s = str(texto if texto is not None else "")
    for a, b in (("–", "-"), ("—", "-"), ("’", "'"), ("“", '"'), ("”", '"'), ("…", "..."), ("✅", ""), ("⚠️", ""), ("·", "-")):
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


def _n(v) -> str:
    return f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


class _Doc(FPDF):
    def __init__(self, titulo: str, subtitulo: str, horizontal: bool = False):
        super().__init__(orientation="L" if horizontal else "P", unit="mm", format="Letter")
        self.titulo, self.subtitulo = titulo, subtitulo
        self.set_auto_page_break(True, margin=16)
        self.set_margins(12, 12, 12)
        self.alias_nb_pages()
        self.add_page()

    def header(self):
        ancho, logo = self.w - 24, 46
        self.set_draw_color(203, 213, 225)
        self.rect(12, 10, ancho, 18)
        self.line(12 + logo, 10, 12 + logo, 28)  # casilla del logo, como el formato F-PRO-40
        if LOGO.exists():
            self.image(str(LOGO), 16, 13, w=logo - 8)
        self.set_xy(12 + logo, 12)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(*AZUL)
        self.cell(ancho - logo, 7, _t(self.titulo), align="C")
        self.set_xy(12 + logo, 19)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(71, 85, 105)
        self.cell(ancho - logo, 6, _t(self.subtitulo), align="C")
        self.set_text_color(*TEXTO)
        self.set_y(32)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(107, 114, 128)
        hora = (datetime.utcnow() - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p")
        self.cell(0, 5, _t(f"Generado por la intranet Nuvia el {hora}"), align="L")
        self.cell(0, 5, f"Pagina {self.page_no()} de {{nb}}", align="R")

    def datos(self, pares: list[tuple[str, str]]):
        """Cuadro de datos en 2 columnas (etiqueta gris / valor)."""
        ancho = (self.w - 24) / 2
        for i in range(0, len(pares), 2):
            for etq, val in pares[i:i + 2]:
                self.set_font("Helvetica", "B", 8)
                self.set_fill_color(*GRIS)
                self.set_text_color(71, 85, 105)
                self.cell(ancho * 0.40, 7, _t(etq.upper()), border=1, fill=True)
                self.set_font("Helvetica", "B", 8.5)
                self.set_text_color(*TEXTO)
                self.cell(ancho * 0.60, 7, _t(val)[:70], border=1)
            self.ln(7)
        self.ln(3)

    def titulo_seccion(self, texto: str):
        self.set_font("Helvetica", "B", 9.5)
        self.set_text_color(*AZUL)
        self.cell(0, 7, _t(texto.upper()), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(*TEXTO)

    def tabla(self, cabeceras: list[str], filas: list[list[str]], anchos: list[float], marcar: list[bool] | None = None,
              alinear_primera_izq: bool = True):
        def cabecera():
            self.set_font("Helvetica", "B", 7.5)
            self.set_fill_color(*AZUL)
            self.set_text_color(255, 255, 255)
            for c, w in zip(cabeceras, anchos):
                self.cell(w, 6.5, _t(c.upper()), border=1, fill=True, align="C")
            self.ln(6.5)
            self.set_text_color(*TEXTO)
        cabecera()
        self.set_font("Helvetica", "", 8)
        for i, fila in enumerate(filas):
            if self.get_y() > self.h - 22:
                self.add_page()
                cabecera()
                self.set_font("Helvetica", "", 8)
            mal = bool(marcar and marcar[i])
            self.set_fill_color(254, 242, 242) if mal else self.set_fill_color(255, 255, 255)
            self.set_text_color(153, 27, 27) if mal else self.set_text_color(*TEXTO)
            for j, (v, w) in enumerate(zip(fila, anchos)):
                self.cell(w, 6, _t(v), border=1, fill=True, align="L" if (j == 0 and alinear_primera_izq) else "R")
            self.ln(6)
        self.set_text_color(*TEXTO)
        self.ln(3)

    def firma(self, x: float, ancho: float, titulo: str, nombre: str, correo: str, cuando: str, pendiente: str):
        """Firma electrónica: arriba de la línea nombre, fecha y hora; abajo el título y el correo."""
        y = self.get_y()
        self.set_xy(x, y)
        if correo:
            self.set_font("Helvetica", "B", 7.5)
            self.set_text_color(16, 185, 129)
            self.cell(ancho, 4, "FIRMADO ELECTRONICAMENTE", align="C", new_x="LEFT", new_y="NEXT")
            self.set_text_color(*TEXTO)
            self.set_font("Helvetica", "B", 8)
            self.cell(ancho, 4, _t(nombre.upper()), align="C", new_x="LEFT", new_y="NEXT")
            self.set_font("Helvetica", "B", 7.5)
            self.cell(ancho, 4, _t(cuando), align="C", new_x="LEFT", new_y="NEXT")
        else:
            self.ln(4)
            self.set_x(x)
            self.set_font("Helvetica", "B", 7.5)
            self.set_text_color(146, 64, 14)
            self.cell(ancho, 4, _t(pendiente), align="C", new_x="LEFT", new_y="NEXT")
            self.set_text_color(*TEXTO)
            self.ln(4)
            self.set_x(x)
        self.set_x(x)
        self.set_draw_color(17, 24, 39)
        self.line(x + 4, self.get_y() + 1, x + ancho - 4, self.get_y() + 1)
        self.ln(2)
        self.set_x(x)
        self.set_font("Helvetica", "B", 8)
        self.cell(ancho, 4.5, _t(titulo.upper()), align="C", new_x="LEFT", new_y="NEXT")
        self.set_font("Helvetica", "", 7.5)
        self.cell(ancho, 4, _t(correo), align="C", new_x="LEFT", new_y="NEXT")
        return y


def _cuatro_firmas(doc: "_Doc", r, sufijo: str = "") -> None:
    """Carga · Manager del área (fila 1) y Testigo · Validación (fila 2)."""
    mitad = (doc.w - 24) / 2
    nom = lambda e: nombre_propio(e.nombre_completo) if e else ""
    filas = [(("Carga del conteo", nom(r.responsable), r.enviado_email, r.enviado_en, "SIN ENVIAR"),
              ("Manager del area", nom(r.manager_firma), r.manager_firma_email, r.manager_firmado_en, "PENDIENTE DE FIRMA")),
             (("Testigo del conteo", nom(r.testigo), r.testigo_email, r.testigo_firmado_en, "PENDIENTE DE FIRMA"),
              ("Validacion", nom(r.validado_por), r.validado_email, r.validado_en, "PENDIENTE DE VALIDACION"))]
    for izq, der in filas:
        if doc.get_y() > doc.h - 38:
            doc.add_page()
        y = doc.firma(12, mitad, izq[0] + sufijo, izq[1], izq[2] or "", _hora(izq[3]), izq[4])
        fin = doc.get_y()
        doc.set_y(y)
        doc.firma(12 + mitad, mitad, der[0] + sufijo, der[1], der[2] or "", _hora(der[3]), der[4])
        doc.set_y(max(fin, doc.get_y()) + 6)


def _hora(m: datetime | None) -> str:
    return (m - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if m else ""


def acta_area(r, bodegas, materiales, comparacion: dict, meses: list[str]) -> bytes:
    """Acta del área: conteo del manager vs validación con las firmas del manager y del validador."""
    mes = f"{meses[r.mes - 1]} {r.anio}"
    doc = _Doc("CONTEO INVENTARIO MENSUAL - ACTA DE VALIDACION", f"{nombre_propio(r.area).upper()} - {mes.upper()}")
    doc.datos([("Area", nombre_propio(r.area)), ("Mes del reporte", mes),
               ("Responsable", nombre_propio(r.responsable.nombre_completo) if r.responsable else ""),
               ("Fecha reporte", r.fecha_reporte.strftime("%d/%m/%Y")),
               ("Manager del area", nombre_propio(r.manager_firma.nombre_completo) if r.manager_firma else ""),
               ("Testigo", nombre_propio(r.testigo.nombre_completo) if r.testigo else ""),
               ("Validado por", nombre_propio(r.validado_por.nombre_completo) if r.validado_por else ""),
               ("Estado", "VALIDADO" if r.estado == "VALIDADO" else r.estado)])
    filas_cmp = comparacion.get("filas", {})
    ancho = doc.w - 24
    for b in bodegas:
        filas, marcar = [], []
        for m in materiales:
            f = filas_cmp.get(f"{b.id}:{m.id}", {"manager": 0, "validacion": 0, "diferencia": 0, "ok": True})
            filas.append([f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(f["manager"]), _n(f["validacion"]),
                          ("+" if f["diferencia"] > 0 else "") + _n(f["diferencia"])])
            marcar.append(not f["ok"])
        f = filas_cmp.get(f"{b.id}:danados", {"manager": 0, "validacion": 0, "diferencia": 0, "ok": True})
        filas.append(["Disco de zirconia - DAÑADOS", _n(f["manager"]), _n(f["validacion"]), ("+" if f["diferencia"] > 0 else "") + _n(f["diferencia"])])
        marcar.append(not f["ok"])
        doc.titulo_seccion(f"Conteo - {b.nombre} - Bodega {b.codigo}")
        doc.tabla(["Material", "Manager", "Validacion", "Diferencia"], filas, [ancho * 0.52, ancho * 0.16, ancho * 0.16, ancho * 0.16], marcar)
    doc.set_font("Helvetica", "", 8)
    tol = comparacion.get("tolerancia", 0)
    dif = comparacion.get("diferencias", 0)
    doc.multi_cell(0, 4.5, _t(f"Tolerancia aceptada: {tol:g}. Diferencias fuera de tolerancia: {dif}."), new_x="LMARGIN", new_y="NEXT")
    if r.novedad:
        doc.multi_cell(0, 4.5, _t(f"Novedad del manager: {r.novedad}"), new_x="LMARGIN", new_y="NEXT")
    doc.ln(8)
    _cuatro_firmas(doc, r)
    return bytes(doc.output())


def consolidado_mes(anio: int, mes: int, reportes, bodegas, materiales_de_area, comparaciones: dict, finales: dict,
                    pendientes: list[str], meses: list[str], sin_enviar: list[str] | None = None) -> bytes:
    """Consolidado firmado del mes: una sección por área validada (su tabla y sus dos firmas) y al final el total del mes."""
    nombre_mes = f"{meses[mes - 1]} {anio}"
    doc = _Doc("CONTEO INVENTARIO MENSUAL - CONSOLIDADO", nombre_mes.upper())
    ancho = doc.w - 24
    validados = [r for r in reportes if r.estado == "VALIDADO"]
    doc.datos([("Mes del reporte", nombre_mes), ("Areas validadas", str(len(validados)))])
    doc.set_font("Helvetica", "", 8.5)
    for etq, lista in (("Pendientes de validar", pendientes), ("Sin enviar", sin_enviar or [])):
        doc.multi_cell(0, 4.8, _t(f"{etq}: " + (", ".join(nombre_propio(a) for a in lista) or "Ninguna")), new_x="LMARGIN", new_y="NEXT")
    doc.ln(3)
    mitad = ancho / 2
    for r in validados:
        comp = comparaciones.get(r.id, {}).get("filas", {})
        if doc.get_y() > doc.h - 90:
            doc.add_page()
        doc.set_fill_color(*AZUL)
        doc.set_text_color(255, 255, 255)
        doc.set_font("Helvetica", "B", 10)
        doc.cell(0, 7, _t(f"  AREA: {nombre_propio(r.area).upper()}"), fill=True, new_x="LMARGIN", new_y="NEXT")
        doc.set_text_color(*TEXTO)
        doc.ln(2)
        for b in bodegas:
            filas, marcar = [], []
            for m in materiales_de_area(r.area):
                f = comp.get(f"{b.id}:{m.id}", {"manager": 0, "validacion": 0, "diferencia": 0, "ok": True})
                filas.append([f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(f["manager"]), _n(f["validacion"]),
                              ("+" if f["diferencia"] > 0 else "") + _n(f["diferencia"])])
                marcar.append(not f["ok"])
            f = comp.get(f"{b.id}:danados", {"manager": 0, "validacion": 0, "diferencia": 0, "ok": True})
            filas.append(["Disco de zirconia - DAÑADOS", _n(f["manager"]), _n(f["validacion"]), ("+" if f["diferencia"] > 0 else "") + _n(f["diferencia"])])
            marcar.append(not f["ok"])
            doc.titulo_seccion(f"{b.nombre} - Bodega {b.codigo}")
            doc.tabla(["Material", "Manager", "Validacion", "Diferencia"], filas, [ancho * 0.52, ancho * 0.16, ancho * 0.16, ancho * 0.16], marcar)
        if r.novedad:
            doc.set_font("Helvetica", "", 8)
            doc.multi_cell(0, 4.5, _t(f"Novedad: {r.novedad}"), new_x="LMARGIN", new_y="NEXT")
        doc.ln(6)
        _cuatro_firmas(doc, r, f" - {nombre_propio(r.area)}")
        doc.ln(2)
    # Total del mes (cantidades validadas de todas las áreas)
    if validados:
        if doc.get_y() > doc.h - 60:
            doc.add_page()
        doc.set_fill_color(*AZUL)
        doc.set_text_color(255, 255, 255)
        doc.set_font("Helvetica", "B", 10)
        doc.cell(0, 7, _t(f"  TOTAL DEL MES - {nombre_mes.upper()} ({len(validados)} areas validadas)"), fill=True, new_x="LMARGIN", new_y="NEXT")
        doc.set_text_color(*TEXTO)
        doc.ln(2)
        todos = {}
        for r in validados:
            for m in materiales_de_area(r.area):
                todos[m.id] = m
        for b in bodegas:
            filas = []
            for m in sorted(todos.values(), key=lambda x: (x.orden, x.codigo)):
                filas.append([f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(sum(finales[r.id][0].get(f"{b.id}:{m.id}", 0) for r in validados))])
            filas.append(["Disco de zirconia - DAÑADOS", _n(sum(finales[r.id][1].get(str(b.id), 0) for r in validados))])
            doc.titulo_seccion(f"{b.nombre} - Bodega {b.codigo}")
            doc.tabla(["Material", "Total"], filas, [ancho * 0.75, ancho * 0.25])
    return bytes(doc.output())
