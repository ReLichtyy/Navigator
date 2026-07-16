import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

describe("assistant prompt suggestions require user confirmation", () => {
  it("routes hero suggestions into the controlled composer draft", () => {
    const page = src("app/page.tsx")

    expect(page).toContain("const [composerDraft, setComposerDraft] = useState(\"\")")
    expect(page).toContain("onSuggestion={setComposerDraft}")
    expect(page).toContain("onRegenerate={sendWithWeb}")
    expect(page).toContain("draft={composerDraft}")
    expect(page).toContain("onDraftChange={setComposerDraft}")
  })

  it("keeps suggestion and regenerate callbacks separate in the chat thread", () => {
    const thread = src("src/components/navigator/chat-thread.tsx")

    expect(thread).toContain("onSuggestion?.(phrases[phraseIdx % phrases.length])")
    expect(thread).toContain("onRegenerate(prevUserById.get(m.id)!)")
  })

  it("fills the composer for quick tools instead of invoking onSend", () => {
    const composer = src("src/components/navigator/chat-composer.tsx")
    const runTool = composer.match(/const runTool = \(prompt: string\) => \{([\s\S]*?)\n  \}/)?.[1]

    expect(runTool).toBeDefined()
    expect(runTool).toContain("setDraft(prompt)")
    expect(runTool).not.toContain("onSend(prompt)")
  })
})
