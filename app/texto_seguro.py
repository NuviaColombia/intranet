"""Textos seguros para Postgres, sin tocar el esquema.

Al asignar un texto a cualquier columna String/Text de un modelo se reemplazan los caracteres de control por un
espacio (p. ej. NUL, que llega al copiar desde algunos PDF o programas y Postgres rechaza) y, en String(n), se
recorta al largo de la columna. Antes un texto así daba error 500 y se perdía lo escrito. Tabulador, salto de
línea y retorno de carro se conservan.
"""
import re

from sqlalchemy import String, Text, event

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def instalar_limpieza(cls) -> None:
    """Instala la limpieza en las columnas de texto de un modelo (una sola vez por modelo)."""
    if cls.__dict__.get("_texto_seguro"):
        return
    cls._texto_seguro = True
    for prop in cls.__mapper__.column_attrs:
        col = prop.columns[0]
        if not isinstance(col.type, String):
            continue
        largo = None if isinstance(col.type, Text) else col.type.length

        def limpiar(target, value, oldvalue, initiator, _largo=largo):
            if isinstance(value, str):
                value = _CONTROL.sub(" ", value)
                if _largo:
                    value = value[:_largo]
            return value
        event.listen(getattr(cls, prop.key), "set", limpiar, retval=True)


def instalar_en_todos(base) -> int:
    """Instala la limpieza en todos los modelos registrados en `base` (llamar cuando ya estén importados)."""
    n = 0
    for mapper in base.registry.mappers:
        if not mapper.class_.__dict__.get("_texto_seguro"):
            instalar_limpieza(mapper.class_)
            n += 1
    return n
