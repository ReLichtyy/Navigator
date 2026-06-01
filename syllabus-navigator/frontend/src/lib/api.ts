/**
 * API client for Syllabus Navigator backend.
 * Uses Next.js internal App Router API (/api).
 */
const API_BASE = "/api"

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function parseError(res: Response): Promise<string> {
  const errText = await res.text()
  try {
    const parsed = JSON.parse(errText)
    const detail = parsed.detail || parsed.error
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ")
    return errText || `Request failed (${res.status})`
  } catch {
    return errText || `Request failed (${res.status})`
  }
}

function getHeaders(isJson = true): HeadersInit {
  const headers: Record<string, string> = {}
  if (isJson) headers["Content-Type"] = "application/json"
  return headers
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: boolean } = {},
): Promise<T> {
  const { json = true, ...fetchInit } = init
  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchInit,
    headers: {
      ...getHeaders(json && !(fetchInit.body instanceof FormData)),
      ...(fetchInit.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) throw new ApiError(await parseError(res), res.status)
  
  const contentType = res.headers.get("content-type")
  if (res.status === 204 || !contentType?.includes("application/json")) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

// ============================================================================
// Types
// ============================================================================

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
  status: string
  graph_status: string
  created_at: string
}

export interface GraphResponseAPI {
  syllabus_id: string
  graph_status: string
  graph_error: string | null
  nodes: { id: string; label: string; weight_percent: number }[]
  edges: { source: string; target: string }[]
}

export interface UserPreferencesAPI {
  defaultProvider: string
  defaultModel: string
  language: string
}

export interface UsageSummaryAPI {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byModel: Record<string, { requests: number; tokens: number; costUsd: number }>
  periodDays: number
}

// ============================================================================
// Chat
// ============================================================================

export async function listChats() {
  return request<{ chats: ChatOutAPI[] }>("/chat/history", { method: "GET", json: false })
}

export async function newChat(syllabusId?: string) {
  return request<ChatOutAPI>("/chat/history", {
    method: "POST",
    body: syllabusId ? JSON.stringify({ syllabus_id: syllabusId }) : "{}",
  })
}

export async function deleteChat(chatId: string) {
  return request<void>(`/chat/${chatId}`, { method: "DELETE", json: false })
}

export async function updateChat(
  chatId: string,
  patch: { title?: string; syllabus_id?: string | null; active_model?: string },
) {
  return request<ChatOutAPI>(`/chat/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function renameChat(chatId: string, title: string) {
  return updateChat(chatId, { title })
}

export async function getChatDetail(chatId: string) {
  return request<ChatDetailAPI>(`/chat/${chatId}`, { method: "GET", json: false })
}

export async function fetchChatModels() {
  return request<{ models: string[]; default: string }>("/chat/models", { method: "GET", json: false })
}

export async function querySyllabus(
  syllabusId: string,
  question: string,
  chatId: string,
  userId?: string, // Deprecated, kept for compatibility with useChatWorkspace hook signature
  signal?: AbortSignal,
) {
  return request<{ answer: string; citations: CitationAPI[]; title?: string }>(
    `/chat/${chatId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ question }),
      signal,
    },
  )
}

// ============================================================================
// Upload / Knowledge
// ============================================================================

export async function listSyllabi() {
  return request<{ uploads: SyllabusUploadAPI[] }>("/upload/list", { method: "GET", json: false })
}

export async function uploadSyllabus(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<{ syllabus_id: string; message: string }>("/upload", {
    method: "POST",
    json: false,
    body: form,
  })
}

// ============================================================================
// Settings & Usage
// ============================================================================

export async function getPreferences() {
  return request<{ preferences: UserPreferencesAPI }>("/user/preferences", { method: "GET", json: false })
}

export async function updatePreferences(patch: Partial<UserPreferencesAPI>) {
  return request<{ preferences: UserPreferencesAPI }>("/user/preferences", {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function getUsage() {
  return request<{ usage: UsageSummaryAPI }>("/usage", { method: "GET", json: false })
}

// ============================================================================
// Feedback
// ============================================================================

export async function submitFeedback(messageId: string, vote: "up" | "down", comment?: string) {
  return request<{ success: true }>("/feedback", {
    method: "POST",
    body: JSON.stringify({ 
      message_id: messageId, 
      rating: vote === "up" ? 1 : -1, 
      comment 
    }),
  })
}

// ============================================================================
// Graph
// ============================================================================

export async function fetchGraph(syllabusId: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, { method: "GET", json: false })
}

export async function reprocessGraph(syllabusId: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}/reprocess`, {
    method: "POST",
    json: false,
  })
}
