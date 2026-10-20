# SST (control de inventario de EPP)

**Qué es**: inventario de Elementos de Protección Personal (EPP) para **Nuvia Smiles Colombia
SAS** exclusivamente. Compras registra ingresos, Coordinación SST los aprueba; los managers piden
EPP y Coordinación entrega. Sin saldo guardado: el stock siempre se calcula en vivo sumando los
ingresos aprobados y restando las líneas de las solicitudes ya entregadas (mismo espíritu que el
dashboard de Custodia).

**Archivos clave**
- `app/sst.py` -- acceso (ver abajo). Todo el control de permisos de este módulo vive aquí.
- `app/models_sst.py` -- `SstItem`, `SstAcceso`, `SstIngreso`, `SstSolicitud`, `SstSolicitudLinea`.
- `app/services_sst.py` -- lógica de negocio (crear ingreso/solicitud, aprobar, entregar, stock a fecha).
- `app/routers/sst.py` -- endpoints `/sst/*`.
- `app/templates/sst.html`, `sst_parametros.html`.

**Modelo de acceso -- NO usa el `require_modulo` genérico del resto de la plataforma**

El acceso base ("todos los managers y administradores") se decide por `Empleado.rol`, no por
`Empleado.modulos`: así nadie necesita que le asignen el módulo a mano. Compras y Coordinación
SST son capacidades adicionales, fijas por persona, guardadas en `sst_accesos`.

- `es_admin_sst(user)`: superadmin siempre; un `admin` normal solo si es de Nuvia Smiles.
- `es_manager_sst(user)`: `rol` en `aprobador`, `admin` o `superadmin` -- entra con acceso básico.
- `es_compras_sst` / `es_coordinador_sst`: `es_admin_sst` o tener esa fila en `sst_accesos`.
- `tiene_acceso_sst`: primero exige `user.empresa == EMPRESA_SST` (salvo que `es_admin_sst`), y
  luego alguna de las anteriores.

**Consecutivos**: `EPP-E-0001` (ingresos), `EPP-S-0001` (solicitudes) -- `@property` calculada
sobre el `id`, sin columna ni migración (mismo patrón que Permisos y Horas Extra).

## Gotchas

- **Company-scoping es el error que ya pasó una vez** (en Producción/Custodia, no aquí
  todavía, pero el patrón es idéntico): cualquier "bypass de administrador" en este módulo debe
  exigir también `user.empresa == EMPRESA_SST`, nunca solo `rol in (admin, superadmin)`. Si
  agregas una función nueva de acceso, cópiate de `es_admin_sst`, no de un chequeo de rol suelto.
- Este módulo es deliberadamente independiente del sistema genérico de módulos de People
  (`Empleado.modulos` / `require_modulo`) -- no lo migres a ese patrón sin pensarlo primero,
  la razón de ser así está en el docstring de `app/sst.py`.
- El seed inicial de Compras/Coordinación (Boris Urrego, Dayana Mendoza, Vanessa Reyes) hace
  *fuzzy match* contra `Empleado` reales y **registra un error si no encuentra a alguien** en vez
  de inventar un empleado. Si ves ese log, hay que asignar el acceso a mano en `/sst/parametros`,
  no "arreglar" el script para que invente datos.
