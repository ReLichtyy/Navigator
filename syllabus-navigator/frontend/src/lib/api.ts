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
  SuggestedPromptAPI,
  ChatOutAPI,
  ChatDetailAPI,
  MessageOutAPI,
  SyllabusUploadAPI,
  GraphResponseAPI,
  CourseGraphResponseAPI,
  CourseAPI,
  ProductFeedbackCategoryAPI,
  ProductFeedbackSubmissionAPI,
  ProductFeedbackReceiptAPI,
} from "@/types/api"

export type {
  CitationAPI,
  SuggestedPromptAPI,
  ChatOutAPI,
  ChatDetailAPI,
  MessageOutAPI,
  SyllabusUploadAPI,
  GraphResponseAPI,
  CourseGraphResponseAPI,
  CourseAPI,
  ProductFeedbackCategoryAPI,
  ProductFeedbackSubmissionAPI,
  ProductFeedbackReceiptAPI,
}

export interface UserStudyPrefsAPI {
  difficulty?: "Fácil" | "Media" | "Difícil" | "Adaptativa"
  cardFormat?: "Pregunta y respuesta" | "Rellenar huecos" | "Definición" | "Mixto"
  questionCount?: 5 | 10 | 15
  sessionLen?: 15 | 25 | 45
  spaced?: boolean
  mixSubjects?: boolean
}

export interface UserProfileAPI {
  fullName?: string
  displayName?: string
  career?: string
  school?: string
  level?: "Secundaria" | "Preparatoria" | "Universidad" | "Posgrado" | "Autodidacta"
  tone?: "Cercano" | "Neutro" | "Directo"
  detail?: "Conciso" | "Equilibrado" | "Detallado"
  study?: UserStudyPrefsAPI
}

export interface UserPreferencesAPI {
  defaultProvider: string
  defaultModel: string
  theme?: "dark" | "light" | "system"
  language: string
  profile?: UserProfileAPI
  /** Custom avatar (users.image). Read-only here — managed via upload/removeAvatar. */
  avatarUrl?: string | null
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

export async function newChat(syllabusId?: string, courseId?: string) {
  return request<ChatOutAPI>("/chat/history", {
    method: "POST",
    body: JSON.stringify({
      ...(syllabusId ? { syllabus_id: syllabusId } : {}),
      ...(courseId ? { course_id: courseId } : {}),
    }),
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
  id?: string
  title?: string
  citations?: CitationAPI[]
  suggestions?: SuggestedPromptAPI[]
  provider?: string
  model?: string
}

export async function querySyllabus(
  syllabusId: string | null,
  question: string,
  chatId: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  opts?: { web?: boolean },
): Promise<StreamResult> {
  const res = await fetch(`${API_BASE}/chat/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...(opts?.web ? { web: true } : {}) }),
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
          if (
            parsed.id !== undefined ||
            parsed.title !== undefined ||
            parsed.citations !== undefined ||
            parsed.suggestions !== undefined
          ) {
            result = {
              id: parsed.id,
              title: parsed.title,
              citations: parsed.citations ?? [],
              suggestions: parsed.suggestions ?? [],
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

// Extension → canonical MIME, so the Blob token route (allowedContentTypes) and
// the server-side type detection both see a definite type even when the browser
// reports an empty/generic file.type.
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

/**
 * Upload via Vercel Blob client upload: the file goes straight from the browser
 * to Blob (no ~4.5MB serverless body limit), then we hand the URL to the server
 * to ingest. Accounts only (the token route rejects guests). Lazy-imports the
 * blob client so it isn't in the bundle for guests / the multipart path.
 */
// Largest file we can send through the multipart fallback: Vercel caps the
// serverless request body at ~4.5MB. Bigger files MUST use the Blob path.
const MULTIPART_MAX = 4 * 1024 * 1024

export async function uploadSyllabusViaBlob(file: File) {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""
  const contentType = EXT_MIME[ext] ?? file.type ?? "application/octet-stream"

  let blobUrl: string
  try {
    const { upload } = await import("@vercel/blob/client")
    const blob = await upload(file.name, file, {
      // Documents live in the PRIVATE store — never a public URL. They're served
      // back through the authed proxy route (/api/upload/[id]/file). The token
      // route mints a private-store client token to match.
      access: "private",
      handleUploadUrl: `${API_BASE}/upload/blob`,
      contentType,
    })
    blobUrl = blob.url
  } catch (err) {
    // The Blob client-token handshake can fail (missing/rotated BLOB token, or the
    // token route is unreachable). For files within the serverless body limit, fall
    // back to a direct multipart upload — no client token needed. Bigger files have
    // no fallback, so surface the original error.
    if (file.size <= MULTIPART_MAX) return uploadSyllabus(file)
    throw err
  }

  return request<{ syllabus_id: string; status: string; message: string }>("/upload/from-blob", {
    method: "POST",
    body: JSON.stringify({ url: blobUrl, filename: file.name, contentType }),
  })
}

/**
 * Kick the slow enrichment (graph + schedule + course inference) for a just-
 * uploaded doc. Upload routes only embed inline (fast); this runs the heavy
 * gpt-5.4 generators. Fire-and-forget — the caller does NOT await it; the
 * knowledge page polls graph_status to reflect the result when ready.
 */
export async function processDocument(id: string) {
  return request<{ ok: boolean }>(`/upload/${encodeURIComponent(id)}/process`, {
    method: "POST",
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

/** Update a course: rename, recolor and/or set its term start ("Semana N" anchor). */
export async function updateCourse(
  courseId: string,
  patch: { name?: string; color?: string | null; term_start?: string | null },
) {
  return request<{ course: CourseAPI }>(`/courses/${encodeURIComponent(courseId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

/** Rename a course. */
export async function renameCourse(courseId: string, name: string) {
  return updateCourse(courseId, { name })
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

export async function uploadAvatar(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<{ url: string }>("/user/avatar", { method: "POST", body: form, json: false })
}

export async function removeAvatar() {
  return request<{ ok: boolean }>("/user/avatar", { method: "DELETE", json: false })
}

/** Delete the caller's Neon account data (Clerk deletion is done client-side after). */
export async function deleteAccount() {
  return request<{ ok: boolean }>("/user", { method: "DELETE", json: false })
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

export async function submitProductFeedback(input: ProductFeedbackSubmissionAPI) {
  return request<ProductFeedbackReceiptAPI>("/product-feedback", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

// ============================================================================
// Graph
// ============================================================================

export async function fetchGraph(syllabusId: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, { method: "GET", json: false })
}

export interface GraphUpdatePayload {
  nodes: {
    id: string
    label: string
    weight_percent?: number | null
    level?: number
    parentId?: string | null
    detail?: string | null
  }[]
  edges: { source: string; target: string }[]
  crossLinks?: { source: string; target: string; label: string }[]
}

/**
 * Replace the graph with a user-edited version (manual mind-map edits).
 * Node ids are the existing topic UUIDs, or temp ids for new nodes — the
 * server re-keys them, so consume the returned graph. 400 = cycle.
 */
export async function updateGraph(syllabusId: string, graph: GraphUpdatePayload) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}`, {
    method: "PATCH",
    body: JSON.stringify(graph),
  })
}

export async function reprocessGraph(syllabusId: string) {
  return request<GraphResponseAPI>(`/graph/${syllabusId}/reprocess`, {
    method: "POST",
    json: false,
  })
}

/** Whole-course mind map. graph_status "none" = never generated yet. */
export async function fetchCourseGraph(courseId: string) {
  return request<CourseGraphResponseAPI>(`/graph/course/${courseId}`, {
    method: "GET",
    json: false,
  })
}

export interface CourseGraphRegeneratePayload {
  /** Course documents that feed the map (the drawer's multi-select). */
  fileIds: string[]
  focusTopics?: string[]
  instructions?: string
}

/** (Re)generate the course map from the selected documents. Synchronous. */
export async function regenerateCourseGraph(
  courseId: string,
  payload: CourseGraphRegeneratePayload,
) {
  return request<CourseGraphResponseAPI>(`/graph/course/${courseId}/regenerate`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** Save a user-edited course map (same payload shape as the per-doc PATCH). */
export async function updateCourseGraph(courseId: string, graph: GraphUpdatePayload) {
  return request<CourseGraphResponseAPI>(`/graph/course/${courseId}`, {
    method: "PATCH",
    body: JSON.stringify(graph),
  })
}

export type GraphAskRefine = "concise" | "detail" | "translate" | "regenerate"

export interface GraphAskPayload {
  question?: string
  /** Scope: course map or the per-doc ("sin curso") fallback map. */
  courseId?: string
  syllabusId?: string
  /** Refine the previous answer instead of asking anew (quick chips). */
  refine?: GraphAskRefine
  previousAnswer?: string
  lang?: string
}

/** Inline "ask about this mind map" → a short grounded answer for the canvas bubble. */
export async function askGraph(payload: GraphAskPayload) {
  return request<{ answer: string }>(`/graph/ask`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/** Find an existing chat bound to this syllabus, or create one. */
export async function findOrCreateChatForDoc(syllabusId: string) {
  return request<ChatOutAPI>(`/chat/by-document/${encodeURIComponent(syllabusId)}`, {
    method: "POST",
    json: false,
  })
}

/**
 * How much the server trusts an event's `event_date`:
 *   - `exact` — a real date, from the syllabus.
 *   - `week`  — derived from "Semana N" + the course's term_start, so it is the
 *               MONDAY of that week, not the day the event happens. Right week,
 *               placeholder day: never render it as "Hoy" / "En 2 días".
 *   - `none`  — undated.
 */
export type DatePrecisionAPI = "exact" | "week" | "none"

/**
 * The browser's IANA zone (e.g. "America/Lima"). Sent with every date-bearing
 * request: the server runs in UTC, so without it "today" and "this week" are
 * computed in the wrong calendar (see server/utils/today.ts).
 */
function timeZoneParam(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz ? `tz=${encodeURIComponent(tz)}` : ""
  } catch {
    return ""
  }
}

export interface ScheduleEventAPI {
  id: string
  syllabus_id: string
  /** Real course id (null when the doc isn't filed into a course yet). */
  course_id: string | null
  /** Course name when filed, else the source filename. */
  course_name: string
  /** Source document the date came from (original filename). */
  doc_name: string
  /** The course's persisted color (hex); null → the UI falls back to a hash. */
  course_color: string | null
  event_type: string
  title: string
  description: string | null
  event_date: string | null
  week_label: string | null
  date_precision: DatePrecisionAPI
  weight_percent: number | null
}

/** Upcoming agenda across all the user's courses. `today` is in the caller's zone. */
export async function fetchAgenda() {
  const tz = timeZoneParam()
  return request<{ today: string; events: ScheduleEventAPI[] }>(`/schedule${tz ? `?${tz}` : ""}`, {
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
  syllabus_id: string
  course_id: string | null
  course_name: string
  /** The course's persisted color (hex); null → the UI falls back to a hash. */
  course_color: string | null
  event_type: string
  title: string
  event_date: string | null
  week_label: string | null
  date_precision: DatePrecisionAPI
  weight_percent: number | null
  /** Days from today. Only meaningful when `date_precision === "exact"`. */
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
  const tz = timeZoneParam()
  return request<WeeklyPlanAPI>(`/recommendations${tz ? `?${tz}` : ""}`, {
    method: "GET",
    json: false,
  })
}

// ============================================================================
// Study OS — Área de Estudio (flashcards / quiz / summary / mind map)
// ============================================================================

export interface FlashcardAPI {
  front: string
  back: string
}

/**
 * Question kinds. `mc` (multiple choice) is the only one the generator emits
 * today; the others are the redesigned exercise formats (AreaEstudio.dc) the UI
 * already knows how to render, wired for a later generation phase. Absent → `mc`.
 */
export type QuizKind = "mc" | "conex" | "order" | "fill" | "vf"

export interface QuizQuestionAPI {
  question: string
  options: string[]
  answer: number
  explanation: string
  /** Topic this question assesses — feeds the mastery ledger. Absent on old cached sets. */
  topic?: string
  /** Bank item id — present for staged-quiz questions (used to exclude served items). */
  id?: string
  // ── Redesign (AreaEstudio.dc) — all optional; the UI degrades when absent ──
  /** Exercise format. Defaults to `"mc"` when missing. */
  kind?: QuizKind
  /** Bullet reasons the correct option is right ("POR QUÉ SÍ"). Falls back to `explanation`. */
  whyYes?: string[]
  /** Per-wrong-option reasons ("POR QUÉ NO LA TUYA"), keyed by the option index as a string. */
  whyNo?: Record<string, string[]>
  /** Source citation shown as a chip, e.g. "Repaso DML · p.4". */
  cite?: string
  /** One-line "what to reinforce" used in the results "puntos que mejorar" list. */
  improve?: string
  /** `conex` pairs: left concept → right definition (correct pairing). */
  pairs?: { l: string; r: string }[]
  /** `conex` display order of the right column (indexes into `pairs`). */
  rightOrder?: number[]
  /** `order` steps in the CORRECT order (the UI shuffles for display). */
  steps?: string[]
  /** `fill` text/code with a `_____` gap the student completes. */
  fillText?: string
  /** `fill` accepted answers (normalized comparison; first one shown as the model answer). */
  fillAnswers?: string[]
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
  summary: {
    titulo: string
    temaPrincipal: string
    introduccion: string
    ideasPrincipales: string[]
    conceptos: { termino: string; definicion: string }[]
    conclusion: string
  }
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
  /** Augment generation with a live web search (always fresh, never cached). */
  web?: boolean
  /** Cancel an obsolete request when the visible study scope changes. */
  signal?: AbortSignal
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
  if (opts.web) qs.set("web", "1")
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return request<StudySetAPI>(`/study/${encodeURIComponent(syllabusId)}${suffix}`, {
    method: "GET",
    json: false,
    signal: opts.signal,
  })
}

/**
 * Whole-course study material: aggregates every PDF in a course into one set.
 * Same options/caching as fetchStudySet but keyed by the real course id.
 */
export async function fetchCourseStudySet(courseId: string, opts: StudySetOptions = {}) {
  const qs = new URLSearchParams()
  if (opts.refresh) qs.set("refresh", "1")
  if (opts.difficulty && opts.difficulty !== "medio") qs.set("difficulty", opts.difficulty)
  if (opts.topic?.trim()) qs.set("topic", opts.topic.trim())
  if (opts.web) qs.set("web", "1")
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return request<StudySetAPI>(`/study/course/${encodeURIComponent(courseId)}${suffix}`, {
    method: "GET",
    json: false,
    signal: opts.signal,
  })
}

/** Light study status for the estudio menu (SQL-only server side, never generates). */
export interface StudyStatusAPI {
  /** The default (medio) set is cached and fresh — safe to hydrate silently. */
  cached: boolean
  /** Bank item counts for the scope. */
  flashcards: number
  quiz: number
}

/**
 * Fetch the study status for a PDF or a whole course: bank counts + whether the
 * default set is cached. Cheap — lets the menu render before anything generates.
 */
export async function fetchStudyStatus(
  scope: { kind: "doc"; docId: string } | { kind: "course"; courseId: string },
) {
  const base =
    scope.kind === "doc"
      ? `/study/${encodeURIComponent(scope.docId)}/status`
      : `/study/course/${encodeURIComponent(scope.courseId)}/status`
  return request<StudyStatusAPI>(base, { method: "GET", json: false })
}

export interface StudyStatsAPI {
  streakDays: number
  cardsThisWeek: number
}

/** Study streak + cards reviewed this week (sidebar). */
export async function fetchStudyStats() {
  return request<StudyStatsAPI>(`/study/stats`, { method: "GET", json: false })
}

/** One escalating stage of the staged quiz (`size` to clear + buffer). */
export interface QuizStageAPI {
  stage: number
  stages: number
  difficulty: StudyDifficulty
  /** Ladder index stage 0 starts from (0=fácil, 1=medio, 2=difícil) → lets the client know if the next stage is really harder. */
  base?: number
  /** Correct answers required to clear the stage (user pref; server default 15). */
  size?: number
  questions: QuizQuestionAPI[]
  /** A background fill job is still producing questions → keep polling for more. */
  generating?: boolean
  /** Bank exhausted (no items, nothing recyclable) → show the "done" state. */
  exhausted?: boolean
}

export interface QuizStageOptions {
  stage: number
  /** Escalation boost earned by acing prior stages (0..2). */
  boost?: number
  /** Bank ids already served this run (excluded so stages/swaps don't repeat). */
  excludeIds?: string[]
}

/**
 * Fetch one stage of the staged quiz. `scope` selects a single PDF or a whole
 * course. Questions are generated lazily server-side, so the first call for a new
 * difficulty may take a few seconds; subsequent ones are bank-served.
 */
export async function fetchQuizStage(
  scope: { kind: "doc"; docId: string } | { kind: "course"; courseId: string },
  opts: QuizStageOptions,
) {
  const qs = new URLSearchParams({ stage: String(opts.stage) })
  if (opts.boost) qs.set("boost", String(opts.boost))
  if (opts.excludeIds && opts.excludeIds.length > 0) qs.set("exclude", opts.excludeIds.join(","))
  const base =
    scope.kind === "doc"
      ? `/study/${encodeURIComponent(scope.docId)}/quiz-stage`
      : `/study/course/${encodeURIComponent(scope.courseId)}/quiz-stage`
  return request<QuizStageAPI>(`${base}?${qs.toString()}`, { method: "GET", json: false })
}

// ── Examen: single-page sectioned exam (Examen mode) ─────────────────────────

export type ExamTemplateIdAPI = "teorico" | "practico" | "mixto"

/** The exam paper as the client sees it — no answers, references or rubrics. */
export interface ExamPaperAPI {
  attempt_id: string
  template: ExamTemplateIdAPI
  durationSec: number
  totalPoints: number
  sections: {
    kind: "mcq" | "short" | "dev"
    label: string
    pointsPerItem: number
    items: { key: string; question: string; options?: string[] }[]
  }[]
}

export interface ExamResultItemAPI {
  key: string
  question: string
  score: number
  max: number
  correct: boolean
  yourAnswer: string
  feedback?: string
  correctAnswer?: string
  expectedAnswer?: string
  modelSolution?: string
}

export interface ExamResultAPI {
  attempt_id: string
  template: ExamTemplateIdAPI
  total: number
  maxTotal: number
  sections: { kind: "mcq" | "short" | "dev"; label: string; items: ExamResultItemAPI[] }[]
}

export interface ExamAnswerAPI {
  key: string
  /** MCQ → selected option index; short/dev → free text. */
  response: number | string
}

/**
 * Start an exam attempt. SLOW on a cold scope (short/development items are
 * generated on demand); MCQ comes from the shared quiz bank.
 */
export async function fetchExam(
  scope: { kind: "doc"; docId: string } | { kind: "course"; courseId: string },
  opts: { template?: ExamTemplateIdAPI } = {},
) {
  const qs = new URLSearchParams()
  if (opts.template) qs.set("template", opts.template)
  const base =
    scope.kind === "doc"
      ? `/study/${encodeURIComponent(scope.docId)}/exam`
      : `/study/course/${encodeURIComponent(scope.courseId)}/exam`
  const suffix = qs.size > 0 ? `?${qs.toString()}` : ""
  return request<ExamPaperAPI>(`${base}${suffix}`, { method: "GET", json: false })
}

/**
 * Submit the exam for grading (submit-once; re-posting a graded attempt returns
 * the stored result). SLOW: open answers go through the LLM grader.
 */
export async function gradeExam(
  scope: { kind: "doc"; docId: string } | { kind: "course"; courseId: string },
  attemptId: string,
  answers: ExamAnswerAPI[],
) {
  const p =
    scope.kind === "doc"
      ? { kind: "doc" as const, id: scope.docId }
      : { kind: "course" as const, id: scope.courseId }
  return request<ExamResultAPI>(`/study/exam/grade`, {
    method: "POST",
    body: JSON.stringify({ ...p, attemptId, answers }),
  })
}

// ── Repaso: the queue of failed quiz questions ───────────────────────────────

type QuizScope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

const scopeParams = (s: QuizScope) =>
  s.kind === "doc"
    ? { kind: "doc" as const, id: s.docId }
    : { kind: "course" as const, id: s.courseId }

/**
 * Cooldown per scope. A warm call costs a real LLM generation, and the callers are
 * effects that re-run on remount, scope re-select, tab focus, back-navigation… —
 * without this, wandering around the estudio page would quietly rack up a bill.
 * Server-side the call is already free once the bank is warm, but "free" still
 * means an HTTP round trip and two counts per fire.
 */
// 90s: long enough that idling on the menu can't spam it, short enough that each
// stage of a quiz (~2-3 min) still gets one warm. The real spend ceiling is the
// server's WARM_TARGET — once a rung holds enough questions the call is free.
const WARM_COOLDOWN_MS = 90 * 1000
const lastWarm = new Map<string, number>()

/**
 * Fill the question bank in the background. SLOW (it runs LLM generation) — call
 * it while the student is idle and NEVER await it, otherwise you just moved the
 * wait. Fire it when a scope is picked and after each stage loads: by the time the
 * student needs more questions, the bank already has them.
 *
 * Rate-limited per scope (see WARM_COOLDOWN_MS) and a no-op on the server, so
 * callers can fire it freely from effects.
 */
export function warmStudyBank(scope: QuizScope): void {
  if (typeof window === "undefined") return
  const p = scopeParams(scope)
  const key = `${p.kind}:${p.id}`
  const now = Date.now()
  const last = lastWarm.get(key) ?? 0
  if (now - last < WARM_COOLDOWN_MS) return
  lastWarm.set(key, now)

  void request<{ drained: number }>(`/study/warm`, {
    method: "POST",
    body: JSON.stringify(p),
  }).catch(() => {
    // Best-effort: the serve path still generates on demand if this never lands.
  })
}

/** Record a wrong quiz answer → it leaves the quiz and enters Repaso (fire-and-forget). */
export async function recordQuizFail(scope: QuizScope, question: QuizQuestionAPI) {
  return request<{ success: true }>(`/study/quiz-review`, {
    method: "POST",
    body: JSON.stringify({ ...scopeParams(scope), question }),
  })
}

/**
 * Mark quiz bank items as served to the user so a later session never repeats
 * them (fire-and-forget). Called at stage/quiz end with the answered ids.
 */
export async function markQuizSeen(scope: QuizScope, itemIds: string[]) {
  if (itemIds.length === 0) return
  return request<{ success: true }>(`/study/quiz-seen`, {
    method: "POST",
    body: JSON.stringify({ ...scopeParams(scope), itemIds }),
  })
}

/** The user's Repaso queue (failed quiz questions still to re-master) for a scope. */
export async function fetchQuizReview(scope: QuizScope) {
  const p = scopeParams(scope)
  const qs = new URLSearchParams({ kind: p.kind, id: p.id })
  return request<{ questions: QuizQuestionAPI[] }>(`/study/quiz-review?${qs.toString()}`, {
    method: "GET",
    json: false,
  })
}

/** Resolve a Repaso question (answered correctly) so it drops out of the queue. */
export async function resolveQuizReview(scope: QuizScope, question: string) {
  return request<{ success: true }>(`/study/quiz-review`, {
    method: "PATCH",
    body: JSON.stringify({ ...scopeParams(scope), question }),
  })
}

/** The adaptive "today session": due SRS cards + plan-ordered bank items. */
export interface StudySessionAPI {
  dueCount: number
  /** Stable keys (flashcardKey) of cards due for review today. */
  dueCardKeys: string[]
  flashcards: FlashcardAPI[]
  quiz: QuizQuestionAPI[]
  targets: { label: string; priority: number; mastery: number }[]
}

/**
 * Adaptive session for one PDF: spaced-repetition due cards + bank items ordered
 * by the Router's topic priority (weak/urgent/heavy first). Doc scope only — SRS
 * and mastery are tracked per syllabus.
 */
export async function fetchStudySession(syllabusId: string) {
  return request<StudySessionAPI>(`/study/session?syllabusId=${encodeURIComponent(syllabusId)}`, {
    method: "GET",
    json: false,
  })
}

/** Stable key for a flashcard, surviving study-set regeneration. */
export function flashcardKey(front: string): string {
  let h = 0
  for (let i = 0; i < front.length; i++) {
    h = (Math.imul(31, h) + front.charCodeAt(i)) | 0
  }
  return `c${(h >>> 0).toString(36)}`
}

/** Record a flashcard review (fire-and-forget on the client). Scope-based: whole-course cards count too. */
export async function recordFlashcardReview(scope: QuizScope, cardFront: string, known: boolean) {
  return request<{ success: true }>(`/study/review`, {
    method: "POST",
    body: JSON.stringify({
      ...scopeParams(scope),
      card_key: flashcardKey(cardFront),
      known,
    }),
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

/** Record a batch of quiz outcomes against a scope's topics (fire-and-forget). */
export async function recordMastery(
  scope: QuizScope,
  outcomes: { label: string; correct: boolean }[],
) {
  return request<{ success: true }>(`/mastery`, {
    method: "POST",
    body: JSON.stringify({ ...scopeParams(scope), outcomes }),
  })
}

/** Per-topic mastery for one course. */
export async function fetchMastery(syllabusId: string) {
  return request<{ syllabus_id: string; topics: MasteryTopicAPI[] }>(
    `/mastery/${encodeURIComponent(syllabusId)}`,
    { method: "GET", json: false },
  )
}

// ============================================================================
// Agenda — per-date notes
// ============================================================================

export interface DateNoteAPI {
  id: string
  note_date: string // yyyy-mm-dd
  title: string | null
  color: string | null
  body: string
  created_at: string
  updated_at: string
}

/** Distinct days the user has notes on (for calendar markers). */
export async function listNoteDates() {
  return request<{ dates: string[] }>(`/notes?dates=1`, { method: "GET", json: false })
}

/** The user's newest notes across all dates (Knowledge quick-notes panel). */
export async function listRecentNotes(limit = 10) {
  return request<{ notes: DateNoteAPI[] }>(`/notes?recent=${limit}`, {
    method: "GET",
    json: false,
  })
}

/** List the user's notes for one day. */
export async function listNotes(date: string) {
  return request<{ notes: DateNoteAPI[] }>(`/notes?date=${encodeURIComponent(date)}`, {
    method: "GET",
    json: false,
  })
}

/** Create a note on a day. */
export async function createNote(
  date: string,
  body: string,
  metadata: { title?: string; color?: string } = {},
) {
  return request<{ note: DateNoteAPI }>(`/notes`, {
    method: "POST",
    body: JSON.stringify({ note_date: date, body, ...metadata }),
  })
}

/** Edit a note the user owns. */
export async function updateNote(
  id: string,
  updates: string | { body?: string; title?: string; color?: string },
) {
  return request<{ note: DateNoteAPI }>(`/notes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(typeof updates === "string" ? { body: updates } : updates),
  })
}

/** Delete a note the user owns. */
export async function deleteNote(id: string) {
  return request<{ success: true }>(`/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    json: false,
  })
}

// ============================================================================
// Knowledge — archivo de temas (topics grouped by course)
// ============================================================================

export interface TopicsArchiveCourseAPI {
  course_id: string | null
  course_name: string | null
  course_color: string | null
  topics: string[]
}

/** All generated topics the user owns, grouped by course. */
export async function fetchTopicsArchive() {
  return request<{ courses: TopicsArchiveCourseAPI[] }>(`/topics`, { method: "GET", json: false })
}
