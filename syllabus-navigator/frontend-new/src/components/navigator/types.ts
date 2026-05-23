export type Message = {
  id: string
  role: "user" | "ai"
  content: string
  pending?: boolean
}

export type Chat = {
  id: string
  title: string
  timestamp: string
  createdAt?: string  // ISO timestamp from the backend (used to compute relative labels)
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
