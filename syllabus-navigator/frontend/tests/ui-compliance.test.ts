/**
 * ui-compliance.test.ts — per-window validation that each screen is on the
 * shadcn/ui + Tailwind standard (see docs/UI_TICKETS.md). These tests scan the
 * window's source for the agreed primitives and the absence of the hand-rolled
 * anti-patterns each ticket removed. Node-env, no DOM required.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
}

// Auth UI is fully on Clerk (/sign-in, /sign-up). The legacy (auth)/login|signup
// redirect routes were removed; nothing links to /login|/signup anymore.
describe("Clerk auth routes exist", () => {
  it("mounts <SignIn/> and <SignUp/>", () => {
    expect(src("app/sign-in/[[...sign-in]]/page.tsx")).toContain("SignIn")
    expect(src("app/sign-up/[[...sign-up]]/page.tsx")).toContain("SignUp")
  })
})

// The old /settings page was retired: preferences + usage moved into the
// Configuración modal (opened from the profile menu). /settings now just
// redirects home and asks the shell to open that modal.
describe("UI-3 Settings retired → Configuración modal", () => {
  it("/settings redirects home and flags the modal to open", () => {
    const f = src("app/settings/page.tsx")
    expect(f).toContain('router.replace("/")')
    expect(f).toContain("OPEN_SETTINGS_FLAG")
  })
  it("the settings modal carries every section incl. account/appearance/billing", () => {
    // Labels live in the i18n catalog now, so assert against source + es.json.
    const f = src("src/components/settings/settings-modal.tsx") + src("src/messages/es.json")
    expect(f).toContain("AccountSection")
    expect(f).toContain("BillingSection")
    for (const label of ["Perfil", "Cuenta", "Apariencia", "Plan y facturación"]) {
      expect(f).toContain(label)
    }
  })
})

describe("UI-4 / UI-11 Cursos window", () => {
  const f = src("app/knowledge/page.tsx")
  it("imports Accordion/Badge/Dialog + extracted doc-status + course grouping", () => {
    expect(f).toContain("@/components/ui/accordion")
    expect(f).toContain("@/components/ui/badge")
    expect(f).toContain("@/components/ui/dialog")
    expect(f).toContain("@/lib/ui/doc-status")
    expect(f).toContain("@/lib/ui/course-group")
  })
  it("renders courses as an <Accordion>, not a hand-rolled <table>", () => {
    expect(f).not.toMatch(/<table\b/)
    expect(f).toContain("<Accordion")
    expect(f).toContain("groupByRealCourse(")
  })
  it("graph preview is a <Dialog>, not a hand-rolled fixed-inset modal", () => {
    expect(f).not.toContain("fixed inset-0")
    expect(f).toContain("<Dialog")
  })
  it("renamed to Cursos with Estudiar deep-link + Añadir actions", () => {
    expect(f).toContain("Cursos")
    expect(f).toContain("/estudio?course=")
    expect(f).toContain("Añadir fuente")
  })
  it("does not redefine getDocStatus locally", () => {
    expect(f).not.toContain("function getDocStatus")
  })
})

describe("UI-5 Estudio window", () => {
  const f = src("app/estudio/page.tsx")
  it("imports Card/Badge/Button primitives", () => {
    expect(f).toContain("@/components/ui/card")
    expect(f).toContain("@/components/ui/badge")
    expect(f).toContain("@/components/ui/button")
  })
  it("removed the hand-rolled 'Nuevo' pill", () => {
    expect(f).not.toContain("rounded-md bg-accent px-2 py-0.5")
  })
  it("course chips no longer hand-rolled border buttons", () => {
    expect(f).not.toContain("rounded-xl border px-3.5 py-2 text-sm font-semibold")
  })
})

describe("UI-6 Agenda (unified into Knowledge — AgendaPanel)", () => {
  const f = src("src/components/knowledge/agenda-panel.tsx")
  it("imports extracted agenda-format + Badge/Button", () => {
    expect(f).toContain("@/lib/ui/agenda-format")
    expect(f).toContain("@/components/ui/badge")
    expect(f).toContain("@/components/ui/button")
  })
  it("does not inline TYPE_META or hand-rolled type pills", () => {
    expect(f).not.toContain("const TYPE_META")
    expect(f).not.toContain("${m.cls}")
  })
  it("shows the next-5-days block and the quick-notes panel (calendar-first view)", () => {
    expect(f).toContain("Próximos 5 días")
    expect(f).toContain("Notas")
    expect(f).toContain("listRecentNotes")
  })
  it("the old /agenda route now redirects to /knowledge", () => {
    const r = src("app/agenda/page.tsx")
    expect(r).toContain('router.replace("/knowledge")')
  })
})

describe("UI-7 Chat window", () => {
  const f = src("app/page.tsx")
  it("imports Button primitive", () => {
    expect(f).toContain("@/components/ui/button")
  })
  it("view-mode toggle is no longer a hand-rolled button", () => {
    expect(f).not.toContain("text-xs bg-secondary px-3 py-1.5 rounded-full")
  })
})

describe("Mapa mental window", () => {
  const f = src("app/mapa/page.tsx")
  it("renders the hierarchical graph via GraphCanvas (course → doc selector)", () => {
    expect(f).toContain("@/components/ui/button")
    expect(f).toContain("GraphCanvas")
    expect(f).toContain("fetchGraph")
  })
})

describe("Editable knowledge graph (PATCH /graph wiring)", () => {
  it("GraphCanvas persists recursive tree edits via updateGraph", () => {
    const f = src("src/components/GraphCanvas.tsx")
    expect(f).toContain("RichMindMapCanvas")
    expect(f).toContain("updateGraph")
    expect(f).toContain("onSaveTree")
  })
  it("the canvas drawer exposes the recursion-aware editor + save error surface", () => {
    const f = src("src/components/estudio/rich-mind-map-canvas.tsx")
    expect(f).toContain("applyTreeEdits")
    expect(f).toContain("Guardar cambios")
    expect(f).toContain("saveErr")
  })
  it("the drawer supports cascade-delete confirm + add-child + sibling reorder", () => {
    const f = src("src/components/estudio/rich-mind-map-canvas.tsx")
    expect(f).toContain("countDescendants")
    expect(f).toContain('title="Añadir subtema"')
    expect(f).toContain('type: "reorder"')
  })
  it("knowledge preview passes the editable wiring (syllabusId + onSaved)", () => {
    const f = src("app/knowledge/page.tsx")
    expect(f).toContain("editable")
    expect(f).toContain("onSaved")
  })
})

describe("Estudio sub-vistas (flashcards / quiz / repaso)", () => {
  it("flashcards-view orders due cards via the pure helper and records reviews", () => {
    const f = src("src/components/estudio/flashcards-view.tsx")
    expect(f).toContain("@/lib/ui/study-cards")
    expect(f).toContain("orderDueFirst(")
    expect(f).toContain("recordFlashcardReview")
    // Self-grade + session summary surfaces stay in place.
    expect(f).toContain("¿Sabías la respuesta?")
    expect(f).toContain("¡Sesión completa!")
  })
  it("quiz-view delegates heat/tier/advice to the pure quiz-stage-ui helper", () => {
    const f = src("src/components/estudio/quiz-view.tsx")
    expect(f).toContain("@/lib/ui/quiz-stage-ui")
    for (const helper of ["heatFor(", "stageTier(", "stageAdvice(", "topMissedTopics("]) {
      expect(f).toContain(helper)
    }
    // The presentation logic no longer lives inline in the component.
    expect(f).not.toContain("Dominio sólido")
    expect(f).not.toContain("Etapa perfecta")
  })
  it("quiz-view keeps the staged flow wiring (stage fetch, seen-marking, repaso fallback)", () => {
    const f = src("src/components/estudio/quiz-view.tsx")
    for (const s of ["fetchQuizStage", "markQuizSeen", "recordQuizFail", "fetchQuizReview"]) {
      expect(f).toContain(s)
    }
  })
  it("review-view resolves repaso items and feeds mastery", () => {
    const f = src("src/components/estudio/review-view.tsx")
    expect(f).toContain("fetchQuizReview")
    expect(f).toContain("resolveQuizReview")
    expect(f).toContain("recordMastery")
  })
  it("sub-views share BackButton/EmptyMode instead of hand-rolling them", () => {
    for (const p of [
      "src/components/estudio/quiz-view.tsx",
      "src/components/estudio/review-view.tsx",
    ]) {
      expect(src(p)).toContain('from "./flashcards-view"')
    }
  })
})

describe("Agenda sub-vistas (month-calendar / day-notes-panel)", () => {
  it("month-calendar exposes pure helpers and takes the note-marker wiring", () => {
    const f = src("src/components/agenda/month-calendar.tsx")
    expect(f).toContain("export function bucketEventsByDate")
    expect(f).toContain("export function courseColorIndex")
    expect(f).toContain("onSelectDay")
    expect(f).toContain("noteDates")
  })
  it("day-notes-panel uses ui primitives + shared agenda-format meta (no raw controls)", () => {
    const f = src("src/components/agenda/day-notes-panel.tsx")
    expect(f).toContain("@/components/ui/button")
    expect(f).toContain("@/components/ui/badge")
    expect(f).toContain("@/components/ui/textarea")
    expect(f).toContain("@/lib/ui/agenda-format")
    expect(f).not.toMatch(/<button\b/)
    expect(f).not.toMatch(/<textarea\b/)
  })
  it("the Knowledge AgendaPanel wires the calendar and the day panel together", () => {
    const f = src("src/components/knowledge/agenda-panel.tsx")
    expect(f).toContain("MonthCalendar")
    expect(f).toContain("DayNotesPanel")
  })
})

describe("UI-13 Streak wiring", () => {
  it("sidebar consumes the real /api/study/stats endpoint", () => {
    const f = src("src/components/navigator/app-sidebar.tsx")
    expect(f).toContain("fetchStudyStats")
    expect(f).not.toContain("Racha de 6 días") // static placeholder removed
  })
  it("flashcards record reviews that feed the streak", () => {
    const f = src("src/components/estudio/flashcards-view.tsx")
    expect(f).toContain("recordFlashcardReview")
  })
  it("stats + review API routes exist", () => {
    for (const p of ["app/api/study/stats/route.ts", "app/api/study/review/route.ts"]) {
      expect(() => src(p)).not.toThrow()
    }
  })
})

describe("App sidebar (design chrome)", () => {
  const f = src("src/components/navigator/app-sidebar.tsx")
  // Nav labels + routes live in nav-items.ts and the i18n catalog; assert against all.
  const nav = f + src("src/components/navigator/nav-items.ts") + src("src/messages/es.json")
  it("uses Badge primitive for NUEVO chips", () => {
    expect(f).toContain("@/components/ui/badge")
  })
  it("matches design naming + branding", () => {
    for (const s of [
      "Navigator",
      "Study OS",
      "Asistente",
      // Cursos + Agenda merged into the unified Knowledge entry (2026-07-15).
      "Knowledge",
      "Mapa mental",
      "Área de Estudio",
    ]) {
      expect(nav).toContain(s)
    }
  })
  it("wires the new routes incl. /mapa", () => {
    expect(nav).toContain('href: "/mapa"')
    expect(nav).toContain('href: "/knowledge"')
  })
})
