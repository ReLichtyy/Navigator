/**
 * Domain Models
 * These represent the core entities in the application.
 */

export interface User {
  id: string
  email: string
  name: string | null
  image: string | null
  role: "free" | "pro" | "guest"
}

export interface Citation {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  quote: string
}

export interface Message {
  id: string
  chatId?: string
  role: "user" | "ai" | "system"
  content: string
  createdAt?: string
  pending?: boolean
  citations?: Citation[]
}

export interface Chat {
  id: string
  title: string
  timestamp: string
  createdAt?: string
  activeModel?: string
  syllabusId?: string | null
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

export interface KnowledgeGraph {
  syllabusId: string
  status: Document["graphStatus"]
  error: string | null
  nodes: TopicNode[]
  edges: TopicEdge[]
}
