"""
Integra Desktop\\control-proyectos (Control de Proyectos y Protocolos) como Design › Development (Rosember, 19-oct-2026).

Genera app/static/design/development/{domain.js, api.js, app.js, development.css} a partir de public/ del proyecto:
  * CSS: todo queda bajo .cpapp (no choca con style.css de la intranet), colores de la intranet y modo oscuro de Design.
  * api.js: el conector REST del proyecto (api-http.js) apuntando a /design/api/dev, más la lista de responsables.
  * app.js: responsables = desplegable de personas de Nuvia Design; sin «Restaurar demo», «Importar» ni «Modelo y API»;
    evidencias ≤ 1 MB (la base tiene 500 MB) y descarga con su tipo real.
Si llega una versión nueva del proyecto: copiarla al Escritorio y correr
    python scripts/integrar_development.py [ruta\\control-proyectos]
Cada reemplazo verifica que el texto original exista; si falla, el proyecto cambió y hay que revisar ese punto a mano.
"""
import re
import sys
from pathlib import Path

ORIGEN = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\rosember\Desktop\control-proyectos") / "public"
DESTINO = Path(__file__).resolve().parent.parent / "app" / "static" / "design" / "development"
CABECERA = "/* Generado por scripts/integrar_development.py desde control-proyectos/public. No editar a mano. */\n"


def reemplazar(texto: str, viejo: str, nuevo: str, archivo: str, veces: int = 1) -> str:
    n = texto.count(viejo)
    if n != veces:
        raise SystemExit(f"{archivo}: se esperaba {veces} vez/veces «{viejo[:70]}» y hay {n}. Revisar a mano.")
    return texto.replace(viejo, nuevo)


# ---------------- CSS ----------------
COLORES = {   # paleta del proyecto → la de la intranet (azul de Design, gris de fondo, dorado de Nuvia como acento)
    "--bg:#f4f1ea; --surface:#fffdf8; --surface-2:#f1ede3; --border:#e3dccd;":
        "--bg:#f3f4f6; --surface:#ffffff; --surface-2:#f1f5f9; --border:#e2e8f0;",
    "--text:#17161c; --muted:#6d6a73; --ink:#17161c;": "--text:#111827; --muted:#5b6474; --ink:#0f1b3d;",
    "--primary:#4f3cf0; --primary-2:#7b6cff; --primary-weak:#ece9ff; --lime:#d4ff3f;":
        "--primary:#1d4ed8; --primary-2:#3b82f6; --primary-weak:#e0eaff; --lime:#fbbf24;",
    "--ok:#12865a; --ok-weak:#e1f5ea; --warn:#c47308; --warn-weak:#fdf0d9;":
        "--ok:#15803d; --ok-weak:#dcfce7; --warn:#b45309; --warn-weak:#fef3c7;",
    "--bad:#d2392e; --bad-weak:#fde6e3; --neutral-weak:#ece8de;": "--bad:#dc2626; --bad-weak:#fee2e2; --neutral-weak:#e5e7eb;",
    '--display:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;': "--display:'Segoe UI',system-ui,sans-serif;",
}
SUELTOS = {"#4231d9": "#1e40af", "#c6f52b": "#f59e0b", "rgba(212,255,63,.55)": "rgba(251,191,36,.45)",
           "rgba(212,255,63,.2)": "rgba(251,191,36,.15)", "rgba(79,60,240,.4)": "rgba(29,78,216,.4)",
           "rgba(79,60,240,0)": "rgba(29,78,216,0)", "rgba(23,22,28,": "rgba(15,27,61,", "#fffdf8": "#ffffff",
           "rgba(255,253,248,": "rgba(255,255,255,", "#cfc7b5": "#cbd5e1", "#d8d1c1": "#cbd5e1", "#e9e6dd": "#e2e8f0",
           "rgba(241,237,227,.75)": "rgba(241,245,249,.85)", "rgba(18,134,90,.15)": "rgba(21,128,61,.15)",
           "rgba(210,57,46,.45)": "rgba(220,38,38,.45)", "rgba(210,57,46,0)": "rgba(220,38,38,0)"}
OSCURO = """
/* Modo oscuro de Design (html[data-ds-tema="oscuro"]): mismas variables, tonos oscuros */
:root[data-ds-tema="oscuro"] .cpapp{color-scheme:dark;
  --bg:#0b1220; --surface:#111a2e; --surface-2:#18233b; --border:#26324d;
  --text:#e5e7eb; --muted:#9aa4b8; --ink:#070d1c;
  --primary:#6b8cff; --primary-2:#93a8ff; --primary-weak:#1c2a52; --lime:#fbbf24;
  --ok:#4ade80; --ok-weak:#12301f; --warn:#fbbf24; --warn-weak:#3a2a0b;
  --bad:#f87171; --bad-weak:#3b1515; --neutral-weak:#26324d;
  --shadow:0 1px 0 rgba(0,0,0,.3),0 2px 10px rgba(0,0,0,.35); --shadow-lg:0 18px 40px -16px rgba(0,0,0,.7)}
:root[data-ds-tema="oscuro"] .cpapp{background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px)}
:root[data-ds-tema="oscuro"] .cpapp .btn.primary,:root[data-ds-tema="oscuro"] .cpapp .pbtn.useful.on{color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .hero{background:#070d1c}
:root[data-ds-tema="oscuro"] .cpapp .navpill button.active{color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .navpill .ind{background:#e5e7eb}
:root[data-ds-tema="oscuro"] .cpapp .chip.on,:root[data-ds-tema="oscuro"] .cpapp .side .catbtn.on{background:#e5e7eb;color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .bars .bar span{background:#e5e7eb}
/* los botones de Design en oscuro no deben pisar los del proyecto */
:root[data-ds-tema="oscuro"] .cpapp .btn{background:var(--surface);color:var(--text);border-color:var(--border)}
:root[data-ds-tema="oscuro"] .cpapp .btn:hover{background:var(--surface-2)}
:root[data-ds-tema="oscuro"] .cpapp .btn.primary{background:var(--primary);border-color:var(--primary);color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .btn.lime{background:var(--lime);border-color:var(--lime);color:#0f1b3d}
:root[data-ds-tema="oscuro"] .cpapp .btn.ghost{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.16);color:#fff}
:root[data-ds-tema="oscuro"] .cpapp .btn.ink{background:#e5e7eb;border-color:#e5e7eb;color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .btn.danger{color:var(--bad)}
:root[data-ds-tema="oscuro"] .cpapp .btn.danger-fill{background:var(--bad);border-color:var(--bad);color:#0b1220}
:root[data-ds-tema="oscuro"] .cpapp .post.pinned{background:#1c2a52;border-color:#1c2a52}
:root[data-ds-tema="oscuro"] .cpapp .post.pinned .fade::after{background:linear-gradient(transparent,#1c2a52)}
"""
# Lo que style.css de la intranet pone a todos los input/label/table y no debe entrar aquí
RESET = """.cpapp input,.cpapp select,.cpapp textarea{width:auto;margin:0;font-size:inherit;border-radius:0;padding:revert}
.cpapp label{font-size:inherit;color:inherit;font-weight:inherit}
.cpapp table{font-size:inherit}
.cpapp h1,.cpapp h2,.cpapp h3,.cpapp h4{color:inherit}
.cpapp [hidden]{display:none!important}
.cpapp nav{color:inherit;flex-wrap:nowrap}
"""


def _prefijar(selectores: str) -> str:
    out = []
    for s in selectores.split(","):
        s = s.strip()
        if s in (":root", "body", "html"):
            out.append(".cpapp")
        elif s == "*":
            out.append(".cpapp,.cpapp *")
        elif s == "main":
            out.append(".cpapp .cp-main")
        elif s.startswith("main"):
            out.append(".cpapp .cp-main" + s[4:])
        else:
            out.append(".cpapp " + s)
    return ",".join(out)


def _bloque(css: str) -> str:
    """Recorre reglas de primer nivel; dentro de @media se recorre de nuevo, @keyframes se deja igual."""
    res, i = [], 0
    while i < len(css):
        j = css.find("{", i)
        if j < 0:
            res.append(css[i:])
            break
        cab = css[i:j]
        prof, k = 1, j + 1
        while prof:
            prof += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        cuerpo = css[j + 1:k - 1]
        cab_limpia = re.sub(r"/\*.*?\*/", "", cab, flags=re.S)
        espacio = cab[:len(cab) - len(cab.lstrip())]
        sel = cab_limpia.strip()
        if sel.startswith("@keyframes"):
            res.append(cab + "{" + cuerpo + "}")
        elif sel.startswith("@media"):
            res.append(espacio + sel + "{" + _bloque(cuerpo) + "}")
        else:
            res.append(espacio + _prefijar(sel) + "{" + cuerpo + "}")
        i = k
    return "".join(res)


def css() -> str:
    t = (ORIGEN / "css" / "styles.css").read_text(encoding="utf-8")
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    for a, b in COLORES.items():
        t = reemplazar(t, a, b, "styles.css")
    for a, b in SUELTOS.items():
        t = t.replace(a, b)
    t = t.replace("font:14px/1.5 Inter,system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif",
                  "font:14px/1.5 'Segoe UI',system-ui,-apple-system,Roboto,sans-serif")
    t = t.replace("Inter,sans-serif", "'Segoe UI',system-ui,sans-serif")
    t = re.sub(r"html\{scroll-behavior:smooth\}\n?", "", t)
    out = _bloque(t)
    # el fondo de puntos del proyecto va en el contenedor, que ocupa todo el ancho bajo la barra de la intranet
    out = out.replace(".cpapp{margin:0;background-color", ".cpapp{margin:-24px -16px 0;min-height:calc(100vh - 90px);background-color")
    return CABECERA + RESET + out + OSCURO


# ---------------- JS ----------------
def domain() -> str:
    t = (ORIGEN / "js" / "domain.js").read_text(encoding="utf-8")
    t = reemplazar(t, "{k:'anuncio',l:'Anuncio',c:'#9bbf12'", "{k:'anuncio',l:'Anuncio',c:'#d97706'", "domain.js")
    t = reemplazar(t, "window.CP_USER_NAME || 'Luis Blaschke'", "window.CP_USER_NAME || ''", "domain.js")
    return CABECERA + t


def api() -> str:
    t = (ORIGEN / "js" / "api-http.js").read_text(encoding="utf-8")
    t = reemplazar(t, "window.CP_API_BASE || '/api'", "window.CP_API_BASE || '/design/api/dev'", "api-http.js")
    t = reemplazar(t, "  /* Respaldo */", "  /* Responsables (personas activas de Nuvia Design) */\n"
                   "  people:        ()              => http('GET',    '/people'),\n\n  /* Respaldo */", "api-http.js")
    t = reemplazar(t, "credentials: 'include'", "credentials: 'same-origin'", "api-http.js")
    return CABECERA + t


def app() -> str:
    t = (ORIGEN / "js" / "app.js").read_text(encoding="utf-8")
    f = "app.js"
    # Avisos, tooltips y confeti viven dentro de .cpapp (sus estilos están ahí)
    t = reemplazar(t, "const topHost = () => [...document.querySelectorAll('dialog[open]')].pop() || document.body;",
                   "const CP_ROOT = document.querySelector('.cpapp');\n"
                   "const topHost = () => [...document.querySelectorAll('.cpapp dialog[open]')].pop() || CP_ROOT;", f)
    t = reemplazar(t, "const colors=['#4f3cf0','#d4ff3f','#12865a','#c47308','#7b6cff','#17161c'];",
                   "const colors=['#1d4ed8','#fbbf24','#15803d','#d97706','#3b82f6','#0f1b3d'];", f)
    # Responsables: desplegable de personas de Nuvia Design
    t = reemplazar(t, "const state = {", "const peopleOpts = sel => `<option value=\"\">Elige una persona…</option>`"
                   "+state.people.map(x=>`<option value=\"${esc(x.id)}\" ${String(sel)===x.id?'selected':''}>${esc(x.name)}</option>`).join('');\n"
                   "const state = {people:[],", f)
    t = reemplazar(t, "const v=p||{name:'',type:'Desarrollo',owner:'',",
                   "const v=p||{name:'',type:'Desarrollo',owner:'',ownerId:'',", f)
    t = reemplazar(t, "<input name=\"owner\" value=\"${esc(v.owner)}\" placeholder=\"Nombre y apellido\">",
                   "<select name=\"ownerId\">${peopleOpts(v.ownerId)}</select>", f)
    t = reemplazar(t, "<input name=\"owner\" value=\"${esc(er?er.owner:p.owner)}\">",
                   "<select name=\"ownerId\">${peopleOpts(er?er.ownerId:p.ownerId)}</select>", f)
    t = reemplazar(t, "async function refresh(){\n  state.projects=await api.list();",
                   "async function refresh(){\n  if(!state.people.length) state.people=await api.people();\n  state.projects=await api.list();", f)
    # Evidencias: máximo 1 MB ya comprimidas (si no cabe, baja calidad y tamaño)
    t = reemplazar(t, "    let dataUrl=c.toDataURL('image/webp',.85); if(!dataUrl.startsWith('data:image/webp')) dataUrl=c.toDataURL('image/jpeg',.85);\n"
                      "    return {dataUrl,w,h,size:Math.round((dataUrl.length-dataUrl.indexOf(',')-1)*.75),name};",
                   "    const enc=q=>{ let u=c.toDataURL('image/webp',q); if(!u.startsWith('data:image/webp')) u=c.toDataURL('image/jpeg',q); return u; };\n"
                   "    const bytesOf=u=>Math.round((u.length-u.indexOf(',')-1)*.75);\n"
                   "    let dataUrl=enc(.82);\n"
                   "    for(const q of [.7,.6,.5]){ if(bytesOf(dataUrl)<=1048576) break; dataUrl=enc(q); }\n"
                   "    if(bytesOf(dataUrl)>1048576) throw new Error(`${name}: queda de más de 1 MB aun optimizada; recórtala o usa una captura más pequeña`);\n"
                   "    return {dataUrl,w,h,size:bytesOf(dataUrl),name};", f)
    t = reemplazar(t, "PNG, JPG, WEBP o GIF · hasta 15 MB · se optimizan y se elimina la metadata (ej. ubicación GPS)",
                   "PNG, JPG, WEBP o GIF · se optimizan a máx. 1 MB y se elimina la metadata (ej. ubicación GPS) · hasta 20 por proyecto", f)
    t = reemplazar(t, "const ext=(e.dataUrl.match(/^data:image\\/(\\w+)/)||[])[1]||'png';",
                   "const ext=((e.mime||'image/png').split('/')[1]||'png').replace('jpeg','jpg');", f)
    # Sin importación ni datos de demostración (vienen de la base de la intranet)
    t = reemplazar(t, "$('#importFile').addEventListener('change', async e=>{", "if($('#importFile')) $('#importFile').addEventListener('change', async e=>{", f)
    # Al cerrar un aviso de error el foco no debe salir del contenedor
    return CABECERA + t


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, contenido in (("development.css", css()), ("domain.js", domain()), ("api.js", api()), ("app.js", app())):
        (DESTINO / nombre).write_text(contenido, encoding="utf-8", newline="\n")
        print(nombre, len(contenido))


if __name__ == "__main__":
    main()
