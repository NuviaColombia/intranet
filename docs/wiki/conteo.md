# Conteo inventario mensual (Producción)

**Qué es**: conteo físico mensual de materiales/insumos por área y por bodega, exclusivo de
Nuvia Smiles (vive bajo "Producción", junto con Custodia y Consumo). El manager de cada área
cuenta cada material (con decimales, ej. 12.5), cuenta discos de zirconia dañados, anexa foto de
evidencia y anota novedades.

**Archivos clave**
- `app/models_conteo.py` -- `ConteoReporte`, `ConteoLinea`, `ConteoEvidencia`, `ConteoDocumento`,
  `ConteoContable`, `ConteoContableSoporte`, `ConteoBodega/Material/MaterialArea`, `ConteoTestigo`,
  `ConteoConfig`, `ConteoAviso`.
- `app/services_conteo.py` -- toda la lógica (flujo, firmas, PDFs, WorkDrive, recordatorios Cliq).
- `app/routers/conteo.py` -- página, API, páginas de firma, endpoints de Parámetros.
- `app/pdf_conteo.py` -- genera el PDF del acta (por área) y el consolidado del mes (fpdf2).
- `app/templates/conteo.html`, `conteo_firma.html`, `conteo_parametros.html`.

**Flujo: 3 firmas para quedar "en firme"**

1. El responsable del área carga el conteo y lo envía (`ENVIADO`).
2. El **Director de Producción** (una sola persona, configurada en `ConteoConfig`) firma.
3. **"Testigo"** -- a pesar del nombre, es en realidad **área contable**: cualquier persona de la
   lista de testigos, el primero que firma se queda con el cupo.

Antes de firmar (Director o testigo), cada uno debe hacer su propio **"segundo conteo"** (el
conteo oficial), que se compara contra lo que cargó el responsable -- quien hizo el segundo
conteo **no puede ser quien originalmente cargó el reporte**. Las diferencias no bloquean la
firma: quedan marcadas como "diferencia" en pantalla y en el PDF.

**Existencia contable** (`ConteoContable`) es una cifra aparte, mensual, que carga el área
contable para comparar contra lo contado físicamente -- no es parte del flujo de 3 firmas, tiene
su propio candado (`firma_contable`) que solo el Director o un admin puede reabrir.

**PDFs y WorkDrive**: al llegar a "en firme" se genera el acta del área (con las 3 firmas
electrónicas: nombre, correo, hora) y se sube a Zoho WorkDrive (carpeta `AAAA-MM NombreMes`); el
consolidado del mes se regenera cada vez que cambia el estado de firma de alguna área. Si se
anula una firma, el PDF se borra y se vuelve a generar cuando se vuelva a firmar.

## Gotchas

- **Bodega 103 "Bienes" viene desactivada por defecto** -- hay que activarla a mano en
  Parámetros si se necesita (lo de bienes normalmente se entrega a depósito).
- **No hay consecutivo**: los reportes se identifican por `(área, año, mes)` más el id de la
  base de datos, no por un número de documento.
- **Candados distintos según el estado**: una vez `ENVIADO` o `EN_FIRME` no se puede editar.
  "Anular firmas" (vuelve a `DEVUELTO`, antes de firmar en firme) y "anular reporte" (borra todo,
  después de firmado) son dos acciones distintas, solo para Director o admin -- no se usan para
  lo mismo.
- ⚠️ **Posible gap de company-scoping (encontrado al escribir esta página, no corregido
  todavía)**: `services_conteo.py` tiene su propio `es_admin()` que usa
  `user.rol in ("admin", "superadmin") or es_admin_produccion(user)` -- **sin** el chequeo de
  `user.empresa == EMPRESA_PRODUCCION` que sí tiene `acceso_produccion.es_admin()`. Esta función
  propia se usa para casi todo adentro del módulo (anular, editar, ver pendientes, cargar
  contable...). Si algún día un admin de otra empresa llega a pasar el candado de entrada del
  submódulo, este `es_admin()` interno le daría más permisos de los que debería tener. Vale la
  pena revisarlo con el mismo criterio que ya se aplicó en SST y Custodia.
