# Pendientes — planes de implementación

> Sustituye a `NEXT_STEPS.md` (borrado 2026-07-02; todo su log histórico está en git history).
> Solo contiene lo que FALTA. Referencia estable de estructura: `CLAUDE.md`.
> Descartados a propósito (selección del usuario 2026-07-02): SQL crudo de
> user/preferences|feedback|cron/cleanup → repos; B4 pre-calentar quiz bank; cron a */5.

---

## ✅ Completado 2026-07-03 (detalle en git history)

- **Plan 1 — Mapa editable reconectado.** `updateGraph` re-añadido a `api.ts`; drawer del
  canvas (`mind-map-canvas.tsx`) ganó sección estructural (renombrar/borrar/añadir rama +
  error de ciclo visible); `GraphCanvas` mapea ramas→grafo vía `src/lib/ui/graph-edit.ts`
  (puro, unit-testeado) y persiste con PATCH. **Nota:** se cableó en el preview de
  `/knowledge` (único lugar que muestra el grafo real con `editable`+`onSaved`) — el plan
  decía `/mapa`, pero `/mapa` renderiza mindmaps de study-set, no este grafo.
- **Plan 2 (1,2) — Tests de gaps.** `tests/chunk.repo.test.ts` (scoping por user en
  search/searchByUser/searchByCourse/lexical) y `tests/recommendation.service.test.ts`
  (semana lunes-domingo, horizonte 21d, review-first por prereqs, scoping por sílabo).
  Suite: 261 tests verdes.
- **Plan 3 — "Semana N" → fecha real.** `user_courses.term_start DATE` (migrado en Neon);
  resolver puro `lib/server/rag/week-date.ts` (`resolveWeekDate`, `resolveEventWeekDates`;
  labels "Semana N"/"Week N"/"S3"); `schedule.repo` expone `term_start` (LEFT JOIN);
  `schedule.service` + `recommendation.service` resuelven al servir (nunca persisten;
  semana vigente se mantiene hasta agotarse — cutoff hoy−6, `days_until` clamp ≥0);
  captura UI: botón calendario en la carpeta del curso en `/knowledge` →
  `PATCH /api/courses/[id]` (`UpdateCourseSchema` `{name?, term_start?}`).

## Restos menores (opcionales)

- Plan 2.3 — render tests de sub-vistas (`/estudio` flashcards/quiz, `/agenda`): se decidió
  seguir con el patrón ui-compliance + helpers puros (sin testing-library). El editor del
  mapa ya quedó cubierto así.
- Plan 3 v2 — inferir `term_start` desde el sílabo en `course-infer`; reordenar (v2) de
  ramas en el editor del mapa.

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
