import json
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
from .models_design import (DesignArea, DesignCatalogo, DesignAusenciaTipo, DesignPreApprovedSheet,
                            DesignPreApprovedCentro, DesignPreApprovedDoctor, DesignPreApprovedFila,
                            DesignPreApprovedCelda, DesignPerfCriterio, DesignPerfSheet, DesignPerfEmpleado,
                            DesignPerfCelda, DesignPerfGanador, DesignPerfSeleccionFila, DesignPerfSeleccionCelda,
                            DesignCanvasDoc, FORMATO_DUAL, FORMATO_SINGLE, FORMATO_N2, FORMATO_SUPPORT)
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

# Catálogos reales tomados del HTML original (N3_Schedule_Demo), no inventados.
DESIGN_CENTROS = [
    "Indianapolis", "Cleveland", "Wellesley", "Westbury", "Nashville", "Orlando", "Dublin",
    "San Antonio", "St Louis", "Moorestown", "Harrison", "Reading", "Vegas", "Austin",
    "Minneapolis", "Houston", "Training", "Pittsburgh", "Detroit", "Chicago", "Parsippany",
    "Fort Worth", "Colaboracion", "Milwaukee", "Alpharetta", "Dallas", "Marietta",
]

_DESIGN_PRODUCTOS_N3_N6 = [
    "N3 - Full Mouth 24Z", "N3 - Full Mouth G-CAM",
    "N3 - Removable Denture With Fixed Arch", "N3 - Removable Denture With Fixed Arch 24Z",
    "N3 - Removable Denture/G-Cam Ti Bar", "N3 - Removable Denture/Zirconia", "N3 - Redo Removable Denture",
    "N3 - Single 24Z", "N3 - Single G-Cam/tibar", "N3 - Single Removable Denture",
    "N3 - Redo Full Mouth 24Z", "N3 - Redo Single 24Z", "N3 - Redo Single GCam",
    "N3 - ShortBridge24Z", "N3 - ShortBridge G-Cam", "N3 - Screw Retain",
    "N2 - TC Design", "N3 - Printed Nightguard", "N3 - NightGuard", "N3 - Demo Pickup",
    "N6 - Full Mouth 24Z Remake", "N6 - Single 24Z Remake",
]

DESIGN_PRODUCTOS_POR_AREA = {
    "N3 Prosthetic": _DESIGN_PRODUCTOS_N3_N6,
    "N6 Material Changes": _DESIGN_PRODUCTOS_N3_N6,
    "Face Design": ["Traveling", "Full Mouth", "Single 24z"],
    "N2 Demodenture": ["Full Mouth", "Full Mouth Travel", "Full Mouth Regular", "Full Mouth Changes",
                       "Single 24z", "Single G-cam", "Single Travel", "Single Regular"],
    "Support": [],
}

_DESIGN_ESTADOS_N3_N6 = ["Pickup received", "Initiated", "Ready to design", "Bite ready",
                        "Hold", "Approved", "Canceled"]
_DESIGN_ESTADOS_FACE = ["Ready to design", "Pending approval", "Initiated", "Hold", "Approved",
                        "Skipped", "Training", "Finish", "Change Ready"]
_DESIGN_ESTADOS_N2 = _DESIGN_ESTADOS_FACE + ["Meeting", "Html", "Practice", "Canceled"]

DESIGN_ESTADOS_POR_AREA = {
    "N3 Prosthetic": _DESIGN_ESTADOS_N3_N6,
    "N6 Material Changes": _DESIGN_ESTADOS_N3_N6,
    "Face Design": _DESIGN_ESTADOS_FACE,
    "N2 Demodenture": _DESIGN_ESTADOS_N2,
    "Support": _DESIGN_ESTADOS_N3_N6,  # placeholder hasta que se capture el flujo real de Support
}

DESIGN_ETAPAS_SUPPORT = [
    "Bite Design", "Zn Design", "Doctor Authorization", "Bar and wax zn milling", "Lab check out",
    "Design tc zn over bar", "Manager Verification", "Quality contro surgery", "Processing", "Milling",
    "Final Qc Zn", "Printer", "Scan Bar Zn", "Zn Milling", "Zn Cut/ Sintering", "Zn Porcelain",
    "Delivery From Col", "Qc Initial Zn",
]
DESIGN_SOPORTES_SUPPORT = ["Xamir Mercado", "Diego Sampayo"]
DESIGN_CLASIFICACIONES_SUPPORT = ["Soporte"]

DESIGN_AUSENCIAS_INICIALES = [
    "Vacaciones", "Calamidad doméstica", "Licencia por luto", "Licencia por paternidad",
    "Descanso compensatorio", "Festivo compensatorio", "Incapacidad", "Suspensión",
    "Remunerada", "No remunerada", "Cumpleaños", "Grado",
]

# Canvas: 8 plantillas base (marcos ya ubicados sobre una hoja de 1080x1080), portadas
# 1:1 desde cvFitGrid()/cvFiveGrid() de la herramienta original. Se siembran como hojas
# reales (no "elegibles") en cada área, igual que hacía cvSeedLibrary() al abrir el panel.
CANVAS_TEMPLATES = [
    {"id": "upper-1", "nombre": "Upper", "titulo": "Upper",
     "frames": [{"x": 90, "y": 301, "w": 900, "h": 675}]},
    {"id": "upper-2", "nombre": "Upper", "titulo": "Upper",
     "frames": [{"x": 90, "y": 475, "w": 436, "h": 327}, {"x": 554, "y": 475, "w": 436, "h": 327}]},
    {"id": "upper-4", "nombre": "Upper", "titulo": "Upper",
     "frames": [{"x": 90, "y": 297, "w": 436, "h": 327}, {"x": 554, "y": 297, "w": 436, "h": 327},
                {"x": 90, "y": 652, "w": 436, "h": 327}, {"x": 554, "y": 652, "w": 436, "h": 327}]},
    {"id": "lower-1", "nombre": "Lower", "titulo": "Lower",
     "frames": [{"x": 90, "y": 301, "w": 900, "h": 675}]},
    {"id": "lower-2", "nombre": "Lower", "titulo": "Lower",
     "frames": [{"x": 90, "y": 475, "w": 436, "h": 327}, {"x": 554, "y": 475, "w": 436, "h": 327}]},
    {"id": "lower-4", "nombre": "Lower", "titulo": "Lower",
     "frames": [{"x": 90, "y": 297, "w": 436, "h": 327}, {"x": 554, "y": 297, "w": 436, "h": 327},
                {"x": 90, "y": 652, "w": 436, "h": 327}, {"x": 554, "y": 652, "w": 436, "h": 327}]},
    {"id": "upper-implant", "nombre": "Upper Implant Angulation", "titulo": "UPPER IMPLANT ANGULATION",
     "frames": [{"x": 190, "y": 232, "w": 336, "h": 252}, {"x": 554, "y": 232, "w": 336, "h": 252},
                {"x": 190, "y": 512, "w": 336, "h": 252}, {"x": 554, "y": 512, "w": 336, "h": 252},
                {"x": 372, "y": 792, "w": 336, "h": 252}]},
    {"id": "lower-implant", "nombre": "Lower Implant Angulation", "titulo": "LOWER IMPLANT ANGULATION",
     "frames": [{"x": 190, "y": 232, "w": 336, "h": 252}, {"x": 554, "y": 232, "w": 336, "h": 252},
                {"x": 190, "y": 512, "w": 336, "h": 252}, {"x": 554, "y": 512, "w": 336, "h": 252},
                {"x": 372, "y": 792, "w": 336, "h": 252}]},
]


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
    columnas_design_favoritos = {c["name"] for c in inspect(engine).get_columns("design_favoritos")}
    if "protocolo_id" not in columnas_design_favoritos:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE design_favoritos ADD COLUMN protocolo_id INTEGER REFERENCES design_protocolos(id)"))
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
                db.add(DesignArea(nombre=nombre, formato=formato, orden=i))
            db.flush()
        # Backfill idempotente de catálogos por (área, tipo) -- corre siempre, así que también
        # completa instalaciones que ya tenían las áreas creadas pero catálogos parciales/vacíos.
        for area in db.query(DesignArea).all():
            catalogos_area = [("centro", DESIGN_CENTROS), ("producto", DESIGN_PRODUCTOS_POR_AREA.get(area.nombre, [])),
                              ("estado", DESIGN_ESTADOS_POR_AREA.get(area.nombre, []))]
            if area.nombre == "Support":
                catalogos_area += [("etapa", DESIGN_ETAPAS_SUPPORT), ("soporte", DESIGN_SOPORTES_SUPPORT),
                                   ("clasificacion", DESIGN_CLASIFICACIONES_SUPPORT)]
            for tipo, valores in catalogos_area:
                if not valores:
                    continue
                if db.query(DesignCatalogo).filter(DesignCatalogo.area_id == area.id,
                                                   DesignCatalogo.tipo == tipo).count() == 0:
                    for j, valor in enumerate(valores, start=1):
                        db.add(DesignCatalogo(area_id=area.id, tipo=tipo, valor=valor, orden=j))
        for nombre in DESIGN_AUSENCIAS_INICIALES:
            if not db.query(DesignAusenciaTipo).filter(DesignAusenciaTipo.nombre == nombre).first():
                orden = db.query(DesignAusenciaTipo).count() + 1
                db.add(DesignAusenciaTipo(nombre=nombre, orden=orden))
        # Pre-Approved N3: datos reales (9 diseñadores/managers) extraídos del HTML original.
        seed_pa_path = Path(__file__).resolve().parent / "seed_data" / "design_preapproved_n3.json"
        area_n3 = db.query(DesignArea).filter(DesignArea.nombre == "N3 Prosthetic").first()
        if area_n3 and seed_pa_path.exists() and db.query(DesignPreApprovedSheet).filter(
                DesignPreApprovedSheet.area_id == area_n3.id).count() == 0:
            with open(seed_pa_path, encoding="utf-8") as f:
                pa_data = json.load(f)
            for i, (nombre_designer, sheet_data) in enumerate(pa_data.items(), start=1):
                sheet = DesignPreApprovedSheet(area_id=area_n3.id, nombre=nombre_designer,
                                               titulo=sheet_data.get("title", "Pre-approved changes"),
                                               changes_label=sheet_data.get("changesLabel", "Changes"), orden=i)
                db.add(sheet)
                db.flush()
                for j, centro in enumerate(sheet_data.get("centers", []), start=1):
                    db.add(DesignPreApprovedCentro(sheet_id=sheet.id, nombre=centro.get("name", ""),
                                                   span=centro.get("span") or 1, orden=j))
                doctor_ids = []
                for j, doc_nombre in enumerate(sheet_data.get("doctors", []), start=1):
                    d = DesignPreApprovedDoctor(sheet_id=sheet.id, nombre=doc_nombre, orden=j)
                    db.add(d)
                    db.flush()
                    doctor_ids.append(d.id)
                for j, fila_data in enumerate(sheet_data.get("rows", []), start=1):
                    fila = DesignPreApprovedFila(sheet_id=sheet.id, criterio=fila_data.get("c", ""), orden=j)
                    db.add(fila)
                    db.flush()
                    for k, valor in enumerate(fila_data.get("v", [])):
                        if k < len(doctor_ids) and valor:
                            db.add(DesignPreApprovedCelda(fila_id=fila.id, doctor_id=doctor_ids[k], valor=valor))
        # Desempeño: evaluaciones mensuales reales + selección de empleado del mes,
        # extraídas del HTML original. Solo administradores ven este módulo.
        seed_perf_path = Path(__file__).resolve().parent / "seed_data" / "design_perf.json"
        if seed_perf_path.exists():
            with open(seed_perf_path, encoding="utf-8") as f:
                perf_data = json.load(f)
            if db.query(DesignPerfCriterio).count() == 0:
                for i, nombre in enumerate(perf_data.get("criteria", []), start=1):
                    db.add(DesignPerfCriterio(nombre=nombre, orden=i))
                db.flush()
            criterio_ids = [c.id for c in db.query(DesignPerfCriterio).order_by(DesignPerfCriterio.orden).all()]
            for i, sheet_data in enumerate(perf_data.get("sheets", []), start=1):
                nombre_sheet = sheet_data.get("name", "")
                if db.query(DesignPerfSheet).filter(DesignPerfSheet.nombre == nombre_sheet,
                                                    DesignPerfSheet.tipo == "eval").first():
                    continue
                sheet = DesignPerfSheet(nombre=nombre_sheet, tipo="eval",
                                        meses=json.dumps(sheet_data.get("months", []), ensure_ascii=False), orden=i)
                db.add(sheet)
                db.flush()
                for j, emp_data in enumerate(sheet_data.get("employees", []), start=1):
                    emp = DesignPerfEmpleado(sheet_id=sheet.id, nombre=emp_data.get("n", ""),
                                             nota=emp_data.get("nt", ""), total=emp_data.get("t", 0) or 0,
                                             totales_mes=json.dumps(emp_data.get("tr", []), ensure_ascii=False),
                                             orden=j)
                    db.add(emp)
                    db.flush()
                    for crit_idx, meses_vals in enumerate(emp_data.get("v", [])):
                        if crit_idx >= len(criterio_ids):
                            continue
                        for mes_idx, celda in enumerate(meses_vals):
                            if celda and celda != 0:
                                nivel, puntaje = celda[0], celda[1]
                                db.add(DesignPerfCelda(empleado_id=emp.id, criterio_id=criterio_ids[crit_idx],
                                                       mes_indice=mes_idx, nivel=nivel, puntaje=puntaje))
            for sel_data in perf_data.get("seleccion", []):
                nombre_sheet = sel_data.get("name", "")
                if db.query(DesignPerfSheet).filter(DesignPerfSheet.nombre == nombre_sheet,
                                                    DesignPerfSheet.tipo == "seleccion").first():
                    continue
                sheet = DesignPerfSheet(nombre=nombre_sheet, tipo="seleccion",
                                        meses=json.dumps(sel_data.get("months", []), ensure_ascii=False),
                                        orden=len(perf_data.get("sheets", [])) + 1)
                db.add(sheet)
                db.flush()
                for j, gan_data in enumerate(sel_data.get("winners", []), start=1):
                    db.add(DesignPerfGanador(sheet_id=sheet.id, categoria=gan_data.get("cat", ""), orden=j,
                                             ganadores_mes=json.dumps(gan_data.get("byMonth", []), ensure_ascii=False)))
                for j, fila_data in enumerate(sel_data.get("rows", []), start=1):
                    fila = DesignPerfSeleccionFila(sheet_id=sheet.id, evaluador=fila_data.get("ev", ""), orden=j)
                    db.add(fila)
                    db.flush()
                    for mes_idx, cell in enumerate(fila_data.get("cells", [])):
                        if not cell:
                            continue
                        persona = cell[0] if len(cell) > 0 else ""
                        puntaje = cell[1] if len(cell) > 1 else ""
                        nota = cell[2] if len(cell) > 2 else ""
                        if str(persona).strip().lower() == "n/a" and not nota:
                            continue
                        db.add(DesignPerfSeleccionCelda(fila_id=fila.id, mes_indice=mes_idx, persona=str(persona),
                                                        puntaje=str(puntaje), nota=nota))
        # Canvas: siembra las 8 plantillas base por área (idempotente por área, no globalmente,
        # para que un área agregada después de este deploy también reciba sus plantillas).
        for area in db.query(DesignArea).all():
            if db.query(DesignCanvasDoc).filter(DesignCanvasDoc.area_id == area.id).count() == 0:
                for i, tpl in enumerate(CANVAS_TEMPLATES, start=1):
                    db.add(DesignCanvasDoc(area_id=area.id, nombre=tpl["nombre"], template_id=tpl["id"],
                                           titulo=tpl["titulo"],
                                           frames=json.dumps([{"id": f"f{j}", **f, "img": None}
                                                              for j, f in enumerate(tpl["frames"])],
                                                             ensure_ascii=False),
                                           orden=i))
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
