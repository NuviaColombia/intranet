# Wiki del proyecto (mantenida por Claude)

Páginas cortas por módulo: qué hace, dónde vive, cómo fluyen los datos y qué no romper. La
idea es no tener que releer el código fuente completo cada vez que una sesión nueva (mía o de
Rosember/Carlos) necesita tocar un módulo que no construyó.

## Regla: qué se registra

Obligatorio (ver `CLAUDE.md`): si un cambio entra en alguna de estas categorías, se anota en la
página de su módulo **en el mismo commit**, en una o dos líneas, con la fecha y quién lo pidió.

1. **Acceso**: quién entra o ve algo, sobre todo las excepciones por persona (correos o nombres
   en el código), roles nuevos, invitados y lo que alguien puede hacer en un equipo que no es el
   suyo.
2. **Reglas de negocio**: validaciones que bloquean algo (p. ej. qué se exige para un estado),
   automatismos (qué llena o mueve el sistema solo) y fórmulas de lo que se calcula (totales,
   contadores, producción).
3. **Base de datos**: tablas o columnas nuevas, migraciones al arrancar y datos que se crean solos
   (siembras «una vez»). Incluye quién lo autorizó.
4. **De dónde sale cada dato**: si un dato se lee de otro módulo (p. ej. ausencias de People) o
   de otra tabla, y qué funciones deben usarse para leerlo.
5. **Integraciones**: avisos push, Cliq, correo, servicios externos y variables de entorno que
   necesitan (sin escribir nunca su valor).
6. **Errores corregidos que pueden volver**: la causa en una línea y qué no hacer para que no
   reaparezca.
7. **Lo que requiere aprobación** antes de tocarse, y de quién.

No se registra: cambios visuales (colores, textos, anchos), arreglos obvios al leer el código ni
el paso a paso de una función. Si dudas, regístralo: una línea de más cuesta menos que repetir una
investigación.

**Formato de cada página**: Qué es · Archivos clave · Modelo de acceso / flujo de datos ·
Gotchas · Quién aprueba cambios sensibles (si aplica).

## Páginas

- [sst.md](sst.md) -- Control de inventario de EPP (Nuvia Smiles)
- [custodia.md](custodia.md) -- Cambio de custodia y Producción (Nuvia Smiles)
- [consumo.md](consumo.md) -- Seguimiento de consumo (Nuvia Smiles, mismo acceso que Custodia)
- [conteo.md](conteo.md) -- Conteo inventario mensual (Nuvia Smiles)
- [caja_menor.md](caja_menor.md) -- Caja Menor Nuvia (desde 27-oct-2026 vive dentro del módulo
  "Contabilidad" del portal, junto a "Pagos", que todavía no tiene funcionalidad)
- [permisos.md](permisos.md) -- Permisos / Vacaciones (People, ambas empresas)
- [design.md](design.md) -- Design Schedule (mapa general; el detalle de Openings sigue en
  `CLAUDE.md`, es la nota que más se ha roto y conviene dejarla donde toda sesión la lee primero)
- [activos.md](activos.md) -- Activos: inventario de hardware de TI (Design), migrado desde un
  proyecto aparte

## Historial de hallazgos de company-scoping

El mismo tipo de bug ("un admin/superadmin entra sin revisar su empresa") ya apareció y se
corrigió **cuatro veces**: SST, Custodia/Producción, Conteo y Caja Menor. Si vas a escribir
código nuevo que decida "¿es administrador?", parte de `acceso_produccion.es_admin` (Producción)
o `sst.es_admin_sst` (SST) como ejemplo, no de un `rol in (admin, superadmin)` suelto -- ese es
exactamente el patrón que ya falló cuatro veces. El detalle de cada corrección sigue en la página
de su módulo ([caja_menor.md](caja_menor.md), [conteo.md](conteo.md), [custodia.md](custodia.md)).
