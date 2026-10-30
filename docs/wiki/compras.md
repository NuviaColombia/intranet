# Compras (inventario de Items)

**Qué es**: módulo nuevo (pedido por Oscar, 30-oct-2026), réplica estructural de SST (ver
[sst.md](sst.md)) pero con "Item" en vez de "EPP", clasificación fija por item, columna SKU/Código,
buscador en el inventario y carga masiva por Excel. **Acceso exclusivo de superadmin en todas las
pantallas, por ahora** -- a diferencia de SST, no hay roles internos tipo "Compras"/"Coordinación"
todavía (Oscar los pidió explícitamente fuera de alcance hasta que decida abrir el acceso). Mismo
flujo que SST: ingreso de inventario pendiente de aprobación, solicitud pendiente de entrega, sin
saldo guardado (el stock se deriva sumando ingresos aprobados y restando solicitudes entregadas).

**Archivos clave**
- `app/models_compras.py` -- `CompraItem` (con `sku` y `categoria`, que SST no tiene),
  `CompraIngreso`, `CompraSolicitud`, `CompraSolicitudLinea`.
- `app/services_compras.py` -- lógica de negocio + `importar_items_excel`/`generar_plantilla_items`
  (carga masiva, que SST tampoco tiene).
- `app/routers/compras.py` -- endpoints `/compras/*`, todos con `Depends(require_superadmin)`.
- `app/templates/compras.html`, `compras_parametros.html`.

## Modelo de acceso: todo `require_superadmin`, sin capas intermedias

A propósito, este módulo **no** replica `app/sst.py` (el archivo de acceso con `es_admin_sst`,
`SstAcceso`, roles Compras/Coordinador). Como por ahora nadie más que superadmin puede entrar, cada
ruta de `app/routers/compras.py` usa directamente `auth.require_superadmin` -- no existe un
`CompraAcceso` ni un `es_admin_compras`.

**Si más adelante piden abrir el acceso a managers o a roles tipo "Compras"/"Coordinación"**: no
agregues un `rol in (admin, superadmin)` suelto. Replica el patrón de SST (`es_admin_sst` +
`SstAcceso` + `tiene_acceso_sst`/`es_compras_sst`/`es_coordinador_sst` en `app/sst.py`), adaptado a
una empresa/alcance de Compras -- ese patrón ya evita el bug de company-scoping que se ha repetido
cuatro veces en la plataforma (ver "Historial de hallazgos" en [README.md](README.md)).

## ⚠️ `es_compras_mod`, no `es_compras`, en `base.html`

`app/templates/base.html` ya usaba **`es_compras`** como nombre de contexto para "esta persona tiene
el rol interno Compras *dentro de SST*" (quien registra ingresos de EPP). La bandera que marca "esta
página es del módulo Compras" (equivalente a `es_sst`, `es_pagos`, `es_activos` de los otros
módulos) se llama **`es_compras_mod`** a propósito, para no reusar ese nombre ya ocupado por SST en
el mismo archivo. Si alguna vez renombras algo de esto, no los vuelvas a cruzar.

**Consecutivos**: `ITEM-E-0001` (ingresos), `ITEM-S-0001` (solicitudes) -- igual patrón que SST
(`@property` sobre el `id`, sin columna).

## Carga masiva de items (Excel)

`/compras/parametros/items/importar` -- mismo patrón que la importación de empleados
(`app/excel_import.py::importar_empleados` + `app/routers/admin.py`): encabezados en minúscula,
solo `nombre` es columna obligatoria (`sku`, `categoria`, `unidad_conteo`, `presentacion` son
opcionales), upsert por `nombre`, errores acumulados por fila (no aborta el archivo completo), tope
de 10 MB, `request.session["import_resultado_compras"]` para mostrar el resultado tras el redirect.

⚠️ **Gotcha de orden de rutas**: `POST /compras/parametros/items/importar` y
`GET /compras/parametros/items/plantilla` están registradas **antes** de
`POST /compras/parametros/items/{item_id}` en `app/routers/compras.py`. Starlette empareja rutas por
orden de registro: si `{item_id}` quedara primero, `/items/importar` caería ahí e intentaría
convertir `"importar"` a entero (daba 422 real, ya lo encontré armando este módulo). Si agregas una
ruta estática nueva bajo `/compras/parametros/items/...`, va **antes** de la dinámica `{item_id}`.

## Clasificación

`CATEGORIAS_COMPRAS = ("Aseo y Cafetería", "Tecnología", "Otros")` en `app/models_compras.py`, fija
en código (no configurable desde la UI, igual que `UNIDADES_CONTEO`). Un valor inválido al crear/
editar un item uno a uno cae en `"Otros"` (defensivo, el `<select>` del formulario ya restringe); en
la carga por Excel, un valor que no es ninguna de las 3 sí genera un error de fila.
