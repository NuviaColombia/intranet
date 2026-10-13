"""Genera app/static/design/schedule.min.js a partir de schedule.js (B11, 13-oct-2026).

Uso:
  python scripts/minificar_design.py          -> escribe schedule.min.js
  python scripts/minificar_design.py --check  -> falla si schedule.min.js no corresponde al código actual

Hay que correrlo cada vez que se cambie schedule.js. tests/test_minificado.py avisa si se olvidó.
Requiere el paquete rjsmin (pip install rjsmin); no se usa al correr la intranet.
"""
import sys
from pathlib import Path

import rjsmin

BASE = Path(__file__).resolve().parent.parent / "app" / "static" / "design"
FUENTE = BASE / "schedule.js"
SALIDA = BASE / "schedule.min.js"


def minificado() -> str:
    return rjsmin.jsmin(FUENTE.read_text(encoding="utf-8"))


def main() -> int:
    texto = minificado()
    if "--check" in sys.argv:
        actual = SALIDA.read_text(encoding="utf-8") if SALIDA.exists() else ""
        if actual != texto:
            print("schedule.min.js está desactualizado: corre python scripts/minificar_design.py")
            return 1
        print("schedule.min.js al día")
        return 0
    SALIDA.write_text(texto, encoding="utf-8", newline="\n")
    print(f"escrito {SALIDA.name}: {SALIDA.stat().st_size // 1024} KB (fuente {FUENTE.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
