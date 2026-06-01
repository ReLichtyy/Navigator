export type Citation = {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  quote: string
}

export type Message = {
  id: string
  role: "user" | "ai"
  content: string
  pending?: boolean
  citations?: Citation[]
}

export type Chat = {
  id: string
  title: string
  timestamp: string
  createdAt?: string
  activeModel?: string
  syllabusId?: string | null
  messageCount?: number
  messages: Message[]
}

export type AttachedFile = {
  id: string
  name: string
  size: string
  file?: File
  syllabus_id?: string
  status?: "uploading" | "ready" | "error"
}
