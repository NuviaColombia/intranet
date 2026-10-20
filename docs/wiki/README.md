# Wiki del proyecto (mantenida por Claude)

Páginas cortas por módulo: qué hace, dónde vive, cómo fluyen los datos y qué no romper. La
idea es no tener que releer el código fuente completo cada vez que una sesión nueva (mía o de
Rosember/Carlos) necesita tocar un módulo que no construyó.

**Cuándo actualizarla**: al terminar un cambio que no sea obvio con solo leer el código --
una regla de negocio, un gotcha de seguridad ya corregido una vez, una decisión de diseño que
costó una investigación larga. No hace falta documentar cada función; sí vale la pena documentar
lo que, si se te olvida, puede volver a romperse.

**Formato de cada página**: Qué es · Archivos clave · Modelo de acceso / flujo de datos ·
Gotchas · Quién aprueba cambios sensibles (si aplica).

## Páginas

- [sst.md](sst.md) -- Control de inventario de EPP (Nuvia Smiles)
- [custodia.md](custodia.md) -- Cambio de custodia y Producción (Nuvia Smiles)

Para el módulo Design, la nota equivalente ya vive en `CLAUDE.md` (la regla de Openings) porque
es la que más veces se ha roto; cuando este formato de wiki se extienda a Design, esa nota se
debería mover aquí y dejar solo un enlace en `CLAUDE.md`.
