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
