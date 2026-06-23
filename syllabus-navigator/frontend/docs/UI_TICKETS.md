# UI Standardization Tickets — Window by Window

> Goal: bring **every window** onto the shared **shadcn/ui + Tailwind** standard defined in
> `CLAUDE.md` ("use `components/ui/*` primitives; don't hand-roll buttons/inputs/dialogs") and the
> semantic token system in `app/globals.css` (`background`, `foreground`, `card`, `border`,
> `secondary`, `muted-foreground`, `accent`, `destructive`).
>
> **Design source note:** the `claude.ai/design` artifact URL is auth-gated (HTTP 403), but the
> user provided 6 reference screenshots (`navChat`, `navCursos`, `navAreaEstudio`, `navMapaMental`,
> `navAgendaP1`, `navAgendaP2`). The design is a **dark theme** (near-black bg, green accent — the
> app already defaults to dark) with an **expanded branded left sidebar**. Tickets UI-1…UI-8 below
> standardize the existing windows on the shadcn/tailwind primitives; tickets **UI-9…UI-13** capture
> the design-specific deltas the screenshots revealed.

## The standard (definition of done for "uses the standard")

1. **Controls come from `components/ui/*`** — `Button`, `Input`, `Label`, `Textarea`, `Select`,
   `Card`, `Badge`, `Table`, `Separator`, `Skeleton`, `Dialog`, `DropdownMenu`, `Tooltip`, `Sheet`.
   No raw `<button class=…>`, `<input>`, `<select>`, or hand-rolled modal `<div class="fixed inset-0">`.
2. **Color via semantic tokens**, never raw palette hex/Tailwind palette for brand surfaces.
   Allowed status tints: `green|red|amber|blue|purple|teal-500/10` for badges only.
3. **Radius/spacing from the scale** (`rounded-md/lg/xl`, `--radius`), not arbitrary values.
4. **`cn()`** for conditional classes; variants via `cva` in the primitive, not inline ternaries.
5. **Accessibility**: every input has a `<Label htmlFor>`; icon-only buttons have `sr-only` text.
6. **A per-window test passes** (see `tests/ui-compliance.*.test.ts`) asserting the above by
   scanning the window's source, plus unit tests for any extracted pure helper.

---

## TICKET UI-1 — Auth: Login window (`app/(auth)/login/page.tsx`)

**Context.** Login hand-rolls two `<input>`s, a submit `<button>`, a guest `<button>`, and the
error banner. Colors are mostly tokenized but the error uses `text-red-400` and inputs duplicate
focus-ring classes that belong in the `Input` primitive.

**Description.** Replace inputs with `<Input>` + `<Label htmlFor>`, the submit and guest buttons with
`<Button>` (`variant="accent"` and `variant="outline"`), and keep `GoogleButton`. Error banner uses
`destructive` tokens. The "Or" divider uses `<Separator>`.

**Acceptance criteria.**
- No raw `<input>`/`<button>` in the file; all via `Input`/`Label`/`Button`.
- Email + password fields each have an associated `<Label htmlFor>`.
- Error banner uses `border-destructive/30 bg-destructive/10 text-destructive` (no `red-400`).
- Submit shows loading text and is disabled while `loading || isGuestLoading`.
- `tests/ui-compliance.login.test.ts` passes.

## TICKET UI-2 — Auth: Signup window (`app/(auth)/signup/page.tsx`)

**Context.** Mirror of login; same hand-rolled controls.

**Description.** Same primitive migration as UI-1; keep password-confirm validation and the
guest→user upgrade path intact.

**Acceptance criteria.**
- All controls via primitives; every field has a `<Label>`.
- Client-side validation messages render in `destructive` tokens.
- Submit disabled while submitting; loading copy shown.
- `tests/ui-compliance.signup.test.ts` passes.

## TICKET UI-3 — Settings window (`app/settings/page.tsx`)

**Context.** Uses raw `<select>` ×2, a raw text `<input>`, a submit `<button>`, and stat cards built
from bare `<div>`s. "Back to Chat" is a plain `<Link>`.

**Description.** Migrate provider/language to `<Select>`, default-model to `<Input>` + `<Label>`,
submit to `<Button variant="accent">`, usage stat tiles to `<Card>`, and section headings keep the
`border-b` rule. Back link becomes `<Button variant="ghost" asChild><Link/></Button>`.

**Acceptance criteria.**
- No raw `<select>`/`<input>`/`<button>`; provider + language use `<Select>`.
- Three usage tiles use `<Card>`; values unchanged (requests, tokens k, est. cost $).
- Save flow still calls `updatePreferences` and toasts success/failure.
- `tests/ui-compliance.settings.test.ts` passes.

## TICKET UI-4 — Knowledge Base window (`app/knowledge/page.tsx`)

**Context.** Largest hand-rolled surface: header CTA button, search `<input>`, a full hand-built
`<table>`, status pills, row action buttons, inline rename input, and a hand-rolled full-screen
**graph preview modal** (`fixed inset-0 … backdrop-blur`).

**Description.** Migrate to `<Button>` (header "Add Source", row Preview/Chat/Delete, Retry),
`<Input>` for search + rename, `<Table>` family for the list, `<Badge>` for the status pill, and the
preview modal to `<Dialog>`. Extract the pure `getDocStatus()` mapper into
`src/lib/ui/doc-status.ts` so it is unit-testable. Preserve polling, optimistic rows, rename, and
reprocess behavior.

**Acceptance criteria.**
- Search + rename use `<Input>`; all actions use `<Button>`.
- List rendered with `<Table>`/`<TableHeader>`/`<TableRow>`/`<TableCell>`.
- Status pill uses `<Badge>` with tone variants (ok/error/warn/pending).
- Graph preview uses `<Dialog>` (no hand-rolled `fixed inset-0` modal).
- `getDocStatus` exported from `lib/ui/doc-status.ts`; covered by unit tests.
- `tests/ui-compliance.knowledge.test.ts` + `tests/doc-status.test.ts` pass.

## TICKET UI-5 — Área de Estudio window (`app/estudio/page.tsx`)

**Context.** Course-picker chips, the 6 mode cards, the "Nuevo" badge, and gate/empty/error states
are all hand-rolled `<button>`/`<div>`s. Child views (`flashcards-view`, `quiz-view`,
`mind-resumen-view`) are separate and also need a pass.

**Description.** Course chips → `<Button variant="outline"/secondary>` (active state via `cn`),
mode cards → `<Card>` (keep hover lift), "Nuevo" + "Indexado" → `<Badge>`, gate/empty/error CTAs →
`<Button>`. Keep `MODES` config and the deep-link `?mode=`/`?course=` behavior.

**Acceptance criteria.**
- Course chips and mode cards use primitives; active chip styled via `cn`, not duplicated class soup.
- Badges via `<Badge>`; spinners/empties keep semantic tokens.
- `ModeRouter`, child views render unchanged data.
- `tests/ui-compliance.estudio.test.ts` passes.

## TICKET UI-6 — Agenda window (`app/agenda/page.tsx`)

**Context.** Gate CTA, "this week" panel, event list rows, and type pills are hand-rolled. The
`TYPE_META` map + `daysBadge`/`whenLabel` helpers are pure but inlined (untestable in isolation).

**Description.** Type pills → `<Badge>`, gate/CTA → `<Button>`, event rows + course sections →
`<Card>` where a surface is implied. Extract `TYPE_META`, `daysBadge`, `whenLabel` into
`src/lib/ui/agenda-format.ts`. Keep `MonthCalendar` integration.

**Acceptance criteria.**
- Type pills use `<Badge>`; gate CTA uses `<Button>`.
- `daysBadge`/`whenLabel`/`meta` exported from `lib/ui/agenda-format.ts` and unit-tested
  (Vencido/Hoy/Mañana/En N días; date vs week_label vs "Sin fecha").
- `tests/ui-compliance.agenda.test.ts` + `tests/agenda-format.test.ts` pass.

## TICKET UI-7 — Chat workspace window (`app/page.tsx` + `navigator/*`)

**Context.** Mostly already on primitives (`top-header` uses `Button`/`DropdownMenu`). Remaining
hand-rolled bits: the "View Knowledge Graph" toggle `<button>` and the `app-sidebar` profile
`<button>`s.

**Description.** Replace the view-mode toggle and the two sidebar profile buttons with `<Button>`
(`variant="secondary"`/`ghost`/`icon`). Keep `HistorySidebar`, `ChatThread`, `ChatComposer`,
`GraphCanvas` wiring untouched.

**Acceptance criteria.**
- View-mode toggle + sidebar profile triggers use `<Button>`.
- No behavioral change to chat streaming, history, or graph toggle.
- `tests/ui-compliance.chat.test.ts` passes.

## TICKET UI-8 — Shared primitives library

**Context.** Only `button`, `dialog`, `dropdown-menu`, `sheet`, `tooltip`, `markdown` exist; the
windows above need more.

**Description.** Add `input`, `label`, `textarea`, `select`, `card`, `badge`, `table`, `separator`,
`skeleton` under `components/ui/`, styled with the existing token system. Add an `accent` variant
(and `xl` radius option) to `Button` so brand CTAs keep the green accent.

**Acceptance criteria.**
- New primitives compile under TS strict and use semantic tokens only.
- `Button` exposes `variant="accent"`; existing variants unchanged.
- `tests/ui-primitives.test.ts` asserts each primitive file exists, is a function component, and
  references tokens (not raw palette) for its base surface.

---

# Design-aligned tickets (from screenshots)

## TICKET UI-9 — Expanded branded sidebar ✅ DONE

**Context.** The design replaces the 16px icon rail (`app-sidebar.tsx`, in the root layout so it
shows on every window) with a ~240px branded sidebar: "Navigator / STUDY OS" logo, a "Colapsar"
toggle, labeled nav (**Asistente**, **Cursos**, **Agenda**), an **ESTUDIO** group (**Área de
Estudio**, **Mapa mental**, each with a green **NUEVO** badge), a streak card, and a profile card.

**Description.** Rebuild `app-sidebar.tsx` to the expanded design using `Button`/`Badge`/`Tooltip`/
`DropdownMenu`. Nav renamed (Chat→Asistente, Knowledge Base→Cursos) and `/mapa` added. Collapse
state narrows to an icon rail with tooltips. Profile card opens the existing account dropdown.

**Acceptance criteria.**
- Sidebar shows branding, the 3 main + 2 study nav items, streak + profile cards.
- Active route is highlighted via `cn`; NUEVO chips use `<Badge variant="accent">`.
- Collapse toggle works and keeps a11y (`sr-only` labels + tooltips when collapsed).
- `tests/ui-compliance.test.ts › App sidebar` passes.
- ⚠️ Streak ("Racha de 6 días / 128 tarjetas") is a **static placeholder** — see UI-13.

## TICKET UI-10 — Mapa mental window ✅ DONE

**Context.** The design promotes the mind map to a top-level window (`/mapa`) with a course picker
and the central-topic→branches layout (already implemented as `MindView` inside Estudio).

**Description.** Add `app/mapa/page.tsx` reusing `MindView` + the Estudio data flow (`listSyllabi`
→ `fetchStudySet`), a course-chip picker, gate/empty/error states on primitives, `?course=` deep
link, and a back link to `/estudio`.

**Acceptance criteria.**
- `/mapa` loads, lets the user pick a ready course, renders its mindmap via `MindView`.
- Guest/anon gated with a `<Button>` CTA; loading/empty/error handled.
- `tests/ui-compliance.test.ts › Mapa mental window` passes.

## TICKET UI-11 — Cursos as a course accordion ✅ DONE

**Context.** The design's **Cursos** screen (`navCursos`) is an **accordion of courses** (code
`ISW-521` + name, "N documentos · clic para ver", an "Estudiar" button), expanding to the course's
documents (filename, date, `Ready` badge). Header has "Añadir curso" + "Añadir fuente".

**Description.** Group `syllabus_uploads` by **course code parsed from the filename**
(`lib/ui/course-group.ts` → `parseCourseCode`/`groupByCourse`) — no migration needed; codes like
`ISW-524` are already in the uploaded filenames. Page renamed to **Cursos**, rebuilt with the
`Accordion` primitive; each course exposes an "Estudiar" deep-link to `/estudio?course=<id>`. All
prior behavior (upload, search, rename, reprocess, polling, graph-preview Dialog) preserved.

**Acceptance criteria.**
- Courses render as `<Accordion>` with code `<Badge>`, name, doc count, "Estudiar". ✅
- Expanding shows the course's documents with date + status `<Badge>` + actions. ✅
- "Añadir curso" / "Añadir fuente" upload actions wired. ✅
- `getDocStatus`/`groupByCourse` extracted + unit-tested; `tests/course-group.test.ts` +
  `tests/ui-compliance.test.ts › Cursos window` pass. ✅

## TICKET UI-12 — Agenda: calendar + detected-dates + simulacro CTA ✅ DONE (CTA)

**Context.** The design (`navAgendaP1/P2`) shows: a "Calendario sincronizado con tus cronogramas"
banner + "N fechas detectadas" badge ✅, a month grid with per-day event dots (existing
`MonthCalendar`), a "FECHAS DETECTADAS EN LOS CRONOGRAMAS" list with date blocks + course code, and
a "¿Lista la Prueba Corta?" → "Iniciar simulacro" CTA linking into Estudio.

**Description.** The sync banner + Badge + primitive migration are **done**. Remaining: restyle the
by-course list into the dated "detected dates" blocks and add the simulacro CTA card linking to
`/estudio?course=…&mode=simulacro`.

**Acceptance criteria.**
- Sync banner with detected-count badge. ✅
- Detected-dates rows show a date block + course code.
- Simulacro CTA card deep-links into Estudio simulacro mode.

## TICKET UI-13 — Study-stats endpoint for the streak card ✅ DONE

**Context.** The sidebar streak card ("Racha de N días", "N tarjetas repasadas esta semana") was
static. The `flashcard_reviews` table already existed (with a `reviewed_at` index) but nothing wrote
to it.

**Description.** Wired the full path: flashcard "Ya la sé"/"Repasar luego" → `POST /api/study/review`
records a Leitner-boxed review (`StudyStatsRepository.recordReview`); `GET /api/study/stats` returns
`{ streakDays, cardsThisWeek }` (streak via the pure `lib/ui/streak.ts`); the sidebar fetches it and
renders real numbers (and hides for anonymous users). Reviews are owner-checked; guests excluded by
the `flashcard_reviews.user_id` FK.

**Acceptance criteria.**
- `/api/study/stats` returns real streak + weekly counts; sidebar consumes it. ✅
- Flashcard grading records reviews (`recordFlashcardReview`); courseId threaded through Estudio. ✅
- Streak math unit-tested (`tests/streak.test.ts`); placeholder removed. ✅
