"""Catálogo de hallazgos de QC por área (títulos generales con hallazgos preestablecidos). Quien marca el QC elige de la
lista; los aprobadores y admins agregan títulos y hallazgos nuevos y quedan para toda el área. El hallazgo elegido se
guarda como texto en el reporte de QC de la orden (qc_reporte), así el Dashboard y los reportes no cambian.
Una fila con hallazgo vacío es un título que todavía no tiene hallazgos."""
import re
from sqlalchemy import func
from sqlalchemy.orm import Session
from .models import Empleado
from .models_design import DesignArea, DesignQcCatalogo, DesignConexionRegla

# Listas dadas por Rosember el 9-oct-2026. Cada una se carga una sola vez, la primera vez que se consulta
# (nombre del área -> marca de "ya cargada" -> títulos). Cada título: (nombre, tabla, producto_clave, hallazgos).
# tabla "" = todas; "principal" = Cirugías; "nightguard" = Nightguards / TC. producto_clave "" = cualquier producto;
# "nightguard" o "tc" = solo si el producto de la fila es de ese tipo.
SEMILLAS = {
    "N2 Demodenture": ("qc_catalogo_n2", [
        ("HTML", "", "", [
            "Falto Face design", "Falto Waxup (Especificar si upper, lower o ambos)", "Falto Denture (Especificar si upper, lower o ambos)",
            "No hay Red Midline", "Posicion de Midline", "Files movidos", "Falto Tissue (Especificar si upper, lower o ambos)",
            "Falto Scans (Especificar si upper, lower o ambos)", "Html incorrecto", "No subio rx en html", "Rx incorrecto"]),
        ("TO PRINT", "", "", [
            "Subio To Print incorrecto", "Faltaron files en el To Print", "Marcación de talla incorrecta", "Holes Mal posicionados",
            "Stent mal posicionado", "No habia archivo To Print", "No subio antagonista",
            "Faltaron archivo en oclusion scene (barra-waxup-antagonista)", "Faltaron holes en demo", "No reemplazo nuevo To Print"]),
        ("PLATAFORMA", "", "", [
            "Comentario de talla", "Informe de cambios realizados con pre aprobados", "Informe de reducción de hueso",
            "Aprobacion o no de cambios solicitados", "Comentarios de Single", "Información importante del caso",
            "Archivos en stage equivocado", "Fotos equivocadas", "Stage no aprobado"]),
        ("OTROS PROCESOS", "", "", [
            "Archivo(s) en formato equivocado", "Archivo(s) mal guardado", "Diseño de demo denture diferente a las preferencias el doctor",
            "Talla en To Print diferente a comentario en plataforma", "No dejo el caso en hold", "No guardo waxup", "No guardo barra",
            "Dejo el caso iniciado", "Modificacion de posicion waxup (incisal, midline, lip support, cant)",
            "Waxup y denture desalineadas", "Waxup sin limpiar", "Barra sin limpiar"]),
    ]),
    "Face Design": ("qc_catalogo_face", [
        ("BLENDER", "", "", [
            "Mountaing incorrecto: Desviaciones en la línea media o planos de referencia del mountaing.",
            "Scans desalineados / mal integrados: solapamiento o totals mal alineados.",
            "Scan-Face desalineado: Falta de coincidencia entre los intraorals scans y las referencias faciales.",
            "CBCT mal posicionada: CBCT mal orientado a los scans y linea media."]),
        ("PLATFORM", "", "", [
            "Falta de reporte en plataforma: No se dejó comentario sobre incidencias (traspaso de scans, fotos defectuosas, Falta de información en scans etc.)."]),
    ]),
    "N3 Prosthetic": ("qc_catalogo_n3", [
        ("SURGERIES", "principal", "", [
            "HTML incompleto en capeta to mill",
            "Archivo de construction no se encuentra en la carpeta to mill.",
            "Falta size en la carpeta de TC to mill en caso de cx.",
            "Foto de reducción de tissue con el modelo de gingiva traslucido.",
            "Comentario en plataforma y cliq con degree incorrecto"]),
        ("NG", "nightguard", "nightguard", [
            "Faltan las medidas diligenciadas en el stage NG design",
            "Fotos de medidas de NG no corresponden a la indicada en el canva"]),
        ("TC", "nightguard", "tc", [
            "Nombre equivocado en recortes de TC", "Cortes no siguen el protocolo", "El peso de los archivos es incorrecto"]),
    ]),
}
MAX_TEXTO = 300


def puede_agregar(user: Empleado) -> bool:
    return user.rol in ("aprobador", "admin", "superadmin")


def puede_borrar(user: Empleado) -> bool:
    return user.rol in ("admin", "superadmin")


def _sembrar(db: Session) -> None:
    for nombre_area, (marca, titulos) in SEMILLAS.items():
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            continue
        area = db.query(DesignArea).filter(DesignArea.nombre == nombre_area).first()
        if not area:
            continue
        try:
            if not db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area.id).first():
                n = 0
                for titulo, tabla, clave, items in titulos:
                    for texto in items:
                        n += 1
                        db.add(DesignQcCatalogo(area_id=area.id, titulo=titulo, hallazgo=texto, tabla=tabla, producto_clave=clave, orden=n))
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        except Exception:
            db.rollback()  # otro proceso la cargó al mismo tiempo


def _producto_es(clave: str, producto: str) -> bool:
    p = producto or ""
    if clave == "nightguard":
        return bool(re.search(r"nightguard", p, re.I))
    if clave == "tc":
        return bool(re.search(r"\btc\b", p, re.I))
    return True


def _titulos(db: Session, area_id: int) -> dict[str, dict]:
    """Todos los títulos del área (activos) con su contexto, sin filtrar."""
    _sembrar(db)
    out: dict[str, dict] = {}
    for r in (db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area_id, DesignQcCatalogo.activo == 1)
              .order_by(DesignQcCatalogo.orden, DesignQcCatalogo.id)):
        t = out.setdefault(r.titulo, {"titulo": r.titulo, "tabla": r.tabla or "", "productoClave": r.producto_clave or "", "items": []})
        if r.hallazgo:
            t["items"].append({"id": r.id, "texto": r.hallazgo})
    return out


def catalogo(db: Session, area_id: int, tabla: str = "", producto: str = "") -> list[dict]:
    """[{titulo, items: [{id, texto}]}] de lo que aplica a esa tabla y a ese producto, en el orden en que se crearon."""
    return [{"titulo": t["titulo"], "items": t["items"]} for t in _titulos(db, area_id).values()
            if (not t["tabla"] or t["tabla"] == tabla) and _producto_es(t["productoClave"], producto)]


def _siguiente_orden(db: Session, area_id: int) -> int:
    return (db.query(func.max(DesignQcCatalogo.orden)).filter(DesignQcCatalogo.area_id == area_id).scalar() or 0) + 1


def _limpio(txt: str, campo: str) -> str:
    txt = " ".join((txt or "").split())
    if not txt:
        raise ValueError(f"Escribe el {campo}.")
    if len(txt) > MAX_TEXTO:
        raise ValueError(f"El {campo} es muy largo (máximo {MAX_TEXTO} letras).")
    return txt


def agregar_titulo(db: Session, area_id: int, titulo: str, tabla: str = "") -> None:
    """Título nuevo: queda en la tabla donde se agregó (Cirugías o Nightguards / TC) y sirve para cualquier producto de ella."""
    titulo = _limpio(titulo, "título")
    if any(k.lower() == titulo.lower() for k in _titulos(db, area_id)):
        raise ValueError("Ese título ya existe.")
    tabla = tabla if tabla in ("principal", "nightguard") else ""
    db.add(DesignQcCatalogo(area_id=area_id, titulo=titulo, hallazgo="", tabla=tabla, orden=_siguiente_orden(db, area_id)))
    db.commit()


def agregar_hallazgo(db: Session, area_id: int, titulo: str, texto: str) -> dict:
    titulo, texto = _limpio(titulo, "título"), _limpio(texto, "hallazgo")
    existentes = [t for t in _titulos(db, area_id).values() if t["titulo"].lower() == titulo.lower()]
    if not existentes:
        raise KeyError(titulo)
    t = existentes[0]
    if any(i["texto"].lower() == texto.lower() for i in t["items"]):
        raise ValueError("Ese hallazgo ya está en el título.")
    r = DesignQcCatalogo(area_id=area_id, titulo=t["titulo"], hallazgo=texto, tabla=t["tabla"], producto_clave=t["productoClave"],
                         orden=_siguiente_orden(db, area_id))
    db.add(r)
    db.commit()
    return {"id": r.id, "texto": r.hallazgo}


def eliminar(db: Session, item_id: int) -> bool:
    """Quita un hallazgo de la lista (los reportes de QC ya guardados no cambian)."""
    r = db.get(DesignQcCatalogo, item_id)
    if not r or not r.activo:
        return False
    r.activo = 0
    db.commit()
    return True
