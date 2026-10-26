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
# N6 Material Changes usa los mismos hallazgos que N3 (pedido por Rosember el 9-oct-2026); cada área tiene su propia copia.
SEMILLAS["N6 Material Changes"] = ("qc_catalogo_n6", SEMILLAS["N3 Prosthetic"][1])
MAX_TEXTO = 300

# Hallazgos que se agregan a una lista que ya existe (una sola vez, con su marca). Si un hallazgo ya está (mismo texto, sin
# importar mayúsculas ni tildes) se reemplaza: queda con el texto y el título de esta lista, sin duplicarse.
# Lista de N6 dada por Rosember el 13-oct-2026 (títulos para todas las tablas del área).
CARGAS = [
    ("qc_n6_lista_13oct", "N6 Material Changes", [
        ("REPORTES QC PLATAFORMA", [
            "Html design mal cargado", "Html Dr mal cargado", "No se dejo foto del implant angulation",
            "Falto foto del cilindro del implante omitido", "No se dejo la nota del size",
            "No se dejo nota de porque no se diseño la guia COL", "Se cargaron las fotos de otro paciente",
            "No se dejaron las fotos del TC", "No se actualizo la foto de medidas", "No se dejo la nota del adapted",
            "Se diseño el la NG con los file de otro paciente", "Falta de información importante del caso"]),
        ("TO MIL/ TO PRINT", [
            "Se cargo la carpeta incorrecta", "Html design completo, incompleto", "Html del CAM incorrecto",
            "Falto el STL de oclusión", "No se hizo la corrección que le mande hacer en el QC de diseño",
            "No se cargo el constructioninfo", "No se cargo la guia COL"]),
        ("OTROS PROCESOS", [
            "Archivos incorrectos", "No se hizo el cambio de size", "Se diseño con el degree incorrecto",
            "Corregir estetica de las barras", "Corregir estetica de las guias de verificacion",
            "No se tomaron las medidas correctamente", "No verifico que tocaba pedir un nuevo scan del stump",
            "No verifico que tocaba pedir un nuevo scan del tissue", "Bite mal alineado",
            "Se encontro una mejor alineacion ICAM/MICRON"]),
    ]),
]

# Listas que REEMPLAZAN la de un área (una sola vez, con su marca): todo lo que había en el área sale de la lista
# (activo = 0; los reportes de QC ya guardados no cambian) y queda solo esta, en todas las tablas y para cualquier producto.
# N3 (Rosember, 26-oct-2026): la lista reorganizada en 4 títulos. Los hallazgos que había (la lista del 9-oct-2026 y los
# que agregaron los aprobadores) se revisaron con Rosember y cada uno quedó reemplazado por uno de estos.
REEMPLAZOS = [
    ("qc_n3_lista_26oct", "N3 Prosthetic", [
        ("Diseño", [
            "Cambios incorrectos/no realizados (cambios que no sigan el RX ni los comentarios del doctor)",
            "Morfología incorrecta (size, degree, shape)",
            "Scans mal alineados (plato, VDO, oclusión, tissues, stumps, antagonista)",
            "Diseño mal alineado (waxups y barras mal alineados después de hacer los cambios)",
            "Micron/Icam (mal alineado, se omitieron los implantes incorrectos)",
            "Correcciones de diseño en productos finales (falta o exceso de material, TC mal diseñado, parámetros incorrectos)",
            "Diseño incompleto (TC, barras, guias, screw retained)",
            "No se cambió el producto (shorten dental arch, remake con workflow de N3)"]),
        ("Evidencias", [
            "Evidencias de ICAM/Micron (No se subieron/se subieron incorrectas)",
            "Evidencias de plataforma y RX (No se subieron/se subieron incorrectas)",
            "Evidencias de angulación de implantes (No se subieron/se subieron incorrectas)",
            "Evidencias de barras vs tissues (No se subieron/se subieron incorrectas)",
            "Evidencias de reducción de tissue (No se subieron/se subieron incorrectas)",
            "HTML Bite (No se subió/se subió incorrecto)",
            "Evidencias de medidas nightguard (No se subieron/se subieron incorrectas)",
            "Evidencias de diseño de nightguard (No se subieron/se subieron incorrectas)",
            "Evidencias de oclusión de TC (No se subieron/se subieron incorrectas)",
            "Evidencia de pesos de recortes (No se subió/se subió incorrecta)",
            "HTML TC vs Antagonista (No se subió/se subió incorrecto)"]),
        ("Comentarios /reportes", [
            "No se dejaron comentarios, se dejaron los de otro paciente",
            "VDO diferente al utilizado en el diseño",
            "Morfología (size, degree, shape) diferente a la utilizada en el diseño",
            "Bar Adapt diferente al aplicado en el diseño",
            "Implantes omitidos/movidos diferente a los aplicados en el diseño",
            "Comentarios adicionales (no se dejaron, se dejaron incompletos o eran incorrectos)",
            "Final prosthetic design mal diligenciado (no coincide con los cambios y morfología usada)",
            "Reporte de medidas (No se subieron/se subieron incorrectas)"]),
        ("To mill", [
            "No se subió a la plataforma",
            "Se subió incompleto a la plataforma",
            "Se subieron archivos incorrectos en la carpeta a la plataforma o de otro paciente",
            "La carpeta del TC tenía el nombre incorrecto"]),
    ]),
]


def _clave_texto(t: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFD", t or "")
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn").lower()).strip()


def _cargar_listas(db: Session) -> None:
    for marca, nombre_area, titulos in CARGAS:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            continue
        area = db.query(DesignArea).filter(DesignArea.nombre == nombre_area).first()
        if not area:
            continue
        try:
            filas = db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area.id).all()
            orden = _siguiente_orden(db, area.id)
            for titulo, items in titulos:
                for texto in items:
                    k = _clave_texto(texto)
                    previas = [f for f in filas if f.hallazgo and _clave_texto(f.hallazgo) == k]
                    if previas:   # repetido: se reemplaza el que estaba (texto y título nuevos, activo)
                        f = previas[0]
                        f.titulo, f.hallazgo, f.tabla, f.producto_clave, f.activo = titulo, texto, "", "", 1
                        for extra in previas[1:]:
                            extra.activo = 0
                    else:
                        db.add(DesignQcCatalogo(area_id=area.id, titulo=titulo, hallazgo=texto, tabla="", producto_clave="", orden=orden))
                        orden += 1
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        except Exception:
            db.rollback()  # otro proceso la cargó al mismo tiempo


def _reemplazar_listas(db: Session) -> None:
    for marca, nombre_area, titulos in REEMPLAZOS:
        if db.query(DesignConexionRegla).filter(DesignConexionRegla.tipo == "sistema", DesignConexionRegla.clave == marca).first():
            continue
        area = db.query(DesignArea).filter(DesignArea.nombre == nombre_area).first()
        if not area:
            continue
        try:
            db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area.id).update({DesignQcCatalogo.activo: 0})
            n = 0
            for titulo, items in titulos:
                for texto in items:
                    n += 1
                    db.add(DesignQcCatalogo(area_id=area.id, titulo=titulo, hallazgo=texto, tabla="", producto_clave="", orden=n))
            db.add(DesignConexionRegla(tipo="sistema", clave=marca, creado_por="Sistema"))
            db.commit()
        except Exception:
            db.rollback()  # otro proceso la cargó al mismo tiempo


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
    _cargar_listas(db)
    _reemplazar_listas(db)


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


def renombrar_titulo(db: Session, area_id: int, titulo: str, nuevo: str) -> int:
    """Corrige el nombre de un título del área (Rosember, 21-oct-2026; p. ej. una palabra mal escrita). Cambia todas sus
    filas; los reportes de QC ya guardados conservan el texto con el que se guardaron. Devuelve cuántas filas cambió."""
    titulo, nuevo = _limpio(titulo, "título"), _limpio(nuevo, "título")
    if nuevo == titulo:
        return 0
    if any(k.lower() == nuevo.lower() and k.lower() != titulo.lower() for k in _titulos(db, area_id)):
        raise ValueError("Ya hay otro título con ese nombre.")
    filas = db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area_id, DesignQcCatalogo.titulo == titulo).all()
    if not filas:
        raise KeyError(titulo)
    for r in filas:
        r.titulo = nuevo
    db.commit()
    return len(filas)


def eliminar_titulo(db: Session, area_id: int, titulo: str) -> int:
    """Quita un título y todos sus hallazgos de la lista del área (Rosember, 26-oct-2026). Los reportes de QC ya guardados
    no cambian. Devuelve cuántas filas quitó."""
    titulo = _limpio(titulo, "título")
    filas = db.query(DesignQcCatalogo).filter(DesignQcCatalogo.area_id == area_id, DesignQcCatalogo.titulo == titulo,
                                              DesignQcCatalogo.activo == 1).all()
    if not filas:
        raise KeyError(titulo)
    for r in filas:
        r.activo = 0
    db.commit()
    return len(filas)


def editar_hallazgo(db: Session, item_id: int, texto: str) -> dict:
    """Corrige el texto de un hallazgo (Rosember, 26-oct-2026). Los reportes ya guardados conservan el texto con el que se
    guardaron."""
    texto = _limpio(texto, "hallazgo")
    r = db.get(DesignQcCatalogo, item_id)
    if not r or not r.activo or not r.hallazgo:
        raise KeyError(item_id)
    if texto != r.hallazgo and db.query(DesignQcCatalogo).filter(
            DesignQcCatalogo.area_id == r.area_id, DesignQcCatalogo.titulo == r.titulo, DesignQcCatalogo.activo == 1,
            DesignQcCatalogo.id != r.id, func.lower(DesignQcCatalogo.hallazgo) == texto.lower()).first():
        raise ValueError("Ese hallazgo ya está en el título.")
    r.hallazgo = texto
    db.commit()
    return {"id": r.id, "texto": r.hallazgo}


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
