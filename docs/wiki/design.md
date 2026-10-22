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
- **Producción del día**: los casos hechos como prestado suman al diseñador
  (`prestados_por_disenador`). En N3 se separa en Sx (Cirugías), Tc y Ng (`tipo_produccion`); en N6 (21-oct-2026) en Mc (Material
  Change), D (Dummy, la tabla principal), Ng y Tc. En
  Removable Denture va por manager, y REM = arcos aprobados con Both = 2.
- **Desempeño › Selección asistida** (Rosember, 21-oct-2026; solo admin, botón «🏆 Selección asistida» en Desempeño):
  propone Manager del mes (aprobadores de Face/N2/N3/N6), Empleado del mes N2/Face, N3/N6, otro de N3/N6 y MVP (mejor
  puntaje global; puede coincidir con un ganador). Analiza por defecto el mes anterior (selector para otros meses; el en
  curso sale como prueba). No guarda nada. Puntaje 0-100 = percentiles dentro del área, ponderados:
  diseñador — productividad (aprobadas por día disponible, descuenta ausencias) 30, calidad QC (hallazgos/caso,
  suavizado) 25, cambios digitales 15, evaluación del líder en Desempeño 20, eficiencia (tiempo vs mediana del producto
  en su área) 10; manager — productividad del equipo 30, cambios 20, QC a tiempo (mediana Approved→QC) 20, cobertura de
  QC 10, reparto parejo 10, hoja DESIGN MANAGERS 10. Compiten con ≥ 50 % de días disponibles y ≥ 10 aprobadas;
  indicadores sin dato reparten su peso. Código: `services_design_seleccion.py`, `/design/api/perf/seleccion-asistida`.
- **Desempeño en modo oscuro** (Rosember, 21-oct-2026): las celdas de nivel (ALTO, SOBRESALIENTE, MEDIO, BAJO) usan
  fondo oscuro teñido y texto claro del mismo tono, como los estados del Schedule (antes conservaban el color claro).
  Reglas en `static/design/oscuro.css` (`--pf-niv` / `--pf-niv-t`); el modo claro no cambia.
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
- **Push de Removable Denture** (Rosember, 21-oct-2026): a Nestor cuando le llega una copia nueva
  (`_push_copia_rd`; la pasada de órdenes viejas no avisa) y al manager del equipo de N3 / N6 de origen cuando
  Nestor aprueba la copia (`push_rd_aprobada`). Validado: el Fin de Bite design en N3 o N6 pasa la copia en vivo
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
