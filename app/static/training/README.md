# Training de Design

Plataforma de aprendizaje interactiva y bilingüe (ES/EN) sobre el lenguaje y los protocolos de Nuvia Design.
Entrada: **Design › 🎓 Training** (`/design/training`). Código y contenido viven en `app/static/training/`; las rutas, en
`app/routers/design_training.py` y `app/services_design_training.py`.

## Quién lo ve
Por ahora solo los **admins** (revisión). Para abrirlo a todos los de Design:
1. `ABIERTO_A_TODOS = True` en `app/services_design_training.py`.
2. Quitar la condición de admin del enlace "🎓 Training" en `app/templates/base.html`
   (`{% if es_design and user.rol in ('admin', 'superadmin') %}` → `{% if es_design %}`).

## Piezas
| Archivo | Qué hace |
|---|---|
| `training.js` | Rutas (`#/`, `#/m/<módulo>`, `#/l/<lección>/<paso>`, `#/glosario`, `#/laboratorio`, `#/examen`, `#/diploma`, `#/admin`) y vistas |
| `steps.js` | Un renderizador por tipo de paso |
| `quiz.js` | Preguntas: una, varias, verdadero/falso, ordenar, parejas (lecciones y examen final) |
| `sim.js` | Laboratorio 3D de movimientos (three.js), animaciones guiadas (tour) y visor de modelos con pines |
| `widgets.js` | Calculadoras: `espesor24z`, `tamanos`, `articulador`, `tiempos` |
| `lib.js` | Utilidades, textos de la interfaz ES/EN, API, glosario automático |
| `vendor/three/` | three.js r160 con OrbitControls y los cargadores GLB, STL, OBJ y PLY (sin CDN) |
| `data/*.json` | El contenido: un archivo por módulo |

## Contenido (`data/<módulo>.json`)
Un módulo → lecciones → pasos. **Todo texto visible es `{"es": "...", "en": "..."}`**. Los términos de Nuvia (VDO, incisal edge,
midline, cant...) se dejan en inglés en ambos idiomas. Tipos de paso: `texto`, `tarjetas`, `flujo`, `acordeon`, `tabla`, `quiz`,
`simulador`, `tour`, `modelo3d`, `calculadora`, `checklist`, `enlace`, `resumen`, `lider`, `caso`, `visor`, `imagen`. Cada lección termina en un `quiz` (se aprueba con 70%).

- Validar: `python -m app.services_design_training_validar` (la prueba `tests/test_training_contenido.py` lo hace en cada corrida).
- Los módulos nuevos aparecen solos al agregar el JSON (se ordenan por `orden`). El glosario de todos los módulos se combina
  (un término repetido conserva la definición más completa).
- **Simulador y tours**: unidades en mm. Signos: `vdo` + abre; `incisal` + apically (sube) / − incisally (baja); `midline` + derecha del
  paciente; `cant` + canino izquierdo apically; `plano` + molares apically; `rotacion` + molares a la derecha; `labio` + facially;
  `tamano` índice 0..5 = A, AW, B, BW, C, CW; `grado` 5 o 10. `"modo": "fijo"` = antagonista fijo (Single 24z) y activa el indicador
  Contacto / Interferencia / Sin ocluir (`vdo + incisal ≈ 0` es contacto).
- **Enlaces a protocolos** (`enlace`): abren `/design?panel=protocols&q=<texto>` con esa búsqueda hecha.

## Editor (admins): editar y publicar sin tocar código
Botón **Editar contenido** arriba a la derecha (solo admins). Funciona como el editor de la página de Inicio:
- Todo cambio se guarda solo como **borrador** (por módulo); nadie lo ve hasta **Publicar**. **Descartar cambios** vuelve a lo publicado;
  **Historial** guarda las últimas 30 publicaciones de cada módulo y deja restaurar cualquiera (vuelve como borrador).
- Inicio: crear módulos nuevos. Módulo: datos (título, resumen, sección, área, orden, icono), lecciones (agregar, renombrar, mover,
  quitar) y glosario. Lección: todos los pasos uno debajo de otro; ✏️ abre el formulario del paso en un panel lateral (ES y EN lado a lado),
  ⠿ / ↑ ↓ los mueven, ⧉ duplica, ＋ agrega (o suelta imágenes del computador sobre ＋). "Avanzado (JSON)" edita cualquier paso.
- Imágenes: paso `imagen` (1 a 6, de una, dos o tres por fila, con pie y fuente) o una imagen al lado de un `texto` (`imagen.lado` =
  izq/der/arriba/abajo). Se eligen de las **imágenes de los protocolos** (`img/`, pies en `img/pies.json`) o de la **biblioteca de medios**
  de Design (las que se suben quedan ahí; tabla `design_inicio_medios`).
- Al publicar se valida el módulo con reglas flexibles (basta un idioma; una lección sin quiz se completa al llegar al final).
- **Importante:** cuando un módulo se publica desde el editor, esa versión (en la base de datos) reemplaza al archivo `data/<módulo>.json`.
  Cambios posteriores a ese archivo en el código no se verán en ese módulo hasta que se descarte su versión del editor.

## Laboratorio 3D
Visor de un caso real aprobado (Nuvia Design Viewer, pestañas RX y Changes) con una guía de qué mirar, y el simulador de movimientos.
El visor incluido está en `app/training_privado/laboratorio-visor.html.gz` (fuera de `/static`: sin nombre ni número de orden del
paciente, se entrega solo a quien puede ver Training). Un admin puede reemplazarlo desde el mismo Laboratorio o en Administrar.

## Modelos 3D
Cada paso `modelo3d` tiene un **espacio** (`slot`). En **Training › Administrar** o directamente en el paso, un admin sube un archivo
**GLB, STL, OBJ o PLY** (un solo archivo, máx. 60 MB). Se guarda en la base de datos (`design_training_modelos`). Desde el visor, los
admins agregan **pines** con título y texto bilingües (clic sobre el modelo) y los alumnos tienen un recorrido automático por los pines,
plano de corte, malla y fondo claro/oscuro. Para modelos con texturas usa GLB.

## Datos
- `design_training_progreso`: avance por persona y lección (completada, mejor puntaje). `_ultima` = dónde se quedó; `_examen` = mejor puntaje del examen final (se aprueba con 80%).
- `design_training_modelos`: los modelos 3D y sus pines.
- `design_training_modulos` (borrador y publicado de cada módulo editado) y `design_training_versiones` (historial de publicaciones).

## Pendientes por confirmar con el manager
Los pasos marcados con **⚠ "Confirmar con el manager"** recogen contradicciones entre las versiones en español e inglés de los protocolos
(tolerancia de VDO 0.5 vs 1 mm, reducción de tissue 1 vs 1.5 mm, altura de accesos 16-17 vs 18-19 mm, colores de arch size, tiempos que no suman...).
Ninguna de esas cifras se usa en los quizzes.
