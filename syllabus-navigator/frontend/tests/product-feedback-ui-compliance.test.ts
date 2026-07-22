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
    const dialog = read("src/components/ui/dialog.tsx")
    expect(modal).toContain("Dialog")
    expect(modal).toContain("Select")
    expect(modal).toContain("Textarea")
    expect(modal).toContain("displayName")
    expect(modal).toContain("avatarUrl")
    expect(modal).toContain("submitProductFeedback")
    expect(modal).toContain("resolveProductFeedbackRequestId")
    expect(modal).not.toContain("personName:")
    expect(modal).not.toContain('fetch("/api')
    expect(modal.match(/clientRequestIdRef\.current = ""/g)?.length).toBeGreaterThanOrEqual(3)
    expect(modal).toContain('name="category"')
    expect(modal).toContain('name="description"')
    expect(modal).toContain("onCloseAutoFocus")
    expect(modal).toContain('closeLabel={t("close")}')
    expect(modal).not.toContain('aria-live="polite"')
    expect(dialog).toContain("closeLabel")
  })

  it("uses the purple treatment and session-aware visibility helper", () => {
    const launcher = read("src/components/feedback/product-feedback-launcher.tsx")
    expect(launcher).toContain("shouldShowProductFeedbackLauncher")
    expect(launcher).toContain("#c084fc")
    expect(launcher).toContain("#a855f7")
    expect(launcher).toContain("aria-label")
    expect(launcher).toContain("lg:w-auto")
    expect(launcher).toContain("hidden lg:inline")
    expect(launcher).toContain("z-[41]")
    expect(launcher).toContain('id="product-feedback-launcher"')
    expect(launcher).not.toContain("launcherButtonRef")
    expect(launcher).toContain("aria-controls")
    expect(launcher).toContain("safe-area-inset-right")
  })

  it("keeps mobile headers and the launcher aligned below the safe area", () => {
    for (const file of [
      "src/components/navigator/top-header.tsx",
      "app/knowledge/page.tsx",
      "app/estudio/page.tsx",
      "app/mapa/page.tsx",
    ]) {
      expect(read(file)).toContain("safe-area-inset-top")
      expect(read(file)).toContain("safe-area-inset-right")
    }
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
