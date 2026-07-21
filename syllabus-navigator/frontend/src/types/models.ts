/**
 * Domain Models
 * These represent the core entities in the application.
 */

export interface Citation {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  char_start?: number | null
  char_end?: number | null
  quote: string
  source_type?: "pdf" | "link" | "text" | "docx" | "pptx" | "xlsx" | null
  source_url?: string | null
  file_url?: string | null
  source_name?: string | null
  syllabus_id?: string | null
}

export interface SuggestedPrompt {
  label: string
  prompt: string
}

export interface Message {
  id: string
  chatId?: string
  role: "user" | "ai" | "system"
  content: string
  createdAt?: string
  pending?: boolean
  citations?: Citation[]
  suggestions?: SuggestedPrompt[]
}

export interface Chat {
  id: string
  title: string
  timestamp: string
  createdAt?: string
  activeModel?: string
  syllabusId?: string | null
  courseId?: string | null
  /** Document/course name this chat is bound to (for "historial por curso" filter). */
  syllabusName?: string | null
  messageCount?: number
  messages: Message[]
}

export interface AttachedFile {
  id: string
  name: string
  size: string
  file?: File
  syllabus_id?: string
  status?: "uploading" | "ready" | "error"
}

export interface Document {
  id: string
  userId: string
  originalFilename: string
  sourceHash: string
  status: "pending" | "processing" | "ready" | "error"
  graphStatus: "pending" | "processing" | "ready" | "error"
  graphError: string | null
  createdAt: string
}

export interface TopicNode {
  id: string
  label: string
  weightPercent: number
}

export interface TopicEdge {
  source: string
  target: string
}
