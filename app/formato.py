"""Formato de visualización para nombres propios (personas, áreas, motivos).

Solo cambia cómo se MUESTRA el texto; lo guardado en la base (en mayúsculas) no se toca,
porque la lógica de Custodia compara áreas y motivos como texto exacto.
La misma regla está replicada en JS en custodia.html (usa estas mismas listas vía tojson).
"""
import re

# Se muestran siempre en mayúsculas.
SIGLAS = ["QC", "OP", "DIR", "PMMA", "CNC", "ID", "N/A", "NA", "SAS", "SST", "TC", "PO", "CAD", "CAM"]
# Conectores que van en minúscula (salvo si son la primera palabra).
MINUSCULAS = ["de", "del", "la", "las", "los", "y", "e", "o", "u", "a", "en", "con", "por", "para", "el", "al"]

_SIGLAS = set(SIGLAS)
_MINUSCULAS = set(MINUSCULAS)


def _palabra(p: str, primera: bool, solo_primera: bool) -> str:
    if not p:
        return p
    if p.upper() in _SIGLAS or any(ch.isdigit() for ch in p):
        return p.upper() if p.upper() in _SIGLAS else p
    minus = p.lower()
    if not primera and (solo_primera or minus in _MINUSCULAS):
        return minus
    return minus[0].upper() + minus[1:]


def nombre_propio(texto, frase: bool = False) -> str:
    """'LEIDER DAVID MONTENEGRO' -> 'Leider David Montenegro'; 'QC FINAL' -> 'QC Final'.

    frase=True (motivos): solo la primera palabra de cada parte en mayúscula,
    'PRODUCCIÓN NORMAL' -> 'Producción normal', 'MERMA/DAÑO' -> 'Merma/Daño'.
    """
    if texto is None:
        return ""
    texto = str(texto)
    # Partes separadas por "/" o " - " empiezan de nuevo con mayúscula.
    partes = re.split(r"(/|\s-\s)", texto)
    salida = []
    for parte in partes:
        if parte in ("/",) or re.fullmatch(r"\s-\s", parte or ""):
            salida.append(parte)
            continue
        palabras = parte.split(" ")
        hechas, primera = [], True
        for p in palabras:
            if not p:
                hechas.append(p)
                continue
            hechas.append(_palabra(p, primera, frase))
            primera = False
        salida.append(" ".join(hechas))
    return "".join(salida)
