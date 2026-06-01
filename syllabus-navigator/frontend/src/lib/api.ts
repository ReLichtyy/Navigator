/**
 * API client for Syllabus Navigator backend.
 * User identity is injected via setApiUserId() from UserContext.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

let _userId = "dev-user-1"

export function setApiUserId(id: string) {
  _userId = id
}

export function getApiUserId() {
  return _userId
}

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * Strips HTML tags from a string so that error pages from reverse
 * proxies (Vercel, Cloudflare, nginx) never leak raw HTML into the UI.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Returns true when the Content-Type header indicates a JSON body.
 * Handles variations like "application/json; charset=utf-8".
 */
function isJsonContentType(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? ""
  return ct.includes("application/json")
}

async function parseError(res: Response): Promise<string> {
  const errText = await res.text()

  // If the body looks like HTML (error page from proxy/gateway), don't expose it.
  if (errText.trimStart().startsWith("<!") || errText.trimStart().startsWith("<html")) {
    const stripped = stripHtml(errText)
    // Take at most 120 chars of the stripped text for context.
    const preview = stripped.length > 120 ? stripped.slice(0, 120) + "…" : stripped
    return `Server returned an error page (${res.status}): ${preview || "Unknown error"}`
  }

  try {
    const parsed = JSON.parse(errText)
    const detail = parsed.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ")
    return errText || `Request failed (${res.status})`
  } catch {
    return errText || `Request failed (${res.status})`
  }
}

function getHeaders(userId?: string, isJson = true): HeadersInit {
  const headers: Record<string, string> = {
    "X-User-Id": userId || _userId,
  }
  if (isJson) headers["Content-Type"] = "application/json"
  return headers
}

async function request<T>(
  path: string,
  init: RequestInit & { userId?: string; json?: boolean } = {},
): Promise<T> {
  const { userId, json = true, ...fetchInit } = init

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      headers: {
        ...getHeaders(userId, json && !(fetchInit.body instanceof FormData)),
        ...(fetchInit.headers as Record<string, string> | undefined),
      },
    })
  } catch (err) {
    // Network error (backend down, DNS failure, CORS blocked, etc.)
    throw new ApiError(
      "Unable to reach the server. Check your connection or try again later.",
      0,
    )
  }

  if (!res.ok) throw new ApiError(await parseError(res), res.status)
  if (res.status === 204) return undefined as T

  // ── Guard: validate the response is actually JSON ──────────────────────
  if (!isJsonContentType(res)) {
    const body = await res.text()
    const preview = body.trimStart().startsWith("<")
      ? stripHtml(body).slice(0, 120)
      : body.slice(0, 120)
    throw new ApiError(
      `Expected a JSON response from ${path} but received "${res.headers.get("content-type") ?? "unknown"}": ${preview || "(empty body)"}`,
      res.status,
    )
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

// ============================================================================
// Chat
// ============================================================================

export async function listChats(userId?: string) {
  return request<{ chats: ChatOutAPI[] }>("/chat/list", { method: "GET", userId, json: false })
}

export async function newChat(syllabusId?: string, userId?: string) {
  return request<ChatOutAPI>("/chat/new", {
    method: "POST",
    userId,
    body: syllabusId ? JSON.stringify({ syllabus_id: syllabusId }) : "{}",
  })
}

export async function deleteChat(chatId: string, userId?: string) {
  return request<void>(`/chat/${chatId}`, { method: "DELETE", userId, json: false })
}

export async function updateChat(
  chatId: string,
  patch: { title?: string; syllabus_id?: string | null; active_model?: string },
  userId?: string,
) {
  return request<ChatOutAPI>(`/chat/${chatId}`, {
    method: "PATCH",
    userId,
    body: JSON.stringify(patch),
  })
}

export async function renameChat(chatId: string, title: string, userId?: string) {
  return updateChat(chatId, { title }, userId)
}

export async function getChatDetail(chatId: string, userId?: string) {
  return request<ChatDetailAPI>(`/chat/${chatId}`, { method: "GET", userId, json: false })
}

export async function fetchChatModels() {
  return request<{ models: string[]; default: string }>("/chat/models", { method: "GET", json: false })
}

export async function querySyllabus(
  syllabusId: string,
  question: string,
  chatId: string,
  userId?: string,
  signal?: AbortSignal,
) {
  return request<{ chat_id: string; answer: string; citations: CitationAPI[]; title: string }>(
    "/chat/query",
    {
      method: "POST",
      userId,
      body: JSON.stringify({ syllabus_id: syllabusId, question, chat_id: chatId }),
      signal,
    },
  )
}

// ============================================================================
// Upload / Knowledge
// ============================================================================

export async function listSyllabi(userId?: string) {
  return request<{ uploads: SyllabusUploadAPI[] }>("/upload/list", { method: "GET", userId, json: false })
}

export async function uploadSyllabus(file: File, userId?: string) {
  const form = new FormData()
  form.append("file", file)
  return request<{ syllabus_id: string; message: string }>("/upload/syllabus", {
    method: "POST",
    userId,
    json: false,
    body: form,
  })
}

// ============================================================================
// Graph
// ============================================================================

export async function fetchGraph(syllabusId: string, userId?: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, { method: "GET", userId, json: false })
}

export async function reprocessGraph(syllabusId: string, userId?: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}/reprocess`, {
    method: "POST",
    userId,
    json: false,
  })
}
