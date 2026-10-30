# Evaluación de desempeño (People)

**Qué es**: `/evaluacion-desempeno`, dentro de People, visible para cualquier empleado autenticado
(sin casilla de módulo, igual que "Certificaciones"). Dos formularios -- "Evalúa a tu jefe" (360°) y
"Evalúa a tu equipo" (individual) -- basados en la estructura de aprobadores que ya existe en People
(`Empleado.aprobador1_id`/`aprobador2_id`), más el documento "Plan de mejora" por líder. Pedido por
Oscar el 30-oct-2026, basado en el archivo `Plan_Mejora_Lideres_NuviaSmiles - copia.xlsx`. Aplica a
**todas las empresas** (Smiles y Design).

⚠️ **No confundir con el "Desempeño" de Design** (`app/services_design.py`, funciones `perf_*`,
tablas `DesignPerf*`, dentro de Design Schedule): son dos sistemas totalmente independientes que
coexisten sin relación. Este (People) es la evaluación 360 + plan de mejora semestral; el de Design
es una rejilla mensual de criterios por equipo.

**Archivos clave**
- `app/models_evaluacion.py` -- `EvaluacionCiclo`, `Evaluacion360Respuesta`,
  `EvaluacionEquipoRespuesta`, `PlanMejora` + sus tablas hijas (`PlanMejoraCompetenciaNota`,
  `PlanMejoraAccion`, `PlanMejoraSeguimiento`), `EvaluacionRecordatorioEnviado`.
- `app/services_evaluacion.py` -- toda la lógica de negocio (quién evalúa a quién, promedios,
  permisos, recordatorios).
- `app/routers/evaluacion_desempeno.py` -- rutas + el bucle `asyncio` del recordatorio automático.
- `app/templates/evaluacion_desempeno*.html`.
- `tests/test_evaluacion_desempeno.py`.

## Modelo de acceso (de dónde sale cada dato)

**"Tu jefe" = tus aprobadores vigentes**: `services_evaluacion.jefes_a_evaluar(empleado)` devuelve
`[aprobador1, aprobador2]` (deduplicados, solo si siguen `activo=1`) -- **no** usa el campo `rol`.
**"Tu equipo" = de quién eres aprobador**: `services_evaluacion.equipo_a_evaluar(db, empleado)` es
literalmente `services.empleados_a_cargo(db, empleado)` ya existente, reutilizado tal cual -- no
hay una segunda fuente de "equipo". Una persona puede ver las dos tarjetas a la vez si tiene jefe Y
equipo (nivel intermedio); no hace falta ninguna lógica especial para ese caso, sale solo de estas
dos funciones siendo independientes entre sí.

**Un cambio de aprobador a mitad de ciclo no altera respuestas ya dadas**: `Evaluacion360Respuesta`/
`EvaluacionEquipoRespuesta` quedan ligadas a `evaluador_id`/`evaluado_id` fijos (snapshot del
momento). Las listas de pendientes se recalculan en vivo en cada `GET`, así que si cambia el
aprobador de alguien, automáticamente deja de pedirle evaluar al jefe anterior y empieza a pedirle
el nuevo -- sin tocar lo ya respondido.

**Quién ve/edita el Plan de mejora de un líder** (`puede_ver_plan`/`puede_editar_plan`/`puede_firmar`
en `services_evaluacion.py`): lo ve el propio líder, su(s) jefe(s), admin/superadmin y RR.HH.
(`services.es_aprobador_soporte` -- Pamela o un superadmin de respaldo, mismo criterio que el resto
de la plataforma para "RR.HH."). **El líder puede ver pero no editar** fortalezas/plan de
acción/seguimiento (eso lo escribe su jefe o RR.HH., igual que en el Excel original) -- solo puede
firmar su propia casilla de la Sección 7.

**La Evaluación 360 (Sección 2) es siempre anónima a nivel de consulta, no solo de presentación**:
`promedio_360()` nunca hace `SELECT` de `evaluador_id`, solo `AVG`/`COUNT` agregados. El líder jamás
puede saber quién calificó qué, ni siquiera mirando la base de datos a través del código de esta
función.

## Recordatorios automáticos (noviembre y mayo)

Un ciclo (`EvaluacionCiclo`) se abre solo, una vez, cuando el bucle `asyncio` del router (revisa
cada 6 horas) detecta que estamos en noviembre o mayo (`abrir_ciclo_si_corresponde`, idempotente por
`UniqueConstraint(anio, mes)`). Cada persona con algo pendiente recibe Cliq + correo
(`services_evaluacion.enviar_recordatorios`), sin repetir antes de `DIAS_ENTRE_RECORDATORIOS` (7)
días -- la marca vive en `EvaluacionRecordatorioEnviado`. Mismo patrón que
`app/routers/recordatorio_firmas.py` (tabla de marca por persona + `asyncio.create_task` en el
propio router), reutilizando `zoho_cliq.enviar_cliq`/`zoho_mail.enviar_correo` ya existentes.

## Gotchas

- Los ciclos **solo** se abren solos en noviembre/mayo -- para probar el flujo completo en otro mes
  hay que llamar `services_evaluacion.abrir_ciclo_si_corresponde(db, fecha_falsa)` a mano (ver
  `tests/test_evaluacion_desempeno.py`); no hay ningún botón en la UI para forzarlo (a propósito,
  para no abrir un ciclo "de prueba" por accidente en producción).
- Las 12 competencias de la Evaluación 360 y los 3 aspectos de "Evalúa a tu equipo" son texto
  **fijo** tomado literal del Excel (`COMPETENCIAS_360`/`ASPECTOS_EQUIPO` en
  `services_evaluacion.py`), no configurable desde la UI.
