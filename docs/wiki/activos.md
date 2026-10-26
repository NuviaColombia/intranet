# Activos (Smiles / Design)

**Qué es**: módulo de inventario de hardware de TI. Hoy solo tiene contenido la opción **Design**
(equipos, dongles ExoCAD, mantenimientos, grupos de trabajo, actas de entrega); **Smiles** es un
cascarón "Próximamente" (`app/templates/activos.html`), sin construir todavía.

Design se **migró** desde un proyecto aparte (FastAPI + SQLite crudo sin ORM, frontend vanilla JS,
usuario/clave compartidos) que vivía en una carpeta local fuera de este repo
(`inventario_hardware_entrega_2026-10-22`). Esa carpeta traía su propia documentación para guiar la
migración (`README.md` sección 11, `CONTEXTO_IA.md`) -- si alguna vez hay que revisar una regla de
negocio y esta página no alcanza, esos documentos (si siguen disponibles) tienen el detalle
original.

**Archivos clave**
- `app/models_activos.py` -- esquema completo (equipos, dongles, historial de asignaciones,
  mantenimientos, jornadas de mantenimiento, actas, auditoría, áreas, perfiles).
- `app/services_activos.py` -- equipos, perfiles (usuarios), dongles, áreas, grupos de trabajo.
- `app/services_activos_mantenimiento.py` -- mantenimientos individuales, programación en lote
  para equipos sueltos (`programar_mantenimiento_lote`, sin pasar por un grupo de trabajo -- pedido
  por Oscar el 26-oct-2026, botón "📅 Programar mantenimiento (varios)" en Equipos) y jornadas de
  mantenimiento por grupo (con recurrencia automática).
- `app/services_activos_consultas.py` -- todos los listados/fichas/dashboard (solo lectura).
- `app/services_activos_excel.py` -- exportar el inventario e importar/comparar un Excel.
- `app/routers/activos.py` -- `/activos` (aterrizaje), `/activos/design` y toda su API bajo
  `/activos/design/api/...`.
- `app/templates/activos_design.html` + `app/static/activos_design/{app.js,app.css}` -- el
  frontend original portado (mismo HTML/CSS/JS, con las rutas de API reapuntadas y el login HTTP
  Basic quitado -- la sesión del portal ya resuelve quién entra).

**Modelo de acceso**: como cualquier otro módulo (`require_modulo("activos")` +
`user.tiene_modulo('activos')`) -- el checkbox "Activos" se asigna por persona desde
Empleados/Parámetros (People), igual que Caja Menor o SST. No hay una tabla de permisos propia.

**Decisión clave de la migración: los "usuarios" del inventario se unificaron con `Empleado`.**
`ActivosPerfil` es una extensión 1:1 de `Empleado` (FK `empleado_id`), no una tabla de personas
aparte -- el nombre, el correo y el cargo siempre son los de People. `ActivosPerfil` solo guarda lo
que es propio de Activos: JumpCloud, líder de grupo, avatar, y el alta/baja como custodio de
hardware (`retirado`). Ese alta/baja es una acción **propia de Activos**, a propósito desacoplada
de activar/desactivar un empleado en People -- desactivar a alguien en People no retira
automáticamente su perfil de Activos, y viceversa. Por eso "+ Registrar usuario" en la pantalla no
pide un nombre: pide elegir un empleado ya existente en People (`GET
/activos/design/api/empleados-disponibles`, filtra por empresa Nuvia Design y excluye a quien ya
tenga perfil activo).

**Auditoría en vez de "restaurar la base completa"**: el proyecto original podía restaurar toda la
base de datos a un punto anterior (snapshot de archivo SQLite completo antes de cada cambio).
Activos comparte la misma base Postgres que el resto de la plataforma, así que eso se reemplazó por
`ActivosAuditoria` -- un registro simple de quién hizo qué y cuándo, sin botón de restaurar. La
recuperación ante un desastre real queda a nivel de los respaldos de la base de datos (Supabase),
no por módulo.

## Gotchas

- **`SessionLocal` de esta plataforma usa `autoflush=False`** (ver `app/database.py`). Las
  funciones de `services_activos_mantenimiento.py` hacen varios `UPDATE` con `setattr(obj, campo,
  valor)` y después **consultas SQL crudas** sobre la misma tabla (`_conteo_servicios`, usado para
  decidir si una jornada ya se puede cerrar y reprogramar) -- sin un `db.flush()` explícito entre
  medio, esas consultas ven el estado *anterior* al cambio y la recurrencia automática de jornadas
  nunca se dispara (bug real, encontrado y corregido durante la migración: ver el `db.flush()` en
  `_aplicar_cambios_mantenimiento`). Si agregas una función nueva que escribe y luego lee con SQL
  crudo en la misma transacción, necesita su propio `db.flush()`.
- **No existe columna `estado` en `jornadas_mantenimiento`**: ABIERTA/VENCIDA/CERRADA/ANULADA se
  calculan en Python (`estado_jornada()`, en `services_activos_mantenimiento.py`) a partir de
  `fecha_anulacion` y de si quedan mantenimientos `PROGRAMADO`/`EN_PROCESO`. No le agregues una
  columna de estado pensando que falta -- es a propósito.
- **Jerarquía de áreas de Activos, exactamente 2 niveles** (área principal → departamento), con su
  propio catálogo (`ActivosArea`) -- no reutiliza `Area`/`Empresa` de People, son conceptos
  distintos. Un área que ya tiene departamentos propios no puede anidarse dentro de otra
  (`_validar_area_padre` en `services_activos.py`).
- **Máximo un dongle activo por equipo** vía `UniqueConstraint` en `asset_tag_asignado`, validado
  antes también en `_mover_dongle` para dar un mensaje claro en vez de un error de base de datos.
- **"Salud" de un equipo** (`OPTIMO`/`NOVEDADES`/`EN_MANTENIMIENTO`/`SIN_REVISION`,
  `salud_equipo()` en `services_activos_consultas.py`) es una **reconstrucción**, no una copia
  exacta: el proyecto original la calculaba con un `CASE` de SQL (`_SALUD`) cuyo detalle exacto no
  se migró. Si el equipo de TI dice que no coincide con lo que esperaban ver, ese es el punto a
  ajustar.
- **Datos reales migrados (Oscar, 26-oct-2026)**: 18 áreas, 149 perfiles, 184 equipos, 68 dongles,
  273 periodos de historial, 6 jornadas y 15 mantenimientos (0 actas -- el original nunca guardó
  ninguna). El script de migración unió los "usuarios" del inventario con `Empleado` por nombre; 5
  de 154 quedaron sin vincular (4 personas retiradas que nunca existieron en Empleados + una cuenta
  de prueba "Training 6") -- sus equipos/historial migraron igual pero sin custodio. Si uno de esos
  4 aparece después en People, hay que vincular su historial a mano (no hay script para eso, se
  haría con un UPDATE puntual). El script no quedó en el repo (era de un solo uso, corrido a mano
  contra producción); si hace falta repetir el patrón, está documentado en la conversación de esa
  fecha.
