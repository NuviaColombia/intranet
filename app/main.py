from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from pathlib import Path
from sqlalchemy import inspect, text
from . import config
from .database import engine, SessionLocal
from .models import Base, TipoPermiso, Empleado, Empresa, Area, Configuracion
from .models_custodia import CustodiaArea, CustodiaMotivo
from .models_design import DesignArea, DesignCatalogo, DesignAusenciaTipo, FORMATO_DUAL, FORMATO_SINGLE, \
    FORMATO_N2, FORMATO_SUPPORT
from .routers import (auth_routes, solicitudes, aprobaciones, admin, dashboard, certificaciones, horas_extra,
                      portal, custodia, mis_aprobaciones, custodia_parametros, design_schedule)

app = FastAPI(title="Solicitudes Nuvia")
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY, max_age=60 * 60 * 10)
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")

app.include_router(auth_routes.router)
app.include_router(portal.router)
app.include_router(dashboard.router)
app.include_router(solicitudes.router)
app.include_router(aprobaciones.router)
app.include_router(admin.router)
app.include_router(certificaciones.router)
app.include_router(horas_extra.router)
app.include_router(custodia.router)
app.include_router(custodia_parametros.router)
app.include_router(mis_aprobaciones.router)
app.include_router(design_schedule.router)


@app.exception_handler(307)
async def redirect_handler(request: Request, exc):
    return RedirectResponse(exc.headers.get("Location", "/login"))


TIPOS_INICIALES = [("Cita médica", None, 1), ("Calamidad doméstica", None, 1),
                   ("Licencia de luto", 5, 0), ("Permiso personal", 3, 1),
                   ("Diligencia personal (horas)", None, 1)]

EMPRESAS_INICIALES = ["Nuvia Smiles Colombia SAS", "Nuvia Design Colombia SAS"]

AREAS_INICIALES = ["Admin", "Operativa"]

CUSTODIA_AREAS_INICIALES = [
    ("MILLING", 1), ("CORTE", 1), ("SINTERING/SANDBLAST", 1), ("GLAZE", 1), ("CRISTALES", 1),
    ("QC FINAL", 1), ("DIR PRODUCCIÓN", 1), ("DIR PRODUCCIÓN - DAÑADO", 1), ("EMPAQUE", 1), ("BODEGA", 1),
]  # (nombre, es_inventario) -- EMPAQUE cuenta como inventario: toda orden que llega ahí se considera completada

CUSTODIA_MOTIVOS_INICIALES = ["PRODUCCIÓN NORMAL", "MERMA/DAÑO", "DEVOLUCIÓN"]

DESIGN_AREAS_INICIALES = [
    ("N3 Prosthetic", FORMATO_DUAL), ("N6 Material Changes", FORMATO_DUAL),
    ("Face Design", FORMATO_SINGLE), ("N2 Demodenture", FORMATO_N2), ("Support", FORMATO_SUPPORT),
]  # (nombre, formato)

DESIGN_ESTADOS_N3_N6 = ["Pickup received", "Initiated", "Ready to design", "Bite ready",
                        "Hold", "Approved", "Canceled"]

DESIGN_AUSENCIAS_INICIALES = ["Vacaciones", "Incapacidad", "Permiso", "Ausencia"]


@app.on_event("startup")
def init_db():
    Base.metadata.create_all(bind=engine)
    columnas_auditoria = {c["name"] for c in inspect(engine).get_columns("auditoria")}
    if "empleado_id" not in columnas_auditoria:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE auditoria ADD COLUMN empleado_id INTEGER REFERENCES empleados(id)"))
    columnas_empleados = {c["name"] for c in inspect(engine).get_columns("empleados")}
    if "modulos" not in columnas_empleados:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE empleados ADD COLUMN modulos VARCHAR(100) DEFAULT 'people'"))
            conn.execute(text("UPDATE empleados SET modulos = 'people' WHERE modulos IS NULL"))
    columnas_solicitudes = {c["name"] for c in inspect(engine).get_columns("solicitudes")}
    if "hora_inicio" not in columnas_solicitudes:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE solicitudes ADD COLUMN hora_inicio TIME"))
            conn.execute(text("ALTER TABLE solicitudes ADD COLUMN hora_fin TIME"))
    columnas_tipos = {c["name"] for c in inspect(engine).get_columns("tipos_permiso")}
    if "permite_horas" not in columnas_tipos:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tipos_permiso ADD COLUMN permite_horas INTEGER DEFAULT 1"))
            conn.execute(text(
                "UPDATE tipos_permiso SET permite_horas = 0 WHERE nombre = 'Licencia de luto' OR es_vacaciones = 1"))
    if "area_custodia" not in columnas_empleados:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE empleados ADD COLUMN area_custodia VARCHAR(100) DEFAULT ''"))
            conn.execute(text("UPDATE empleados SET area_custodia = '' WHERE area_custodia IS NULL"))
    if "salario" not in columnas_empleados:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE empleados ADD COLUMN salario FLOAT"))
    columnas_factores = {c["name"] for c in inspect(engine).get_columns("custodia_factores_discos")}
    if "activo" not in columnas_factores:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE custodia_factores_discos ADD COLUMN activo INTEGER DEFAULT 1"))
    columnas_custodia_areas = {c["name"] for c in inspect(engine).get_columns("custodia_areas")}
    if "alerta_horas_advertencia" not in columnas_custodia_areas:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE custodia_areas ADD COLUMN alerta_horas_advertencia INTEGER DEFAULT 24"))
            conn.execute(text("ALTER TABLE custodia_areas ADD COLUMN alerta_horas_critica INTEGER DEFAULT 48"))
            conn.execute(text(
                "UPDATE custodia_areas SET alerta_horas_advertencia = 24 WHERE alerta_horas_advertencia IS NULL"))
            conn.execute(text(
                "UPDATE custodia_areas SET alerta_horas_critica = 48 WHERE alerta_horas_critica IS NULL"))
    # Corrección de negocio: EMPAQUE sí cuenta como ubicación de inventario -- toda orden que
    # llega ahí se considera completada, y debe seguir apareciendo en Ubicación actual/Historial.
    with engine.begin() as conn:
        conn.execute(text("UPDATE custodia_areas SET es_inventario = 1 WHERE nombre = 'EMPAQUE'"))
    db = SessionLocal()
    try:
        if db.query(TipoPermiso).count() == 0:
            for nombre, dias, permite_horas in TIPOS_INICIALES:
                db.add(TipoPermiso(nombre=nombre, dias_anuales=dias, permite_horas=permite_horas))
        if not db.query(TipoPermiso).filter(TipoPermiso.es_vacaciones == 1).first():
            db.add(TipoPermiso(nombre="Vacaciones", dias_anuales=None, es_vacaciones=1, permite_horas=0))
        if db.query(Empresa).count() == 0:
            for nombre in EMPRESAS_INICIALES:
                db.add(Empresa(nombre=nombre))
        if db.query(Area).count() == 0:
            for nombre in AREAS_INICIALES:
                db.add(Area(nombre=nombre))
        if not db.query(Configuracion).first():
            db.add(Configuracion(sabado_habil=0))
        if db.query(CustodiaArea).count() == 0:
            for i, (nombre, es_inventario) in enumerate(CUSTODIA_AREAS_INICIALES, start=1):
                db.add(CustodiaArea(nombre=nombre, orden=i, es_inventario=es_inventario))
        if db.query(CustodiaMotivo).count() == 0:
            for i, nombre in enumerate(CUSTODIA_MOTIVOS_INICIALES, start=1):
                db.add(CustodiaMotivo(nombre=nombre, orden=i))
        if db.query(DesignArea).count() == 0:
            for i, (nombre, formato) in enumerate(DESIGN_AREAS_INICIALES, start=1):
                area = DesignArea(nombre=nombre, formato=formato, orden=i)
                db.add(area)
            db.flush()
            for area in db.query(DesignArea).filter(DesignArea.formato == FORMATO_DUAL).all():
                for j, estado in enumerate(DESIGN_ESTADOS_N3_N6, start=1):
                    db.add(DesignCatalogo(area_id=area.id, tipo="estado", valor=estado, orden=j))
        if db.query(DesignAusenciaTipo).count() == 0:
            for i, nombre in enumerate(DESIGN_AUSENCIAS_INICIALES, start=1):
                db.add(DesignAusenciaTipo(nombre=nombre, orden=i))
        # Garantizar que los correos de ADMIN_EMAILS existan y tengan rol admin
        for email in config.ADMIN_EMAILS:
            emp = db.query(Empleado).filter(Empleado.email == email).first()
            if not emp:
                emp = Empleado(nombres="Admin", apellidos=email.split("@")[0],
                               empresa="-", cargo="Administrador", area="-",
                               identificacion=f"admin-{email}", email=email,
                               num_aprobaciones=1, rol="admin")
                db.add(emp)
            elif emp.rol != "admin":
                emp.rol = "admin"
        db.commit()
    finally:
        db.close()
