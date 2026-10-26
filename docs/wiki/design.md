# Design Schedule (mapa general)

**Qué es**: el módulo más grande de la plataforma, exclusivo de **Nuvia Design Colombia SAS**
(`tiene_modulo` revisa la empresa explícitamente -- solo un superadmin puede entrar sin ser de
esa empresa). Esta página es un mapa, no un detalle: Design tiene docenas de archivos; aquí solo
está dónde buscar y qué no romper sin pensarlo.

**Submódulos y su router de entrada**
- `app/routers/design_schedule.py` -- el núcleo: Schedule (N2/N3/N6/Face), Dashboard,
  Pre-Approved N3/N2, Canvas, QC, simulación. El archivo más grande (3000+ líneas);
  casi todos los demás routers de Design comparten su `router`.
- `app/routers/design_inicio.py` -- página de inicio de Design (noticias + mural).
- `app/routers/design_mural.py` -- avisos fijados en una pared.
- `app/routers/design_office.py` -- Nuvia Office (Word/PowerPoint propios), solo
  aprobadores/admins.
- `app/routers/design_training.py` -- plataforma de entrenamiento interactiva.
- `app/routers/design_push.py` -- notificaciones push del navegador.
- `app/routers/design_support.py` -- turnos rotativos de Support.
- `app/routers/design_vivo.py` -- canal de actualizaciones en vivo (Server-Sent Events).
- `app/routers/design_ayuda.py`, `design_calendario.py`, `design_cumple.py`, `design_dev.py`,
  `design_pizarron.py`, `design_reunion.py` -- funciones más puntuales (pedir ayuda entre
  aprobadores N3, calendario, cumpleaños, seguimiento de proyectos, pizarra digital, videollamada).

## Acceso: excepciones por persona (no por rol)

Antes de buscar un patrón de roles que no existe:
- **Mural**: los editores siempre lo ven; el resto, solo cuando hay algo publicado.
- **Centro de avisos** (`/design/avisos`): solo admins de Design (20-oct-2026).
- **Corregir el texto de un hallazgo de QC** (Dashboard › Resumen › Reportes de QC, «Editar»): solo admins, también en
  días cerrados (`api_qc_hallazgo_editar`; Rosember, 21-oct-2026). Se puede deshacer desde el aviso.
- **Nueva lista de hallazgos de QC de N3** (Rosember, 26-oct-2026): 4 títulos (Diseño, Evidencias, Comentarios /reportes,
  To mill) con 31 hallazgos, iguales en Cirugías y Nightguards / TC y para cualquier producto. Reemplazó toda la lista
  anterior de N3 (la del 9-oct y lo que agregaron los aprobadores): esas filas quedan con `activo = 0` y los reportes
  de QC ya guardados no cambian. Se aplica una sola vez (`REEMPLAZOS` en services_design_qc.py, marca
  `qc_n3_lista_26oct`); lo que se agregue después se conserva. N6 sigue con su lista.
- **Dejar a cargo › varias asignaciones** (Rosember, 26-oct-2026): un equipo puede tener varias asignaciones por fechas
  (p. ej. una persona distinta cada día de las vacaciones del manager); cada día solo una persona (no deja cruzar fechas).
  Sin cambiar la estructura de la base: la lista de cada equipo va en design_conexion_reglas (tipo «sistema», clave
  `delegaciones_equipo_<team_id>`, JSON con id, empleado, desde, hasta, quién autorizó) y design_delegaciones queda como
  espejo de la de hoy o la próxima (para el Schedule en vivo). Un equipo sin lista usa esa fila (lo de antes). La ventana
  muestra la lista con «Quitar» y «Agregar una asignación», que propone el día siguiente a la última; la etiqueta del
  Schedule dice «+N programadas». `delegaciones_activas` calcula quién está a cargo hoy desde las listas.
- **Dejar a cargo › «Otra persona…»** (Rosember, 26-oct-2026): al final de la lista de diseñadores del equipo; abre un
  buscador con las personas activas de la MISMA área (diseñadores de otros equipos y sus managers) que no son del equipo
  (`candidatos_delegacion`, GET `/design/api/teams/{id}/delegacion/candidatos`). `guardar_delegacion` acepta al equipo
  o a esos candidatos; nunca a alguien de otra área. Quien queda a cargo gestiona el Schedule (`gestiona_equipo`).
- **Buscador en la ventana del QC** (Rosember, 26-oct-2026): con «Con hallazgos» aparece «🔍 Buscar hallazgo…»; deja solo
  los hallazgos que coinciden (sin importar tildes; si coincide el título, todos los suyos) y abre sus títulos. Lo marcado
  se conserva al buscar.
- **Pestaña lateral «Acciones»** (Rosember, 26-oct-2026): «Producción», «Cambios digital» y «Dejar a cargo» salieron de la
  cabecera del Schedule a una pestaña en el borde derecho (`#dsLateral`). Se despliega al pasar el mouse o al tocarla (tocada
  queda abierta); se recoge al salir, con Esc, al hacer clic afuera o al usar una acción. Cada botón sigue con sus reglas de
  siempre (`ds-fuera` / `hidden`); si ninguno aplica, la pestaña no se ve. Con la pestaña visible, `#ds-app` deja 30px a la
  derecha para que no tape el contenido. En oscuro la pestaña es blanca con texto del azul de la barra.
- **Saludo en el título del Schedule** (Rosember, 26-oct-2026): en vez de «Design Schedule (equipo)», los aprobadores ven
  «Hola <primer nombre>, aquí está tu equipo en movimiento.» y los diseñadores «Hola <primer nombre>, tu trabajo es
  espectacular. ¡Gracias!». Quien está a cargo HOY del equipo (Dejar a cargo, `aCargo.esYo` + `activa`) ve el de
  aprobador con su nombre. Los admins ven el título de siempre. La pestaña del navegador sigue «Design Schedule (equipo)»
  para todos (`data-pestana` del h1). El primer nombre es la primera palabra de `nombres`.
- **Buscar orden o paciente con el logo** (Rosember, 26-oct-2026): en el Schedule el buscador es un círculo con el logo
  (día: círculo del azul de la barra y logo blanco; oscuro: círculo blanco y logo azul de la barra, en `oscuro.css`).
  Al tocarlo se alarga en la barra de búsqueda, como Google; se recoge con Esc o al salir sin nada escrito. Abierta, el
  contorno alumbra en azul claro. La barra (`.ds-buscar-caja`) se despliega por encima de los botones vecinos: el círculo
  ocupa siempre 34px y el foco usa `preventScroll`, así la página no salta al abrir. El logo es
  `static/design/logo_buscar.png` (blanco con transparencia), usado como máscara CSS para pintarlo de cualquier color.
- **Dashboard › Filtros › Reportes de QC: filtro ▾** (Rosember, 26-oct-2026): en el encabezado «Hallazgo de QC», ordenar
  A → Z / Z → A y elegir qué hallazgos ver (cada reporte se parte en «Título › hallazgo», con cuántas órdenes lo tienen,
  buscador y «Seleccionar todos»). La tabla, «Borrar los hallazgos filtrados» y la descarga usan solo lo visible
  (`ddQcFiltrados`).
- **Eliminar títulos y editar hallazgos de la lista de QC** (Rosember, 26-oct-2026; todas las áreas, solo admins): 🗑
  junto al título lo quita con todos sus hallazgos (`eliminar_titulo`, POST `/qc-catalogo/titulo/eliminar`, declarada
  antes de `/qc-catalogo/{item_id}/eliminar`) y ✎ junto a cada hallazgo corrige su texto (`editar_hallazgo`, POST
  `/qc-catalogo/{item_id}/editar`; no deja repetir un texto en el mismo título). Los reportes de QC ya guardados no cambian.
- **Renombrar un título de la lista de hallazgos de QC** (✎ en la ventana del QC): solo admins, cambia el título
  para toda el área (`renombrar_titulo`); los reportes ya guardados conservan su texto (21-oct-2026).
- **Dashboard › Reportes** (`/design/reportes/mensual`, subir PDF): solo admins de Design (21-oct-2026).
- **Development**: admins, Luis Felipe Blaschke y Paul Andion (`DEV_ESPECIALES`) y los invitados,
  estos en solo lectura (Rosember, 19–20-oct-2026).
- **Calendario en People**: Pamela Manzur y Nicol Ardila (de People, no de Design) ven el
  Calendario de Design en su propio menú -- una excepción cruzada entre empresas, no un rol.
- **Support** (las dos personas de la rotación de Support Time, quien cubre un turno ese día y los
  miembros de equipos de Support; `services_design_support.ids_support`): abren el Schedule de
  cualquier equipo y ahí ven y trabajan solo los casos asignados a ellos, como un prestado
  (`es_orden_prestada_a`). No crean ni borran órdenes de ese equipo (20-oct-2026).
- **Octubre 2026 abierto para los aprobadores** (Rosember, 21-oct-2026): cada aprobador activo de Design
  tiene un permiso de edición del 1 al 31 de octubre en sus propios Schedules, vigente hasta el 31-oct
  11:59 pm, para llenar los días vacíos mientras se implementa el Schedule. Lo crea una vez
  `services_design_permisos.octubre_aprobadores_una_vez` (marca `permiso_octubre_aprobadores_2026`); se ve y se
  puede quitar por persona en Parámetros › Equipos.
- **Diseñador prestado**: edita la orden de otro equipo que tiene asignada; al pasar el caso al día
  siguiente (`trasladar_holds`) vuelve sin diseñador.

**Invitados de solo lectura** (`app/invitados.py`, Parameters › Invitados): entran con Zoho, dentro
de Design se tratan como admin para ver todo, y `auth.get_current_user` rechaza cualquier petición
que no sea de lectura en toda la plataforma (salvo su push y su modo oscuro). Su fila en
`empleados` lleva el cargo «Invitado (solo lectura)»; no se puede volver invitado a un empleado.

**Simulación**: un admin puede "simular" ser otra persona. Dentro de Design actúa como esa
persona por completo; fuera de Design, todo queda en solo lectura. Regla de seguridad: un
superadmin puede simular a cualquiera; un admin normal solo a alguien de su propia empresa, y
**nunca** a un superadmin.

## Reglas de negocio del Schedule

- **Approved en N3 › Cirugías** exige Orden, Paciente, Centro, Producto, Diseñador, START, RTD,
  Inicio diseño y Crítico; si hay Start hold, también Re-initiated. QC es opcional. Lo valida el
  servidor (`faltan_para_aprobar`) y la pantalla hace parpadear lo que falta (`DS_APROBAR_N3`).
  No aplica a los casos de Removable Denture (Rosember, 19-oct-2026).
- **Bite ready** (Nightguards / TC) registra el tiempo como Hold: llena Start hold y al volver a
  Initiated, Re-initiated (`horas_de_estado`; Rosember, 20-oct-2026).
- **Formato de horas por fecha**: desde el 21-oct-2026 todo octubre usa el formato actual (Rosember: los
  días 1–8 salían con el formato viejo mientras los aprobadores los llenan). Fechas de corte en
  `FACE_/DUAL_/NG_/N2_NUEVO_DESDE` (services_design.py) y `DS_*_NUEVO_DESDE` / `dsHorasPorEstado` (schedule.js),
  todas en 2026-10-01; deben ir iguales en los dos lados. Las órdenes del 1 al 4 de octubre con el formato viejo
  se convirtieron una vez (marcas `*_formato_nuevo_oct1`, Inicio diseño → `hora_inicio`).
- **Hold solo después de iniciar** (Rosember, 21-oct-2026): no se puede poner Hold (ni crear una orden en Hold) si la
  etapa en curso no tiene Inicio (`orden_iniciada`; Material Change y Removable miran Zirconia/Denture con `z_`). Lo
  valida el servidor (`HOLD_SIN_INICIO`) y la pantalla oculta la opción (`dsAjustarOpcionHold`). Motivo: casos puestos
  en Hold antes de empezar dejaban el Start hold antes del Inicio y el Total salía mal (orden 243897).
- **Crítico** (N3) es de selección múltiple: se guarda como «A; B»; N/A va sola.
- **Total de la orden** = Fin − Inicio − Hold, con horas sin fecha. Dos correcciones que no se
  deben deshacer: varias noches en Hold suman los días perdidos (`_menos_hold`), y un Hold sin
  Re-initiated termina en el Fin (`_fin_hold`; antes un Hold del viernes aprobado el lunes contaba
  el fin de semana). Fórmula idéntica en `duracion_orden_min` y `dsDuracionMin`.
- **Descansos seguidos**: si al marcar un descanso el otro sigue corriendo, el nuevo empieza cuando
  termina aquel (19-oct-2026).
- **Contadores**: «Canceladas» cuenta toda orden con datos en Canceled, aunque no tenga diseñador;
  los demás contadores solo cuentan órdenes completas (centro, producto y diseñador).
- **Pre-Approved › «+ Doctor» en el centro elegido** (Rosember, 27-oct-2026): al tocar un centro (su nombre, un doctor o una
  celda de sus columnas) queda elegido (encabezado resaltado) y el botón dice «+ Doctor en FREMONT»; el doctor nuevo queda al
  final de las columnas de ese centro, los doctores de los centros siguientes se corren y su `span` sube 1
  (`preapproved_agregar_doctor(centro_id=)`, POST `/preapproved/sheets/{id}/doctores?centro_id=`). Cada centro es un grupo de
  doctores consecutivos; el `orden` de los doctores se renumera seguido y las celdas siguen a su doctor (van por doctor_id).
  Sin centro elegido va al último, como antes. No toca Openings ni `services_design_origenes.py`.
- **Dashboard › Aprobaciones también para aprobadores** (Rosember, 28-oct-2026): antes solo admins. Un aprobador ve la
  pestaña y las órdenes lentas (aprobadas sin QC pasada 1 h 30 min) pero solo de sus equipos (los que maneja o tiene a
  cargo: `_equipos_visibles` → `lentas(equipos=)`); los admins ven todo. Pedir por la API un equipo ajeno no devuelve nada.
  Ayudas y Reportes siguen siendo solo de admins.
- **Correcciones de Desempeño de N2 Daniel** (Rosember, 28-oct-2026): en `CORRECCIONES_ACORDADAS`, quitar «Shirliana
  Rodriguez» (queda en la Papelera) y la de la duplicada de Aylin (`unir_duplicado`, pendiente de su nombre completo). Se
  aplican desde Parámetros (vista previa primero). `unir_duplicado` conserva la fila con más calificaciones, pasa las demás
  a la Papelera y completa los meses vacíos con las calificaciones de la otra.
- **Hoja de Desempeño «N3 Zulys»** (Rosember, 28-oct-2026): creación única (`perf_hoja_zulys_una_vez`, marca
  `perf_hoja_n3_zulys_2026_10_28`) que busca en la base a la manager de un equipo activo de N3 llamada Zulys (Zuly, Zully…) y
  arma la hoja con los 12 meses de 2026, una fila por cada diseñador de su equipo (sin ella ni inactivos) y la asocia a ella
  (regla `hoja_manager`, como «N3 Paula»), así ve y califica solo la suya. Corre al arrancar y al abrir Desempeño. Si todavía
  no hay una manager de N3 con ese nombre, no hace nada ni marca y lo intenta después; si hay dos personas con ese nombre,
  no adivina. Si alguien borra la hoja, no reaparece. Para sumar un diseñador nuevo del equipo después: agregarlo en la hoja.
- **Hoja de Desempeño «N3 Leonardo»** (Rosember, 26-oct-2026): igual que la de Zulys, para el aprobador Leonardo de N3 y su
  equipo (`perf_hoja_leonardo_una_vez`, marca `perf_hoja_n3_leonardo_2026_10_26`, busca «leonardo» en el nombre del manager).
  Ambas usan `_perf_hoja_aprobador_una_vez(db, cfg, estado)`; para otro aprobador basta otra configuración igual.
- **Personas de una hoja de Desempeño** (Rosember, 26-oct-2026): en las hojas de evaluación, «+ Agregar persona» (nuevas
  contrataciones), ✎ corregir el nombre y 🗑 quitar (p. ej. si alguien sale de la empresa), en «Año completo» y «Un mes».
  Puede el aprobador en la hoja de su equipo (nunca su propia fila ni DESIGN MANAGERS) y el admin en cualquier hoja de
  evaluación (`perf_puede_gestionar_hoja`). Rutas: POST `/design/api/perf/sheets/{id}/personas`,
  `/design/api/perf/empleados/{id}/nombre` y `/design/api/perf/empleados/{id}/quitar`. Quitar deja la fila con sus
  calificaciones en la Papelera (módulo `perf-emp`, 15 días, se puede restaurar). No se permiten dos filas con el mismo
  nombre en una hoja. Renombrar no cambia nombres ya escritos en la hoja de Selección ni en Empleado del mes.
- **Quien está a cargo no está disponible** (Rosember, 28-oct-2026): una persona a quien se deja «a cargo» de un equipo hoy
  (`delegaciones_activas`) queda como un aprobador: en Seguimiento no sale si no tiene casos propios hoy (si los tiene, sale con
  lo que hace), no cuenta como diseñador en turno en la capacidad de «Casos por equipo» (salvo que tenga casos hoy) y no se
  ofrece como libre en «Pedir ayuda» (N3, N2 y Face). Aplica aunque cubra un equipo distinto al suyo y solo durante sus fechas.
- **Desempeño › N6 Marlene: meses de 2025 a 2026** (Rosember, 28-oct-2026): los títulos de mes de esa hoja decían 2025.
  Corrección única (`perf_meses_2026_una_vez`, marca `perf_meses_n6_marlene_a_2026_2026_10_28` en design_conexion_reglas, que
  guarda cómo estaban): cambia el año de los títulos de la hoja «N6 Marlene» (y solo de ella); las calificaciones van por la
  posición del mes y no se tocan. Corre al arrancar el servidor y al abrir Desempeño. Efecto: la Selección asistida, que busca
  el mes por etiqueta y año, ahora encuentra los meses de 2026 de esa hoja.
- **Solicitar ayuda también en N2 y Face** (Rosember, 28-oct-2026): mismas condiciones que en N3 (ver
  `services_design_ayuda.py`). La opción «🤝 Pedir ayuda…» sale al manager del equipo (o a quien está a cargo hoy), en su
  Schedule, hoy y en una orden guardada. Cada área pide SOLO a los otros equipos de su misma área (N3 a N3, N2 a N2, Face a
  Face; no se mezclan): `AREAS_AYUDA`, `_equipos_ayuda`, `libres_n3(area_id=)`. «Libre» = igual que N3 (sin la regla de
  articulación, que solo existe en N3). Sin libres, el mismo mensaje («Contacta al manager General»). Dashboard › Ayudas
  (solo admins) trae el área de cada solicitud y un filtro por área (`reporte(area_id=)`, `?area_id=`). Un manager de varias
  áreas pide desde el equipo cuyo Schedule tiene abierto (`equipo_de_solicitante(team_id=)`).
- **Zulys en lila en las gráficas del Dashboard** (Rosember, 28-oct-2026): las líneas de equipos se coloreaban por su
  posición (`DDT_COL`); ahora hay colores fijos por nombre (`DDT_FIJOS`, `ddTColores`): el equipo o aprobador que contenga
  «zuly» o «zully» (se escribe Zulys) sale siempre en lila (#a78bfa), sin importar su posición; los demás siguen la paleta en su orden. El violeta de la
  paleta pasó a verde azulado para que no se parezca al lila. Se aplica a todas las gráficas de tendencia (Resumen y Filtros).
- **Esc = acceso directo al Schedule** (Rosember, 27-oct-2026): en toda pantalla de Design, Esc lleva al Schedule
  (`static/design/esc.js`, cargado desde base.html y en las páginas que no usan la barra común: Office y los dos reportes
  imprimibles). No pisa los Esc de varios niveles: espera lo que pasó DESPUÉS de que los demás atendieron la tecla y solo
  navega si nadie la usó (evento cancelado, cambió la pantalla, la dirección o el foco, hay una ventana abierta). Así se
  conservan: Canvas (hoja → principal de Canvas → Schedule), Training (lección → módulo), ventanas y menús que se cierran,
  el menú de la barra (solo lo cierra) y los paneles del Schedule. Escribiendo en un campo, la primera Esc solo sale del
  campo y la segunda va al Schedule. El Pizarrón conserva su Esc (cierra menús y paneles, guarda lo pendiente, confirma si
  hay reunión) y ahora vuelve siempre al Schedule (antes, a la página anterior). En el Schedule no hace falta: ya cierra
  sus paneles. `ds_estaticos_v` incluye esc.js para que el navegador no use una copia vieja.
- **Canvas › «🧹 Limpiar todo»** (Rosember, 27-oct-2026): solo en la vista Tablero (junto a «Vista»), con cuántas fotos hay.
  Quita las fotos de los marcos de TODAS las hojas del área (como «🧹 Limpiar» de una hoja, pero en todas); el formato, los
  marcos y las anotaciones se quedan. Pide confirmación y deja «Deshacer» unos segundos (`cvLimpiarTodo`). Se guarda en el
  navegador y en el respaldo del servidor como cualquier cambio de la hoja.
- **Compartir una hoja de Canvas** (Rosember, 26-oct-2026): «⇪ Compartir» en el tablero, la cuadrícula, el panel de hojas y
  la barra del editor. Envía una COPIA a todos los de la misma área o a una persona del área (`canvas_destinatarios`:
  diseñadores y managers de los equipos activos del área). Va solo el formato: los marcos sin foto y sin las anotaciones
  con imagen (`canvas_compartir`). La copia queda en el respaldo de quien la recibe, con «(de Nombre)» en el nombre, y
  le llega un push; su Canvas la trae al abrirse (`cvTraerDelServidor` agrega las hojas del respaldo que no están en el
  navegador). Si nunca había abierto el Canvas de esa área, recibe también sus hojas base.
  Ventana (27-oct-2026): dos tarjetas («Todo mi área» con cuántas personas / «Una persona») y, para una persona, una lista con
  buscador, iniciales y equipo; el botón dice a quién se envía (`cvCompartir`). Teclado: ↓/↑ eligen, Enter envía, Esc cierra.
- **Canvas propio en el navegador** (Rosember, 26-oct-2026): cada persona trabaja su Canvas en SU navegador (IndexedDB
  `ds-canvas`, clave `<empleado_id>:<area_id>`) y el servidor guarda un respaldo privado (solo el dueño ve y guarda,
  `canvas_puede_ver`). La primera vez, o si se borran los datos del navegador, se copian al navegador las hojas del
  respaldo; desde ahí el navegador manda. Se quitó «Ver hojas de» para managers y admins (`canvas_personas_visibles`
  devuelve []). Ojo: quien use dos computadores tiene una copia distinta en cada uno y el respaldo queda con lo último
  que se guardó. Pruebas: `tests/test_design_canvas.py`.
- **Botón Producción para todo el equipo** (Rosember, 23-oct-2026): el botón «Producción» de la barra del Schedule (con un
  equipo abierto, fuera de Support) lo ven aprobadores, admins y diseñadores; antes solo los gestores (`DS_GESTION`). Solo
  cambia quién ve el botón: el dato sale de lo que el Schedule ya carga (`dsPintarProduccion`). El panel de Seguimiento
  sigue solo para gestores.
- **Producción del día**: los casos hechos como prestado suman al diseñador
  (`prestados_por_disenador`). En N3 se separa en Sx (Cirugías), Tc y Ng (`tipo_produccion`); en N6 (21-oct-2026) en Mc (Material
  Change), D (Dummy, la tabla principal), Ng y Tc. En
  Removable Denture va por manager, y REM = arcos aprobados con Both = 2.
- **Inicio › podio de diseñadores de N3** (Rosember, 22-oct-2026): solo cuentan las Cirugías (tabla principal); los
  Nightguards y TC ya no suman (`PODIO_SOLO_CIRUGIAS` en services_design_inicio.py). Las demás áreas no cambian.
- **Comments › Training ve la pestaña de N3** (Rosember, 22-oct-2026): `COMMENTS_AREAS["n3"]` incluye el área Training.
- **Push › clic en el aviso** (22-oct-2026): si la intranet estaba abierta en una página no controlada por el service
  worker, `navigate()` fallaba y el clic no llevaba a ningún lado. Ahora sw.js usa una pestaña de Design (navigate; si no
  puede, le manda el mensaje `nvAbrir` y push.js cambia de página) y, si no hay pestaña de Design, abre una nueva.
- **Mural › push al publicar** (Rosember, 22-oct-2026): cada aviso que se publica (uno o «Publicar» de varios) manda un
  push fijo (se queda hasta cerrarlo) a todas las personas activas con acceso a Design, menos a quien lo publica; uno por
  aviso (etiqueta `mural-{id}`, no se reemplazan) y al tocarlo abre el Mural en ese aviso (`?aviso=id`). Quien administra
  el Mural tiene «🔔 Push de prueba» (solo a sí mismo) y «📣 Avisar a todos» para los avisos con la cinta «Nuevo»
  (`avisar_nuevos`, `POST /design/api/mural/push`). Solo llega a quien activó las notificaciones (🔔) en su navegador.
- **N6 › Producción del día: TC** (Rosember, 22-oct-2026): en la tabla Nightguards / TC, el producto «N6 - Full Mouth Zirk -
  Over Ti-Bar (8mm or less)» cuenta como Tc (antes caía en Ng porque su nombre no dice «TC»). Lista `PRODUCTOS_TC`
  (servidor, `tipo_produccion`) y `DS_PRODUCTOS_TC` (schedule.js, `dsTipoProduccion`): para otro producto, agregarlo en las dos.
- **Cumpleaños › subir la foto a mano** (Rosember, 22-oct-2026): en Formatos Canva › Cumpleaños (solo admin) cada persona
  sin foto tiene «📷 Subir foto» y las que tienen, «📷 Cambiar foto». La imagen se recorta cuadrada al centro y se reduce
  a 800 px en el navegador; se guarda en `design_fotos_perfil` con origen «manual · quién · fecha» y queda como su foto
  de perfil de Design. El inicio de sesión con Zoho ya no reemplaza una foto manual (`foto_design_al_iniciar`).
  Endpoint `POST /cumple/api/foto/{empleado_id}` (JPG/PNG/WEBP, máx. 2 MB).
- **Inicio › rankings sincronizados al mediodía** (Rosember, 22-oct-2026): el de equipos/managers y el de diseñadores se
  actualizan juntos una vez al día, a las 12:00 m. hora Colombia (antes cada hora, cada uno por su lado). Cuentan los
  casos aprobados hasta ese corte (`corte_ranking`; una orden con aprobada_en después de las 12 espera al día siguiente),
  así un reinicio del servidor no cambia el resultado. El pie dice «último corte: dd/mm 12:00».
  Cambio (Rosember, 22-oct-2026): ya no una vez al día sino cada 4 horas, cortes fijos 12 a. m., 4, 8, 12 m., 4 p. m. y
  8 p. m. (`HORAS_ENTRE_CORTES`); el corte de medianoche del día 1 todavía muestra el mes anterior completo.
- **GeoVictoria (integración, fases 1-3)** (Rosember, 22-oct-2026): API de asistencia (https://customerapi.geovictoria.com/api/v1,
  login JWT con clave/secreto). Credenciales: Parámetros › GeoVictoria (solo admin; las escribe un admin, se guardan en
  design_conexion_reglas tipo sistema clave `geovictoria`; el secreto no vuelve a la pantalla). Solo Nuvia Design; cruce
  por cédula (Empleado.identificacion ↔ Identifier, solo dígitos). Un hilo (`services_design_geovictoria.arrancar`, en el
  startup) trae cada 5 min el AttendanceBook de hoy (lotes de 40) a memoria; Seguimiento lee esa memoria y muestra
  entrada (con atraso), almuerzo, salida, permisos y lo que falta marcar. Avisos **push** (no Cliq), activables en la
  página: a la persona y a su manager (y a quien está a cargo hoy) cuando, con 10 min de tolerancia (configurable), no
  marcó la entrada, el regreso del almuerzo (60/90 min libres o fin del almuerzo fijo) o la salida; uno por tipo y
  persona al día (claves guardadas en `gv_avisos_AAAA-MM-DD`, se borran a los 7 días). Sin turno o con permiso en
  GeoVictoria no se avisa. Pendiente: fases 4-6 (ausencias automáticas, reporte de horas, puntualidad en Selección).
  La página carga sola el cruce y las marcas al abrirse; «Conexión» y «Cruce por cédula» son desplegables que abren
  cerrados con su resumen (Rosember, 22-oct-2026; se quitó «Probar con una persona»).
  Horario sin asignar (Rosember, 22-oct-2026): si un diseñador no tiene turno en GeoVictoria ese día (ni descanso «No
  trabaja» ni permiso), a su manager le llega un push para asignárselo: a las 3 p. m. por el siguiente día hábil y a las
  7 a. m. por hoy; solo días hábiles; un push por manager con la lista (`_recordar_horarios`). En Marcas de hoy y en
  Seguimiento sale «📅 Sin horario». Usa la misma casilla «Enviar avisos push».
  Permisos de la plataforma (Rosember, 22-oct-2026): además de los de GeoVictoria, no se avisa (ni «sin horario») a quien
  tiene un permiso de día completo en People (aprobado o pendiente de soporte) o una ausencia en Tiempos libres; con un
  permiso por horas de People que cubre la hora de la marca, el aviso espera a que termine el permiso + la tolerancia
  (`_permisos_plataforma`, `faltas`). Se revisa con cada consulta de marcas (cada 5 min).
  Almuerzo → Tiempos libres (Rosember, 22-oct-2026; casilla en la página, encendida por defecto): la marca de salida a
  colación llena el Almuerzo de Tiempos libres en el/los equipo(s) de la persona: inicio = salida; fin = regreso, máximo
  60 min («si se pasa, se anota 1 hora»); sin regreso aún, inicio + 60. No pisa un almuerzo escrito a mano
  (`almuerzo_a_tiempos_libres`); avisa en vivo al Schedule.
  Reporte mensual de llegadas tarde (Dashboard › Reportes › «Reportes GeoVictoria»): GetConsolidatedColombia (días con
  atraso y minutos); solo quienes llegaron tarde ≥ 1 vez; KPIs, gráfica de quienes más llegan tarde, por equipo, por día de
  la semana y detalle; mismo estilo del reporte mensual, imprimible como PDF (`/design/reportes/geovictoria?mes=`). Los
  meses cerrados se guardan el día 1 (design_conexion_reglas `gv_reporte_AAAA-MM`); el mes en curso se calcula al abrirlo.
  No salen Rosember Jhoan Bravo Marentes ni Leidy Rodríguez (`EXCLUIDOS_REPORTE`); los meses guardados con otra
  `REPORTE_VERSION` se recalculan.
  Inconsistencias de marcación (Rosember, 22-oct-2026): cada viernes desde las 3 p. m. (una vez; marca
  `inconsist|fecha|*`) se revisa el mes en curso del día 1 hasta ayer. En días con turno y sin permiso (GeoVictoria,
  People o Tiempos libres) es inconsistencia no tener marcas o tener un número impar (1 o 3: falta una); solo entrada y
  salida (sin almuerzo) está bien. Cada manager recibe un push «⚠️ Hay inconsistencias en tu GeoVictoria» con su gente y
  los días (`inconsistencias`, `avisar_inconsistencias`). Requiere «Avisos» activo.
- **Selección asistida con postulados** (Rosember, 22-oct-2026): cada manager postula a su empleado del mes en la hoja de
  Selección. Si el mes ya tiene postulados, solo ellos compiten en N2 / Face, N3 / N6 y MVP; su puntaje es su posición
  frente a toda su área y «Destacado» no cuenta. Manager del mes: solo los calificados ese mes en DESIGN MANAGERS. Sin
  postulados o sin calificaciones se muestran todos (prueba) y la pantalla lo avisa. Recordatorio: el último día hábil
  del mes (sin festivos) a las 9 a. m., push «🏆 No olvides postular a tu empleado del mes» a cada manager de Face, N2, N3
  y N6 que aún no ha postulado (`recordar_postulados`, desde el hilo del Centro de avisos; una vez, clave
  `seleccion_recordatorio_AAAA-MM`).
- **Selección asistida sin desventaja por área** (auditoría de Rosember, 22-oct-2026): simulado con todos igual de buenos,
  el área más pequeña ganaba de más (Face ≈ 60 % de «N2 / Face» siendo ~⅓ de la gente; MVP el doble de lo justo). Cambios:
  percentil = (puesto − ½) / n (el mejor de 25 queda sobre el mejor de 5); destacado vale (n − ½) / n del equipo y el
  resto (n − 1) / 2n, y no cuenta para la gente de un manager que no llenó Selección ese mes (antes 0); evaluación =
  puntos sobre / bajo el promedio de su líder, comparados en el área; puntualidad entre todos; área con menos de
  `MIN_GRUPO_AREA` (4) compara carga y eficiencia con su categoría; MVP usa el mismo puntaje (posición en el área), ya no la
  carga en minutos estándar entre todas las áreas. Con esto cada área gana en proporción a su gente.
- **Selección asistida › Elegir** (Rosember, 22-oct-2026): cada ganador (y cada «Siguiente») tiene «✔ Elegir»; lo
  registra en la tabla «Empleado del mes» de la hoja de Selección que tiene la columna de ese mes (prefiere la que tiene
  el año en el nombre), en la categoría que corresponde (MVP → fila MVP, N2/Face según el área, el «otro» de N3/N6 en la
  segunda fila de N3/N6, Manager → fila manager/líder); se puede cambiar antes de registrar y pide confirmar si la celda
  ya tenía a alguien (`destinos`, `GET /design/api/perf/seleccion-asistida/destinos`; guarda con `/design/api/perf/ganadores/{id}`).
- **Desempeño › Empleado del mes: categoría editable** (Rosember, 22-oct-2026): en la hoja de Selección el admin
  corrige el texto de cada categoría (vista anual y de un mes); los ganadores ya registrados se quedan
  (`perf_renombrar_categoria`, `POST /design/api/perf/ganadores/{id}/categoria`).
- **Desempeño › Selección asistida** (Rosember, 21-oct-2026; solo admin, botón «🏆 Selección asistida» en Desempeño):
  propone Manager del mes (aprobadores de Face/N2/N3/N6), Empleado del mes N2/Face, N3/N6, otro de N3/N6 y MVP (mejor
  puntaje global entre quienes no ganaron otra categoría: nadie se repite, Rosember 22-oct-2026). Analiza por defecto el mes anterior (selector para otros meses; el en
  curso sale como prueba). No guarda nada. Puntaje 0-100 = percentiles dentro del área, ponderados:
  diseñador — productividad (aprobadas por día disponible, descuenta ausencias) 30, calidad QC (hallazgos/caso,
  suavizado) 25, cambios digitales 15, evaluación del líder en Desempeño 20, eficiencia (tiempo vs mediana del producto
  en su área) 10; manager — productividad del equipo 30, cambios 20, QC a tiempo (mediana Approved→QC) 20, cobertura de
  QC 10, reparto parejo 10, hoja DESIGN MANAGERS 10. Regla (Rosember, 22-oct-2026): un diseñador con cualquier hallazgo
  de QC en el mes queda descartado de una vez (el peso de Calidad pasó a los demás: productividad 40, evaluación 27,
  cambios 20, eficiencia 13). Nadie se repite: ni ganadores ni nombres en «Siguientes».
  Imparcialidad (Rosember, 22-oct-2026): los cambios digitales ya no cuentan (no son culpa del diseñador ni del equipo).
  Diseñadores = productividad 45, evaluación del líder 25 (percentil SOLO entre los calificados por el mismo líder, para
  quitar el sesgo de líderes que califican más alto), destacado por su manager en la hoja de Selección 15 (sí = 100,
  no = 0; si nadie destacó ese mes no cuenta), eficiencia 15. Managers = hoja DESIGN MANAGERS 40, productividad 25,
  QC a tiempo 15, cobertura de QC 10, reparto parejo 10.
  Carga de trabajo (Rosember, 22-oct-2026): Face = más casos y más fáciles (IA), N2 medio, N3/N6 complejos y con menos
  volumen. «Productividad» pasa a ser carga: cada caso aprobado vale los minutos estándar de su producto (mediana real
  del tiempo de diseño en los últimos 90 días, ≥ 5 casos; si no, la del área; si no, mediana general × FACTOR_AREA
  Face 1 / N2 1,5 / N3 2,5 / N6 2,5). Managers: la carga se compara entre todos (ya no por área). MVP: también entre
  todas las áreas. Empleado del mes de cada área: dentro de su área. La pantalla muestra los minutos por caso de cada área.
  Configuración (Rosember, 22-oct-2026): botón «⚙️ Configuración» junto a «Analizar» para que el admin cambie los
  porcentajes de diseñadores y de managers (enteros 0-100, cada grupo suma 100; 0 % = no cuenta; «Restablecer los de
  fábrica»). Se guarda en design_conexion_reglas (tipo sistema, clave `seleccion_asistida_pesos`); sin guardar se usan
  PESOS_DISENADOR / PESOS_MANAGER. Rutas GET/POST `/design/api/perf/seleccion-asistida/config` (solo admin).
  Puntualidad (GeoVictoria, Rosember 22-oct-2026): criterio nuevo para diseñadores y managers = % de días trabajados
  (Consolidated/Extended › WorkedDays) en que llegó a tiempo (GetConsolidatedColombia › días con atraso), desempate por
  minutos de atraso; diseñadores contra su área, managers contra todos. Pesos de fábrica: diseñadores carga 40 ·
  evaluación 25 · destacado 15 · eficiencia 10 · puntualidad 10; managers evaluación 35 · carga 25 · QC a tiempo 15 ·
  cobertura 10 · reparto 5 · puntualidad 10. Si había pesos guardados sin este criterio, entra con 10 % y se le descuenta
  al de más peso. Sin GeoVictoria configurado el criterio no cuenta (`_puntualidad`). Compiten con ≥ 50 % de días disponibles y ≥ 10 aprobadas;
  indicadores sin dato reparten su peso. Código: `services_design_seleccion.py`, `/design/api/perf/seleccion-asistida`.
- **Desempeño en modo oscuro** (Rosember, 21-oct-2026): las celdas de nivel (ALTO, SOBRESALIENTE, MEDIO, BAJO) usan
  fondo oscuro teñido y texto claro del mismo tono, como los estados del Schedule (antes conservaban el color claro).
  Reglas en `static/design/oscuro.css` (`--pf-niv` / `--pf-niv-t`); el modo claro no cambia.
- **N3 › Order Entered al escribir la orden** (Rosember, 22-oct-2026): en los Schedules de N3 (todas sus tablas), al
  escribir el número de orden en una fila sin estado, el estado queda en «Order Entered» (pantalla: dsGuardarFila;
  servidor: `estado_al_escribir_orden` al crear y al editar). Si la fila ya tiene estado no se toca. Solo N3.
- **N3 › Cirugías: el estado marca la articulación** (Rosember, 21-oct-2026): «Pickup received» llena START y «Ready to
  design» llena RTD (hora Colombia, solo si están vacías; se pueden corregir a mano; RTD solo si hay START). De Pickup
  received no se puede pasar a Initiated ni a otro estado de diseño: primero Ready to design (Order Entered, Canceled y
  Skipped sí). En pantalla esas opciones se ocultan (`dsAjustarOpcionPickup`) y el servidor lo valida (`pickup_salta`,
  `articulacion_por_estado`). Solo N3 Prosthetic, tabla Cirugías (no Nightguards/TC, no Training ni N6).
- **Dashboard › Resumen y Filtros** (Rosember, 21-oct-2026): la pestaña que se llamaba «Resumen» ahora es «Filtros» (igual
  que antes). La nueva «Resumen», primera de la fila, es solo informativa: una «Tendencia por equipo» por área (Face, N2,
  N3, N6) en el mes en curso (`dgCargar`); un aprobador ve solo sus áreas y equipos (lo limita `dashboard_tendencia`).
  Ajuste del mismo día: dos gráficas por fila, entrada animada y, en el día de hoy, la cara del aprobador (manager) de
  cada equipo en vez del círculo (iniciales si no tiene foto; `dashboard_tendencia` devuelve `aprobador`, `foto` y `hoy`).
  Las pestañas del Dashboard quedan en la misma fila del título.
  Regla (Rosember, 21-oct-2026): la «Tendencia por equipo» (Resumen y Filtros) cuenta solo órdenes completas en estado
  **Approved**; el resto de Filtros (KPIs, Producción por diseñador, filtro Estado) sigue igual.
  Resumen › «Reportes de QC por diseñador» (Rosember, 21-oct-2026): barras de más a menos en el mes en curso, solo quien
  tiene ≥ 1; todas las áreas juntas (aprobador: solo sus equipos). Cuenta QC marcado con hallazgo escrito; en N6 el QC de
  Zirconia es otro reporte; sin canceladas/skipped (`dashboard_qc_disenadores`, `/design/api/dashboard/qc-disenadores`).
  Ajuste: solo salen quienes tienen **5 reportes o más** (`DG_QC_MIN`), barras en azul y clic en una barra abre la lista
  de sus errores (fecha, orden, paciente, producto, hallazgo).
  Resumen › «Reparto de productos por equipo» (Rosember, 21-oct-2026, primera propuesta): tabla diseñador × producto del
  mes en curso con selector de equipo (aprobador: solo los suyos). Cuenta órdenes completas sin canceladas/skipped; los
  diseñadores son los miembros del equipo (los prestados salen aparte y no cuentan). Celda ▲/▼ si está 50 % por encima o
  por debajo del promedio; fila Equidad = coeficiente de variación (≤ 25 % Pareja, ≤ 50 % Algo desigual, más Desigual).
  Máx. 10 productos, el resto en «Otros» (`dashboard_reparto`, `/design/api/dashboard/reparto`).
  Corrección: el aprobador (manager) del equipo NO cuenta (Rosember: hace casos ocasionales; ni fila, ni prestado, ni
  total) y en Support no hay prestados; la fila Prestados dice al pasar el mouse quién fue cada uno y de qué equipo viene.
  Casos chicos: si entre el que más y el que menos hay ≤ 1 caso es «Pareja» (1 contra 0 no es desigual); con menos de 2
  casos por diseñador dice «Pocos casos»; ▲/▼ solo si se separa 2 casos o más del promedio.
  N6 Material Change: cada producto se divide en «· Bite design» (siempre) y «· Zirconia design» (si la orden ya llegó a
  esa etapa), juntos en la tabla; el subtítulo cuenta órdenes reales. La tabla va debajo de Reportes de QC.
  Ausencias (Rosember, 21-oct-2026): columna «Días» = días disponibles / días hábiles del mes hasta hoy (lunes a viernes
  sin festivos, menos ausencias de día completo de Tiempos libres y de permisos de People aprobados o pendientes de
  soporte; no los por horas). A cada diseñador le corresponde una parte de cada producto según sus días; ▲/▼ y la
  equidad comparan contra eso (casos por día disponible, CV ponderado). Ahora salen todos los miembros activos del
  equipo aunque tengan 0 casos; quien estuvo ausente todo el periodo sale en gris y no cuenta (`_reparto_dias`).
  Presencia día a día (Rosember, 22-oct-2026): lo que le correspondía a cada uno = los casos de cada día repartidos entre
  los diseñadores presentes ese día (no por días totales), así quien falta (incapacidad, luto, vacaciones…) no sale por
  debajo y los presentes no salen por encima; equidad = variación de «hizo ÷ le correspondía» ponderada.
  `REPARTO_EXCLUIR`: en Face no cuentan María José Lemus ni el producto Maxilar Print.
  N2 (Rosember, 22-oct-2026): los Changes (productos con «change» en el nombre) salen en un apartado propio «🔁 Changes»
  debajo de la tabla, con el mismo cálculo; la tabla principal ya no los trae (`REPARTO_CHANGES_APARTE`, seccion="changes").
- **Dashboard › Articulación** (Rosember, 21-oct-2026): el filtro de área solo ofrece N3; cada vez que se abre la
  pestaña el periodo vuelve al mes en curso (`daAbrir`). La tabla «(Centros)» solo muestra centros con casos de más de
  2 h; la de «(Casos)» muestra de a 50 con «Mostrar más». Las dos en desplegables que abren cerrados.
- **Dashboard › Aprobaciones** (Rosember, 21-oct-2026): solo órdenes aprobadas que siguen sin QC pasada 1 h 30 min
  (`services_design_aprobacion.lentas`); al marcar el QC salen de la lista.
  Removable Denture no sale ahí ni en «Aprobadas sin QC» del Resumen: no lleva QC (21-oct-2026).
- **Dashboard › Ayudas** (21-oct-2026): «Enviada a» y la tabla por aprobador salen de `design_ayuda_ofertas` (a quién le
  llegó cada solicitud); respuesta promedio = atendida_en − creada_en de las que ese aprobador atendió.
  Los admins pueden eliminar una solicitud (p. ej. de prueba) con sus envíos; la orden no cambia (`eliminar_solicitud`).
- **Reporte mensual** (Dashboard › Reportes, Rosember, 21-oct-2026; `services_design_reportes`): para la
  Directora de producción, ES/EN, se descarga con Imprimir › PDF. Solo lo que tiene problemas: centros con
  cirugías de N3 cuya articulación pasó de 2 h (`dashboard_articulacion`) y cambios adicionales (Cambios
  digitales) por diseñador. El diseñador sale de cruzar el número de orden del cambio con el Schedule (la
  orden más reciente hasta la fecha del cambio; sin copias de Removable Denture ni Support). No se guarda:
  se arma al abrirlo.
- **Support Designer** (N3): asigna el caso a quien atiende Support en ese momento: el turno que
  corre según la rotación o, si ese turno tiene cobertura activa, quien lo reemplaza
  (`services_design_support.en_turno`).

## Base de datos (cambios recientes, autorizados por Rosember)

- 19-oct-2026: `design_cumple_vistos`, `design_dev_*` (Development), `design_ordenes.critico`
  pasa a 300 caracteres (solo en PostgreSQL).
- 20-oct-2026: `design_dev_apoyos`, `design_invitados`, columna `design_ordenes.arco`. Área y
  equipo «Removable Denture» creados solos por `rd_una_vez`. Columna
  `design_support_config.cliq_canales` (solo para sembrar el grupo «Support» del Centro de avisos). Tablas
  `design_cliq_grupos`, `design_cliq_destinos`, `design_cliq_mensajes`, `design_cliq_envios` (Centro de avisos).
  Tabla `design_copias_rd` (copia de
  Removable Denture ↔ orden original); la primera vez que se abre Removable Denture, las órdenes de
  hoy en adelante con «Removable» reciben su copia (`rd_copias_una_vez`).

- 21-oct-2026: tabla `design_reportes` (PDF subidos a mano en Dashboard › Reportes; hasta 15 MB cada uno,
  ocupan espacio de la base de Supabase).
- 21-oct-2026: **Protocols se retiró por completo** (Design y Nuvia Office), autorizado por Rosember. Al arrancar,
  `main.retirar_protocolos` (una sola vez, marca `sistema/protocolos_eliminados_2026_10_21` en `design_conexion_reglas`)
  borra los protocolos de la Papelera (`design_trash.modulo = 'protocol'`), los favoritos de protocolos, las
  presentaciones de Nuvia Office que eran borradores de un protocolo, y elimina las tablas `design_protocolos`,
  `design_protocolo_areas`, `design_protocolo_archivos` (PDF), `design_protocolo_versiones`,
  `design_protocolo_borradores`, `design_protocolo_miniaturas` y `design_protocolo_paginas`. Irreversible.
  La columna `design_favoritos.protocolo_id` queda sin uso y sin llave foránea. Training ya no tiene enlaces a
  Protocols (los pasos «enlace» sin lección se omiten) e Inicio oculta los botones y tarjetas que llevaban ahí.

## Integraciones

- **Face → N2 solo con la hoja de hoy** (Rosember, 21-oct-2026): al marcar el QC en Face, el caso pasa a N2 solo si
  la orden de Face es del día de hoy (`copiar_face_a_n2`). Llenar o corregir semanas viejas de Face no crea casos
  en N2. Ese día se quitaron una vez las copias del 21-oct que venían de hojas viejas y N2 no había empezado
  (`face_n2_viejas_una_vez`). Antes (14-oct) cualquier QC copiaba el caso al día de hoy.
- **Push fijo** (se queda hasta que lo cierren): Face → N2 al llegar una orden aprobada, y a la
  persona de Support cuando un equipo de N3 le asigna un caso (`_push_caso_a_support`).
- **Producto fantasma «Training»** (Rosember, 26-oct-2026): está en el catálogo de productos de TODAS las áreas, al final
  (`PRODUCTOS_AL_FINAL` con áreas None, marca `producto_training_todas_2026_10_26`); es solo para practicar. La orden se
  ve y se edita en el Schedule, pero no cuenta en ninguna parte: `filtro_orden_completa` lo excluye (contadores,
  Dashboard, vista de todas las áreas, Reparto, Inicio, Reportes, Selección asistida, reportes de QC), y además
  `filtro_no_fantasma` en Seguimiento, casos asignados y prestados; N3/N2 Producción y la copia Face → N2 usan
  `es_producto_fantasma`. En la pantalla, `dsEsFantasma` lo saca de los contadores y del botón Producción.
- **Push al pasar un caso a Training** (Rosember, 26-oct-2026): cuando un manager de N3 › Cirugías elige «Training» en
  Diseñador (`mover_a_training`), a la manager del equipo de Training (Estefanía) y a quien esté a cargo hoy de ese
  equipo les llega «🎓 Nuevo caso para Training» (fijo, con orden, paciente, centro, producto, quién lo pasó y el día)
  para que lo asigne (`_push_llego_a_training` en routers/design_schedule.py). No le llega a quien lo pasa.
- **Push de Removable Denture** (Rosember, 21-oct-2026): a Nestor cuando le llega una copia nueva
  (`_push_copia_rd`; la pasada de órdenes viejas no avisa) y al manager del equipo de N3 / N6 de origen cuando
  Nestor aprueba la copia (`push_rd_aprobada`; desde el 26-oct-2026 también al diseñador de la orden original,
  nunca a quien aprueba). Validado: el Fin de Bite design en N3 o N6 pasa la copia en vivo
  a Ready to design · Denture design.
- **Cliq**: el bot «Anuncios Design» avisa el cambio de turno de Support; necesita
  `DESIGN_CLIQ_WEBHOOK_TOKEN` (o `DESIGN_CLIQ_REFRESH_TOKEN`) en Render.
- **Centro de avisos (Cliq)** (`/design/avisos`, menú Management; solo admins de Design; Rosember,
  20-oct-2026): todo lo que envía el bot. Grupos (canales por Unique Name y personas por correo, mensaje
  directo del bot), mensajes con variables (`{persona}` = @mención por correo `{@correo}`, `{turno}`,
  `{horario}`, `{fecha}`…) y su momento (inicio de cada turno de Support, día del cambio de turno,
  programado una vez o cada semana, o a mano), bot por mensaje (vacío = `DESIGN_CLIQ_BOT`) e historial
  con reintento. Un hilo revisa cada minuto (`services_design_avisos.arrancar`, arranca con la app); cada
  envío automático deja una marca en `design_conexion_reglas`, así no se repite con dos instancias. Si el
  servidor estaba caído, sale dentro de 30 min. Los dos avisos de antes («Support Designer en turno» y
  «Cambio de turno de Support») quedaron como mensajes «de la plataforma»: se pausan, no se borran, y
  usan las mismas marcas de antes. `DESIGN_SIN_AVISOS_TURNO` apaga el hilo.
  21-oct-2026: el hilo no puede morir (antes, un `rollback` fallido tras un error lo detenía para siempre
  sin aviso); si un envío automático falla antes de llegar a Cliq, se quita su marca y se reintenta el
  minuto siguiente. La página muestra si el envío automático está corriendo y su último error.
  **Plan en memoria** (Rosember, 21-oct-2026: «no quiero que haga las consultas tan seguido»): cada minuto el revisor
  compara la hora con un plan en memoria (`_cargar_plan` / `_pendientes`) y **no consulta la base** salvo cuando toca un
  envío, cuando alguien edita un mensaje, grupo, Support Time o festivos (`invalidar()`), cada 30 min o al cambiar el
  día, y para reintentos solo si hubo un 429. Lo ya enviado se recuerda en `_HECHOS`. Probado en tiempo real: sale en
  el minuto programado y después hace 0 consultas. Si se agrega un disparador nuevo, va en `_pendientes` (sin base).
  **Límite de Cliq** (21-oct-2026: varios canales seguidos daban «429 request_limit_exceeded»): 2 s de
  pausa entre destinos, un reintento a los 20 s y, si sigue el 429, el revisor lo reintenta solo (hasta 4
  veces en una hora). «Enviar ahora» con más de 3 destinos se envía en segundo plano (míralo en Historial).

## Gotchas

- **La regla de Openings ya está documentada en [`CLAUDE.md`](../../CLAUDE.md)** -- no la
  dupliques aquí; esa es la fuente oficial y la prueba que falla a propósito si se toca sin
  avisar a Rosember.
- Dos lugares más, además de Openings, tienen una nota explícita de "validar con Rosember antes
  de tocar":
  - `app/services_design_origenes.py` (docstring del módulo completo).
  - `app/services_design_pa_excel.py` -- un comentario marca qué hojas del Excel de Pre-Approved
    "Rosember confirmó que están bien" (no las "arregles" sin preguntar).
- **Removable Denture** (área con un solo equipo, «Schedule Removable Denture», diseñador Nestor
  Rojas). Desde el 20-oct-2026 (Rosember) toda orden de N3 / N6 cuyo producto dice «Removable»
  tiene una COPIA en ese equipo: la original la trabaja su equipo y Nestor diseña la removable en la
  copia (estado y horas propios). `sincronizar_copia_rd` corre al crear, editar, crear en lote y
  borrar: crea la copia (Nestor, Bite design, Order Entered), le copia orden/paciente/centro/
  producto y las horas de Bite design, que son las de la original (Inicio diseño, Hold, Fin de N3 /
  N6; `_bite_desde_original`). Al ponerse el Fin en la original, la copia pasa a Denture design ·
  Ready to design; cuando Nestor cambia el estado (Initiated…) trabaja Denture design (horas `z_*`).
  Esto lo pidió Rosember el 20-oct-2026. **Cambio 21-oct-2026:** el FINISH de Bite design ya no sale del Fin de la
  original (es el Fin de todo el caso de N3): lo pone la opción **«Bite Finish»** de la lista de estados de N3 / N6
  (solo en órdenes con copia, arriba de «Colores…»; `api_bite_finish` → `bite_finish_rd`). La orden de N3 no cambia de
  estado; la copia queda en Denture design · Ready to design y Nestor recibe un push. Después del Bite Finish la
  original ya no toca las horas de Bite de la copia. La marca `rdBite` ('pendiente' / 'hecho') viene en `/dia` y en la
  respuesta al guardar; el cliente la conserva en los parches en vivo (`dsConservarExtras`). Si quitan «Removable» o borran la original, la copia se
  borra solo si Nestor no la ha empezado. Si Nestor borra su copia, el vínculo queda y no se vuelve a crear. Manager y equipo de
  origen salen de `design_copias_rd` (`copias_rd_info`). Denture design se llena por estado
  (`rd_horas_por_estado`); no aplica la regla de Approved de N3. En la lista de Diseñador, «Nestor Rojas (Removable Denture)» solo sale en
  Nightguards / TC (ahí sí se le presta el caso). Antes la orden se le prestaba a Nestor y era la
  misma; ya no. La copia va SIEMPRE el mismo día que la original: `trasladar_holds` no mueve las
  copias (seguían en Ready to design y se corrían un día aunque la original no) y al final llama a
  `alinear_copias_rd`, que las pone en la fecha de su original (corregido el 20-oct-2026).
- **`Empleado.activo` es entero (1/0), no booleano**: filtra con `== 1`. Con `== True` funciona en
  SQLite (pruebas) pero PostgreSQL falla; así se cayó el Centro de avisos al publicarlo (20-oct-2026).
- **Ausencias desde People (Tiempos libres)**: no se guardan en `design_breaks`; se calculan al
  vuelo con los permisos aprobados de People (`services_design._permisos_aprobados_del_dia`, que
  traduce cualquier tipo de permiso al catálogo de ausencias de Design con
  `ausencia_design_de`). Todo lo que necesite saber si alguien está ausente (Schedule, Seguimiento,
  Producción, Solicitar ayuda) debe usar esa función, no solo `DesignBreak.tipo_ausencia`. Los
  permisos por horas (`permisos_por_horas_del_dia`) no son ausencia: son aviso y pausa.
  Cuentan los permisos **aprobados y los «pendiente de soporte»** (`ESTADOS_AUSENCIA_PEOPLE`; 21-oct-2026:
  las licencias ya aprobadas por el jefe que esperan que People valide el documento salían libres).
- **Seguimiento sin Support** (Rosember, 21-oct-2026): no salen los equipos de Support ni las dos personas de
  Support Time, aunque trabajen casos de N3; quien solo cubre un turno sí sale.
- Si necesitas el detalle de un submódulo específico (Schedule, Dashboard, Pre-Approved, Office,
  Training...), conviene que esa investigación se convierta en su propia página aquí -- esta
  página es deliberadamente superficial para que siga siendo útil sin volverse obsoleta.
