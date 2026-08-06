"""Logos de empresa para membretes (certificados, navegación, login)."""
from pathlib import Path

LOGOS = {
    "Nuvia Smiles Colombia SAS": "nuvia-smiles.png",
    "Nuvia Design Colombia SAS": "nuvia-design.png",
}
LOGOS_DIR = Path(__file__).resolve().parent / "static" / "logos"


def logo_para(empresa: str | None) -> str | None:
    nombre = LOGOS.get(empresa or "")
    if nombre and (LOGOS_DIR / nombre).exists():
        return f"/static/logos/{nombre}"
    return None


def logos_disponibles() -> list[str]:
    """Todas las rutas de logo que existen en disco, para mostrar cuando no hay un usuario logueado."""
    return [f"/static/logos/{nombre}" for nombre in LOGOS.values() if (LOGOS_DIR / nombre).exists()]
