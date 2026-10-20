# Seguimiento de consumo (Producción)

**Qué es**: entrega de materia prima (frascos) a los técnicos y su rendimiento diario (arcos por
tipo de producto), hasta que cada frasco se consume. Exclusivo de Nuvia Smiles -- comparte el
mismo modelo de acceso que Custodia (ver [custodia.md](custodia.md)), bajo "Producción".

**Archivos clave**
- `app/models_consumo.py` -- `ConsumoMateria` (catálogo), `ConsumoTipo` (tipos de producto),
  `ConsumoTecnico`, `ConsumoManager`, `ConsumoEntrega` (entrega, `id` = consecutivo),
  `ConsumoFrasco`, `ConsumoJornada` (registro diario), `ConsumoTraslado`, `ConsumoApertura`
  (desbloqueo de un día pasado).
- `app/services_consumo.py` (~1000 líneas) -- toda la lógica.
- `app/routers/consumo.py` -- rutas, API, exportes CSV, migraciones.
- `app/templates/consumo.html`, `consumo_parametros.html`.

**Modelo de acceso**: el mismo de Custodia (`acceso_produccion.py` -- `require_submodulo`,
`ProduccionAdmin`, `ProduccionAcceso`, company-scoping a Nuvia Smiles). Encima de eso, ser
**técnico** o **manager** es un concepto aparte: filas en `ConsumoTecnico`/`ConsumoManager`
(cada una ligada a un `Empleado` y a un área), asignadas en Producción › Parámetros. Un técnico
solo ve/actúa sobre frascos de su propia área; un manager, sobre la suya.

**Medidas múltiples**: cada materia prima (`ConsumoMateria.medida`) puede pedir que se registren
arcos, gotas, o ambos a la vez -- no es un solo tipo de medida fijo por todo el módulo.

**Traslado de frascos**: mover un frasco en uso de un técnico a otro (incapacidad, retiro, cambio
de área). El "dueño actual" del frasco es el del traslado más reciente si existe, o si no, el de
la entrega original.

## Gotchas

- **La jornada no se edita, se anula**: quien la guarda no la puede modificar directamente --
  el técnico pide la anulación (con observación) y el manager de su área la aprueba o rechaza.
  No busques un botón de "editar" en `ConsumoJornada`, no existe a propósito.
- **"Empezar desde cero"** (botón solo-admin en Parámetros): borra entregas (incluidas las
  anuladas), frascos y jornadas, pero **conserva** materias/tipos/técnicos/managers. Queda
  auditado. No lo confundas con la limpieza de "modo pruebas" (más abajo), que es más acotada.
  No es una papelera, no hay forma de recuperar esos datos.
- **Modo pruebas**: una bandera por navegador; lo que se registra mientras está activa se marca
  `prueba=1` y **no envía avisos de Cliq ni cuenta como real**. Una limpieza aparte borra solo los
  datos marcados como prueba.
- **Consecutivo**: el `id` de `ConsumoEntrega` mismo es el consecutivo de la entrega; no hay un
  formato con prefijo.
- `ConsumoApertura` (pedir registrar un día pasado): una vez el manager la aprueba, el día queda
  abierto **solo hasta el final de ese mismo día**, no indefinidamente.
