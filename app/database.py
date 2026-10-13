import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import DATABASE_URL

# Pool: los valores por defecto siguen siendo 5 + 10. Si el plan de la base permite más conexiones, se puede subir con
# DB_POOL_SIZE y DB_MAX_OVERFLOW. pool_recycle: una conexión que lleva 30 min sin usarse se renueva (evita errores tras
# un rato de inactividad).
_POOL = {"pool_recycle": 1800, "pool_pre_ping": True}
if not DATABASE_URL.startswith("sqlite"):
    if os.getenv("DB_POOL_SIZE"):
        _POOL["pool_size"] = int(os.getenv("DB_POOL_SIZE"))
    if os.getenv("DB_MAX_OVERFLOW"):
        _POOL["max_overflow"] = int(os.getenv("DB_MAX_OVERFLOW"))
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    **_POOL,
)
if DATABASE_URL.startswith("sqlite"):
    # SQLite no revisa las llaves foráneas si no se le pide; Postgres (producción) sí. Así un error de ese tipo
    # aparece también al probar en local y no por primera vez en producción.
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_llaves_foraneas(conexion, _registro):
        conexion.execute("PRAGMA foreign_keys=ON")

if DATABASE_URL.startswith("postgresql"):
    # Postgres rechaza el carácter NUL en cualquier texto (también en una búsqueda: "¿ya existe un área con este
    # nombre?"), y eso daba error 500. Se reemplaza por un espacio en los parámetros de todas las consultas.
    from sqlalchemy import event as _event

    def _sin_nul(v):
        return v.replace("\x00", " ") if isinstance(v, str) and "\x00" in v else v

    def _limpiar_parametros(p):
        if isinstance(p, dict):
            return {k: _sin_nul(v) for k, v in p.items()}
        if isinstance(p, (list, tuple)):
            return type(p)(_limpiar_parametros(x) if isinstance(x, (dict, list, tuple)) else _sin_nul(x) for x in p)
        return p

    @_event.listens_for(engine, "before_cursor_execute", retval=True)
    def _postgres_sin_nul(conn, cursor, statement, parameters, context, executemany):
        return statement, _limpiar_parametros(parameters)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
