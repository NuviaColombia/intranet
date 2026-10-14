"""Diagnóstico de la copia Face → N2 (14-oct-2026): revisa una orden paso a paso y dice por qué se copió o no.

Repite las mismas comprobaciones de services_design.copiar_face_a_n2 sin crear nada, y agrega lo que no se ve en
pantalla: a qué hora se marcó el QC (qc_en), si hay copia registrada y si el manager de N2 tiene notificaciones.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from . import services_design as sd
from .models_design import DesignArea, DesignCopiaFace, DesignOrden, DesignPushSuscripcion, DesignTeam

# Despliegues de las reglas (hora de Colombia): antes de la primera no existía la copia; entre la primera y la segunda
# solo se copiaban las órdenes de mañana; desde la segunda, cualquier orden y queda en N2 el día en que se marca el QC.
REGLA_MANANA = datetime(2026, 10, 13, 18, 14)
REGLA_HOY = datetime(2026, 10, 14, 12, 44)
PUSH_DESDE = datetime(2026, 10, 14, 12, 54)
DESPLIEGUE_MIN = 10   # Render tarda unos minutos en publicar cada cambio


def _col(dt: datetime | None) -> datetime | None:
    """UTC (como se guarda) → hora de Colombia, sin zona."""
    if not dt:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(sd.ZONA_COLOMBIA).replace(tzinfo=None)


def diagnosticar(db: Session, numero: str) -> dict:
    numero = (numero or "").strip().upper()
    face = (db.query(DesignOrden).options(joinedload(DesignOrden.team).joinedload(DesignTeam.area))
            .join(DesignTeam, DesignOrden.team_id == DesignTeam.id).join(DesignArea, DesignTeam.area_id == DesignArea.id)
            .filter(DesignArea.nombre == "Face Design", func.upper(func.trim(DesignOrden.orden)) == numero)
            .order_by(DesignOrden.fecha.desc(), DesignOrden.id.desc()).all())
    en_n2 = (db.query(DesignOrden).options(joinedload(DesignOrden.team))
             .join(DesignTeam, DesignOrden.team_id == DesignTeam.id).join(DesignArea, DesignTeam.area_id == DesignArea.id)
             .filter(DesignArea.nombre == "N2 Demodenture", func.upper(func.trim(DesignOrden.orden)) == numero)
             .order_by(DesignOrden.fecha.desc()).all())
    out = {"numero": numero, "ordenesFace": [], "enN2": [{"equipo": o.team.nombre if o.team else "", "fecha": o.fecha.isoformat(),
                                                          "creadaEn": str(_col(o.creado_en))[:16]} for o in en_n2]}
    n2_equipos = (db.query(DesignTeam).join(DesignArea, DesignTeam.area_id == DesignArea.id)
                  .filter(DesignArea.nombre == "N2 Demodenture", DesignTeam.activo == 1).all())
    for o in face:
        pasos = []
        ok = lambda bien, texto: pasos.append({"ok": bool(bien), "texto": texto})
        ok(True, f"Orden de Face en el equipo {o.team.nombre if o.team else '?'}, día {o.fecha:%d/%m/%Y}.")
        qc_en = _col(o.qc_en)
        if not o.qc:
            ok(False, "El QC NO está marcado: la copia se hace solo al marcar el QC (la casilla, no el estado Approved).")
        elif not qc_en:
            ok(False, "El QC está marcado pero no tiene hora registrada (se marcó antes del 13-oct o al crear la orden con el QC ya marcado).")
        else:
            ok(True, f"QC marcado el {qc_en:%d/%m/%Y a las %I:%M %p}.")
            if qc_en < REGLA_MANANA + timedelta(minutes=DESPLIEGUE_MIN):
                ok(False, "Se marcó antes de que existiera la copia a N2 (13-oct 6:14 pm): no se copió.")
            elif qc_en < REGLA_HOY + timedelta(minutes=DESPLIEGUE_MIN) and o.fecha != qc_en.date() + timedelta(days=1):
                ok(False, "Se marcó cuando la regla solo copiaba órdenes de MAÑANA (hasta el 14-oct ~12:50 pm) y esta orden no era de "
                          "mañana: no se copió. Desde el cambio se copia cualquier orden al marcar el QC.")
        centro = (o.centro or "").strip()
        if not centro:
            ok(False, "La orden no tiene centro.")
        mgr = sd.manager_n2_de_centro(db, centro) if centro else ""
        if centro and not mgr:
            parecidos = [f.get("centro", "") for f in sd._openings_filas_cache(db)
                         if f.get("centro") and (set(sd._normalizar_texto(centro).split()) & set(sd._normalizar_texto(f["centro"]).split()))]
            ok(False, f"Openings no tiene manager de N2 para el centro «{centro}»" +
                      (f" (en Openings hay: {', '.join(parecidos[:5])})." if parecidos else " (ese centro no aparece igual en Openings)."))
        elif mgr:
            ok(True, f"Openings dice que el manager de N2 de «{centro}» es «{mgr}».")
            p = sd._pal_manager(mgr)
            eq = [t for t in n2_equipos if t.manager and p and p <= sd._pal_manager(t.manager.nombre_completo)]
            if len(eq) == 1:
                t = eq[0]
                ok(True, f"Le corresponde el equipo de N2 «{t.nombre}» (manager {t.manager.nombre_completo}).")
                subs = db.query(DesignPushSuscripcion).filter(DesignPushSuscripcion.empleado_id == t.manager_id).count()
                ok(subs > 0, f"{t.manager.nombre_completo} tiene notificaciones activadas en {subs} navegador(es)." if subs else
                             f"{t.manager.nombre_completo} NO tiene notificaciones activadas: aunque se copie, no le llega el aviso push "
                             "(debe activarlas con la campana 🔔).")
            elif not eq:
                ok(False, f"Ningún equipo ACTIVO de N2 tiene como manager a «{mgr}» (managers de N2: " +
                          ", ".join(sorted(t.manager.nombre_completo for t in n2_equipos if t.manager)) + ").")
            else:
                ok(False, f"Hay {len(eq)} equipos de N2 con manager «{mgr}» ({', '.join(t.nombre for t in eq)}): no se sabe a cuál copiar.")
        copias = db.query(DesignCopiaFace).filter(DesignCopiaFace.face_orden_id == o.id).all()
        if copias:
            for cp in copias:
                n2o = db.get(DesignOrden, cp.n2_orden_id)
                ok(True, f"Copia registrada ({cp.estado}) el {_col(cp.creada_en):%d/%m/%Y %I:%M %p}" +
                         (f" en {n2o.team.nombre if n2o and n2o.team else '?'}, día {n2o.fecha:%d/%m/%Y}." if n2o else " (la orden de N2 ya no existe)."))
        else:
            ok(False, "No hay ninguna copia registrada de esta orden en N2.")
        out["ordenesFace"].append({"id": o.id, "equipo": o.team.nombre if o.team else "", "fecha": o.fecha.isoformat(),
                                   "centro": centro, "producto": o.producto or "", "pasos": pasos})
    return out
