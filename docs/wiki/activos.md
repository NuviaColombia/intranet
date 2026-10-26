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
  por Oscar el 26-oct-2026, botón "📅 Programar mantenimiento (varios)" en Mantenimientos) y jornadas de
  mantenimiento por grupo (con recurrencia automática).
- `app/services_activos_consultas.py` -- todos los listados/fichas/dashboard (solo lectura).
- `app/services_activos_excel.py` -- exportar el inventario e importar/comparar un Excel.
- `app/routers/activos.py` -- `/activos` (aterrizaje), `/activos/design` y toda su API bajo
  `/activos/design/api/...`.
- `app/templates/activos_design.html` + `app/static/activos_design/{app.js,app.css}` -- el
  frontend original portado (mismo HTML/CSS/JS, con las rutas de API reapuntadas y el login HTTP
  Basic quitado -- la sesión del portal ya resuelve quién entra).
- `app/services_activos_solicitudes.py` + `app/routers/activos_mantenimiento.py` +
  `app/templates/activos_mantenimiento.html` -- flujo aparte de solicitud/aprobación de
  mantenimiento para managers de equipo (ver sección propia más abajo).

**Modelo de acceso**: como cualquier otro módulo (`require_modulo("activos")` +
`user.tiene_modulo('activos')`) -- el checkbox "Activos" se asigna por persona desde
Empleados/Parámetros (People), igual que Caja Menor o SST. No hay una tabla de permisos propia.
Esto aplica a la app completa (`/activos`, `/activos/design`); `/activos/mantenimiento` tiene su
**propio** modelo de acceso, más abierto (ver abajo).

**Bandera `es_activos` en la barra superior**: las tres páginas de Activos pasan `es_activos: True`
al contexto de `base.html`, para que no se muestren los enlaces de People (Panel, Mis solicitudes,
Empleados, Parámetros...) -- al construir el módulo originalmente no se agregó esta bandera (a
diferencia de Custodia/Caja/SST) y esos enlaces aparecían por error encima del inventario. Si agregas
una página nueva bajo `/activos/...`, acuérdate de pasar `es_activos: True`.

## Solicitud/aprobación de mantenimiento para managers de equipo (`/activos/mantenimiento`)

Pedido por Oscar el 26-oct-2026: los **managers de equipo** (cualquiera que ya figure como
`id_lider_id` de un grupo en `ActivosPerfil`, sin asignarles nada aparte en People) necesitan poder
pedir mantenimiento para los equipos de su propio grupo **sin ver el resto del inventario** (ni
Equipos, ni Dongles, ni Usuarios, ni Auditoría). Flujo de 4 pasos:

1. El manager **solicita** mantenimiento para un equipo de su grupo (`crear_solicitud`).
2. El aprobador **acepta** (`aceptar_solicitud`) -- hoy, solo **Yostyn Guerrero Pitalúa**
   (`yostynguerrero@nuviasmiles.com`, empleado id 5) + cualquier `superadmin` como respaldo
   (`APROBADORES_MANTENIMIENTO` en `services_activos_solicitudes.py`; es una persona haciendo su
   trabajo, no un rol genérico -- si cambia quién hace mantenimiento, hay que tocar ese set a mano).
   Esto crea un `ActivosMantenimiento` real (vía `registrar_mantenimiento`, `CORRECTIVO`/`EN_PROCESO`)
   y el equipo pasa a `MANTENIMIENTO` -- mismo mecanismo que usa el resto de la app, no uno nuevo.
3. El aprobador hace el trabajo y marca **realizado** (`marcar_realizado`, vía
   `actualizar_mantenimiento(..., devolver_stock=False)` -- el equipo se queda en `MANTENIMIENTO`).
4. El **manager confirma** (`confirmar_solicitud`) que quedó bien -- el equipo vuelve a **EN USO con
   el mismo dueño que tenía antes de la solicitud** (vía `asignar_equipo`, guardado como
   `empleado_original_id` al crear la solicitud; si no tenía dueño, vuelve a `STOCK`).

**Por qué una página y un router aparte** (`/activos/mantenimiento`, no un endpoint más de
`routers/activos.py`): retrofitear permisos por endpoint en la SPA grande (~45 endpoints bajo un
solo `require_modulo("activos")`) habría sido invasivo y fácil de dejar un hueco. En cambio,
`require_activos_manager` (en `routers/activos_mantenimiento.py`) deja pasar a quien **ya** tiene el
módulo completo **o** a quien es líder de un grupo (`es_manager_equipos`) -- un manager
técnicamente no puede llamar ningún otro endpoint de Activos, no es solo que la UI se lo oculte.

No se duplica ninguna regla de negocio de equipos/mantenimientos: cada paso llama a las funciones ya
existentes y probadas (`registrar_mantenimiento`, `actualizar_mantenimiento`, `asignar_equipo`,
`actualizar_estado_equipo`).

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

- **`app/static/activos_design/app.js`/`app.css` se sirven con `Cache-Control: public, max-age=86400`
  y, hasta el 26-oct-2026, sin parámetro de versión** (`<script src="/static/activos_design/app.js">`
  a secas) -- después de cada deploy, el navegador (y Cloudflare) podían seguir sirviendo la copia
  vieja hasta 24h, así que un fix recién desplegado parecía "seguir sin funcionar". Se agregó
  `?v={{ activos_estaticos_v }}` (hash del contenido de esos dos archivos, calculado una vez al
  arrancar en `main_templates.py`, mismo patrón que `ds_estaticos_v` de Design) a los dos tags en
  `activos_design.html`. Si agregas otro archivo estático propio de Activos, inclúyelo en
  `_version_activos()` para que también invalide la caché al cambiar.
- **`checkList(name, items, placeholder)` es una función de `app/static/activos_design/app.js`
  (define la lista de casillas con buscador y «Marcar todos»/«Ninguno» de los modales de
  programación masiva) que se quedó SIN DEFINIR al portar el frontend original -- se usaba en
  "Programar por grupo" y en "Programar mantenimiento (varios)" pero nunca se copió la función (solo
  su listener de filtro, `$('modal-fields').addEventListener('input', ...)`). El botón no hacía nada
  visible porque el `ReferenceError: checkList is not defined` quedaba dentro de una promesa
  rechazada (bug real, encontrado el 26-oct-2026). Si agregas un modal nuevo que necesite una lista
  larga de casillas, usa `checkList` -- ya está definida junto a `guia()`.
- **`GET /activos/design/api/mantenimientos/estado` (el dashboard de Mantenimiento/Resumen,
  `obtener_estado_mantenimiento` en `services_activos_consultas.py`) tiene que devolver LISTAS en
  `novedades`, `mantenimientos_vencidos`, `equipos_en_mantenimiento` y `grupos_sin_programar`, no
  conteos.** `app/static/activos_design/app.js` (`loadEstado()`) itera cada uno para armar las
  alertas del panel (`for (const m of d.mantenimientos_vencidos)...`) -- un `func.count(...)` ahí
  rompe el frontend con `"X is not iterable"` (bug real, encontrado el 26-oct-2026: se migró como
  conteo por error). Si tocas esa función, cada uno de esos 4 campos debe seguir siendo una lista de
  objetos con los campos que `app.js` lee (`asset_tag`, `usuario`, `dias`, `lider`, etc.).
- **`listar_grupos` calcula la salud de un equipo por equipo si no tienes cuidado, y eso es lento de
  verdad contra Postgres (Supabase) en producción**: `salud_equipo()` hace hasta 2 consultas por
  equipo, y antes del 26-oct-2026 se llamaba así, una vez por cada equipo de cada grupo -- con ~180
  equipos reales eso eran cientos de ida y vuelta a la base por cada carga del dashboard de
  Mantenimiento (se llama en casi cada acción, ver `loadEstado()`/`refrescarMantenimiento()` en
  app.js). Se reemplazó por `_salud_equipos_lote()`, que calcula la salud de TODOS los equipos de
  TODOS los grupos en 2 consultas. Si agregas un campo nuevo a `listar_grupos` que necesite datos por
  equipo, calcúlalo en lote (un `IN (...)` sobre todos los asset_tags) en vez de un query por equipo
  dentro del loop de grupos.
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
