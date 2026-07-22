import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "..")
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("product feedback UI integration", () => {
  it("mounts one global launcher inside the existing providers", () => {
    const providers = read("src/components/ClientProviders.tsx")
    expect(providers).toContain('from "@/components/feedback/product-feedback-launcher"')
    expect(providers.match(/<ProductFeedbackLauncher\s*\/>/g)).toHaveLength(1)
  })

  it("uses shared primitives, session identity and the client API adapter", () => {
    const modal = read("src/components/feedback/product-feedback-modal.tsx")
    expect(modal).toContain("Dialog")
    expect(modal).toContain("Select")
    expect(modal).toContain("Textarea")
    expect(modal).toContain("displayName")
    expect(modal).toContain("submitProductFeedback")
    expect(modal).not.toContain('fetch("/api')
  })

  it("uses the purple treatment and session-aware visibility helper", () => {
    const launcher = read("src/components/feedback/product-feedback-launcher.tsx")
    expect(launcher).toContain("shouldShowProductFeedbackLauncher")
    expect(launcher).toContain("#c084fc")
    expect(launcher).toContain("#a855f7")
    expect(launcher).toContain("aria-label")
  })

  it("provides feedback copy in both locale catalogs", () => {
    const es = JSON.parse(read("src/messages/es.json"))
    const en = JSON.parse(read("src/messages/en.json"))
    expect(es.feedback.launcher).toBeTruthy()
    expect(es.feedback.modalTitle).toBeTruthy()
    expect(en.feedback.launcher).toBeTruthy()
    expect(en.feedback.modalTitle).toBeTruthy()
  })
})
