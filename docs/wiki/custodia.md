# Cambio de custodia (y Producción en general)

**Qué es**: traslados de material (discos, insumos) entre áreas de producción, exclusivo de
**Nuvia Smiles Colombia SAS**. Vive bajo el paraguas "Producción" junto con Seguimiento de
consumo (otro submódulo con el mismo modelo de acceso).

**Archivos clave**
- `app/acceso_produccion.py` -- acceso a Producción y sus submódulos (compartido con Consumo).
- `app/services_custodia.py` -- lógica de negocio (crear traslado, firmar recibido, firmar DIR).
- `app/models_custodia.py` -- `CustodiaTraslado` y modelos relacionados.
- `app/routers/custodia.py`, `app/routers/custodia_parametros.py`.
- `app/templates/custodia.html`.

**Modelo de acceso -- tres caminos distintos a nivel "administrador"**

1. `superadmin` -- administra todo, sin excepción.
2. `admin` cuya `empresa == EMPRESA_PRODUCCION` ("Nuvia Smiles Colombia SAS").
3. **`ProduccionAdmin`** (tabla `produccion_admins`): una persona concreta, asignada por un
   admin en Producción › Parámetros › General, que entra con todos los permisos a Producción
   **sin ser administradora del resto de la intranet** (y sin chequeo de empresa -- la asignación
   explícita es la que importa aquí, no el rol general).

Un manager normal necesita, además, que le hayan dado el permiso "custodia" de People
(`Empleado.modulos`) **y** una fila en `produccion_accesos` para el submódulo específico
(Custodia o Consumo), asignada en Producción › Parámetros.

Quién puede **firmar** un traslado es un chequeo aparte, en `services_custodia.py`, y **no**
sigue el modelo de administrador de arriba: firmar certifica que el material llegó físicamente
a esa persona, así que solo cuenta la asignación de área en Parámetros, sin importar el rol.
- `puede_firmar_recibido(user, traslado)` -- únicamente si el traslado llega a una de las áreas
  que tiene asignadas el usuario (`Empleado.area_custodia`, hasta 2 áreas separadas por coma --
  ver `Empleado.areas_custodia`/`tiene_area`). Ni admin, ni superadmin, ni `ProduccionAdmin`
  firman por fuera de su área asignada.
- `puede_firmar_dir(user)` -- lo mismo, pero para la firma obligatoria de DIR PRODUCCIÓN en las
  salidas de QC FINAL (requiere tener asignada el área DIR PRODUCCIÓN).
- `puede_firmar_algo(user, t)` -- combina las dos anteriores (para la bandeja de "Mis
  aprobaciones").

**Consecutivo**: el `id` del `CustodiaTraslado`, **sin prefijo** (a diferencia de Permisos,
Horas Extra y SST). Ya está integrado en los avisos de Cliq, el CSV de exportación y los
tickets impresos -- fue una decisión explícita no agregarle prefijo para no arriesgar esas
integraciones.

## Gotchas

- **Company-scoping es un error que ya ocurrió de verdad**: `es_admin()` en
  `acceso_produccion.py` originalmente daba acceso de administrador a *cualquier* admin del
  sistema sin revisar la empresa, y un admin de Nuvia Design terminó viendo y pudiendo firmar
  traslados de Nuvia Smiles (vía la bandeja unificada `/mis-aprobaciones`). El fix quedó en
  `es_admin()`: cualquier bypass de "administrador" nuevo que agregues en Producción (fuera de
  firmar, ver el punto siguiente) debe seguir ese mismo patrón (superadmin, o admin+empresa, o
  `ProduccionAdmin` explícito -- nunca `rol in (admin, superadmin)` a secas).
- **(2026-10-20) Un admin firmó un recibido por error, en el lugar del manager del área.**
  Pasó por la bandeja unificada `/mis-aprobaciones`: antes, cualquier admin veía ahí *todos* los
  traslados pendientes (con el bypass de "administrador" que describe el punto anterior) mezclados
  con permisos y horas extra, con un solo botón "Confirmar recibido" y ningún aviso de que no era
  su área. El fix fue más de fondo que un aviso: `puede_firmar_recibido()`/`puede_firmar_dir()` ya
  **no** tienen ningún bypass de administrador -- solo firma quien tiene esa área asignada en
  Parámetros (`Empleado.area_custodia`), sea admin, superadmin o no. Como consecuencia,
  `/mis-aprobaciones` deja de mostrarle el traslado a un admin que no tenga esa área, porque
  `resumen_pendientes()` ya filtra con `puede_firmar_recibido()`. Si alguna vez parece que hace
  falta un "firmar por emergencia" para cuando el manager no está disponible, que sea una función
  nueva y explícita (con su propio registro de quién y por qué) -- no un bypass silencioso como el
  anterior.
- **No le agregues un prefijo al consecutivo de Custodia.** Si se necesita un formato tipo
  "CC-0001" para un documento nuevo, créalo como una propiedad aparte -- no toques `id` ni la
  forma en que ya se imprime/envía/exporta.
- `ProduccionAdmin` no revisa empresa a propósito: es una asignación manual y explícita, no un
  rol general. Si alguna vez parece "demasiado permisivo", el control real está en quién tiene
  permiso de asignarlo (un admin de la intranet), no en el código de `es_admin_produccion`.
