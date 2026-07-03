# Pendientes — planes de implementación

> Sustituye a `NEXT_STEPS.md` (borrado 2026-07-02; todo su log histórico está en git history).
> Solo contiene lo que FALTA. Referencia estable de estructura: `CLAUDE.md`.
> Descartados a propósito (selección del usuario 2026-07-02): SQL crudo de
> user/preferences|feedback|cron/cleanup → repos; B4 pre-calentar quiz bank; cron a */5.

---

## Plan 1 — Reconectar el mapa editable (PATCH graph sin UI)

**Contexto (verificado 2026-07-02).** `PATCH /api/graph/[syllabusId]` está vivo y testeado
(`GraphService.updateGraph`: ownership + validación de ciclos + `replaceGraph`;
`tests/graph.route.test.ts` cubre 401/404/400-body/400-ciclo/200). Pero desde que se quitó
xyflow (`EditableGraph`), **ninguna UI lo llama**: el adapter `updateGraph` fue eliminado de
`src/lib/api.ts` y el canvas custom (`src/components/estudio/mind-map-canvas.tsx`) es
read-only (la toolbar decorativa se eliminó el 2026-07-02 precisamente porque no hacía nada).

**Implementación propuesta** (cliente del canvas custom, sin re-añadir xyflow):

1. **Adapter** — `src/lib/api.ts`: re-añadir
   `updateGraph(syllabusId, {nodes: {id,label,weight_percent?}[], edges: {source,target}[]})`
   → `PATCH /graph/${syllabusId}`. El contrato zod del server es `GraphUpdateSchema`
   (`validators/api.schemas.ts`).
2. **Editor** — NO dibujar edición libre en canvas: añadir al drawer "Editar mapa" existente
   (`mind-map-canvas.tsx`, `editOpen`) una sección de edición estructural simple:
   renombrar rama, borrar rama, añadir rama (input), y (v2) reordenar. El mapa radial se
   recalcula solo — no hay posiciones que persistir.
3. **Guardar** — el drawer llama `updateGraph` con la topología editada; ante 400 de ciclo,
   mostrar el error del server. Tras 200, refetch (`fetchGraph`) y re-render.
4. **Dónde aplica** — `/mapa` (scope doc, grafo real). El modo Mapa de /estudio (mindmap del
   study-set) NO usa este endpoint; no tocarlo.
5. **Tests** — extender `ui-compliance` (el drawer usa primitivas), y un test del adapter/route
   wiring si se añade lógica de mapeo nodes/edges → topics/dependencies en cliente.

**Aceptación:** editar una rama en `/mapa` → PATCH 200 → recarga muestra el cambio; un edge
circular devuelve 400 con mensaje visible; typecheck + suite verdes.

---

## Plan 2 — Tests de cobertura (gaps conocidos)

Gaps señalados en las auditorías de jun (sin cubrir a 2026-07-02):

1. **Unit `chunk.repo#searchByUser`** — scoping por `user_id` (que un user nunca recupere
   chunks ajenos). Estilo `tests/date-notes.repo.test.ts` (mock del tagged template `sql`,
   assert de los valores bindeados).
2. **Unit `recommendation.service`** — cruce schedule×prereqs y rango de semana
   (lunes-domingo): evaluación próxima genera "Repasa primero: <prereqs>"; evento fuera de
   rango no aparece.
3. **Render UI** — sub-vistas de `/estudio` (flashcards flip, quiz score), `/agenda`
   (calendario + notas inline), y el editor del mapa cuando exista (Plan 1).
   Nota: el proyecto no tiene testing-library configurado — decidir si se añade
   (`@testing-library/react` + jsdom en vitest) o se sigue con el patrón actual
   (ui-compliance escanea el source + helpers puros unit-testeados). Lo segundo es más barato
   y consistente con lo existente.

**Aceptación:** suite > 224 tests, verde; typecheck OK.

---

## Plan 3 — "Semana N" → fecha real

**Contexto.** `schedule-gen` extrae eventos con `week_label` ("Semana 3") cuando el sílabo no
trae fecha ISO; el chat razona sobre el label pero la agenda/recomendaciones no pueden ubicar
esos eventos en el calendario (el `MonthCalendar` excluye los sin fecha; `pickWeekTopics` y
`recommendation.service` solo cruzan eventos con `event_date`).

**Decisión de producto tomada (2026-07-02): modelo term-start por curso.**

**Implementación propuesta:**

1. **Schema** — `src/lib/schema.sql`: `ALTER TABLE courses ADD COLUMN IF NOT EXISTS
   term_start DATE`. Re-correr `npm run db:migrate`.
2. **Resolver puro** — `src/lib/ui/` o `lib/server/rag/`: `resolveWeekDate(termStart,
   weekLabel)` → lunes de esa semana (`term_start + (N-1)*7 días`). Parse tolerante de
   "Semana N" / "Week N" / "S3". Unit tests (bordes: N=1, label malformado → null).
3. **Captura del term_start** — UI mínima: input de fecha en la carpeta del curso
   (`/knowledge` o el picker de `/estudio`), `PATCH /api/courses/[id]` (route existe; añadir
   campo al zod schema + repo). Opcional v2: inferirlo del sílabo en `course-infer`.
4. **Consumo** — `recommendation.service` y `schedule.service`: cuando el evento no tiene
   `event_date` pero sí `week_label` y el curso tiene `term_start`, resolver la fecha al
   servir (NO persistirla — si el usuario corrige term_start, todo se recalcula).
   `MonthCalendar` las recibe como fechas normales.
5. **Chat** — el bloque AGENDA inyectado ya lleva fechas cuando existen; con el resolver
   aplicado en `schedule.service` esto mejora solo.

**Aceptación:** curso con `term_start` seteado → eventos "Semana N" aparecen en el calendario
y en "Esta semana" cuando corresponde; sin `term_start`, comportamiento actual intacto;
tests del resolver + suite verde.

---

## Ops / infra (checklist corto)

- [ ] **Railway — EXPORTAR DATOS antes de apagar.** Confirmado (2026-07-02): el FastAPI viejo
      sigue desplegado en Railway CON datos que importan. El código fuente ya no está en el
      repo (borrado 2026-06-23; recuperable de git history). Acción: dump de su DB/Chroma
      (o al menos los uploads/syllabi que no existan ya en Neon) → luego apagar el servicio
      para dejar de pagar. Sin esto NO apagar nada.
- [ ] **CI**: añadir `npm run lint` + `npm run format:check` a `.github/workflows/ci.yml`
      (hoy solo tsc + tests).
- [ ] **Vercel**: verificar que `BLOB_READ_WRITE_TOKEN` está seteado (sin él los PDFs de
      cuenta no se persisten; degrada con warning en logs).
