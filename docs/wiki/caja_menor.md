# Caja Menor Nuvia

**Qué es**: manejo de cajas de caja menor (ej. CONTABILIDAD, MANTENIMIENTO). Reemplaza una app
anterior en Google Apps Script. Alguien con acceso a una caja crea un **recibo**; un
"Autorizado por" (no puede ser quien lo creó) lo firma; si el beneficiario es un empleado activo,
se le pide su **firma de recibido** por Cliq (en la app o por un enlace sin login). Varios
recibos firmados se agrupan en un **FM** ("Formato de reembolso"), con firma de "Elaborado por" y
de un "Supervisado por" distinto. Un **arqueo** compara el fondo contra el efectivo contado más
los recibos pendientes.

**Archivos clave**
- `app/models_caja.py` -- `CajaMenor`, `CajaAcceso`, `CajaAutorizador`, `CajaSupervisor`,
  `CajaFM`, `CajaRecibo`, `CajaAdjunto`, `CajaArqueo`, `CajaObservacion`.
- `app/services_caja.py` (~1200 líneas) -- toda la lógica: crear/firmar recibo, legalizar,
  arqueo, avisos de Cliq, importar de Google Sheets, números en letras.
- `app/routers/caja_menor.py` -- páginas, API y Parámetros.
- `app/templates/caja_menor*.html`, `caja_recibido*.html`.

**Modelo de acceso**: usa el `require_modulo` genérico (`caja_menor`), no uno propio como SST.
Adentro, el detalle fino sí es por tabla propia: `CajaAcceso` (quién puede usar una caja),
`CajaAutorizador` (quién firma "Aprobado por"), `CajaSupervisor` (quién da el visto bueno del FM)
-- todas por persona, asignadas en Parámetros.

**(2026-10-20) Ni admin ni superadmin entran automático a Caja menor.** A diferencia del resto de
módulos, `Empleado.tiene_modulo()` (`app/models.py`) tiene una excepción explícita para
`"caja_menor"`: ser `admin` o `superadmin` ya **no** basta -- solo entra quien tiene el permiso
`caja_menor` en `Empleado.modulos`, ya sea porque opera/autoriza/supervisa una caja (como
cualquier empleado), o porque otro admin/superadmin con acceso lo autorizó explícitamente desde
Parámetros › Quién tiene acceso › "Administradores autorizados a entrar a Caja menor"
(`/caja-menor/parametros/admins/{id}/toggle`).

Para que esto no bloquee a todo el mundo (incluido quien tendría que autorizar), **Parámetros en
sí no depende de ese permiso**: usa `require_admin_caja_menor()` (nuevo, en
`app/routers/caja_menor.py`), que solo exige `rol in (admin, superadmin)` -- separado por completo
de `require_modulo(MODULO)`, que sigue gateando el resto de la app (la página de entrada, las
cajas, los recibos). Las ~15 rutas de Parámetros (cajas, accesos, autorizadores, supervisores,
este toggle) usan `require_admin_caja_menor`; todo lo demás sigue usando `require_modulo(MODULO)`.
Si agregas una ruta nueva bajo `/caja-menor/parametros/`, usa `require_admin_caja_menor`, no
`require_modulo(MODULO)` -- si no, un admin recién creado no podría ni entrar a autorizarse a sí
mismo. Pedido de Carlos: por defecto nadie nuevo (ni admin ni superadmin) debe poder entrar al
módulo hasta que alguien ya autorizado lo permita.

A diferencia de SST/Custodia/Consumo/Conteo, Caja Menor **no es de una sola empresa**: cada
`CajaMenor` tiene su propio campo `empresa` (hoy: Contabilidad y Mantenimiento son de Nuvia
Smiles, Design es de Nuvia Design). `services_caja.es_admin(user, caja=None)` refleja eso:
- sin `caja` -- el chequeo de rol de siempre (para decisiones que no dependen de una caja en
  particular, como si alguien puede ser elaborador y supervisor del mismo FM a la vez).
- con `caja` -- superadmin administra cualquiera; un admin normal solo las de su propia empresa.

Los formularios de Parámetros que asignan acceso/autorización/supervisión a una persona pueden
marcar varias cajas de una vez (`form.getlist("cajas")`); `_reemplazar_cajas()`
(`routers/caja_menor.py`) filtra esa selección a las cajas que el admin administra y **no borra**
las asignaciones de otra empresa que ya tuviera esa persona (asignadas antes por otro admin) --
si tocas esos formularios, no vuelvas a un `delete()` + `insert()` sin ese filtro.

**(2026-10-22) Firma de "recibido" sin el módulo: dos rutas, y un aviso en el portal.** Quien recibe el
dinero no necesita el módulo `caja_menor` para firmar -- hay dos caminos, ambos sin ese permiso:
`/caja-menor/firmar-recibido/{id}/{token}` (sin iniciar sesión, el que manda el bot de Cliq, token HMAC)
y `/caja-menor/recibido/{id}` (con sesión iniciada, para quien no usó el enlace de Cliq). El problema real
reportado: si la persona no hace clic en el botón de Cliq y en cambio entra a la intranet por su cuenta, no
había ninguna forma de que encontrara su recibo pendiente -- terminaba intentando entrar a "Caja menor"
(que si pide el módulo) y se topaba con "No tienes acceso a ese módulo". El portal (`/`,
`app/routers/portal.py`) ahora muestra un aviso con el o los recibos pendientes de cualquier usuario que
tenga uno (`services_caja.recibos_pendientes_de_recibido`), con enlace directo a `/caja-menor/recibido/{id}`
-- ese aviso es independiente de `tiene_modulo`, se ve tenga o no acceso al módulo.

**(2026-10-22) Anticipos: registro simple, aparte de los recibos, ahora con firma.** Carlos entrega
dinero antes de la compra (anticipo) y el colaborador vuelve después con la factura electrónica y el
gasto de transporte. `CajaAnticipo` (`app/models_caja.py`) es a propósito un registro **suelto**, sin
relación con `CajaRecibo` ni `CajaFM`: identificación, nombre, valor, fecha, concepto y un estado
PENDIENTE/LEGALIZADO. Nueva pestaña "💸 Anticipos" en la caja (`app/templates/caja_menor.html`, slug
`anticipos` en `SECCIONES["caja"]` de `acceso_secciones.py` y en el `pestanas()` de `base.html`) --
igual que las demás pestañas, respeta Secciones por persona y el mismo `_caja()` (no opera quien es
firmante de la caja). Si en el futuro hace falta más control (vincular el anticipo a un recibo/factura
real, alertar anticipos viejos sin legalizar, etc.), es una ampliación de este modelo, no justifica
rehacerlo.

- **Legalizar no se puede deshacer** (`services_caja.legalizar_anticipo`): a diferencia de la primera
  versión (que tenía un toggle PENDIENTE↔LEGALIZADO), ahora es de un solo sentido -- pedido explícito
  de Carlos. Si alguien legaliza por error, no hay botón para corregirlo (habría que hacerlo
  directamente en la base de datos).
- **Firma de quien recibió el anticipo**: mismo patrón que `CajaRecibo.recibido_*` -- si la
  identificación coincide con un colaborador activo de People (`colaborador_por_identificacion`,
  reutilizada de recibos), `crear_anticipo` le asigna `empleado_id` automáticamente, y puede firmar por
  dos caminos sin el módulo `caja_menor`: `/caja-menor/anticipo/{id}` (con sesión) o
  `/caja-menor/firmar-anticipo/{id}/{token}` (enlace de Cliq, sin sesión -- mismo HMAC que
  `token_recibido`). Aparece en el aviso del portal junto con los recibos pendientes
  (`anticipos_pendientes_de_firma`). A un tercero sin cuenta en People no se le pide firma (no tiene
  `empleado_id`), solo se marca Legalizado a mano.
- **Autocompletar identificación/nombre** (`services_caja.buscar_personas`,
  `GET /caja-menor/api/{caja_id}/buscar-persona`): busca por nombre o identificación en Empleados
  activos (cualquier empresa) y en el historial de recibos/anticipos de esta caja; People tiene
  prioridad sobre el historial. **(2026-10-22) Búsqueda por palabra, no por texto contiguo**: cada
  palabra escrita debe aparecer en `nombres` O en `apellidos` (cualquiera de las dos, en cualquier
  orden) -- así "Carlos Baldovino" encuentra a "Carlos Andrés Barreto Baldovino" aunque esas dos
  palabras no estén seguidas (primer nombre + segundo apellido). Antes comparaba el texto completo
  contra un solo campo a la vez y se perdía esas combinaciones. Se usa igual en "Nuevo recibo" y en
  "Anticipos" (mismos campos). Es
  solo una ayuda de UI -- no impide escribir un nombre o identificación que no esté en ninguna lista.
  **(2026-10-22) Lista de sugerencias propia, no `<datalist>`**: el `<datalist>` nativo del navegador
  resultó poco confiable (su filtrado y cuándo se muestra varían entre navegadores, y Carlos reportó
  que no le aparecía nada). Ahora es un `<div class="cm-sugerencias">` armado y mostrado por JS
  (`buscarPorNombre`/`_cajaSugerencias` en `caja_menor.html`), con clic para elegir -- si se toca este
  autocompletar de nuevo, no volver al `<datalist>`.
- **Migración de columnas nuevas**: `empleado_id`, `firmado_email`, `firmado_en`, `firmado_via` se
  agregan con `ALTER TABLE` en el `on_event("startup")` de `caja_menor.py` (igual que las demás
  columnas del módulo) -- la tabla ya existía en producción antes de este cambio, así que
  `Base.metadata.create_all()` no la toca.

**Adjuntos**: igual que en Permisos (soporte documental), se guardan como BLOB en la propia fila
(`CajaAdjunto.datos`, columna `deferred`) -- no van a Zoho WorkDrive. Límite 5 MB,
JPG/PNG/WEBP/PDF.

**Consecutivo**: por caja, `max(existentes)+1` con un piso en `caja.consecutivo_inicial` (para
seguir la numeración de la app vieja) y reintento si dos personas guardan al mismo tiempo. El FM
tiene su propio contador (`caja.fm_siguiente`).

## Gotchas

- **Company-scoping ya se corrigió aquí** (era el mismo bug de SST/Custodia: cualquier
  admin/superadmin veía y operaba todas las cajas de todas las empresas, sin revisar la empresa
  de cada una). La migración que agregó `CajaMenor.empresa` le asignó a cada caja existente la
  empresa de su responsable actual -- si alguna vez cambias de responsable a alguien de otra
  empresa, revisa si la caja también debería cambiar de empresa.
- Un recibo ya firmado (o con "recibido" ya firmado) no se edita -- hay que anularlo y crear uno
  nuevo. Un FM no se puede anular si ya fue marcado como reembolsado; anular un FM devuelve sus
  recibos a "activo" para volver a legalizarlos.
- Caso límite ya resuelto en el código: si una caja tiene un solo autorizador y es la misma
  persona que crea el recibo, se bloquea con un mensaje pidiendo agregar otro autorizador --no
  asumas que "un autorizador basta" al tocar esa validación.
- El dinero de un FM sigue contando como "fuera de la caja" en los arqueos hasta que tesorería lo
  marca como reembolsado (`total_pendiente`).
