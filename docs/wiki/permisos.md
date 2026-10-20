# Permisos (People)

**Qué es**: el módulo original de la plataforma -- solicitudes de permiso/vacaciones de un
empleado, aprobadas por su(s) jefe(s). Vive bajo "People" y NO tiene restricción de empresa (lo
usan tanto Nuvia Smiles como Nuvia Design).

**Archivos clave**
- `app/models.py` -- `Solicitud`, `Aprobacion`, `TipoPermiso`.
- `app/services.py` -- `crear_solicitud`, `resolver_aprobacion`, `pendientes_de`, y el flujo de
  soporte documental (ver abajo).
- `app/routers/solicitudes.py` -- la solicita el empleado (`/solicitudes`).
- `app/routers/aprobaciones.py` -- bandeja propia de Permisos (`/aprobaciones`).
- `app/routers/mis_aprobaciones.py` + `app/aprobaciones_globales.py` -- bandeja **unificada** de
  todos los módulos (`/mis-aprobaciones`, el enlace "Aprobaciones" del menú).

**Modelo de aprobación: 1 o 2 niveles, por `Empleado.num_aprobaciones`**

No es por tipo de permiso, es por empleado: `aprobador1_id`/`aprobador2_id` en `Empleado`.
`Solicitud.estado` pasa `pendiente_1` → (`pendiente_2` si aplica) → `aprobada`/`rechazada`. Un
aprobador solo ve/decide lo que le corresponde (`pendientes_de()` filtra por
`Aprobacion.aprobador_id == empleado.id`) -- ya nace correctamente acotado, sin el problema de
company-scoping que tuvieron Custodia y SST.

**Soporte documental (Cita médica, Calamidad doméstica, Licencia de luto)**

`TipoPermiso.requiere_soporte` (configurable en Parámetros) agrega un segundo candado,
independiente del jefe: la solicitud no queda "aprobada" hasta que el jefe apruebe **y** se
anexe un documento (incapacidad, certificado, etc.) que valide **People** -- hoy, un correo fijo
(`PAMELA_EMAIL` en `app/services.py`) o un superadmin como respaldo (`es_aprobador_soporte`). Las
dos condiciones pueden llegar en cualquier orden; el estado intermedio es `pendiente_soporte`.
El archivo se guarda como BLOB en la propia fila de `Solicitud` (no hay tabla de adjuntos aparte,
a diferencia de Caja Menor).

**Consecutivo**: `PER-0001`, propiedad calculada sobre el `id`, sin migración.

## Gotchas

- `/aprobaciones` (bandeja propia de Permisos) y `/mis-aprobaciones` (bandeja unificada) son
  **dos páginas distintas** que muestran cosas parecidas pero no idénticas -- el historial de "lo
  que yo decidí" existe en ambas por separado (`historial` en `aprobaciones.py`,
  `historial_decisiones()` en `aprobaciones_globales.py`). Si agregas una funcionalidad a una,
  pregúntate si la otra también la necesita.
- El gate de soporte documental (`es_aprobador_soporte`) es un correo hardcodeado, no un rol --
  mismo patrón que el certificado laboral (`app/routers/certificaciones.py`, `CORREO_VERIFICACION`).
  Si esa persona cambia de correo o de cargo, hay que actualizar la constante a mano.
- El enlace "Aprobaciones" del menú superior (`/mis-aprobaciones`) estuvo oculto para
  **superadmin** por un bug en `_resumen_aprobaciones()` (`app/main_templates.py`) que solo
  revisaba `rol in (aprobador, admin)` -- ya corregido, pero es la clase de bug fácil de
  reintroducir si se toca esa función sin pensar en los tres roles.
