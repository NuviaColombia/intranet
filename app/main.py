from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from pathlib import Path
from sqlalchemy import inspect, text
from . import config
from .database import engine, SessionLocal
from .models import Base, TipoPermiso, Empleado, Empresa, Area, Configuracion
from .routers import auth_routes, solicitudes, aprobaciones, admin, dashboard, certificaciones, horas_extra, portal

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


@app.exception_handler(307)
async def redirect_handler(request: Request, exc):
    return RedirectResponse(exc.headers.get("Location", "/login"))


TIPOS_INICIALES = [("Cita médica", None), ("Calamidad doméstica", None),
                   ("Licencia de luto", 5), ("Permiso personal", 3),
                   ("Diligencia personal (horas)", None)]

EMPRESAS_INICIALES = ["Nuvia Smiles Colombia SAS", "Nuvia Design Colombia SAS"]

AREAS_INICIALES = ["Admin", "Operativa"]


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
    db = SessionLocal()
    try:
        if db.query(TipoPermiso).count() == 0:
            for nombre, dias in TIPOS_INICIALES:
                db.add(TipoPermiso(nombre=nombre, dias_anuales=dias))
        if not db.query(TipoPermiso).filter(TipoPermiso.es_vacaciones == 1).first():
            db.add(TipoPermiso(nombre="Vacaciones", dias_anuales=None, es_vacaciones=1))
        if db.query(Empresa).count() == 0:
            for nombre in EMPRESAS_INICIALES:
                db.add(Empresa(nombre=nombre))
        if db.query(Area).count() == 0:
            for nombre in AREAS_INICIALES:
                db.add(Area(nombre=nombre))
        if not db.query(Configuracion).first():
            db.add(Configuracion(sabado_habil=0))
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
