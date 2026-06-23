# Navigator — Window Build Tickets

> Source design: Claude Design `Navigator: Organización estudiantil`
> (`0186a160-3ac9-4086-8354-fb32d33a4e37` / `Navigator.dc.html`).
> Standard: full-stack Next.js (`frontend/`), **shadcn/ui + Tailwind semantic tokens**
> (`bg-background`, `text-accent`, `bg-card`, `border-border`, `text-muted-foreground`…).
> Do **not** hardcode the design's hex palette — map it to existing tokens so light/dark both work.
> Layering respected: route → service → repo → `lib/db`. All client calls go through `src/lib/api.ts`.

Legend — status: ✅ done · 🟧 partial · ⬜ todo.

---

## EPIC A — Study OS ("Área de Estudio")

The design's headline feature: per-course study material generated from the course's knowledge
base (chunks). One new window with a course picker + a 6-mode grid, each mode a sub-view.
Backend: one structured-output generation (`study-gen`) cached per syllabus in `study_sets`,
served by `GET /api/study/[syllabusId]`.

### A0 — Study generation backend  ✅
- **Context:** No quiz/flashcard/summary data exists; the mockup hardcodes it. We already have
  course text (`ChunkRepository.getConcatenatedText`) and the structured-output pattern
  (`graph-gen`, `schedule-gen`).
- **Description:** Add `study_sets` table; `study-gen.ts` (one strict `json_schema` call →
  `{ flashcards[], quiz[], summary{intro,points[]}, mindmap{center,branches[]} }`); `study.repo.ts`
  (get/upsert cached set); `StudyService.getStudySet(userId, syllabusId, {refresh})` with ownership
  via `DocumentRepository.findByIdAndUser`; `GET /api/study/[syllabusId]` route; `api.ts#fetchStudySet`.
- **Acceptance criteria:**
  - 401 unauthenticated; 404 when the syllabus is not owned by the caller.
  - 200 returns a cached set when present; `?refresh=1` regenerates and re-caches.
  - Generation is grounded in the course chunks only (no invented facts); empty course → typed
    "not enough material" error, not a crash.
  - Quiz items have exactly one correct index; flashcards are front/back; summary has 3–6 points.
  - `tsc --noEmit` clean; route covered by tests (see E1).

### A1 — Área de Estudio menu  ✅
- **Context:** Entry window for the Study OS (sidebar "Área de Estudio", NUEVO badge).
- **Description:** `/estudio` page: course picker (pills from `listSyllabi`, "Ready" courses only),
  source banner ("● Indexado", doc count), and a 3-col mode grid: Quiz dinámico, Tarjetas dinámicas,
  Modo repaso, Simulacro, Mapa mental, Resumen automático.
- **Acceptance criteria:**
  - Picking a course loads its study set (spinner → content); switching course resets sub-view.
  - Each mode card opens its sub-view; counts (n preguntas / n tarjetas) come from the loaded set.
  - No course / no indexed course → empty state pointing to the Knowledge Base.
  - Uses `components/ui/*` + semantic tokens; no raw hex.

### A2 — Flashcards / Modo repaso  ✅
- **Description:** Flip card (concept ↔ definition), prev/next, progress bar, position `i/total`,
  "Repasar luego" / "Ya la sé" actions. Repaso opens the same view labelled "Modo repaso".
- **Acceptance criteria:** flip toggles face; next/prev wrap; progress reflects position; keyboard
  (←/→ navigate, space flips) works; back returns to the menu.

### A3 — Quiz dinámico / Simulacro  ✅
- **Description:** MCQ runner: question, A–D options, lock answer on click, correct/incorrect
  styling + explanation, score, "Siguiente / Ver resultados", results screen with %, Reintentar.
- **Acceptance criteria:** exactly one answer scorable per question; can't change after answering;
  progress + score update; final screen shows `score/total` and %; Reintentar resets to Q1.

### A4 — Mapa mental (study)  ✅
- **Description:** Central topic + branch cards (label + chips) from `study_set.mindmap`.
- **Acceptance criteria:** renders center + N branches with their items; degrades when mindmap empty.
  (Distinct from the prerequisite graph in `GraphCanvas`, which stays in Knowledge preview.)

### A5 — Resumen automático  ✅
- **Description:** Intro paragraph + numbered key points from `study_set.summary`; "Regenerar"
  (calls `?refresh=1`); CTAs to flashcards/quiz.
- **Acceptance criteria:** shows intro + points; Regenerar refetches; CTAs switch sub-view.

---

## EPIC B — Shell (sidebar)

### B1 — Sidebar nav: Study + Mind  ✅
- **Context:** Design sidebar adds "Área de Estudio" and "Mapa mental" under an "Estudio" group,
  each with a NUEVO badge, plus collapse. Current sidebar is a 16px icon rail.
- **Description:** Add `/estudio` nav entries to `app-sidebar.tsx` keeping the icon-rail standard
  (tooltip labels). Active state via `pathname`.
- **Acceptance criteria:** new icons route to `/estudio`; active styling matches existing; a11y
  `sr-only` labels kept; no layout regression on existing pages.

### B2 — Streak / XP widget  ⬜ (deferred — needs a real progress source)
- **Context:** Design shows "🔥 Racha de 6 días" + cards-reviewed bar. No streak data model exists.
- **Description:** Add `study_progress` (cards reviewed, streak) + surface in an expanded sidebar.
- **Acceptance criteria:** widget reflects real per-user counts; hidden for anon/guest. *Deferred:
  build only after Study review events are persisted; shipping a fake number is worse than omitting.*

---

## EPIC C — Existing windows (already shipped; align to design)

### C1 — Chat (Asistente)  ✅ exists
- Already implemented (`app/page.tsx`, SSE, sources expander, model pill). Design parity: sources
  disclosure + "crear simulacro" CTA. **Acceptance:** no change required for parity beyond a Study CTA
  (covered by A3 via deep-link `/estudio?course=<id>&mode=quiz`).

### C2 — Cursos (Knowledge Base)  ✅ exists
- Table-based KB with upload, status, preview graph, rename, delete. Design uses accordion course
  cards; **acceptance:** functional parity already met; cosmetic accordion is optional polish (🟧).

### C3 — Agenda  🟧
- **Context:** Current agenda is a list ("Esta semana" + by-course). Design adds a **month calendar
  grid** with event dots + a "Fechas detectadas" list + a simulacro CTA.
- **Description:** Add a month calendar (current month, weeks Mon-start) that places
  `schedule_events` with a concrete `event_date` as dots/labels; keep the existing weekly plan.
- **Acceptance criteria:** events with ISO dates appear on the right day; today highlighted; prev/next
  month navigates; events without a date still listed below; anon gated as today.

---

## EPIC E — Validation (tests, window by window)

### E1 — Study route tests  ✅
- `tests/study.route.test.ts`: 401 (anon), 404 (not owned), 200 (cached set returned), `?refresh=1`
  triggers regeneration, generation error → typed 4xx/5xx (no leak). Mocks auth + repos + gen.

### E2 — Study-gen schema validation  ✅
- Unit: `study-gen` output validator rejects malformed sets (no correct answer, empty front) and
  normalizes (clamps quiz `answer` index, trims). Pure function, no network.

### E3 — Typecheck + suite green  ✅
- `tsc --noEmit` clean and `npm test` green (new + existing) before close-out.

### E4 — Agenda calendar test  🟧
- Render/unit for date-bucketing (event lands in correct cell; undated excluded from grid).
