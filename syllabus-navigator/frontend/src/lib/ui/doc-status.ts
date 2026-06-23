/**
 * doc-status.ts — pure mapping from a syllabus upload to its display status.
 * Extracted from the Knowledge Base window so it is unit-testable (UI-4).
 */
import type { SyllabusUploadAPI } from '@/lib/api'

export type DocTone = 'ok' | 'error' | 'warn' | 'pending'

export interface DocStatusView {
  label: string
  tone: DocTone
  tooltip?: string
  canReprocess: boolean
}

/** Badge variant name (see components/ui/badge.tsx) for a given tone. */
export const TONE_VARIANT: Record<DocTone, 'ok' | 'error' | 'warn' | 'pending'> = {
  ok: 'ok',
  error: 'error',
  warn: 'warn',
  pending: 'pending',
}

export function getDocStatus(
  doc: SyllabusUploadAPI & { _optimistic?: boolean },
): DocStatusView {
  if (doc._optimistic) return { label: 'Uploading…', tone: 'pending', canReprocess: false }

  if (doc.status === 'error') {
    return {
      label: 'Failed',
      tone: 'error',
      tooltip: doc.error_message ?? 'Processing failed.',
      canReprocess: true,
    }
  }
  if (doc.status === 'pending') {
    return { label: 'Processing…', tone: 'pending', canReprocess: false }
  }

  // status === "processed" → look at the graph stage
  if (doc.graph_status === 'failed') {
    return {
      label: 'Graph failed',
      tone: 'warn',
      tooltip: doc.graph_error ?? 'Graph generation failed.',
      canReprocess: true,
    }
  }
  if (doc.graph_status === 'pending' || doc.graph_status === 'processing') {
    return { label: 'Building graph…', tone: 'pending', canReprocess: false }
  }
  return { label: 'Ready', tone: 'ok', canReprocess: false }
}
