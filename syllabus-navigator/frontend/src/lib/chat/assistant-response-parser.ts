import type { SuggestedPromptAPI } from "@/types/api"

export const SUGGESTIONS_MARKER = "\n<!--NAVIGATOR_SUGGESTIONS:"
const SUGGESTIONS_END = "-->"
const MAX_SUGGESTIONS = 3
const MAX_LABEL_LENGTH = 48
const MAX_PROMPT_LENGTH = 240

export interface ParsedAssistantResponse {
  content: string
  contentDelta: string
  suggestions: SuggestedPromptAPI[]
}

function normalizeSuggestions(value: unknown): SuggestedPromptAPI[] {
  if (!Array.isArray(value)) return []

  const suggestions: SuggestedPromptAPI[] = []
  const seenPrompts = new Set<string>()

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue
    const label =
      "label" in candidate && typeof candidate.label === "string"
        ? candidate.label.trim().slice(0, MAX_LABEL_LENGTH)
        : ""
    const prompt =
      "prompt" in candidate && typeof candidate.prompt === "string"
        ? candidate.prompt.trim().slice(0, MAX_PROMPT_LENGTH)
        : ""
    const dedupeKey = prompt.toLocaleLowerCase()
    if (!label || !prompt || seenPrompts.has(dedupeKey)) continue

    suggestions.push({ label, prompt })
    seenPrompts.add(dedupeKey)
    if (suggestions.length === MAX_SUGGESTIONS) break
  }

  return suggestions
}

/**
 * Separates the optional machine-readable suggestion block from streamed text.
 * A short tail is buffered so the marker is never flashed when split across chunks.
 */
export class AssistantResponseParser {
  private buffer = ""
  private visibleContent = ""
  private readingSuggestions = false

  push(chunk: string): string {
    this.buffer += chunk
    if (this.readingSuggestions) return ""

    const markerIndex = this.buffer.indexOf(SUGGESTIONS_MARKER)
    if (markerIndex >= 0) {
      const visibleDelta = this.buffer.slice(0, markerIndex)
      this.visibleContent += visibleDelta
      this.buffer = this.buffer.slice(markerIndex + SUGGESTIONS_MARKER.length)
      this.readingSuggestions = true
      return visibleDelta
    }

    const safeLength = Math.max(0, this.buffer.length - SUGGESTIONS_MARKER.length + 1)
    const visibleDelta = this.buffer.slice(0, safeLength)
    this.buffer = this.buffer.slice(safeLength)
    this.visibleContent += visibleDelta
    return visibleDelta
  }

  finish(): ParsedAssistantResponse {
    let contentDelta = ""
    let suggestions: SuggestedPromptAPI[] = []

    if (this.readingSuggestions) {
      const endIndex = this.buffer.indexOf(SUGGESTIONS_END)
      const encoded = endIndex >= 0 ? this.buffer.slice(0, endIndex) : this.buffer
      try {
        suggestions = normalizeSuggestions(JSON.parse(encoded))
      } catch {
        suggestions = []
      }
    } else {
      contentDelta = this.buffer
      this.visibleContent += contentDelta
    }

    this.buffer = ""
    return { content: this.visibleContent, contentDelta, suggestions }
  }
}
