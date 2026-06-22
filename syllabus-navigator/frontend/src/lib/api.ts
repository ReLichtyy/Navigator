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

import type { 
  CitationAPI,
  ChatOutAPI, 
  ChatDetailAPI, 
  MessageOutAPI, 
  SyllabusUploadAPI, 
  GraphResponseAPI 
} from "@/types/api"

export type { CitationAPI, ChatOutAPI, ChatDetailAPI, MessageOutAPI, SyllabusUploadAPI, GraphResponseAPI }

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

export interface ChatModelAPI {
  id: string
  displayName: string
}

export async function fetchChatModels() {
  return request<{ models: ChatModelAPI[]; default: string }>("/chat/models", { method: "GET", json: false })
}

export interface StreamResult {
  title?: string
  citations?: CitationAPI[]
  provider?: string
  model?: string
}

export async function querySyllabus(
  syllabusId: string | null,
  question: string,
  chatId: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(`${API_BASE}/chat/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  })

  if (!res.ok) {
    const errMsg = await parseError(res)
    throw new ApiError(errMsg, res.status)
  }

  // Read SSE stream
  const reader = res.body?.getReader()
  if (!reader) throw new ApiError("No response body", 500)

  const decoder = new TextDecoder()
  let buffer = ""
  let result: StreamResult = {}

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const payload = line.slice(6).trim()
        if (payload === "[DONE]") continue
        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) {
            throw new ApiError(parsed.error, 500)
          }
          if (parsed.content) {
            onChunk(parsed.content)
          }
          // Final event carries title, citations, provider, model
          if (parsed.title !== undefined || parsed.citations !== undefined) {
            result = {
              title: parsed.title,
              citations: parsed.citations ?? [],
              provider: parsed.provider,
              model: parsed.model,
            }
          }
        } catch (parseErr) {
          if (parseErr instanceof ApiError) throw parseErr
          // Malformed SSE line — skip it
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return result
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

export async function deleteSyllabus(id: string) {
  return request<{ success: boolean }>(`/upload/${id}`, { method: "DELETE", json: false })
}

export async function renameDocument(id: string, name: string) {
  return request<{ upload: SyllabusUploadAPI }>(`/upload/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
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

/** Save a manually-edited mind map. Returns the persisted graph (with new ids). */
export async function updateGraph(
  syllabusId: string,
  graph: {
    nodes: { id: string; label: string; weight_percent?: number | null }[]
    edges: { source: string; target: string }[]
  },
) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, {
    method: "PATCH",
    body: JSON.stringify(graph),
  })
}

export interface ScheduleEventAPI {
  id: string
  syllabus_id: string
  course_name: string
  event_type: string
  title: string
  description: string | null
  event_date: string | null
  week_label: string | null
  weight_percent: number | null
}

/** Upcoming agenda across all the user's courses. */
export async function fetchAgenda() {
  return request<{ today: string; events: ScheduleEventAPI[] }>(`/schedule`, {
    method: "GET",
    json: false,
  })
}

/** Full schedule for one syllabus. */
export async function fetchSchedule(syllabusId: string) {
  return request<{ events: ScheduleEventAPI[] }>(
    `/schedule?syllabusId=${encodeURIComponent(syllabusId)}`,
    { method: "GET", json: false },
  )
}

export interface UpcomingAssessmentAPI {
  id: string
  course_name: string
  event_type: string
  title: string
  event_date: string | null
  week_label: string | null
  weight_percent: number | null
  days_until: number | null
  review_first: string[]
}

export interface WeeklyPlanAPI {
  today: string
  week_start: string
  week_end: string
  this_week_topics: ScheduleEventAPI[]
  upcoming_assessments: UpcomingAssessmentAPI[]
}

/** Dynamic weekly study plan (assessments + this week's topics + review hints). */
export async function fetchRecommendations() {
  return request<WeeklyPlanAPI>(`/recommendations`, { method: "GET", json: false })
}
