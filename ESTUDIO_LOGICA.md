# Área de Estudio — Lógica pendiente / revisión

> Doc de trabajo. Estado **cambiante**: lógica por hacer, decisiones y hallazgos de la
> revisión del área de estudio. Se va agregando a medida que se revisa.
> Última revisión: 2026-06-26.

---

## 0. Cómo funciona hoy (mapa rápido)

**Scope (cliente)** — `app/estudio/page.tsx`:
- `course` → todo un curso (agregado por `courseId`).
- `doc` → un PDF específico (`docId`).
- `combo` → varias **carpetas de curso** combinadas (client-side).

**Scope (servidor)** — `study-items.repo.ts`: `StudyScope = { kind: "doc" | "course", id }`.
El banco (`study_items`), la cola de Repaso (`quiz_review`), la maestría y el fingerprint
de cache se llavean por **un solo id** (doc **o** course). No existe un scope de
"subconjunto de PDFs".

**Combinado (multi-curso)** se resuelve en el cliente: se hace fetch del set de cada curso
y se fusionan con `combineStudySets` / `fuseMindmaps` (`src/lib/ui/combine-study.ts`).

**Enfoque (focus)**:
- Texto de instrucción → `topic`. Con topic, el set es **"custom"** → el servidor lo genera
  **fresh y NO lo cachea** (`getStudySet` / `getCourseStudySet`, `custom = !!topic || diff!=="medio"`).
- Dificultad: fija en `"medio"`; la escalera del quiz es automática (ver §1).

---

## 1. Estado actual de los 4 modos (revisado)

| Modo | Fuente de datos | ¿Honra el enfoque (`topic`)? | Multi-scope |
|---|---|---|---|
| Quiz dinámico | banco staged (`getQuizStage`) | **NO** — el endpoint staged ignora `topic` | doc/course; combo → aviso "elige uno" |
| Simulacro | igual que Quiz | **NO** | igual |
| Tarjetas dinámicas | `set.flashcards` (set ensamblado/custom) | **SÍ** | combina client-side |
| Modo repaso | cola de falladas (`fetchQuizReview`) | NO aplica (son preguntas ya falladas) | doc/course; combo → aviso |
| Resumen / Mapa | `set.summary` / `set.mindmap` | **SÍ** | combina client-side |

Dificultad (hecho esta sesión): `stageDifficulty` con piso en `medio` (idx 1). Base
`masteryAvg >= 0.6 ? 2 : 1`. Empieza en medio, sube a difícil; maestría alta arranca difícil.
Nunca fácil. El quiz de curso no tiene maestría por-syllabus → siempre arranca medio.

---

## 2. POR HACER — Select de PDFs para el enfoque (pedido del usuario)

**Objetivo:** dentro de un curso, elegir **cuáles PDFs** entran al enfoque (subconjunto),
no solo "todo el curso" o "un PDF".

### Opción A — Combinar en cliente (recomendada, sin tocar backend)
- Nuevo scope cliente `{ kind: "docs"; docIds: string[] }`.
- `loadSet`: fetch de `fetchStudySet(docId)` por cada PDF seleccionado → `combineStudySets`.
- `ScopePicker`: convertir las filas de PDF en **multi-select** (checkboxes), + opción
  "Todo el curso". 1 PDF → scope `doc` (features completas). ≥2 → scope `docs` (combinado).
- **Funciona** para: Tarjetas, Resumen, Mapa.
- **Limitación** (igual que `combo`): Quiz/Simulacro/Repaso no tienen endpoint multi-doc →
  mostrar el aviso de "elige un PDF / curso". El enfoque por-texto tampoco llega al quiz (ver §3).

### Opción B — Scope de subconjunto en backend (pesada, futura)
- Extender `StudyScope` server a `{ kind: "docs", ids: string[] }`.
- Tocar: keying del banco `study_items`, `quiz_review`, maestría, fingerprint de cache,
  y todos los repos que asumen un id único. Cambio grande.
- Habilita Quiz/Repaso staged sobre el subconjunto real.

**Decisión propuesta:** implementar **A** ahora; dejar **B** documentada como futuro si se
quiere quiz staged sobre subconjunto.

---

## 3. Hallazgos / inconsistencias (de la revisión)

- ⚠️ **El enfoque (`topic`) NO afecta al Quiz dinámico ni al Simulacro.** El endpoint
  `getQuizStage` / `getCourseQuizStage` no recibe `topic`; sirve del banco staged
  topic-agnóstico. El usuario pone un enfoque, abre el Quiz, y se ignora. Decidir:
  (a) pasar `topic` al staged y sesgar generación/orden por ese tema, o
  (b) avisar en UI que el enfoque aplica a Tarjetas/Resumen/Mapa, no al Quiz.
- `combo` (multi-curso) ya cae al aviso de "no disponible para varios cursos" en
  Quiz/Repaso/Simulacro. El nuevo `docs` (multi-PDF) heredaría lo mismo en Opción A.
- Panel de maestría (`MasteryPanel`) y SRS (`dueKeys`) solo existen en scope `doc` único.
  En `docs`/`combo` no hay tracking por-card. Esperado, pero anotar para UX.
- El set base se recarga con `topic:null` al cambiar de scope (resetea el enfoque). Por diseño.

---

## 4. Hecho esta sesión

- Botón "Aplicar enfoque" en el menú (regenera set custom; `inline` no rompe el cache default).
- Quitado el selector de dificultad (ahora automática, piso medio).
- `stageDifficulty` con piso `medio`.
- Mapa mental: click afuera del tag → sale/colapsa (ver §5).

---

## 5. Mapa mental — estudio quirúrgico

**Componente único:** `src/components/estudio/mind-map-canvas.tsx` (`MindMapCanvas`).
Usado en 2 lugares, ambos con el mismo componente:
- `/mapa` (page.tsx) — doc/curso/combo, con multi-select de cursos y vista "Galaxia".
- Área de Estudio modo "Mapa" — solo course/combo inline (doc scope redirige a `/mapa`).

> El `EditableGraph`/`GraphCanvas` (xyflow) es el **grafo de conocimiento**, NO el mapa
> mental. No confundir.

**Modelo del mapa:** `Mindmap = { center, branches: { label, items[] }[] }`. Layout radial
fijo, máx `MAX_BRANCHES = 8`. Nodos = "tags" (ramas). Click en tag → expande + selecciona
(`toggleNode`). Doble-click en tag/centro → manda el label al chat (`onTopicDouble`).

### Hecho: salir del tag clickeando afuera ✅
- Antes: click en tag expandía+seleccionaba; click en canvas vacío **no hacía nada** (la
  selección/expansión quedaba pegada). Única salida: re-clickear el tag.
- Ahora: click en el área vacía del `world` → `clearSelection()` → deselecciona y colapsa.
  - `moved` ref distingue pan-drag de click (umbral 3px) — un arrastre no deselecciona.
  - Nodos (centro + ramas) hacen `stopPropagation` en su `onClick` → no llegan al fondo.

### ⚠️ Botones que NO funcionan (decorativos / por cablear)
- **Toolbar inferior** (`tool` state): `select / add / connect / text` + menú "Más"
  (`color / layout / lock / export / del`). Todos solo hacen `setTool(...)`. **Ninguno
  ejecuta acción** — no añaden/conectan/borran/exportan nada. Puro estado visual.
- **Minimap** (abajo-derecha): posiciones de nodos **hardcodeadas** (`60 + (i%4)*28`, etc.),
  no reflejan el layout real ni permiten navegar (no es clickeable). Solo el rect de
  viewport (`mmLeft/mmTop`) sí sigue el pan/zoom.
- Decidir por botón: (a) cablear funcionalidad real, (b) quitarlos, o (c) marcarlos como
  "próximamente"/deshabilitados para no prometer lo que no hacen.

### Funciona bien (confirmado)
- Zoom (`zoomBy`/`zoomReset`), pan, expandir/colapsar todo, selección de rama/centro,
  drawer "Editar mapa" → `onRegenerate({focus, instructions})` (solo single course; combo
  es read-only, `onRegenerate` undefined), overlay de carga, empty state.

### Otros hallazgos del mapa
- El enfoque del drawer usa solo `focus[0]` (`topic: focus[0]` en `/mapa`) — si el usuario
  marca varios temas, los demás se ignoran. El backend de set custom toma 1 `topic` string.
- Doble-click para "preguntar a la IA" no es obvio en UI (solo el hint "Subraya un subtema").

---

## 6. Búsqueda web (web augmentation) — estado

Feature para que la generación del set traiga **contexto web en vivo** además del PDF.

**Hecho (backend + plumbing):**
- Route: `?web=1` → `study/[syllabusId]` y `study/course/[courseId]` lo parsean.
- Service (`getStudySet`/`getCourseStudySet`): `web` marca el set como **custom**
  (`custom = ... || !!opts.web`) → siempre fresh, nunca cacheado. Corre
  `webSearchContext(query)` + `appendWebContext(text, web)` antes de generar.
- API cliente (`api.ts`): `StudySetOptions.web` → `qs.set("web","1")`.
- `page.tsx`: estado `webSearch`/`setWebSearch`, pasado por `loadSet`/`applyFocus`/
  `launchMode`, y agregado a `scopeKey` (4º arg `w`) para que cambiar web re-fetchee.

**⚠️ Pendiente (lo que falta):**
- **No hay toggle en la UI.** `setWebSearch` no se llama en ningún lado → `webSearch`
  queda fijo en `false` y la feature nunca se activa. Falta el switch/botón (icono `Globe`
  ya importado) en el menú, cableado a `setWebSearch` + pasado a `Menu` (props `webSearch`/
  `onWeb`).
- Igual que el enfoque (§3): web **solo afecta** Tarjetas/Resumen/Mapa (set ensamblado).
  El Quiz/Simulacro staged NO recibe `web` → la búsqueda web se ignora ahí.
- Decidir UX: el toggle vive junto a "Aplicar enfoque" (mismo bloque), y dejar claro que
  con web ON el set siempre regenera (no cache) → más lento/costoso.
