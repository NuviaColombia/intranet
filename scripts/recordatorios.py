"""Envía a cada aprobador un resumen diario de solicitudes pendientes.

Programar con cron (Linux) o Programador de tareas (Windows), ej. cada día 8:00 am:
    python -m scripts.recordatorios
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collections import defaultdict
from app.database import SessionLocal
from app.models import Aprobacion, Solicitud
from app.zoho_mail import enviar_correo
from app import config


def main():
    db = SessionLocal()
    try:
        aps = (db.query(Aprobacion).join(Solicitud)
               .filter(Aprobacion.decision == "pendiente",
                       Solicitud.estado.in_(["pendiente_1", "pendiente_2"])).all())
        activos = [a for a in aps
                   if (a.solicitud.estado == "pendiente_1" and a.nivel == 1)
                   or (a.solicitud.estado == "pendiente_2" and a.nivel == 2)]
        por_aprobador = defaultdict(list)
        for a in activos:
            por_aprobador[a.aprobador].append(a)

        for aprobador, lista in por_aprobador.items():
            filas = "".join(
                f"<li>#{a.solicitud.id} — {a.solicitud.empleado.nombre_completo}: "
                f"{a.solicitud.tipo.nombre}, {a.solicitud.fecha_inicio} al {a.solicitud.fecha_fin} "
                f"({a.solicitud.dias:g} días)</li>" for a in lista)
            html = (f'<p style="font-family:sans-serif">Tienes <b>{len(lista)}</b> solicitud(es) '
                    f'de permiso pendiente(s) por aprobar:</p><ul style="font-family:sans-serif">{filas}</ul>'
                    f'<p style="font-family:sans-serif"><a href="{config.BASE_URL}/aprobaciones">'
                    f'Revisar en la plataforma</a></p>')
            enviar_correo(aprobador.email,
                          f"[Permisos] Recordatorio: {len(lista)} solicitud(es) pendiente(s)", html)
            print(f"Recordatorio enviado a {aprobador.email} ({len(lista)} pendientes)")
        if not por_aprobador:
            print("No hay solicitudes pendientes.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
