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

describe("UI-1 Login window", () => {
  const f = src("app/(auth)/login/page.tsx")
  it("imports Input/Label/Button primitives", () => {
    expect(f).toContain('@/components/ui/input')
    expect(f).toContain('@/components/ui/label')
    expect(f).toContain('@/components/ui/button')
  })
  it("has no raw <input> or hand-rolled <button>", () => {
    expect(f).not.toMatch(/<input\b/)
    expect(f).not.toMatch(/<button\b/)
  })
  it("error banner uses destructive tokens, not red-400", () => {
    expect(f).not.toContain("text-red-400")
    expect(f).toContain("bg-destructive/10")
  })
})

describe("UI-2 Signup window", () => {
  const f = src("app/(auth)/signup/page.tsx")
  it("imports Input/Label/Button primitives", () => {
    expect(f).toContain('@/components/ui/input')
    expect(f).toContain('@/components/ui/button')
  })
  it("has no raw <input> or hand-rolled <button>", () => {
    expect(f).not.toMatch(/<input\b/)
    expect(f).not.toMatch(/<button\b/)
  })
  it("no red-400 error color", () => {
    expect(f).not.toContain("text-red-400")
  })
})

describe("UI-3 Settings window", () => {
  const f = src("app/settings/page.tsx")
  it("imports Select/Input/Card/Button primitives", () => {
    expect(f).toContain('@/components/ui/select')
    expect(f).toContain('@/components/ui/input')
    expect(f).toContain('@/components/ui/card')
    expect(f).toContain('@/components/ui/button')
  })
  it("has no raw <select>/<input>/<button>", () => {
    expect(f).not.toMatch(/<select\b/)
    expect(f).not.toMatch(/<input\b/)
    expect(f).not.toMatch(/<button\b/)
  })
})

describe("UI-4 / UI-11 Cursos window", () => {
  const f = src("app/knowledge/page.tsx")
  it("imports Accordion/Badge/Dialog + extracted doc-status + course grouping", () => {
    expect(f).toContain('@/components/ui/accordion')
    expect(f).toContain('@/components/ui/badge')
    expect(f).toContain('@/components/ui/dialog')
    expect(f).toContain('@/lib/ui/doc-status')
    expect(f).toContain('@/lib/ui/course-group')
  })
  it("renders courses as an <Accordion>, not a hand-rolled <table>", () => {
    expect(f).not.toMatch(/<table\b/)
    expect(f).toContain("<Accordion")
    expect(f).toContain("groupByCourse(")
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
    expect(f).toContain('@/components/ui/card')
    expect(f).toContain('@/components/ui/badge')
    expect(f).toContain('@/components/ui/button')
  })
  it("removed the hand-rolled 'Nuevo' pill", () => {
    expect(f).not.toContain("rounded-md bg-accent px-2 py-0.5")
  })
  it("course chips no longer hand-rolled border buttons", () => {
    expect(f).not.toContain("rounded-xl border px-3.5 py-2 text-sm font-semibold")
  })
})

describe("UI-6 Agenda window", () => {
  const f = src("app/agenda/page.tsx")
  it("imports extracted agenda-format + Badge/Button/Card", () => {
    expect(f).toContain('@/lib/ui/agenda-format')
    expect(f).toContain('@/components/ui/badge')
    expect(f).toContain('@/components/ui/button')
  })
  it("does not inline TYPE_META or hand-rolled type pills", () => {
    expect(f).not.toContain("const TYPE_META")
    expect(f).not.toContain("${m.cls}")
  })
  it("has the sync banner", () => {
    expect(f).toContain("Calendario sincronizado")
  })
})

describe("UI-7 Chat window", () => {
  const f = src("app/page.tsx")
  it("imports Button primitive", () => {
    expect(f).toContain('@/components/ui/button')
  })
  it("view-mode toggle is no longer a hand-rolled button", () => {
    expect(f).not.toContain("text-xs bg-secondary px-3 py-1.5 rounded-full")
  })
})

describe("Mapa mental window", () => {
  const f = src("app/mapa/page.tsx")
  it("exists, imports Button + reuses MindView", () => {
    expect(f).toContain('@/components/ui/button')
    expect(f).toContain("MindView")
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
  it("uses Badge primitive for NUEVO chips", () => {
    expect(f).toContain('@/components/ui/badge')
  })
  it("matches design naming + branding", () => {
    for (const s of ["Navigator", "Study OS", "Asistente", "Cursos", "Agenda", "Mapa mental", "Área de Estudio"]) {
      expect(f).toContain(s)
    }
  })
  it("wires the new routes incl. /mapa", () => {
    expect(f).toContain('href: "/mapa"')
    expect(f).toContain('href: "/knowledge"')
  })
})
