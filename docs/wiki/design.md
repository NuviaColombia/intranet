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

**Tres excepciones por persona (no por rol) que vale la pena conocer antes de buscar un patrón de
roles que no existe:**
- **Mural**: los editores siempre lo ven; el resto, solo cuando hay algo publicado.
- **Development**: admins, más dos personas puntuales (Luis Felipe Blaschke y Paul Andion, a
  pedido de Rosember).
- **Calendario en People**: Pamela Manzur y Nicol Ardila (de People, no de Design) ven el
  Calendario de Design en su propio menú -- una excepción cruzada entre empresas, no un rol.

**Simulación**: un admin puede "simular" ser otra persona. Dentro de Design actúa como esa
persona por completo; fuera de Design, todo queda en solo lectura. Regla de seguridad: un
superadmin puede simular a cualquiera; un admin normal solo a alguien de su propia empresa, y
**nunca** a un superadmin.

## Gotchas

- **La regla de Openings ya está documentada en [`CLAUDE.md`](../../CLAUDE.md)** -- no la
  dupliques aquí; esa es la fuente oficial y la prueba que falla a propósito si se toca sin
  avisar a Rosember.
- Dos lugares más, además de Openings, tienen una nota explícita de "validar con Rosember antes
  de tocar":
  - `app/services_design_origenes.py` (docstring del módulo completo).
  - `app/services_design_pa_excel.py` -- un comentario marca qué hojas del Excel de Pre-Approved
    "Rosember confirmó que están bien" (no las "arregles" sin preguntar).
- Si necesitas el detalle de un submódulo específico (Schedule, Dashboard, Pre-Approved, Office,
  Training...), conviene que esa investigación se convierta en su propia página aquí -- esta
  página es deliberadamente superficial para que siga siendo útil sin volverse obsoleta.
