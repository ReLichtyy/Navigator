/**
 * API Data Transfer Objects (DTOs)
 * These interfaces represent the exact JSON shapes exchanged over the network.
 */

import type { ProductFeedbackCategory } from "@/lib/ui/product-feedback"

export interface CitationAPI {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  /** Char-offset locator for sources without pages (link/text). null for PDFs. */
  char_start?: number | null
  char_end?: number | null
  quote: string
  /** Source kind, for building a navigable link in the UI. */
  source_type?: "pdf" | "link" | "text" | "docx" | "pptx" | "xlsx" | null
  /** Original URL for 'link' sources. */
  source_url?: string | null
  /** Blob URL of the PDF for 'pdf' sources (accounts only). */
  file_url?: string | null
  /** Source document name — set for cross-course retrieval so the UI can show which course. */
  source_name?: string | null
  syllabus_id?: string | null
}

/** Verifiable source locator attached to generated knowledge and study artifacts. */
export interface SourceRefAPI {
  syllabus_id: string
  /** Canonical extracted block when available. */
  source_block_id?: string | null
  /** Retrieval chunk when the reference was resolved after embedding. */
  chunk_id?: string | null
  /** Existing graph topic used by deterministic previews. */
  topic_id?: string | null
  source_name?: string | null
  source_type?: CitationAPI["source_type"]
  page_start?: number | null
  page_end?: number | null
  char_start?: number | null
  char_end?: number | null
  quote?: string | null
}

export type ArtifactRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface ArtifactRunAPI {
  id: string
  scope_kind: "doc" | "course"
  scope_id: string
  artifact_type: "document_inventory" | "document_graph" | "course_graph" | "study_kit"
  status: ArtifactRunStatus
  stage: string
  progress: number
  error: string | null
  retryable: boolean
  workflow_run_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface SuggestedPromptAPI {
  /** Short chip label shown above the chat composer. */
  label: string
  /** Full prompt copied into the composer after user confirmation. */
  prompt: string
}

export interface ChatOutAPI {
  id: string
  title: string
  active_model: string
  syllabus_id: string | null
  course_id: string | null
  /** Document name the chat is bound to (joined from syllabus_uploads). */
  syllabus_name?: string | null
  created_at: string
  message_count: number
}

export interface MessageOutAPI {
  id: string
  role: "user" | "ai"
  content: string
  created_at: string
  citations: CitationAPI[]
  suggestions?: SuggestedPromptAPI[]
}

export interface ChatDetailAPI extends ChatOutAPI {
  messages: MessageOutAPI[]
}

export interface SyllabusUploadAPI {
  id: string
  original_filename: string
  status: "pending" | "processed" | "error" | "needs_ocr"
  graph_status: "pending" | "processing" | "ready" | "failed"
  /** Source kind: uploaded file (PDF/Word/PowerPoint/Excel), fetched web link, or pasted text. */
  source_type?: "pdf" | "link" | "text" | "docx" | "pptx" | "xlsx"
  /** Original URL for 'link' sources. */
  source_url?: string | null
  error_message?: string | null
  graph_error?: string | null
  /** Blob URL of the original PDF (accounts with blob storage only; null otherwise). */
  file_url?: string | null
  created_at: string
  // --- Course Intelligence Layer ---
  /** Assigned course, set only after the user confirms a suggestion. */
  course_id?: string | null
  /** Latest inferred course name awaiting the user's decision. */
  inferred_course?: string | null
  /** Confidence of the latest suggestion, 0..1. */
  infer_confidence?: number | null
  /** Suggestion state machine. */
  infer_status?: "pending" | "suggested" | "confirmed" | "rejected" | "skipped"
}

export interface CourseAPI {
  id: string
  name: string
  description: string | null
  subject_tags: string[] | null
  color: string | null
  /** yyyy-mm-dd term start — anchors "Semana N" events to real dates. */
  term_start: string | null
  document_count: number
  created_at: string
  updated_at: string
}

export interface GraphResponseAPI {
  syllabus_id: string
  graph_status: SyllabusUploadAPI["graph_status"]
  graph_error: string | null
  /** Chosen presentation layout. null = legacy graph (pre-rewrite, not yet reprocessed). */
  layout: "radial" | "tree_horizontal" | "tree_vertical" | "columns_report" | null
  nodes: {
    id: string
    label: string
    weight_percent: number
    level: number
    parent_id: string | null
    detail: string | null
    color: string | null
    source_refs?: SourceRefAPI[]
    confidence?: number | null
    generation_version?: number
  }[]
  edges: { source: string; target: string }[]
  crossLinks: { source: string; target: string; label: string }[]
}

/**
 * Whole-course mind map (one per course, generated from the docs selected in
 * the "Editar mapa" drawer). Same node/edge shape as GraphResponseAPI.
 * graph_status "none" = never generated yet (client shows the initial CTA).
 */
export interface CourseGraphResponseAPI {
  course_id: string
  graph_status: "none" | "pending" | "processing" | "ready" | "stale" | "failed"
  graph_error: string | null
  /** Docs that fed the current map — the drawer's persisted multi-select. */
  source_doc_ids: string[]
  layout: GraphResponseAPI["layout"]
  nodes: GraphResponseAPI["nodes"]
  edges: GraphResponseAPI["edges"]
  crossLinks: GraphResponseAPI["crossLinks"]
  /** Latest generation run; the stored graph remains visible while this advances. */
  generation?: ArtifactRunAPI | null
}

export type ProductFeedbackCategoryAPI = ProductFeedbackCategory

export interface ProductFeedbackSubmissionAPI {
  category: ProductFeedbackCategoryAPI
  description: string
  clientRequestId: string
}

export interface ProductFeedbackReceiptAPI {
  feedback: {
    id: string
    createdAt: string
    syncStatus: "pending" | "synced"
  }
}
