# Intranet NuviaColombia: notas para quien modifique el código

## ⚠️ Design Schedule: origen de los datos del equipo de diseño (validar con Rosember)

En el módulo Design hay dos fuentes oficiales de datos de las que dependen otras partes:

- **Openings** (Parámetros › Openings; tablas `design_openings_*`) es la base de datos de asignación de centros a los managers y equipos.
  - De Openings sale el desplegable **Centro** del Schedule (`services_design.centros_de_equipo`).
  - De Openings salen los centros de cada hoja de **Pre-Approved** N3 y N2 (`services_design_origenes.pa_sync_openings`).
  - Si en Pre-Approved se mueve un centro a mano, Openings también cambia.
- **Parámetros › Equipos** (tablas `design_teams` y `design_team_designers`) es el origen de los managers y diseñadores del Schedule.
  - Si cambia el manager de un equipo, Openings toma el nombre nuevo.
  - Si se desactiva un equipo, sus centros quedan sin manager en Openings.

**Si te piden cambiar de dónde se leen o hacia dónde se escriben estos datos**, avisa primero: hay que validar la modificación con **Rosember**. Cambiarlos puede dañar el funcionamiento de la plataforma para el equipo de diseño. Esto incluye:
- cambiar o quitar estas conexiones;
- leer los centros o los equipos de otra tabla o archivo;
- cambiar las tablas mencionadas.

El detalle está en `app/services_design_origenes.py`. La prueba `tests/test_design_origenes.py` falla a propósito si ese código cambia; no actualices sus huellas sin la aprobación de Rosember.

```
python -m unittest tests/test_design_origenes.py
```
