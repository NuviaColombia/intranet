# Caja Menor Nuvia

**(2026-10-27) Ahora vive dentro del módulo "Contabilidad" (pedido de Oscar).** El portal (`/`)
ya no muestra una tarjeta "Caja menor Nuvia" directa: muestra **Contabilidad**
(`app/templates/portal.html`), que lleva a `/contabilidad` (`app/routers/contabilidad.py`,
`templates/contabilidad.html` -- mismo patrón de aterrizaje que `/activos`). Ahí hay dos tarjetas:
"Caja menor Nuvia" (funciona igual que siempre, sin ningún cambio de lógica) y **"Pagos"**
(deshabilitada, "Próximamente" -- sin alcance definido todavía). **No se creó un permiso nuevo**:
`/contabilidad` usa `require_modulo("caja_menor")`, el mismo de siempre -- quien ya tenía acceso a
Caja menor ve Contabilidad, y cuando Pagos tenga funcionalidad real, por ahora debe seguir
gateada por ese mismo permiso (confirmado con Oscar: "los mismos de caja menor, y agrega a Dayana
Mendoza" -- a Dayana le falta que un admin le marque la casilla "Caja menor Nuvia" en
Empleados › editar, no se tocó la base de datos de producción directamente para esto). Las
rutas de `/caja-menor/*` no cambiaron: siguen en el mismo router, con el mismo permiso y el mismo
comportamiento; solo cambió qué hay delante en la navegación. El breadcrumb de la barra superior
(`base.html`) ahora es "🧮 Contabilidad › 💵 Caja menor Nuvia[ › caja][ › Parámetros]".

**(2026-10-27) Pagos ya tiene funcionalidad real: dos herramientas que corrían como archivos HTML
sueltos de Oscar.** `/pagos` (`app/routers/pagos.py`, `templates/pagos.html`, mismo permiso
`require_modulo("caja_menor")`, sin tabla ni endpoint propio) sirve dos herramientas que antes eran
archivos `.html` independientes que Oscar abría localmente (carpeta `Datos` de su equipo):

- **"Pagos programados → PDF"**: lee el archivo plano del banco (formato Davivienda, líneas
  `RC`/`TR`) o una tabla pegada de Excel, arma un lote por empresa y genera un PDF con jsPDF para
  repartir los pagos. Mantiene un directorio de beneficiarios (NIT → nombre/cuenta) e historial de
  lotes cargados.
- **"Separador de comprobantes"**: toma el PDF consolidado que entrega el banco con todos los
  comprobantes de un lote, separa cada página por NIT (usando pdf.js para leer el texto y pdf-lib
  para recortar páginas) y las entrega en un ZIP (JSZip), nombrando cada archivo con la empresa que
  reconoce de su propia base de NIT→nombre. Esa base y el historial de ZIP quedan protegidos por un
  PIN que cada quien crea en su propio navegador la primera vez que los desbloquea.

**Todo corre en el navegador, nada se guarda en el servidor.** Ambas herramientas son exactamente
el mismo código JS que ya traían (parseo, generación de PDF, separación de PDF, ZIP) -- solo se les
cambió la piel (CSS) para que se vean como el resto de la plataforma (mismos tokens de color que
`caja_menor.css`, ver `app/static/pagos.css`) y se quitó el CDN de Tailwind del Separador. El
directorio de beneficiarios y el historial de "Pagos programados" usan `localStorage`; la base de
NIT→nombre y el historial de ZIP del Separador usan `IndexedDB`. **Son datos por navegador, no
compartidos entre personas ni dispositivos** -- si alguien cambia de computador o de navegador,
no ve lo que cargó la otra persona. Si en el futuro se pide que esto sea compartido entre todos los
que usan Pagos, hay que migrar esa parte a tablas propias con sus propios endpoints (como
`CajaAcceso` en Caja menor), no es un ajuste menor.

Los dos `<script>` de `pagos.html` están aislados a propósito: el de "Pagos programados" va envuelto
en un IIFE (no expone nada al scope global) porque los dos archivos originales declaraban variables
con el mismo nombre (`esc`, entre otras) y chocarían si convivieran sueltos en la misma página; el
del Separador se dejó en scope global porque su HTML usa `onclick="..."` inline (mismo patrón que
`caja_menor.html`) que necesita encontrar esas funciones como globales. Si tocas cualquiera de los
dos, respeta ese aislamiento.

**Qué es** (Caja menor Nuvia): manejo de cajas de caja menor (ej. CONTABILIDAD, MANTENIMIENTO). Reemplaza una app
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

**(2026-10-27) Responder una observación, sin tener que corregir el recibo/FM.** Antes, la única
forma de "atender" una observación (de quien firma o da el visto bueno) era editar los datos del
recibo/FM -- si el responsable solo quería justificar por qué está bien así, no había dónde
decirlo. `CajaObservacion` ahora tiene `es_respuesta` (`app/models_caja.py`): todas las filas de un
recibo/FM ya se servían como un solo hilo ordenado por `id` (relationship con `lazy="selectin"`),
`es_respuesta` solo distingue cuál fila es una pregunta (bloquea la firma mientras no se atiende) de
cuál es una respuesta (informativa, nunca queda pendiente). Nuevos endpoints
`POST /caja-menor/api/{caja_id}/recibos/{id}/responder` y `.../fms/{id}/responder`
(`services_caja.responder_observacion_recibo`/`_fm`) cierran la observación pendiente más reciente y
agregan la respuesta al mismo hilo; `editar_recibo`/`corregir_fm` (la otra forma de atenderla) no
cambiaron. El aviso de Cliq a quien debe firmar/dar visto bueno (`notificar_firma_pendiente`,
`notificar_supervision_pendiente`) ahora detecta si lo nuevo desde el último aviso es una respuesta
o una corrección de datos, y muestra el texto correspondiente ("💬 Respuesta a tu observación" vs.
"✏️ Se corrigió"). En la UI (`caja_menor.html`), el hilo completo se pinta como burbujas de chat
(`pintarHiloObservaciones`) con un botón "💬 Responder" para quien elaboró el recibo/FM (reutiliza el
modal de anular, `abrirRespuesta`/`confirmarAnulacion`). Columna `es_respuesta` migrada con
`ALTER TABLE` igual que las demás.

**(2026-10-28) Consulta de recibos: los anulados no se ven por defecto, y hay un tope de 100.**
Pedido de Carlos: antes el filtro "Estado" con "Todos" mostraba también los anulados, y la pestaña
cargaba y pintaba todos los recibos de la caja sin límite. Ahora (`caja_menor.html`,
`filtrarConsulta()`, solo filtrado en el navegador -- la API `/recibos` ya soportaba estos
parámetros pero el cliente igual trae todo y filtra ahí):
- "Todos" en el filtro Estado ahora significa "todos menos los anulados"; para verlos hay que
  elegir "ANULADO" explícitamente en ese mismo select.
- Nuevo filtro "Mostrar" (`#cLimite`): "Últimos 100" (por defecto) o "Todos", independiente del
  filtro de fecha que ya existía. El límite se aplica **después** de texto/estado/fecha, así que
  buscar un recibo viejo por número o texto lo sigue encontrando aunque esté fuera de los últimos
  100. Un aviso ("mostrando X de Y") aparece junto al título cuando el límite recorta la lista.
- `limpiarConsulta()` vuelve a este estado por defecto (sin anulados, últimos 100).

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
