export const QUICK_NOTE_COLORS = ["#3FBF84", "#D8C79A", "#8FA8E8", "#E8A0C8"] as const

export interface PreparedQuickNote {
  body: string
  title?: string
  color: string
}

/** Turn the one-line quick-note composer value into persisted note fields. */
export function prepareQuickNote(draft: string, color: string): PreparedQuickNote {
  const body = draft.trim()
  const separated = /^(.{1,120}?)\s*[:—]\s+(.+)$/.exec(body)
  if (!separated) return { body, color }

  return {
    title: separated[1].trim(),
    body: separated[2].trim(),
    color,
  }
}
