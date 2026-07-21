import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { AssistantResponseParser, SUGGESTIONS_MARKER } from "@/lib/chat/assistant-response-parser"
import { querySyllabus } from "@/lib/api"

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

afterEach(() => vi.unstubAllGlobals())

describe("assistant follow-up suggestion protocol", () => {
  it("removes a marker split across stream chunks and returns structured suggestions", () => {
    const parser = new AssistantResponseParser()
    const output = [
      parser.push("La fotosíntesis transforma luz"),
      parser.push(` en energía.\n<!--NAVIGATOR_SUG`),
      parser.push(
        `GESTIONS:[{"label":"🧠 Verlo simple","prompt":"Explícamelo con una analogía"},` +
          `{"label":"📝 Practicar","prompt":"Dame un ejercicio de fotosíntesis"}]-->`,
      ),
    ].join("")
    const final = parser.finish()

    expect(output + final.contentDelta).toBe("La fotosíntesis transforma luz en energía.")
    expect(final.content).toBe("La fotosíntesis transforma luz en energía.")
    expect(final.suggestions).toEqual([
      { label: "🧠 Verlo simple", prompt: "Explícamelo con una analogía" },
      { label: "📝 Practicar", prompt: "Dame un ejercicio de fotosíntesis" },
    ])
  })

  it("streams ordinary answers unchanged when no suggestion block is present", () => {
    const parser = new AssistantResponseParser()
    const streamed = parser.push("Respuesta directa.")
    const final = parser.finish()

    expect(streamed + final.contentDelta).toBe("Respuesta directa.")
    expect(final.content).toBe("Respuesta directa.")
    expect(final.suggestions).toEqual([])
  })

  it("keeps at most three valid, unique suggestions", () => {
    const parser = new AssistantResponseParser()
    parser.push(
      `Respuesta.${SUGGESTIONS_MARKER}` +
        `[{"label":" A ","prompt":" Uno "},{"label":"A repetida","prompt":"Uno"},` +
        `{"label":"B","prompt":"Dos"},{"label":"C","prompt":"Tres"},` +
        `{"label":"D","prompt":"Cuatro"},{"label":"","prompt":"Inválida"}]-->`,
    )

    expect(parser.finish().suggestions).toEqual([
      { label: "A", prompt: "Uno" },
      { label: "B", prompt: "Dos" },
      { label: "C", prompt: "Tres" },
    ])
  })

  it("extracts the persisted message id and suggestions from the final SSE event", async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {"content":"Respuesta"}\n\n`))
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: "message-1",
              title: "Tema",
              citations: [],
              suggestions: [{ label: "📝 Practicar", prompt: "Dame un ejercicio" }],
            })}\n\n`,
          ),
        )
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const chunks: string[] = []

    const result = await querySyllabus(null, "Pregunta", "chat-1", (chunk) => chunks.push(chunk))

    expect(chunks).toEqual(["Respuesta"])
    expect(result).toMatchObject({
      id: "message-1",
      suggestions: [{ label: "📝 Practicar", prompt: "Dame un ejercicio" }],
    })
  })
})

describe("mentor prompt and composer wiring", () => {
  it("asks for adaptive structure, restrained emojis, and optional structured suggestions", () => {
    const prompts = src("src/lib/prompts/templates.ts")

    expect(prompts).toContain("No uses automáticamente")
    expect(prompts).toContain("Normalmente usa entre cero y tres emojis")
    expect(prompts).toContain("NAVIGATOR_SUGGESTIONS")
    expect(prompts).toContain("No generes sugerencias cuando")
  })

  it("renders response suggestions above the composer and fills the draft on selection", () => {
    const page = src("app/page.tsx")
    const composer = src("src/components/navigator/chat-composer.tsx")

    expect(page).toContain("suggestions={latestSuggestions}")
    expect(composer).toContain("Posibles siguientes preguntas")
    expect(composer).toContain("onClick={() => setDraft(suggestion.prompt)}")
  })
})
