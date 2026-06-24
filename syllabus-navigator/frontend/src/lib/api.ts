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
    if (Array.isArray(detail))
      return detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join("; ")
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

async function request<T>(path: string, init: RequestInit & { json?: boolean } = {}): Promise<T> {
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
  GraphResponseAPI,
  CourseAPI,
} from "@/types/api"

export type {
  CitationAPI,
  ChatOutAPI,
  ChatDetailAPI,
  MessageOutAPI,
  SyllabusUploadAPI,
  GraphResponseAPI,
  CourseAPI,
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

export interface ChatModelAPI {
  id: string
  displayName: string
}

export async function fetchChatModels() {
  return request<{ models: ChatModelAPI[]; default: string }>("/chat/models", {
    method: "GET",
    json: false,
  })
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

export async function addLink(url: string) {
  return request<{ syllabus_id: string; status: string; message: string }>("/upload/link", {
    method: "POST",
    body: JSON.stringify({ url }),
  })
}

export async function addTextSource(text: string, title?: string) {
  return request<{ syllabus_id: string; status: string; message: string }>("/upload/text", {
    method: "POST",
    body: JSON.stringify({ text, title }),
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
// Courses — Course Intelligence Layer (inference + assignment)
// ============================================================================

/** List the user's courses (with document counts). */
export async function listCourses() {
  return request<{ courses: CourseAPI[] }>("/courses", { method: "GET", json: false })
}

/** Create a course. */
export async function createCourse(input: {
  name: string
  description?: string | null
  subject_tags?: string[] | null
  color?: string | null
}) {
  return request<{ course: CourseAPI }>("/courses", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

/**
 * Act on a document's course suggestion. confirm with no course → accept the
 * standing suggestion; with course_id → assign existing; with new_course_name →
 * create + assign. reject leaves it uncategorised; skip defers the decision.
 */
export async function setDocumentCourse(
  docId: string,
  body:
    | {
        action: "confirm"
        course_id?: string
        new_course_name?: string
        new_course_tags?: string[]
      }
    | { action: "reject" }
    | { action: "skip" },
) {
  return request<{ upload: SyllabusUploadAPI }>(`/upload/${encodeURIComponent(docId)}/course`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** Rename a course. */
export async function renameCourse(courseId: string, name: string) {
  return request<{ course: CourseAPI }>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })
}

/** Delete a course; its documents survive and become uncategorised. */
export async function deleteCourse(courseId: string) {
  return request<{ success: boolean }>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
    json: false,
  })
}

// ============================================================================
// Settings & Usage
// ============================================================================

export async function getPreferences() {
  return request<{ preferences: UserPreferencesAPI }>("/user/preferences", {
    method: "GET",
    json: false,
  })
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
      comment,
    }),
  })
}

// ============================================================================
// Graph
// ============================================================================

export async function fetchGraph(syllabusId: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, { method: "GET", json: false })
}

// ----- Cross-course prerequisite graph (Sprint 4) -----

export interface CrossGraphNodeAPI {
  id: string
  label: string
  syllabus_id: string
  course: string
  weight_percent: number
}

export interface CrossGraphEdgeAPI {
  source: string
  target: string
  kind: "prerequisite" | "shared"
}

export interface CrossGraphAPI {
  nodes: CrossGraphNodeAPI[]
  edges: CrossGraphEdgeAPI[]
  courses: { syllabus_id: string; course: string }[]
}

/** Combined knowledge graph across all the user's courses, with cross-course bridges. */
export async function fetchCrossGraph() {
  return request<CrossGraphAPI>(`/graph/cross`, { method: "GET", json: false })
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

// ============================================================================
// Study OS — Área de Estudio (flashcards / quiz / summary / mind map)
// ============================================================================

export interface FlashcardAPI {
  front: string
  back: string
}

export interface QuizQuestionAPI {
  question: string
  options: string[]
  answer: number
  explanation: string
  /** Topic this question assesses — feeds the mastery ledger. Absent on old cached sets. */
  topic?: string
}

export interface StudyGuideSectionAPI {
  topic: string
  weight: number
  points: string[]
}

export interface StudySetAPI {
  syllabus_id: string
  flashcards: FlashcardAPI[]
  quiz: QuizQuestionAPI[]
  summary: { intro: string; points: { title: string; body: string }[] }
  mindmap: { center: string; branches: { label: string; items: string[] }[] }
  /** Weight-ordered study guide (Sprint 4). Absent on old cached sets. */
  studyGuide?: StudyGuideSectionAPI[]
}

export type StudyDifficulty = "facil" | "medio" | "dificil"

export interface StudySetOptions {
  /** Regenerate the canonical (medium, whole-course) set. */
  refresh?: boolean
  /** Tune how demanding the generated material is. */
  difficulty?: StudyDifficulty
  /** Focus the set on a single cronograma topic. */
  topic?: string
}

/**
 * Study material for a course. The default (medium, whole-course) set is cached
 * server-side; passing a `difficulty`≠medio or a `topic` returns a fresh tailored
 * set (not cached). Throws ApiError (409) when there's no usable material yet.
 */
export async function fetchStudySet(syllabusId: string, opts: StudySetOptions = {}) {
  const qs = new URLSearchParams()
  if (opts.refresh) qs.set("refresh", "1")
  if (opts.difficulty && opts.difficulty !== "medio") qs.set("difficulty", opts.difficulty)
  if (opts.topic?.trim()) qs.set("topic", opts.topic.trim())
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return request<StudySetAPI>(`/study/${encodeURIComponent(syllabusId)}${suffix}`, {
    method: "GET",
    json: false,
  })
}

export interface StudyStatsAPI {
  streakDays: number
  cardsThisWeek: number
}

/** Study streak + cards reviewed this week (sidebar). */
export async function fetchStudyStats() {
  return request<StudyStatsAPI>(`/study/stats`, { method: "GET", json: false })
}

/** Stable key for a flashcard, surviving study-set regeneration. */
export function flashcardKey(front: string): string {
  let h = 0
  for (let i = 0; i < front.length; i++) {
    h = (Math.imul(31, h) + front.charCodeAt(i)) | 0
  }
  return `c${(h >>> 0).toString(36)}`
}

/** Record a flashcard review (fire-and-forget on the client). */
export async function recordFlashcardReview(syllabusId: string, cardFront: string, known: boolean) {
  return request<{ success: true }>(`/study/review`, {
    method: "POST",
    body: JSON.stringify({ syllabus_id: syllabusId, card_key: flashcardKey(cardFront), known }),
  })
}

// ============================================================================
// Mastery ledger (Sprint 4) — per-topic confidence over time
// ============================================================================

export interface MasteryTopicAPI {
  topic_key: string
  label: string
  confidence: number // 0..1
  attempts: number
  correct: number
}

export interface CourseMasteryAPI {
  syllabus_id: string
  topics: number
  avg_confidence: number // 0..1
  attempts: number
}

/** Record a batch of quiz outcomes against a course's topics (fire-and-forget). */
export async function recordMastery(
  syllabusId: string,
  outcomes: { label: string; correct: boolean }[],
) {
  return request<{ success: true }>(`/mastery`, {
    method: "POST",
    body: JSON.stringify({ syllabus_id: syllabusId, outcomes }),
  })
}

/** Per-topic mastery for one course. */
export async function fetchMastery(syllabusId: string) {
  return request<{ syllabus_id: string; topics: MasteryTopicAPI[] }>(
    `/mastery/${encodeURIComponent(syllabusId)}`,
    { method: "GET", json: false },
  )
}

/** Course-level mastery overview across all the user's courses. */
export async function fetchMasteryOverview() {
  return request<{ courses: CourseMasteryAPI[] }>(`/mastery`, { method: "GET", json: false })
}

// ============================================================================
// Agenda — per-date notes
// ============================================================================

export interface DateNoteAPI {
  id: string
  note_date: string // yyyy-mm-dd
  body: string
  created_at: string
  updated_at: string
}

/** Distinct days the user has notes on (for calendar markers). */
export async function listNoteDates() {
  return request<{ dates: string[] }>(`/notes?dates=1`, { method: "GET", json: false })
}

/** List the user's notes for one day. */
export async function listNotes(date: string) {
  return request<{ notes: DateNoteAPI[] }>(`/notes?date=${encodeURIComponent(date)}`, {
    method: "GET",
    json: false,
  })
}

/** Create a note on a day. */
export async function createNote(date: string, body: string) {
  return request<{ note: DateNoteAPI }>(`/notes`, {
    method: "POST",
    body: JSON.stringify({ note_date: date, body }),
  })
}

/** Edit a note the user owns. */
export async function updateNote(id: string, body: string) {
  return request<{ note: DateNoteAPI }>(`/notes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  })
}

/** Delete a note the user owns. */
export async function deleteNote(id: string) {
  return request<{ success: true }>(`/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    json: false,
  })
}
