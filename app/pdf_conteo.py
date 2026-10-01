"""PDF firmados del Conteo inventario mensual (fpdf2, sin dependencias del sistema):
- Reporte del área en firme: las cantidades contadas y las 3 firmas electrónicas (manager, Director, testigo).
- Consolidado del mes: cada área en firme con sus 3 firmas y al final el total del mes."""
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


def _tres_firmas(doc: "_Doc", r, sufijo: str = "") -> None:
    """Manager (carga del conteo) · Director de Producción · Testigo, en una sola fila."""
    tercio = (doc.w - 24) / 3
    nom = lambda e: nombre_propio(e.nombre_completo) if e else ""
    firmas = [("Manager (carga del conteo)", nom(r.responsable), r.enviado_email, r.enviado_en, "SIN ENVIAR"),
              ("Director de produccion", nom(r.manager_firma), r.manager_firma_email, r.manager_firmado_en, "PENDIENTE DE FIRMA"),
              ("Testigo del conteo", nom(r.testigo), r.testigo_email, r.testigo_firmado_en, "PENDIENTE DE FIRMA")]
    if doc.get_y() > doc.h - 40:
        doc.add_page()
    y, fin = doc.get_y(), doc.get_y()
    for i, (titulo, nombre, correo, cuando, pendiente) in enumerate(firmas):
        doc.set_y(y)
        doc.firma(12 + i * tercio, tercio, titulo + sufijo, nombre, correo or "", _hora(cuando), pendiente)
        fin = max(fin, doc.get_y())
    doc.set_y(fin + 6)


def _hora(m: datetime | None) -> str:
    return (m - timedelta(hours=5)).strftime("%d/%m/%Y %I:%M %p") if m else ""


def _tablas_area(doc: "_Doc", r, bodegas, materiales, conteo: dict, danados: dict, titulo_bodega) -> None:
    """Con segundo conteo: Manager · Segundo conteo (cifra oficial) · Diferencia; sin él, solo la cantidad."""
    ancho = doc.w - 24
    segundo = getattr(r, "segundo_en", None) is not None
    man = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == "CONTEO"}
    man_d = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == "DANADO"}
    seg = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == "VCONTEO"}
    seg_d = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == "VDANADO"}

    def dif(a, b):
        d = round(b - a, 2)
        return ("+" if d > 0 else "") + _n(d)
    for b in bodegas:
        doc.titulo_seccion(titulo_bodega(b))
        if not segundo:
            filas = [[f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(conteo.get(f"{b.id}:{m.id}", 0))] for m in materiales]
            filas.append(["Disco de zirconia - DAÑADOS", _n(danados.get(str(b.id), 0))])
            doc.tabla(["Material", "Cantidad"], filas, [ancho * 0.75, ancho * 0.25])
            continue
        filas, marcar = [], []
        for m in materiales:
            k = f"{b.id}:{m.id}"
            a1, a2 = man.get(k, 0), seg.get(k, 0)
            filas.append([f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(a1), _n(a2), dif(a1, a2)])
            marcar.append(round(a2 - a1, 2) != 0)
        a1, a2 = man_d.get(str(b.id), 0), seg_d.get(str(b.id), 0)
        filas.append(["Disco de zirconia - DAÑADOS", _n(a1), _n(a2), dif(a1, a2)])
        marcar.append(round(a2 - a1, 2) != 0)
        doc.tabla(["Material", "Manager", "Segundo conteo", "Diferencia"], filas,
                  [ancho * 0.49, ancho * 0.17, ancho * 0.17, ancho * 0.17], marcar)


def acta_area(r, bodegas, materiales, meses: list[str]) -> bytes:
    """Reporte del área en firme: lo que se contó y las 3 firmas (manager, Director de Producción y testigo)."""
    mes = f"{meses[r.mes - 1]} {r.anio}"
    en_firme = r.estado == "VALIDADO"
    doc = _Doc("CONTEO INVENTARIO MENSUAL - REPORTE " + ("EN FIRME" if en_firme else "PENDIENTE DE FIRMAS"),
               f"{nombre_propio(r.area).upper()} - {mes.upper()}")
    doc.datos([("Area", nombre_propio(r.area)), ("Mes del reporte", mes),
               ("Responsable", nombre_propio(r.responsable.nombre_completo) if r.responsable else ""),
               ("Fecha reporte", r.fecha_reporte.strftime("%d/%m/%Y")),
               ("Director", nombre_propio(r.manager_firma.nombre_completo) if r.manager_firma else ""),
               ("Testigo", nombre_propio(r.testigo.nombre_completo) if r.testigo else ""),
               ("Estado", "EN FIRME (3 FIRMAS)" if en_firme else "PENDIENTE DE FIRMAS"),
               ("En firme desde", _hora(r.validado_en)),
               ("Segundo conteo", (nombre_propio(r.segundo_por.nombre_completo) + " - " + _hora(r.segundo_en)) if r.segundo_en and r.segundo_por else "Pendiente"),
               ("Cifra oficial", "Segundo conteo" if r.segundo_en else "Conteo del manager")])
    conteo = {f"{l.bodega_id}:{l.material_id}": l.cantidad for l in r.lineas if l.tipo == "CONTEO"}
    danados = {str(l.bodega_id): l.cantidad for l in r.lineas if l.tipo == "DANADO"}
    _tablas_area(doc, r, bodegas, materiales, conteo, danados, lambda b: f"Conteo - {b.nombre} - Bodega {b.codigo}")
    if r.novedad:
        doc.set_font("Helvetica", "", 8)
        doc.multi_cell(0, 4.5, _t(f"Novedad del manager: {r.novedad}"), new_x="LMARGIN", new_y="NEXT")
    doc.ln(8)
    _tres_firmas(doc, r)
    return bytes(doc.output())


def consolidado_mes(anio: int, mes: int, reportes, bodegas, materiales_de_area, finales: dict,
                    esperando: list[str], meses: list[str], sin_enviar: list[str] | None = None) -> bytes:
    """Consolidado firmado del mes: una sección por área en firme (su tabla y sus 3 firmas) y al final el total del mes."""
    nombre_mes = f"{meses[mes - 1]} {anio}"
    doc = _Doc("CONTEO INVENTARIO MENSUAL - CONSOLIDADO", nombre_mes.upper())
    ancho = doc.w - 24
    en_firme = [r for r in reportes if r.estado == "VALIDADO"]
    doc.datos([("Mes del reporte", nombre_mes), ("Areas en firme", str(len(en_firme)))])
    doc.set_font("Helvetica", "", 8.5)
    for etq, lista in (("Esperando firmas o devueltas", esperando), ("Sin enviar", sin_enviar or [])):
        doc.multi_cell(0, 4.8, _t(f"{etq}: " + (", ".join(nombre_propio(a) for a in lista) or "Ninguna")), new_x="LMARGIN", new_y="NEXT")
    doc.ln(3)
    for r in en_firme:
        if doc.get_y() > doc.h - 90:
            doc.add_page()
        doc.set_fill_color(*AZUL)
        doc.set_text_color(255, 255, 255)
        doc.set_font("Helvetica", "B", 10)
        doc.cell(0, 7, _t(f"  AREA: {nombre_propio(r.area).upper()}"), fill=True, new_x="LMARGIN", new_y="NEXT")
        doc.set_text_color(*TEXTO)
        doc.ln(2)
        conteo, danados = finales.get(r.id, ({}, {}))
        _tablas_area(doc, r, bodegas, materiales_de_area(r.area), conteo, danados, lambda b: f"{b.nombre} - Bodega {b.codigo}")
        if r.novedad:
            doc.set_font("Helvetica", "", 8)
            doc.multi_cell(0, 4.5, _t(f"Novedad: {r.novedad}"), new_x="LMARGIN", new_y="NEXT")
        doc.ln(6)
        _tres_firmas(doc, r)
        doc.ln(2)
    # Total del mes (cantidades de todas las áreas en firme)
    if en_firme:
        if doc.get_y() > doc.h - 60:
            doc.add_page()
        doc.set_fill_color(*AZUL)
        doc.set_text_color(255, 255, 255)
        doc.set_font("Helvetica", "B", 10)
        doc.cell(0, 7, _t(f"  TOTAL DEL MES - {nombre_mes.upper()} ({len(en_firme)} areas en firme)"), fill=True, new_x="LMARGIN", new_y="NEXT")
        doc.set_text_color(*TEXTO)
        doc.ln(2)
        todos = {}
        for r in en_firme:
            for m in materiales_de_area(r.area):
                todos[m.id] = m
        for b in bodegas:
            filas = []
            for m in sorted(todos.values(), key=lambda x: (x.orden, x.codigo)):
                filas.append([f"{b.prefijo}-{m.codigo}-{m.descripcion}", _n(sum(finales[r.id][0].get(f"{b.id}:{m.id}", 0) for r in en_firme))])
            filas.append(["Disco de zirconia - DAÑADOS", _n(sum(finales[r.id][1].get(str(b.id), 0) for r in en_firme))])
            doc.titulo_seccion(f"{b.nombre} - Bodega {b.codigo}")
            doc.tabla(["Material", "Total"], filas, [ancho * 0.75, ancho * 0.25])
    return bytes(doc.output())
