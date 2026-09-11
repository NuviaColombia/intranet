from datetime import date, datetime, timedelta
from fastapi import APIRouter, Request, Depends, Form, UploadFile, File
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from ..database import get_db
from ..models import (Empleado, Solicitud, TipoPermiso, Auditoria, Empresa, Area, Configuracion,
                      MODULOS_DISPONIBLES, MODULOS_VALIDOS)
from ..auth import require_admin
from ..excel_import import importar_empleados, generar_plantilla, exportar_reporte
from ..services import auditar, notificar_empleado_creado
from ..main_templates import templates

router = APIRouter()

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ---------- Empleados ----------

@router.get("/empleados")
async def empleados(request: Request, user: Empleado = Depends(require_admin),
                    db: Session = Depends(get_db)):
    emps = db.query(Empleado).order_by(Empleado.apellidos).all()
    aprobadores = [e for e in emps if e.rol in ("aprobador", "admin")]
    empresas = db.query(Empresa).filter(Empresa.activo == 1).order_by(Empresa.nombre).all()
    areas = db.query(Area).filter(Area.activo == 1).order_by(Area.nombre).all()
    return templates.TemplateResponse(request, "empleados.html",
                                      {"user": user, "empleados": emps, "aprobadores": aprobadores,
                                       "empresas": empresas, "areas": areas,
                                       "modulos_disponibles": MODULOS_DISPONIBLES,
                                       "msg": request.query_params.get("msg"),
                                       "resultado": request.session.pop("import_resultado", None)})


@router.get("/empleados/plantilla")
async def plantilla(user: Empleado = Depends(require_admin)):
    return Response(generar_plantilla(), media_type=XLSX,
                    headers={"Content-Disposition": "attachment; filename=plantilla_empleados.xlsx"})


@router.post("/empleados/importar")
async def importar(request: Request, user: Empleado = Depends(require_admin),
                   db: Session = Depends(get_db), archivo: UploadFile = File(...)):
    contenido = await archivo.read()
    resultado = importar_empleados(db, contenido)
    auditar(db, user.email, "Import de empleados",
            f"creados={resultado['creados']} actualizados={resultado['actualizados']} "
            f"errores={len(resultado['errores'])}")
    db.commit()
    request.session["import_resultado"] = resultado
    return RedirectResponse("/empleados", status_code=303)


@router.post("/empleados/nuevo")
async def crear_empleado(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                         nombres: str = Form(...), apellidos: str = Form(...),
                         fecha_nacimiento: str = Form(""), fecha_inicio_empresa: str = Form(""),
                         empresa: str = Form(...),
                         cargo: str = Form(...), area: str = Form(...),
                         identificacion: str = Form(...), email: str = Form(...),
                         num_aprobaciones: int = Form(1), rol: str = Form("empleado"),
                         aprobador1_id: str = Form(""), aprobador2_id: str = Form(""),
                         modulos: list[str] = Form([])):
    identificacion = identificacion.strip()
    email = email.strip().lower()
    if db.query(Empleado).filter(Empleado.identificacion == identificacion).first():
        return RedirectResponse("/empleados?msg=Ya existe un empleado con esa identificación.", status_code=303)
    if db.query(Empleado).filter(Empleado.email == email).first():
        return RedirectResponse("/empleados?msg=Ya existe un empleado con ese correo.", status_code=303)
    emp = Empleado(
        nombres=nombres.strip(), apellidos=apellidos.strip(),
        fecha_nacimiento=date.fromisoformat(fecha_nacimiento) if fecha_nacimiento.strip() else None,
        fecha_inicio_empresa=date.fromisoformat(fecha_inicio_empresa) if fecha_inicio_empresa.strip() else None,
        empresa=empresa.strip(), cargo=cargo.strip(), area=area.strip(),
        identificacion=identificacion, email=email,
        num_aprobaciones=num_aprobaciones if num_aprobaciones in (1, 2) else 1,
        rol=rol if rol in ("empleado", "admin", "aprobador") else "empleado",
        aprobador1_id=int(aprobador1_id) if aprobador1_id else None,
        aprobador2_id=int(aprobador2_id) if aprobador2_id else None,
        modulos=",".join(m for m in modulos if m in MODULOS_VALIDOS),
    )
    db.add(emp)
    db.flush()
    auditar(db, user.email, f"Empleado creado manualmente: {emp.email}", empleado_id=emp.id)
    db.commit()
    notificar_empleado_creado(emp)
    return RedirectResponse("/empleados?msg=Empleado creado.", status_code=303)


@router.get("/empleados/{emp_id}/editar")
async def editar_empleado_form(request: Request, emp_id: int, user: Empleado = Depends(require_admin),
                               db: Session = Depends(get_db)):
    emp = db.get(Empleado, emp_id)
    if not emp:
        return RedirectResponse("/empleados?msg=Empleado no encontrado.", status_code=303)
    otros = db.query(Empleado).filter(Empleado.id != emp_id).order_by(Empleado.apellidos).all()
    aprobadores = [e for e in otros
                  if e.rol in ("aprobador", "admin") or e.id in (emp.aprobador1_id, emp.aprobador2_id)]
    empresas = db.query(Empresa).filter(Empresa.activo == 1).order_by(Empresa.nombre).all()
    if emp.empresa and emp.empresa not in [e.nombre for e in empresas]:
        empresas.append(Empresa(nombre=emp.empresa))
    areas = db.query(Area).filter(Area.activo == 1).order_by(Area.nombre).all()
    if emp.area and emp.area not in [a.nombre for a in areas]:
        areas.append(Area(nombre=emp.area))
    return templates.TemplateResponse(request, "empleado_editar.html",
                                      {"user": user, "emp": emp, "otros": otros, "aprobadores": aprobadores,
                                       "empresas": empresas, "areas": areas,
                                       "modulos_disponibles": MODULOS_DISPONIBLES,
                                       "error": request.query_params.get("error")})


@router.post("/empleados/{emp_id}")
async def editar_empleado(emp_id: int, user: Empleado = Depends(require_admin),
                          db: Session = Depends(get_db),
                          nombres: str = Form(...), apellidos: str = Form(...),
                          fecha_nacimiento: str = Form(""), fecha_inicio_empresa: str = Form(""),
                          empresa: str = Form(...),
                          cargo: str = Form(...), area: str = Form(...),
                          identificacion: str = Form(...), email: str = Form(...),
                          dias_vacaciones: float = Form(0),
                          rol: str = Form("empleado"), num_aprobaciones: int = Form(1),
                          aprobador1_id: str = Form(""), aprobador2_id: str = Form(""),
                          activo: int = Form(1), modulos: list[str] = Form([])):
    emp = db.get(Empleado, emp_id)
    if not emp:
        return RedirectResponse("/empleados?msg=Empleado no encontrado.", status_code=303)

    identificacion = identificacion.strip()
    email = email.strip().lower()
    if db.query(Empleado).filter(Empleado.identificacion == identificacion, Empleado.id != emp_id).first():
        return RedirectResponse(f"/empleados/{emp_id}/editar?error=Ya existe otro empleado con esa identificación.",
                                status_code=303)
    if db.query(Empleado).filter(Empleado.email == email, Empleado.id != emp_id).first():
        return RedirectResponse(f"/empleados/{emp_id}/editar?error=Ya existe otro empleado con ese correo.",
                                status_code=303)

    emp.nombres = nombres.strip()
    emp.apellidos = apellidos.strip()
    emp.fecha_nacimiento = date.fromisoformat(fecha_nacimiento) if fecha_nacimiento.strip() else None
    emp.fecha_inicio_empresa = date.fromisoformat(fecha_inicio_empresa) if fecha_inicio_empresa.strip() else None
    emp.empresa = empresa.strip()
    emp.cargo = cargo.strip()
    emp.area = area.strip()
    emp.identificacion = identificacion
    emp.email = email
    emp.dias_vacaciones = dias_vacaciones
    emp.rol = rol if rol in ("empleado", "admin", "aprobador") else "empleado"
    emp.num_aprobaciones = num_aprobaciones if num_aprobaciones in (1, 2) else 1
    emp.aprobador1_id = int(aprobador1_id) if aprobador1_id else None
    emp.aprobador2_id = int(aprobador2_id) if aprobador2_id else None
    emp.activo = 1 if activo else 0
    emp.modulos = ",".join(m for m in modulos if m in MODULOS_VALIDOS)
    auditar(db, user.email, f"Empleado editado: {emp.email}", empleado_id=emp.id)
    db.commit()
    return RedirectResponse("/empleados?msg=Empleado actualizado.", status_code=303)


# ---------- Parámetros (tipos de permiso) ----------

@router.get("/tipos")
async def tipos(request: Request, user: Empleado = Depends(require_admin),
                db: Session = Depends(get_db)):
    lista = db.query(TipoPermiso).order_by(TipoPermiso.nombre).all()
    empresas = db.query(Empresa).order_by(Empresa.nombre).all()
    areas = db.query(Area).order_by(Area.nombre).all()
    cfg = db.query(Configuracion).first()
    return templates.TemplateResponse(request, "tipos.html",
                                      {"user": user, "tipos": lista, "empresas": empresas, "areas": areas,
                                       "config": cfg, "msg": request.query_params.get("msg")})


@router.post("/tipos")
async def crear_tipo(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                     nombre: str = Form(...), dias_anuales: str = Form("")):
    db.add(TipoPermiso(nombre=nombre.strip(),
                       dias_anuales=float(dias_anuales) if dias_anuales.strip() else None))
    db.commit()
    return RedirectResponse("/tipos", status_code=303)


@router.post("/tipos/{tipo_id}/editar")
async def editar_tipo(tipo_id: int, user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                      nombre: str = Form(...), dias_anuales: str = Form("")):
    t = db.get(TipoPermiso, tipo_id)
    if t:
        t.nombre = nombre.strip()
        if not t.es_vacaciones:
            t.dias_anuales = float(dias_anuales) if dias_anuales.strip() else None
        auditar(db, user.email, f"Parámetro editado: {t.nombre}")
        db.commit()
    return RedirectResponse("/tipos?msg=Parámetro actualizado.", status_code=303)


@router.post("/tipos/{tipo_id}/toggle")
async def toggle_tipo(tipo_id: int, user: Empleado = Depends(require_admin),
                      db: Session = Depends(get_db)):
    t = db.get(TipoPermiso, tipo_id)
    if t:
        t.activo = 0 if t.activo else 1
        db.commit()
    return RedirectResponse("/tipos", status_code=303)


# ---------- Empresas ----------

@router.post("/empresas")
async def crear_empresa(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                        nombre: str = Form(...)):
    nombre = nombre.strip()
    if nombre and not db.query(Empresa).filter(Empresa.nombre == nombre).first():
        db.add(Empresa(nombre=nombre))
        auditar(db, user.email, f"Empresa agregada: {nombre}")
        db.commit()
    return RedirectResponse("/tipos?msg=Empresa agregada.", status_code=303)


@router.post("/empresas/{empresa_id}/toggle")
async def toggle_empresa(empresa_id: int, user: Empleado = Depends(require_admin),
                         db: Session = Depends(get_db)):
    e = db.get(Empresa, empresa_id)
    if e:
        e.activo = 0 if e.activo else 1
        db.commit()
    return RedirectResponse("/tipos", status_code=303)


# ---------- Áreas ----------

@router.post("/areas")
async def crear_area(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                     nombre: str = Form(...)):
    nombre = nombre.strip()
    if nombre and not db.query(Area).filter(Area.nombre == nombre).first():
        db.add(Area(nombre=nombre))
        auditar(db, user.email, f"Área agregada: {nombre}")
        db.commit()
    return RedirectResponse("/tipos?msg=Área agregada.", status_code=303)


@router.post("/areas/{area_id}/toggle")
async def toggle_area(area_id: int, user: Empleado = Depends(require_admin),
                      db: Session = Depends(get_db)):
    a = db.get(Area, area_id)
    if a:
        a.activo = 0 if a.activo else 1
        db.commit()
    return RedirectResponse("/tipos", status_code=303)


# ---------- Configuración general ----------

@router.post("/configuracion")
async def actualizar_configuracion(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                                   sabado_habil: str = Form("")):
    cfg = db.query(Configuracion).first()
    if not cfg:
        cfg = Configuracion()
        db.add(cfg)
    cfg.sabado_habil = 1 if sabado_habil else 0
    auditar(db, user.email, f"Configuración actualizada: sábado hábil = {bool(cfg.sabado_habil)}")
    db.commit()
    return RedirectResponse("/tipos?msg=Configuración actualizada.", status_code=303)


# ---------- Reportes ----------

@router.get("/reportes")
async def reportes(request: Request, user: Empleado = Depends(require_admin),
                   db: Session = Depends(get_db),
                   aud_desde: str = "", aud_hasta: str = "", aud_actor: str = "",
                   aud_accion: str = "", aud_empleado_id: str = "", aud_solicitud: str = "",
                   aud_detalle: str = ""):
    areas = [a[0] for a in db.query(Empleado.area).distinct().all() if a[0]]
    empresas = [e[0] for e in db.query(Empleado.empresa).distinct().all() if e[0]]

    q = db.query(Auditoria).options(joinedload(Auditoria.empleado))
    if aud_desde:
        q = q.filter(Auditoria.fecha >= date.fromisoformat(aud_desde))
    if aud_hasta:
        q = q.filter(Auditoria.fecha < date.fromisoformat(aud_hasta) + timedelta(days=1))
    if aud_actor:
        q = q.filter(Auditoria.actor.ilike(f"%{aud_actor}%"))
    if aud_accion:
        q = q.filter(Auditoria.accion.ilike(f"%{aud_accion}%"))
    if aud_empleado_id:
        q = q.filter(Auditoria.empleado_id == int(aud_empleado_id))
    if aud_solicitud:
        q = q.filter(Auditoria.solicitud_id == int(aud_solicitud))
    if aud_detalle:
        q = q.filter(Auditoria.detalle.ilike(f"%{aud_detalle}%"))
    audit = q.order_by(Auditoria.fecha.desc()).limit(300).all()

    certificados = (db.query(Auditoria).filter(Auditoria.accion == "Certificado laboral generado")
                    .order_by(Auditoria.fecha.desc()).limit(200).all())
    nombres_por_email = {e.email: e.nombre_completo for e in db.query(Empleado).all()}
    empleados_lista = db.query(Empleado).order_by(Empleado.apellidos).all()
    aud_filtros = {"desde": aud_desde, "hasta": aud_hasta, "actor": aud_actor, "accion": aud_accion,
                  "empleado_id": aud_empleado_id, "solicitud": aud_solicitud, "detalle": aud_detalle}
    return templates.TemplateResponse(request, "reportes.html",
                                      {"user": user, "areas": areas, "empresas": empresas,
                                       "estados": Solicitud.ESTADOS, "auditoria": audit,
                                       "certificados": certificados, "nombres_por_email": nombres_por_email,
                                       "empleados_lista": empleados_lista, "aud_filtros": aud_filtros})


@router.get("/reportes/exportar")
async def exportar(user: Empleado = Depends(require_admin), db: Session = Depends(get_db),
                   desde: str = "", hasta: str = "", area: str = "", empresa: str = "",
                   estado: str = ""):
    f = lambda s: date.fromisoformat(s) if s else None
    data = exportar_reporte(db, f(desde), f(hasta), area, empresa, estado)
    nombre = f"permisos_{datetime.now():%Y%m%d_%H%M}.xlsx"
    return Response(data, media_type=XLSX,
                    headers={"Content-Disposition": f"attachment; filename={nombre}"})
