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
- [consumo.md](consumo.md) -- Seguimiento de consumo (Nuvia Smiles, mismo acceso que Custodia)
- [conteo.md](conteo.md) -- Conteo inventario mensual (Nuvia Smiles)
- [caja_menor.md](caja_menor.md) -- Caja Menor Nuvia
- [permisos.md](permisos.md) -- Permisos / Vacaciones (People, ambas empresas)
- [design.md](design.md) -- Design Schedule (mapa general; el detalle de Openings sigue en
  `CLAUDE.md`, es la nota que más se ha roto y conviene dejarla donde toda sesión la lee primero)

## Hallazgos pendientes de revisar (encontrados escribiendo estas páginas, no corregidos)

Dos módulos más tienen el mismo tipo de bug de "company-scoping" que ya se corrigió en SST y
Custodia -- un admin/superadmin entra sin revisar su empresa. Quedó anotado en la página de cada
uno para no perderlo, pero **nadie lo ha arreglado todavía**:
- Caja Menor (`services_caja.es_admin`) -- ver el gotcha en [caja_menor.md](caja_menor.md).
- Conteo inventario mensual (`services_conteo.es_admin`, uno propio distinto al de
  `acceso_produccion`) -- ver el gotcha en [conteo.md](conteo.md).
