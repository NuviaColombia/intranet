# Pagos (dentro de Contabilidad)

**Qué es**: `/pagos` reúne tres herramientas para el equipo de Contabilidad, elegidas en una barra
lateral izquierda. Vive dentro del módulo **Contabilidad** del portal, junto a Caja menor Nuvia
(ver [caja_menor.md](caja_menor.md) para esa parte). Mismo permiso de siempre: `require_modulo
("caja_menor")` -- quien ya entra a Contabilidad entra a Pagos.

**Archivos clave**
- `app/routers/pagos.py` -- página (`/pagos`).
- `app/templates/pagos.html` -- las tres herramientas, cada una con su propio `<script>`.
- `app/static/pagos.css` -- estética compartida (mismos tokens que `caja_menor.css`).
- Accounts Payable: `app/models_pagos.py`, `app/services_pagos_ap.py`, `app/routers/pagos_ap.py`.
- Push de Pagos: `app/routers/pagos_push.py`, `app/static/pagos/sw.js`, `app/static/pagos/push.js`.

## Pagos programados → PDF, y Separador de comprobantes

**(2026-10-27) Nacieron como archivos HTML sueltos de Oscar, ahora viven en `/pagos`.** Eran dos
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
cambió la piel (CSS) para que se vean como el resto de la plataforma y se quitó el CDN de Tailwind
del Separador. El directorio de beneficiarios y el historial de "Pagos programados" usan
`localStorage`; la base de NIT→nombre y el historial de ZIP del Separador usan `IndexedDB`. **Son
datos por navegador, no compartidos entre personas ni dispositivos** -- si alguien cambia de
computador o de navegador, no ve lo que cargó la otra persona. Si en el futuro se pide que esto sea
compartido entre todos los que usan Pagos, hay que migrar esa parte a tablas propias con sus propios
endpoints (como se hizo con Accounts Payable más abajo), no es un ajuste menor.

Los dos `<script>` de estas dos herramientas están aislados a propósito: el de "Pagos programados"
va envuelto en un IIFE (no expone nada al scope global) porque los dos archivos originales
declaraban variables con el mismo nombre (`esc`, entre otras) y chocarían si convivieran sueltos en
la misma página; el del Separador se dejó en scope global porque su HTML usa `onclick="..."` inline
(mismo patrón que `caja_menor.html`) que necesita encontrar esas funciones como globales. El script
de Accounts Payable (ver abajo) también va en su propio IIFE. Si agregas una herramienta nueva,
respeta ese aislamiento.

**(2026-10-28) Las tres herramientas se eligen en una barra lateral izquierda** (`.pg-shell` /
`.pg-sidebar` / `.pg-content` en `pagos.html`/`pagos.css`, pedido de Oscar -- antes eran pestañas
arriba). Para agregar una herramienta nueva: un botón más en `.pg-sidebar` con su propio `id` (se
agrega a los arrays `btns`/`paneles` del script selector al final de `pagos.html`) y un bloque
`.pg-herramienta` más. Si la herramienta nueva carga datos del servidor, engánchala al mismo patrón
de carga perezosa que usa Accounts Payable (`window.ap<Algo>Inicial`, llamado desde el selector solo
la primera vez que se abre esa pestaña) para no pedir datos que nadie va a ver. `pagos.css` tiene
cache-busting por hash de contenido (`pagos_estaticos_v` en `main_templates.py`, mismo patrón que
`activos_estaticos_v` -- ver el gotcha de Cache-Control en [activos.md](activos.md) sobre por qué
hace falta esto y no un número de versión escrito a mano).

## Accounts Payable

**(2026-10-28) A diferencia de las otras dos, esta SÍ tiene base de datos propia en el servidor**
(`pagos_cuentas_por_pagar`, `app/models_pagos.py`) -- no podía ser solo del navegador porque tiene
que avisarle a gente específica (Leslie y Oscar) cuando algo queda pendiente de aprobar, y eso
requiere que el servidor sepa qué pasó. Reemplaza el archivo `ACCOUNTS PAYABLE.xlsx` que llevaba
Oscar, con el mismo flujo que ya usaban ahí: **Pendiente → Aprobado → Pagado**.

**Quién aprueba**: la columna "APROVAL" del Excel original solo tenía dos valores, "Leslie" y
"Oscar" -- eso se volvió literal en `APROBADORES_AP` (`app/services_pagos_ap.py`), un diccionario
`email → nombre corto`:
```python
APROBADORES_AP = {"oscaralmanza@nuviasmiles.com": "Oscar", "leslie.manotas@nuvia.app": "Leslie"}
```
`puede_aprobar(user)` es `True` para esos dos correos **o para cualquier `superadmin`** (pedido de
Oscar). Un `admin` normal con acceso a Contabilidad puede **crear** cuentas por pagar y marcarlas
**Pagado**, pero no puede Aprobar ni Rechazar si no es Leslie, Oscar o superadmin -- la UI
(`apLista` en `pagos.html`) ya oculta esos botones según `puedeAprobar` (que viene del backend en
cada respuesta de `GET /pagos/api/ap`), pero el backend es quien de verdad lo exige
(`routers/pagos_ap.py`), no confíes solo en la UI si agregas un endpoint nuevo.

**Los 4 estados** (`ESTADO_PENDIENTE` / `ESTADO_APROBADO` / `ESTADO_PAGADO` / `ESTADO_OTRO` en
`models_pagos.py`) son botones en la pantalla, con el botón "Aprobados" siempre verde (pedido
explícito de Oscar, no cambia de color con la selección -- la pestaña activa se marca con un borde,
no con el color del botón). "Todos" no filtra por estado. `ESTADO_OTRO` es el cajón de sastre para
lo que el histórico de Excel traía fuera del flujo normal (Rejected, Postponed, Credit, Quote, "-",
vacío...) -- se guarda tal cual en `estado_original` y solo se ve en "Todos", nunca se intentó
inventarle un lugar en el flujo normal. Un pago nuevo creado desde la pantalla también puede llegar
a `OTRO` si alguien lo **rechaza** estando Pendiente (acción que si existe en la UI aunque no estaba
pedida explícitamente: sin ella, un Pendiente malo se quedaría atascado para siempre en la bandeja
de aprobación de Leslie/Oscar -- ver `rechazar()` en `services_pagos_ap.py`).

**Avisos al crear una cuenta por pagar nueva** (`crear()` → `_notificar_pendiente()`, nunca al
importar histórico -- ver abajo): a Leslie y Oscar, por dos vías, ninguna bloquea la creación si
falla (ambas van en `try/except`, con un `print` para rastrear el problema si alguna vez no llega un
aviso):
- **Zoho Cliq**: `zoho_cliq.enviar_cliq_varios()` (el mismo bot que usa el resto de la intranet,
  nada nuevo que configurar).
- **Push (notificación del sistema operativo)**: reutiliza `services_design_push.enviar_en_segundo_plano()`
  -- esa función **no es específica de Design** pese a vivir en ese archivo; solo necesita los
  `empleado_id` de a quién avisar. El problema es que para que a alguien le llegue un push, su
  navegador tiene que haberse suscrito antes, y esa pantalla de "activar notificaciones" **solo
  vivía en Design** (`/design/sw.js`, alcance `/design/`). Como Leslie y Oscar no necesariamente
  tienen nada que ver con Design, se hizo un service worker y una suscripción **propios de Pagos**,
  con su propio alcance:
  - `app/static/pagos/sw.js` servido en `/pagos/sw.js` con `Service-Worker-Allowed: /pagos/`
    (copia casi literal de `/design/sw.js`, mismo formato de aviso `{titulo, cuerpo, url, etiqueta, fijo}`).
  - `app/routers/pagos_push.py`: `/pagos/api/push/{clave,suscribir,desuscribir,prueba}`, todos
    reutilizando `services_design_push` (misma tabla `DesignPushSuscripcion`, mismas claves VAPID
    -- el nombre "Design" en esos dos ahí es solo porque se escribieron ahí primero, no hay nada
    Design-específico en su lógica).
  - `app/static/pagos/push.js`: versión recortada de `/static/design/push.js` (misma lógica de
    suscripción), sin campana flotante ni popover -- aquí es una tarjeta simple dentro de la pestaña
    de Accounts Payable (`#apPushBox`), porque solo le importa a quien aprueba, no a toda la
    intranet. Si alguien usa Design Y Contabilidad, va a terminar con dos suscripciones push
    separadas (una por alcance) -- no es un bug, es el precio de no tocar el alcance de Design.
  - Si Leslie nunca visitó `/pagos` y activó notificaciones ahí, **no le va a llegar el push** (sí
    le sigue llegando el de Cliq). Avísale que entre una vez a Accounts Payable y toque "Activar
    notificaciones".

**Importar el histórico del Excel** (`services_pagos_ap.importar_excel`, `POST
/pagos/api/ap/importar`, admin/superadmin únicamente): el archivo real (`ACCOUNTS PAYABLE.xlsx`,
~64 MB, vive en el computador de Oscar, **no en este repo ni en el servidor** -- por eso el import
es una subida manual desde el navegador, no una siembra de arranque como las demás tablas del
proyecto) tiene 4 pestañas; solo **"AP SMILES"** y **"AP DESIGN"** tienen datos reales (~2.325 y
~1.133 filas respectivamente desde sept-2023). Las otras dos ("PMA", "Purchase Approval") quedaron
fuera a propósito: "Purchase Approval" casi no tiene filas y "PMA" es un formato de solicitudes de
compra totalmente distinto, no cuentas por pagar.

- **Filas 1-9 de cada pestaña son un mini resumen** ("State/Quote/AP/Paid" con fórmulas), **no
  datos** -- el encabezado real está en la fila 10, los datos empiezan en la 11
  (`_FILA_INICIO`/`_COL` en `services_pagos_ap.py`). Las dos pestañas tienen las columnas en el
  mismo orden pese a tener encabezados con texto distinto ("VALUE" vs "VALUE TO PLAY", "APROVAL" vs
  "APPROVAL"), por eso un solo `_COL` sirve para ambas.
- **Clasificación de STATE → estado** (`_clasificar`): solo `"Paid"` → `PAGADO` y `"AP"` → `APROBADO`
  (insensible a mayúsculas/espacios); todo lo demás → `OTRO` con el texto original en
  `estado_original`. No se inventó una regla para mapear "Quote" o blank a Pendiente: esas filas son
  historial cerrado de 2023, nadie va a actuar sobre ellas.
- **Dinero sucio**: `VALUE` a veces es texto con comas ("37,156,700"), a veces numérico -- `_num()`
  limpia ambos. `USD` a veces es el string de error de fórmula `"#VALUE!"` -- `_usd()` lo vuelve
  `None` (no 0, para no mentir que algo vale cero dólares).
- **Codificación ya rota en el Excel original**: algunos textos (p. ej. "ACPM Planta El�ctrica")
  traen el carácter de reemplazo Unicode `�` -- el dato original ya se perdió antes de que esto
  tocara el archivo (no es un bug de este import, no hay forma de recuperar el carácter correcto).
  Se importa tal cual.
- **Reimportar no duplica**: antes de insertar, compara (empresa, fecha, NIT, detalle, valor
  redondeado a 2 decimales) contra lo que ya existe en la tabla. Si Oscar sube el mismo Excel dos
  veces (o una versión más nueva que incluye las mismas filas viejas), las filas ya importadas se
  cuentan como "duplicadas" y no se repiten.
- **El import nunca dispara avisos** (ni Cliq ni push) -- son miles de filas históricas, no pagos
  nuevos pendientes de aprobar.
