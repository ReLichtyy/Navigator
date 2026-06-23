/**
 * ui-primitives.test.ts — asserts the shared primitive library (UI-8) exists,
 * exports its component(s), and styles from semantic tokens rather than raw
 * palette. Source-scan only (node env).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

function ui(name: string): string {
  const p = resolve(process.cwd(), "src/components/ui", `${name}.tsx`)
  expect(existsSync(p), `${name}.tsx should exist`).toBe(true)
  return readFileSync(p, "utf8")
}

const TOKEN = /\b(?:bg-(?:background|card|popover|secondary|muted|accent|primary|destructive)|border-border|text-foreground|text-card-foreground|bg-border)\b/

const PRIMITIVES = ["input", "label", "textarea", "select", "card", "badge", "table", "separator", "skeleton", "accordion"]

describe("UI-8 primitive library", () => {
  for (const name of PRIMITIVES) {
    it(`${name}: exists, exports a component, uses semantic tokens`, () => {
      const f = ui(name)
      expect(f).toContain("export")
      expect(f).toContain("data-slot")
      expect(f).toMatch(TOKEN)
    })
  }

  it("Button exposes the accent brand variant", () => {
    const f = readFileSync(resolve(process.cwd(), "src/components/ui/button.tsx"), "utf8")
    expect(f).toContain("accent:")
    expect(f).toContain("bg-accent")
  })

  it("Badge exposes tone variants used by status windows", () => {
    const f = ui("badge")
    for (const v of ["ok", "error", "warn", "pending", "accent"]) {
      expect(f).toContain(`${v}:`)
    }
  })
})
