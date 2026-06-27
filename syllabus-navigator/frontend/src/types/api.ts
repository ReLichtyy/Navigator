/**
 * API Data Transfer Objects (DTOs)
 * These interfaces represent the exact JSON shapes exchanged over the network.
 */

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

export interface ChatOutAPI {
  id: string
  title: string
  active_model: string
  syllabus_id: string | null
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
  document_count: number
  created_at: string
  updated_at: string
}

export interface GraphResponseAPI {
  syllabus_id: string
  graph_status: SyllabusUploadAPI["graph_status"]
  graph_error: string | null
  nodes: { id: string; label: string; weight_percent: number }[]
  edges: { source: string; target: string }[]
}

export interface ApiResponse<T> {
  data?: T
  error?: string
}
