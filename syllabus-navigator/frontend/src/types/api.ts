/**
 * API Data Transfer Objects (DTOs)
 * These interfaces represent the exact JSON shapes exchanged over the network.
 */

export interface CitationAPI {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  quote: string
}

export interface ChatOutAPI {
  id: string
  title: string
  active_model: string
  syllabus_id: string | null
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
  status: "pending" | "processing" | "ready" | "error"
  graph_status: "pending" | "processing" | "ready" | "error"
  created_at: string
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
