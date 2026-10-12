"""
Genera app/static/design/oscuro_auto.css: la versión oscura de las hojas de estilo de Design (modo oscuro, pedido por
Rosember el 12-oct-2026). Toma cada regla con colores y escribe la misma regla bajo :root[data-ds-tema="oscuro"] con:
  * fondos claros → oscuros (conservan el tono: Hold sigue anaranjado, Ready amarillo…, pero oscuros),
  * texto oscuro → claro (los azules, rojos y verdes del texto se aclaran para leerse sobre fondo oscuro),
  * bordes claros → grises oscuros.
Los colores intermedios (botones azules con texto blanco, la barra superior) no cambian.
Volver a correrlo después de cambiar estilos de Design:  python scripts/generar_oscuro_design.py
Los ajustes hechos a mano van en app/static/design/oscuro.css (se carga después y manda).
"""
import colorsys
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "app"
FUENTES = [
    RAIZ / "static/style.css",            # estilos generales (solo cuentan en Design: el atributo está solo ahí)
    RAIZ / "static/design/schedule.css",
    RAIZ / "static/inicio/inicio.css",
    RAIZ / "static/inicio/editor.css",
]
PLANTILLAS = [RAIZ / "templates/base.html", RAIZ / "templates/design_schedule.html", RAIZ / "templates/design_parametros.html",
              RAIZ / "templates/design_inicio.html"]
SALIDA = RAIZ / "static/design/oscuro_auto.css"
# Nuvia Office: su propia salida; el "papel" (página de Word, diapositiva, miniaturas, presentación) queda como se diseñó
OFFICE = RAIZ / "static/office/office.css"
SALIDA_OFFICE = RAIZ / "static/office/oscuro_office.css"
OFFICE_PAPEL = re.compile(r"nvp-escena|nvp-mini-marco|\.hoja\b|nvp-show|nvp-mod-|\.nvp-h\b|nv-pl-mini|nv-estilo-item \.muestra")
PREFIJO = ':root[data-ds-tema="oscuro"]'

NOMBRES = {"white": "#ffffff", "black": "#000000"}
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b")
TEXTO = {"color", "-webkit-text-fill-color", "caret-color", "fill", "stroke", "text-decoration-color"}
FONDO = {"background", "background-color", "background-image"}
BORDE = {"border", "border-color", "border-top", "border-right", "border-bottom", "border-left", "border-top-color",
         "border-right-color", "border-bottom-color", "border-left-color", "outline", "outline-color", "column-rule",
         "border-inline-start", "border-inline-end", "border-block-start", "border-block-end"}


def a_rgb(tok: str):
    tok = NOMBRES.get(tok.lower(), tok)
    if tok.startswith("#"):
        h = tok[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else None
        return r, g, b, a
    n = [x.strip() for x in re.split(r"[,\s/]+", tok[tok.index("(") + 1:-1]) if x.strip()]
    if len(n) < 3 or any("%" in x for x in n[:3]) or any(not re.match(r"^[\d.]+%?$", x) for x in n):
        return None
    a = None if len(n) < 4 else (float(n[3][:-1]) / 100 if n[3].endswith("%") else float(n[3]))
    return float(n[0]), float(n[1]), float(n[2]), a


def a_texto(r, g, b, a):
    if a is None or a >= 0.999:
        return "#%02x%02x%02x" % (round(r), round(g), round(b))
    return "rgba(%d,%d,%d,%s)" % (round(r), round(g), round(b), ("%.3f" % a).rstrip("0").rstrip("."))


def transformar(tok: str, tipo: str) -> str:
    c = a_rgb(tok)
    if not c:
        return tok
    r, g, b, a = c
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    gris = s < 0.22   # grises y blanco: en oscuro toman el azul pizarra de la barra de Design (#111827)
    if gris:
        h = 0.61
    if tipo == "fondo":
        if a is not None and a < 0.999 and l > 0.5:   # velos claros semitransparentes (hover blanco): blanco tenue
            return a_texto(255, 255, 255, min(a, 0.08) if l > 0.9 else a * 0.5)
        if l >= 0.85:
            l2, s2 = 0.11 + (1 - l) * 0.55, (0.32 if gris else s * 0.55)
        elif l >= 0.55:
            l2, s2 = 0.17 + (0.85 - l) * 0.35, (0.28 if gris else s * 0.6)
        else:
            return tok
    elif tipo == "texto":
        if l > 0.5:
            return tok
        l2, s2 = 0.92 - l * 0.45, (0.14 if gris else min(s, 0.85))
    else:  # borde
        if l < 0.6:
            return tok
        l2, s2 = 0.2 + (1 - l) * 0.35, (0.2 if gris else s * 0.45)
    r2, g2, b2 = colorsys.hls_to_rgb(h, max(0, min(1, l2)), max(0, min(1, s2)))
    return a_texto(r2 * 255, g2 * 255, b2 * 255, a)


def tipo_de(prop: str):
    prop = prop.strip().lower()
    if prop in TEXTO:
        return "texto"
    if prop in FONDO:
        return "fondo"
    if prop in BORDE or prop.startswith("border") or prop.startswith("outline"):
        return "borde"
    if prop == "box-shadow":
        return "sombra"
    return None


def declaraciones(cuerpo: str) -> list:
    out = []
    for d in re.split(r";(?![^(]*\))", cuerpo):
        if ":" not in d:
            continue
        p, v = d.split(":", 1)
        t = tipo_de(p)
        if not t or "var(" in v and not COLOR.search(v):
            continue
        if t == "sombra":   # sombras: claras → negras suaves (en oscuro una sombra blanca brilla)
            nv = COLOR.sub(lambda m: (lambda c: "rgba(0,0,0,.45)" if c and colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)[1] > 0.7 else m.group(0))(a_rgb(m.group(0))), v)
        else:
            nv = COLOR.sub(lambda m: transformar(m.group(0), t), v)
        if nv != v:
            out.append(f"{p.strip()}:{nv.strip()}")
    return out


def prefijar(sel: str) -> str:
    partes = []
    for s in re.split(r",(?![^(]*\))", sel):
        s = s.strip()
        if not s:
            continue
        if s.startswith(":root"):
            s = PREFIJO + s[5:]
        elif re.match(r"^html\b", s):
            s = PREFIJO + s[4:]
        else:
            s = PREFIJO + " " + s
        partes.append(s)
    return ", ".join(partes)


def procesar(css: str, excluir=None) -> list:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            break
        sel = css[i:j].strip()
        prof, k = 1, j + 1
        while k < n and prof:
            prof += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        cuerpo = css[j + 1:k - 1]
        if sel.startswith("@media") or sel.startswith("@supports"):
            dentro = procesar(cuerpo, excluir)
            if dentro:
                out.append(sel + " {\n" + "\n".join("  " + x for x in dentro) + "\n}")
        elif sel.startswith("@"):
            pass  # @keyframes, @font-face…
        elif excluir is not None and excluir.search(sel):
            pass
        else:
            ds = declaraciones(cuerpo)
            if ds and sel:
                imp = [d if "!important" in d else d for d in ds]
                out.append(prefijar(sel) + " { " + "; ".join(imp) + "; }")
        i = k
    return out


# Colores escritos en atributos style="" (plantillas y JavaScript de Design): reglas por atributo con !important.
INLINE_FUENTES = [RAIZ / "templates/design_schedule.html", RAIZ / "templates/design_parametros.html", RAIZ / "templates/design_inicio.html",
                  RAIZ / "templates/base.html", RAIZ / "static/design/schedule.js", RAIZ / "static/design/seguimiento.js",
                  RAIZ / "static/design/asignaciones.js", RAIZ / "static/inicio/render.js", RAIZ / "static/inicio/editor.js"]
INLINE = re.compile(r"(?<![-\w])(color|background|background-color)\s*:\s*(#[0-9a-fA-F]{3,6}\b|white\b|black\b)")


def inline_reglas() -> list:
    vistos = {}
    for f in INLINE_FUENTES:
        for m in INLINE.finditer(f.read_text(encoding="utf-8")):
            vistos[m.group(0)] = (m.group(1), m.group(2))
    out = []
    for escrito, (prop, tok) in sorted(vistos.items(), key=lambda x: (len(x[1][1]), x[0])):  # los más largos al final (mandan)
        tipo = "texto" if prop == "color" else "fondo"
        nuevo = transformar(tok, tipo)
        if nuevo == tok:
            continue
        sel = f'{PREFIJO} [style*="{escrito}"]'
        if prop == "color":
            sel += f':not([style*="-{escrito}"])'
        out.append(f"{sel} {{ {'color' if prop == 'color' else 'background-color'}:{nuevo} !important; }}")
    return out


def main():
    bloques = []
    for f in FUENTES:
        r = procesar(f.read_text(encoding="utf-8"))
        bloques.append(f"/* ---- {f.relative_to(RAIZ)} ({len(r)} reglas) ---- */\n" + "\n".join(r))
    for f in PLANTILLAS:
        estilos = re.findall(r"<style[^>]*>(.*?)</style>", f.read_text(encoding="utf-8"), flags=re.S)
        r = procesar("\n".join(re.sub(r"\{\{.*?\}\}|\{%.*?%\}", "", e, flags=re.S) for e in estilos))
        bloques.append(f"/* ---- {f.relative_to(RAIZ)} <style> ({len(r)} reglas) ---- */\n" + "\n".join(r))
    r = inline_reglas()
    bloques.append(f"/* ---- colores en style=\"\" de plantillas y JS ({len(r)} reglas) ---- */\n" + "\n".join(r))
    SALIDA.write_text("/* GENERADO por scripts/generar_oscuro_design.py — no editar a mano (los ajustes van en oscuro.css). */\n"
                      + "\n\n".join(bloques) + "\n", encoding="utf-8")
    print(SALIDA, sum(b.count("{") for b in bloques), "reglas")
    r = procesar(OFFICE.read_text(encoding="utf-8"), OFFICE_PAPEL)
    SALIDA_OFFICE.write_text("/* GENERADO por scripts/generar_oscuro_design.py, no editar a mano (ajustes al final de office.css). */" + chr(10)
                             + chr(10).join(r) + chr(10), encoding="utf-8")
    print(SALIDA_OFFICE, len(r), "reglas")


if __name__ == "__main__":
    main()
