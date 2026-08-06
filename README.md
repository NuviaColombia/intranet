# Solicitudes Nuvia

Aplicación web (FastAPI + SQLite) con un portal post-login de tres módulos
(Compras, People, SST). Por ahora solo **People** está implementado: solicitar
y aprobar permisos laborales con flujo de 1 o 2 aprobaciones según el cargo,
login con Zoho, notificaciones por Zoho Mail y gestión de empleados por
importación de Excel. Compras y SST son placeholders sin funcionalidad.

## Funcionalidades

- **Login con Zoho** (OAuth/OpenID): los empleados entran con su correo corporativo.
- **Flujo de aprobación**: cada empleado tiene 1 o 2 aprobaciones requeridas según su cargo.
  La solicitud pasa al aprobador 1 y, si aplica, luego al aprobador 2.
- **Aprobación con un clic desde el correo**: los correos de notificación incluyen
  botones Aprobar/Rechazar (enlaces firmados con validez de 7 días).
- **Importación de empleados por Excel** con plantilla descargable
  (nombres, apellidos, fecha de nacimiento, empresa, cargo, área, identificación,
  correo, número de aprobaciones y aprobadores).
- **Tipos de permiso con saldo anual** configurable (o sin límite).
- **Dashboard RRHH**: pendientes, aprobadas, rechazadas, empleados activos y permisos por área.
- **Reportes exportables a Excel** con filtros por fecha, área, empresa y estado.
- **Auditoría** de todas las acciones.
- **Recordatorio diario** a aprobadores con pendientes (`scripts/recordatorios.py`).

## Puesta en marcha

```bash
# 1. Crear entorno e instalar dependencias
python -m venv .venv
.venv\Scripts\activate        # Windows  (en Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt

# 2. Configurar variables
copy .env.example .env         # y edita los valores

# 3. Ejecutar
uvicorn app.main:app --reload
```

Abre http://localhost:8000. En VS Code puedes usar F5 (configuración incluida en `.vscode/`).

La base de datos SQLite (`permisos.db`) se crea sola al arrancar, junto con tipos de
permiso iniciales y el usuario administrador definido en `ADMIN_EMAILS`.

## Configuración de Zoho

### 1. Login de usuarios (Zoho OAuth)
1. Entra a https://api-console.zoho.com → **Add Client** → *Server-based Applications*.
2. Redirect URI autorizada: `{BASE_URL}/auth/callback` (ej. `http://localhost:8000/auth/callback`).
3. Copia Client ID y Client Secret a `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` en `.env`.
4. Ajusta `ZOHO_REGION` según tu data center (com, eu, in, com.au, jp).

### 2. Envío de correos (Zoho Mail API)
1. En https://api-console.zoho.com crea un **Self Client**.
2. Genera un *grant token* con scope: `ZohoMail.messages.CREATE,ZohoMail.accounts.READ`.
3. Intercámbialo por un **refresh token**:
   ```
   POST https://accounts.zoho.com/oauth/v2/token
     ?grant_type=authorization_code&code={grant_token}
     &client_id={id}&client_secret={secret}
   ```
4. Guarda credenciales en `ZOHO_MAIL_*` y define `MAIL_FROM` (dirección válida de la cuenta).

Si Zoho Mail no está configurado, la app funciona igual y registra los correos en consola.

> **Nota:** para que los botones de aprobar desde el correo funcionen fuera de tu red,
> `BASE_URL` debe ser una URL accesible públicamente (servidor, VPN o túnel).

## Importación de empleados

Descarga la plantilla desde **Empleados → plantilla oficial**. Columnas:

| Columna | Notas |
|---|---|
| nombres, apellidos | obligatorios |
| fecha_nacimiento | opcional; AAAA-MM-DD o DD/MM/AAAA |
| fecha_inicio_empresa | opcional; fecha de ingreso a la empresa, mismo formato |
| empresa, cargo, area | obligatorios |
| identificacion | única; se usa para actualizar (upsert) |
| correo | debe coincidir con el correo Zoho del empleado |
| rol | opcional; empleado (default), aprobador o admin. Si se deja vacío en una actualización, no cambia el rol actual |
| num_aprobaciones | 1 o 2 (default 1) |
| dias_vacaciones | opcional; saldo inicial de vacaciones. Si se deja vacío en una actualización, no cambia el saldo actual |
| aprobador1_correo, aprobador2_correo | correo de los aprobadores (pueden venir en el mismo archivo) |

## Recordatorios diarios

Programa `python -m scripts.recordatorios` con el Programador de tareas de Windows
o cron. Envía a cada aprobador un resumen de sus pendientes.

## Estructura

```
app/
  main.py            # arranque, middleware, seed inicial
  config.py          # variables de entorno
  models.py          # Empleado, TipoPermiso, Solicitud, Aprobacion, Auditoria
  services.py        # lógica del flujo de aprobaciones y notificaciones
  auth.py            # OAuth Zoho + sesión
  zoho_mail.py       # envío por API de Zoho Mail
  tokens.py          # enlaces firmados para aprobar desde el correo
  excel_import.py    # import/plantilla/reportes Excel
  routers/           # rutas web
  templates/         # vistas Jinja2
scripts/recordatorios.py
```
