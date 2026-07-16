/**
 * mind-map-selection.ts — handoff contract between /estudio and /mapa.
 *
 * When the student launches "Mapa mental" from the Área de Estudio, the page
 * writes WHAT should be processed (course + chosen PDFs + optional focus) to
 * localStorage instead of letting /mapa auto-generate from every ready doc.
 * /mapa reads this on entry and shows a PREVIEW of the pending selection —
 * nothing is generated until the student confirms.
 */

export const MIND_MAP_SELECTION_KEY = "mapa:pending-selection"

/** Selection considered stale after this long (navigations abandoned mid-way). */
const MAX_AGE_MS = 30 * 60 * 1000

export interface MindMapSelection {
  /** Real course id; null for a "sin curso" bucket (per-doc fallback map). */
  courseId: string | null
  /** Course/folder display name for the preview header. */
  courseName: string
  /** PDFs that should feed the map (subset picked in Material). */
  docIds: string[]
  /** Display names parallel to docIds (preview list, no extra fetch needed). */
  docNames: string[]
  /** Optional focus instruction from the Enfoque section (→ graph-gen prompt). */
  topic: string | null
  /** Epoch ms when the selection was written (staleness check). */
  savedAt: number
}

export function writeMindMapSelection(sel: Omit<MindMapSelection, "savedAt">): void {
  try {
    window.localStorage.setItem(
      MIND_MAP_SELECTION_KEY,
      JSON.stringify({ ...sel, savedAt: Date.now() } satisfies MindMapSelection),
    )
  } catch {
    // storage blocked/full — /mapa just falls back to its default flow
  }
}

/** Read the pending selection; drops (and clears) malformed or stale entries. */
export function readMindMapSelection(): MindMapSelection | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(MIND_MAP_SELECTION_KEY)
    if (!raw) return null
    const sel = JSON.parse(raw) as MindMapSelection
    if (
      !Array.isArray(sel.docIds) ||
      sel.docIds.length === 0 ||
      !Array.isArray(sel.docNames) ||
      typeof sel.savedAt !== "number" ||
      Date.now() - sel.savedAt > MAX_AGE_MS
    ) {
      clearMindMapSelection()
      return null
    }
    return sel
  } catch {
    return null
  }
}

export function clearMindMapSelection(): void {
  try {
    window.localStorage.removeItem(MIND_MAP_SELECTION_KEY)
  } catch {
    // non-fatal
  }
}
