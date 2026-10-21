# Design Schedule (mapa general)

**Qué es**: el módulo más grande de la plataforma, exclusivo de **Nuvia Design Colombia SAS**
(`tiene_modulo` revisa la empresa explícitamente -- solo un superadmin puede entrar sin ser de
esa empresa). Esta página es un mapa, no un detalle: Design tiene docenas de archivos; aquí solo
está dónde buscar y qué no romper sin pensarlo.

**Submódulos y su router de entrada**
- `app/routers/design_schedule.py` -- el núcleo: Schedule (N2/N3/N6/Face), Dashboard,
  Pre-Approved N3/N2, Protocols, Canvas, QC, simulación. El archivo más grande (3000+ líneas);
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
- **Development**: admins, Luis Felipe Blaschke y Paul Andion (`DEV_ESPECIALES`) y los invitados,
  estos en solo lectura (Rosember, 19–20-oct-2026).
- **Calendario en People**: Pamela Manzur y Nicol Ardila (de People, no de Design) ven el
  Calendario de Design en su propio menú -- una excepción cruzada entre empresas, no un rol.
- **Support** (las dos personas de la rotación de Support Time, quien cubre un turno ese día y los
  miembros de equipos de Support; `services_design_support.ids_support`): abren el Schedule de
  cualquier equipo y ahí ven y trabajan solo los casos asignados a ellos, como un prestado
  (`es_orden_prestada_a`). No crean ni borran órdenes de ese equipo (20-oct-2026).
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
- **Crítico** (N3) es de selección múltiple: se guarda como «A; B»; N/A va sola.
- **Total de la orden** = Fin − Inicio − Hold, con horas sin fecha. Dos correcciones que no se
  deben deshacer: varias noches en Hold suman los días perdidos (`_menos_hold`), y un Hold sin
  Re-initiated termina en el Fin (`_fin_hold`; antes un Hold del viernes aprobado el lunes contaba
  el fin de semana). Fórmula idéntica en `duracion_orden_min` y `dsDuracionMin`.
- **Descansos seguidos**: si al marcar un descanso el otro sigue corriendo, el nuevo empieza cuando
  termina aquel (19-oct-2026).
- **Contadores**: «Canceladas» cuenta toda orden con datos en Canceled, aunque no tenga diseñador;
  los demás contadores solo cuentan órdenes completas (centro, producto y diseñador).
- **Producción del día**: los casos hechos como prestado suman al diseñador
  (`prestados_por_disenador`). En N3 se separa en Sx (Cirugías), Tc y Ng (`tipo_produccion`). En
  Removable Denture va por manager, y REM = arcos aprobados con Both = 2.
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

## Integraciones

- **Push fijo** (se queda hasta que lo cierren): Face → N2 al llegar una orden aprobada, y a la
  persona de Support cuando un equipo de N3 le asigna un caso (`_push_caso_a_support`).
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
  Esto lo pidió Rosember el 20-oct-2026. Si quitan «Removable» o borran la original, la copia se
  borra solo si Nestor no la ha empezado. Si Nestor borra su copia, el vínculo queda y no se vuelve a crear. Manager y equipo de
  origen salen de `design_copias_rd` (`copias_rd_info`). Denture design se llena por estado
  (`rd_horas_por_estado`); no aplica la regla de Approved de N3. En la lista de Diseñador, «Nestor Rojas (Removable Denture)» solo sale en
  Nightguards / TC (ahí sí se le presta el caso). Antes la orden se le prestaba a Nestor y era la
  misma; ya no. La copia va SIEMPRE el mismo día que la original: `trasladar_holds` no mueve las
  copias (seguían en Ready to design y se corrían un día aunque la original no) y al final llama a
  `alinear_copias_rd`, que las pone en la fecha de su original (corregido el 20-oct-2026).
- **Ausencias desde People (Tiempos libres)**: no se guardan en `design_breaks`; se calculan al
  vuelo con los permisos aprobados de People (`services_design._permisos_aprobados_del_dia`, que
  traduce cualquier tipo de permiso al catálogo de ausencias de Design con
  `ausencia_design_de`). Todo lo que necesite saber si alguien está ausente (Schedule, Seguimiento,
  Producción, Solicitar ayuda) debe usar esa función, no solo `DesignBreak.tipo_ausencia`. Los
  permisos por horas (`permisos_por_horas_del_dia`) no son ausencia: son aviso y pausa.
- Si necesitas el detalle de un submódulo específico (Schedule, Dashboard, Pre-Approved, Office,
  Training...), conviene que esa investigación se convierta en su propia página aquí -- esta
  página es deliberadamente superficial para que siga siendo útil sin volverse obsoleta.
