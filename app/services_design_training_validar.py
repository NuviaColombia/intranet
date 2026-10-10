"""Validación del contenido de Training (app/static/training/data/*.json). Se usa en la prueba automática
tests/test_training_contenido.py y por línea de comandos:  python -m app.services_design_training_validar [archivo.json ...]
El formato de los pasos está descrito en app/static/training/README.md."""
import json
import re
import sys
from pathlib import Path

DATOS = Path(__file__).resolve().parent / "static" / "training" / "data"
TIPOS = {"texto", "tarjetas", "flujo", "acordeon", "tabla", "quiz", "simulador", "tour", "modelo3d", "calculadora", "checklist", "enlace", "resumen"}
FOCOS = {"vdo", "incisal", "midline", "cant", "plano", "rotacion", "labio", "tamano", "grado", "todo"}
CALCS = {"espesor24z", "tamanos", "articulador", "tiempos"}
VISTAS = {"frontal", "perfil", "oclusal", "libre"}
RESALTAR = {"fantasma", "estatico", "oclusion"}
PARAMS = {"vdo", "incisal", "midline", "cant", "plano", "rotacion", "labio", "tamano", "grado"}
MODOS = {"fijo", "sigue"}
RE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class _V:
    def __init__(self):
        self.errores = []

    def e(self, ruta, msg):
        self.errores.append(f"{ruta}: {msg}")

    def T(self, v, ruta, obligatorio=True):
        if v is None:
            if obligatorio:
                self.e(ruta, "falta el texto bilingüe")
            return
        if not isinstance(v, dict) or set(v) != {"es", "en"}:
            return self.e(ruta, 'debe ser {"es": ..., "en": ...}')
        for k in ("es", "en"):
            if not isinstance(v[k], str) or not v[k].strip():
                self.e(ruta, f"'{k}' vacío")

    def quiz(self, q, r):
        t = q.get("tipo")
        if t not in ("una", "varias", "vf", "orden", "parejas"):
            return self.e(r, f"tipo de pregunta inválido: {t}")
        self.T(q.get("enunciado"), r + ".enunciado")
        self.T(q.get("explicacion"), r + ".explicacion")
        if t in ("una", "varias"):
            ops = q.get("opciones") or []
            ok = sum(1 for o in ops if o.get("ok"))
            if not 3 <= len(ops) <= 5:
                self.e(r, "debe tener 3 a 5 opciones")
            if t == "una" and ok != 1:
                self.e(r, f"'una' necesita exactamente 1 opción correcta (hay {ok})")
            if t == "varias" and ok < 2:
                self.e(r, "'varias' necesita 2+ opciones correctas")
            for i, o in enumerate(ops):
                self.T(o.get("texto"), f"{r}.opciones[{i}].texto")
        elif t == "vf":
            if not isinstance(q.get("ok"), bool):
                self.e(r, "'vf' necesita ok true/false")
        elif t == "orden":
            its = q.get("items") or []
            if not 3 <= len(its) <= 7:
                self.e(r, "'orden' necesita 3 a 7 items")
            for i, x in enumerate(its):
                self.T(x, f"{r}.items[{i}]")
        elif t == "parejas":
            ps = q.get("pares") or []
            if not 3 <= len(ps) <= 6:
                self.e(r, "'parejas' necesita 3 a 6 pares")
            for i, p in enumerate(ps):
                self.T(p.get("a"), f"{r}.pares[{i}].a")
                self.T(p.get("b"), f"{r}.pares[{i}].b")

    def paso(self, p, r):
        t = p.get("t")
        if t not in TIPOS:
            return self.e(r, f"tipo de paso inválido: {t}")
        T = self.T
        if t == "texto":
            T(p.get("titulo"), r + ".titulo")
            T(p.get("cuerpo"), r + ".cuerpo")
            for k in ("porque", "dato", "alerta"):
                T(p.get(k), f"{r}.{k}", False)
        elif t in ("tarjetas", "acordeon"):
            T(p.get("titulo"), r + ".titulo")
            if len(p.get("items") or []) < 2:
                self.e(r, "necesita 2+ items")
            for i, x in enumerate(p.get("items") or []):
                T(x.get("titulo"), f"{r}.items[{i}].titulo")
                T(x.get("texto"), f"{r}.items[{i}].texto")
        elif t == "flujo":
            T(p.get("titulo"), r + ".titulo")
            if len(p.get("pasos") or []) < 3:
                self.e(r, "necesita 3+ pasos")
            for i, x in enumerate(p.get("pasos") or []):
                T(x.get("titulo"), f"{r}.pasos[{i}].titulo")
                T(x.get("texto"), f"{r}.pasos[{i}].texto")
        elif t == "tabla":
            T(p.get("titulo"), r + ".titulo")
            cab = p.get("cabeceras") or []
            for i, c in enumerate(cab):
                T(c, f"{r}.cabeceras[{i}]")
            for i, f in enumerate(p.get("filas") or []):
                if len(f) != len(cab):
                    self.e(r, f"fila {i} tiene {len(f)} celdas y hay {len(cab)} cabeceras")
                for j, c in enumerate(f):
                    T(c, f"{r}.filas[{i}][{j}]")
        elif t == "quiz":
            qs = p.get("preguntas") or []
            if not 2 <= len(qs) <= 6:
                self.e(r, "el quiz necesita 2 a 6 preguntas")
            for i, q in enumerate(qs):
                self.quiz(q, f"{r}.preguntas[{i}]")
        elif t in ("simulador", "tour"):
            T(p.get("titulo"), r + ".titulo")
            if p.get("modo") and p["modo"] not in MODOS:
                self.e(r, "modo inválido")
            if t == "simulador":
                T(p.get("guia"), r + ".guia")
                foco = p.get("foco") or []
                if not foco or any(f not in FOCOS for f in foco):
                    self.e(r, f"foco inválido: {foco}")
                if p.get("vista") and p["vista"] not in VISTAS:
                    self.e(r, "vista inválida")
                rt = p.get("reto")
                if rt:
                    T(rt.get("enunciado"), r + ".reto.enunciado")
                    if not rt.get("objetivo") or any(k not in PARAMS for k in rt["objetivo"]):
                        self.e(r, "reto.objetivo inválido")
                    if not isinstance(rt.get("tolerancia"), (int, float)):
                        self.e(r, "reto.tolerancia numérica requerida")
            else:
                es = p.get("escenas") or []
                if len(es) < 2:
                    self.e(r, "el tour necesita 2+ escenas")
                for i, s in enumerate(es):
                    rr = f"{r}.escenas[{i}]"
                    T(s.get("texto"), rr + ".texto")
                    if any(k not in PARAMS for k in (s.get("p") or {})):
                        self.e(rr, "parámetro desconocido en p")
                    if s.get("cam") and s["cam"] not in VISTAS:
                        self.e(rr, "cam inválida")
                    if any(x not in RESALTAR for x in (s.get("resaltar") or [])):
                        self.e(rr, "resaltar inválido")
                    if not isinstance(s.get("seg", 4), (int, float)) or not 1 <= s.get("seg", 4) <= 12:
                        self.e(rr, "seg debe estar entre 1 y 12")
        elif t == "modelo3d":
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,58}", p.get("slot") or ""):
                self.e(r, "slot inválido")
            for k in ("titulo", "descripcion", "pendiente"):
                T(p.get(k), f"{r}.{k}")
        elif t == "calculadora":
            T(p.get("titulo"), r + ".titulo")
            T(p.get("guia"), r + ".guia", False)
            if p.get("id") not in CALCS:
                self.e(r, f"calculadora desconocida: {p.get('id')}")
        elif t == "checklist":
            T(p.get("titulo"), r + ".titulo")
            for i, x in enumerate(p.get("items") or []):
                T(x, f"{r}.items[{i}]")
        elif t == "enlace":
            T(p.get("titulo"), r + ".titulo")
            T(p.get("texto"), r + ".texto")
            if not (p.get("protocolo") or "").strip():
                self.e(r, "falta 'protocolo'")
        elif t == "resumen":
            T(p.get("titulo"), r + ".titulo")
            for i, x in enumerate(p.get("puntos") or []):
                T(x, f"{r}.puntos[{i}]")


def validar_modulo(d: dict) -> list[str]:
    """Lista de problemas de un módulo (vacía = válido)."""
    v = _V()
    if not RE_ID.match(d.get("id") or ""):
        v.e("modulo", "id inválido")
    v.T(d.get("titulo"), "titulo")
    v.T(d.get("resumen"), "resumen")
    if not isinstance(d.get("orden"), int):
        v.e("modulo", "orden entero requerido")
    ids = set()
    for i, l in enumerate(d.get("lecciones") or []):
        r = f"lecciones[{i}]"
        if not RE_ID.match(l.get("id") or "") or l["id"] in ids:
            v.e(r, "id inválido o repetido")
        ids.add(l.get("id"))
        v.T(l.get("titulo"), r + ".titulo")
        ps = l.get("pasos") or []
        if not 3 <= len(ps) <= 12:
            v.e(r, f"debe tener 4 a 9 pasos (tiene {len(ps)})")
        if not ps or ps[-1].get("t") != "quiz":
            v.e(r, "el último paso debe ser un quiz")
        if len({p.get("t") for p in ps}) < 3:
            v.e(r, "usa al menos 3 tipos de paso distintos")
        for j, p in enumerate(ps):
            v.paso(p, f"{r}.pasos[{j}]")
    if not d.get("lecciones"):
        v.e("modulo", "sin lecciones")
    gl = set()
    for i, g in enumerate(d.get("glosario") or []):
        r = f"glosario[{i}]"
        if g.get("id") in gl:
            v.e(r, "id repetido")
        gl.add(g.get("id"))
        v.T(g.get("termino"), r + ".termino")
        v.T(g.get("def"), r + ".def")
    return v.errores


def validar_todo(carpeta: Path = DATOS) -> dict[str, list[str]]:
    """{archivo: problemas}. Incluye la unicidad de ids de lección entre módulos."""
    out, lecciones = {}, {}
    for a in sorted(carpeta.glob("*.json")):
        try:
            d = json.loads(a.read_text(encoding="utf-8"))
        except ValueError as ex:
            out[a.name] = [f"JSON inválido: {ex}"]
            continue
        errs = validar_modulo(d)
        for l in d.get("lecciones", []):
            if l.get("id") in lecciones:
                errs.append(f"lección {l['id']} repetida en {lecciones[l['id']]}")
            lecciones[l.get("id")] = a.name
        out[a.name] = errs
    return out


if __name__ == "__main__":
    rutas = [Path(x) for x in sys.argv[1:]] or sorted(DATOS.glob("*.json"))
    malo = 0
    for r in rutas:
        errs = validar_modulo(json.loads(r.read_text(encoding="utf-8")))
        print(("OK " if not errs else "ERR") + " " + r.name, *(f"\n   - {x}" for x in errs[:30]))
        malo += bool(errs)
    sys.exit(1 if malo else 0)
