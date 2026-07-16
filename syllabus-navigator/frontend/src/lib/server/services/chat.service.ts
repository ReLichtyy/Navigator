import { validateInput, validateOutput } from "@/lib/guardrails"
import { getPrompt } from "@/lib/prompts"
import { chatCompletion, selectModel } from "@/lib/llm"
import { recordUsage } from "@/lib/metering"
import { estimateCost } from "@/lib/llm/config"
import { getRateLimitTier, type Role } from "@/lib/auth/rbac"
import { timed } from "@/lib/observability/timing"
import { logError } from "@/lib/observability/logger"
import { ChatRepository } from "../repositories/chat.repo"
import { ScheduleRepository, type ScheduleEvent } from "../repositories/schedule.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { getUserPrefs, type UserPrefs } from "../utils/user-prefs"
import { RetrievalService, GROUNDED_SYSTEM_PROMPT, NO_CONTEXT_MESSAGE } from "./retrieval.service"
import { webSearchContext } from "../rag/web-search"
import type { LLMMessage, LLMProvider } from "@/lib/llm"
import type { CitationAPI } from "@/types/api"
import { flags } from "@/lib/config/flags"
import { runToolLoop } from "@/lib/llm/tools-loop"
import { getToolDefinitions, executeTool } from "@/lib/tools"

const MAX_HISTORY_TURNS = 6
const MAX_AGENDA_ITEMS = 40

/** Local (server-tz) date as YYYY-MM-DD. */
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatAgendaLine(e: ScheduleEvent): string {
  const when = e.event_date ?? e.week_label ?? "sin fecha"
  const weight = e.weight_percent ? ` (${e.weight_percent}%)` : ""
  return `- [${e.event_type}] ${when} · ${e.course_name} · ${e.title}${weight}`
}

/**
 * Build a compact agenda block from the student's upcoming events across ALL
 * their courses, plus today's date, so the chat can answer schedule questions
 * ("quizzes this week", "topics this week") at any time — independent of which
 * syllabus the chat is bound to.
 */
async function buildScheduleContext(userId: string): Promise<string> {
  const today = todayISO()
  let events: ScheduleEvent[] = []
  try {
    events = await ScheduleRepository.listAgendaByUser(userId, today, MAX_AGENDA_ITEMS)
  } catch {
    return `Hoy es ${today}.`
  }
  if (events.length === 0) {
    return `Hoy es ${today}. El estudiante no tiene una agenda extraída todavía.`
  }
  return (
    `Hoy es ${today}.\n` +
    `Agenda del estudiante (próximos eventos de todos sus cursos; las fechas son ISO YYYY-MM-DD):\n` +
    events.map(formatAgendaLine).join("\n") +
    `\n\nUsa esta agenda para responder sobre fechas, "esta semana", próximos quizes/exámenes ` +
    `y temas por semana. Para "esta semana", calcula el rango lunes-domingo respecto a hoy. ` +
    `Si un evento solo tiene week_label (sin fecha ISO), trátalo como relativo. No inventes fechas.`
  )
}

const TONE_DIRECTIVE: Record<string, string> = {
  Cercano:
    "Tono: cercano y cálido — háblale de tú, celebra sus avances y usa un lenguaje amigable.",
  Neutro: "Tono: neutro y profesional — amable pero sobrio, sin exceso de entusiasmo.",
  Directo:
    "Tono: directo — ve al grano, sin rodeos ni frases de relleno; prioriza la respuesta sobre la cortesía.",
}

const DETAIL_DIRECTIVE: Record<string, string> = {
  Conciso:
    "Extensión: concisa — respuestas breves, lo esencial primero; expande solo si el estudiante lo pide.",
  Equilibrado:
    "Extensión: equilibrada — explica lo necesario con algún ejemplo, sin extenderte de más.",
  Detallado:
    "Extensión: detallada — explica paso a paso, con ejemplos y contexto adicional cuando ayude.",
}

/**
 * Personalization block from the user's saved profile (Configuración → Perfil):
 * tone/detail directives + who the student is. Empty string when the profile
 * has nothing useful, so the base prompt stays untouched for new users. Pure.
 */
export function buildStudentDirectives(prefs: UserPrefs): string {
  const p = prefs.profile
  const lines: string[] = []
  // Configuración → Perfil → "Idioma de la app". Only emitted for a non-Spanish
  // preference so existing Spanish behavior/tests are untouched by default.
  const lang = prefs.language?.trim().toLowerCase()
  if (lang && lang !== "es") {
    lines.push(
      `Idioma: responde SIEMPRE en "${lang}" (preferencia guardada del estudiante), sin importar ` +
        `el idioma del material citado ni el de la última pregunta.`,
    )
  }
  if (p.tone && TONE_DIRECTIVE[p.tone]) lines.push(TONE_DIRECTIVE[p.tone])
  if (p.detail && DETAIL_DIRECTIVE[p.detail]) lines.push(DETAIL_DIRECTIVE[p.detail])

  const who: string[] = []
  const name = p.displayName?.trim() || p.fullName?.trim()
  if (name) who.push(`se llama ${name} (dirígete así a él/ella)`)
  if (p.career?.trim()) who.push(`estudia ${p.career.trim()}`)
  if (p.level) who.push(`nivel: ${p.level}`)
  if (p.school?.trim()) who.push(`en ${p.school.trim()}`)
  if (who.length > 0) lines.push(`Sobre el estudiante: ${who.join("; ")}.`)

  if (lines.length === 0) return ""
  return `=== PERFIL DEL ESTUDIANTE (preferencias guardadas) ===\n${lines.join("\n")}`
}

/**
 * Actions & Tools layer entry for chat. When TOOLS_ENABLED is on, run a
 * non-streamed tool-calling pass over the prepared messages: the model may call
 * tools (schedule, recommendations, study set, review), we execute them and
 * fold the results back as an extra system note so the streamed answer is
 * grounded in real data. Returns the (possibly) augmented messages + usage.
 *
 * Degrades to a no-op (returns input messages unchanged) when the flag is off,
 * no tools are registered, or the loop errors — the live chat path never breaks.
 */
async function resolveToolsIfEnabled(
  messages: LLMMessage[],
  config: { provider: LLMProvider; model: string },
  ctx: { userId: string; syllabusId: string | null; chatId: string },
): Promise<{
  messages: LLMMessage[]
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  const noUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  if (!flags.toolsEnabled) return { messages, usage: noUsage }

  try {
    const loop = await runToolLoop(
      messages,
      { provider: config.provider, model: config.model },
      getToolDefinitions(),
      (name, args) =>
        executeTool(name, args, {
          userId: ctx.userId,
          syllabusId: ctx.syllabusId ?? undefined,
          chatId: ctx.chatId,
        }),
    )
    if (!loop.transcript) return { messages, usage: loop.usage }
    // Inject tool results as a trailing system note (kept distinct from the
    // grounded syllabus context so the model can tell them apart).
    const augmented: LLMMessage[] = [
      ...messages,
      { role: "system", content: `=== RESULTADOS DE HERRAMIENTAS ===\n${loop.transcript}` },
    ]
    return { messages: augmented, usage: loop.usage }
  } catch (err) {
    logError("chat.tools_resolve.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return { messages, usage: noUsage }
  }
}

export const ChatService = {
  /**
   * Build the LLM messages for a turn. If the chat is bound to a syllabus, run
   * retrieval and inject the grounded context + return citations; otherwise fall
   * back to the plain chat prompt.
   */
  async prepareMessages(
    syllabusId: string | null,
    courseId: string | null,
    userId: string,
    recentHistory: { role: string; content: string }[],
    question: string,
    opts: { web?: boolean } = {},
  ): Promise<{ messages: LLMMessage[]; citations: CitationAPI[] }> {
    let systemContent = getPrompt("chat:general").system
    let userContent = question
    let citations: CitationAPI[] = []

    // Web augmentation (composer "Web" toggle): run the live search now, in
    // parallel with retrieval below — both are independent network calls.
    // Best-effort: webSearchContext resolves to null on any failure.
    const webPromise = opts.web ? webSearchContext(question) : Promise.resolve(null)

    if (courseId) {
      const retrieval = await RetrievalService.retrieveForCourse(userId, courseId, question)
      systemContent = GROUNDED_SYSTEM_PROMPT
      if (retrieval.hasContext) {
        userContent = RetrievalService.buildGroundedUserContent(retrieval.contextBlock, question)
        citations = retrieval.citations
      } else {
        userContent = `No encontrÃ© material relevante dentro de este curso.\n\nPregunta: ${question}`
      }
    } else if (syllabusId) {
      // Chat bound to one course → retrieve within that syllabus.
      const retrieval = await RetrievalService.retrieve(syllabusId, question)
      systemContent = GROUNDED_SYSTEM_PROMPT
      if (retrieval.hasContext) {
        userContent = RetrievalService.buildGroundedUserContent(retrieval.contextBlock, question)
        citations = retrieval.citations
      } else {
        // No syllabus match. Schedule questions are answered from the injected
        // agenda below, so don't hard-decline — just note the text had no match.
        userContent =
          `No encontré fragmentos del sílabo relevantes para esta pregunta; ` +
          `si es sobre fechas/agenda usa la agenda del sistema, de lo contrario ` +
          `responde: "${NO_CONTEXT_MESSAGE}"\n\nPregunta: ${question}`
      }
    } else {
      // Unbound chat → retrieve across ALL the user's courses so the assistant
      // can answer content questions without picking a syllabus first.
      const retrieval = await RetrievalService.retrieveForUser(userId, question)
      if (retrieval.hasContext) {
        systemContent = GROUNDED_SYSTEM_PROMPT
        userContent = RetrievalService.buildGroundedUserContent(retrieval.contextBlock, question)
        citations = retrieval.citations
      }
      // else: keep the general prompt (no course content matched).
    }

    // Schedule awareness: prepend today's date + the student's cross-course
    // agenda so "what quizzes/topics this week?" works in any chat. The saved
    // profile (tone/detail/who the student is) rides along; both reads are
    // independent, so run them in parallel (prefs are cached 120s).
    const [scheduleContext, prefs, webContext] = await Promise.all([
      buildScheduleContext(userId),
      getUserPrefs(userId),
      webPromise,
    ])
    const studentDirectives = buildStudentDirectives(prefs)
    if (studentDirectives) systemContent = `${systemContent}\n\n${studentDirectives}`
    systemContent = `${systemContent}\n\n=== AGENDA / CRONOGRAMA ===\n${scheduleContext}`
    if (webContext) {
      systemContent =
        `${systemContent}\n\n=== CONTEXTO WEB (búsqueda en línea sobre la pregunta; ` +
        `material suplementario, cita las fuentes cuando lo uses) ===\n${webContext}`
    }

    const messages: LLMMessage[] = [{ role: "system", content: systemContent }]
    for (const msg of recentHistory) {
      messages.push({ role: msg.role === "ai" ? "assistant" : "user", content: msg.content })
    }
    messages.push({ role: "user", content: userContent })

    return { messages, citations }
  },

  async processMessage(
    chatId: string,
    userId: string,
    userRole: Role,
    question: string,
    opts: { web?: boolean } = {},
  ) {
    // 1. Input guardrails
    const inputCheck = validateInput(question)
    if (!inputCheck.passed) {
      throw new ApiErrorResponse(inputCheck.reason ?? "Input validation failed.", 400)
    }

    // 2. Verify chat ownership
    const chat = await ChatRepository.findByIdAndUser(chatId, userId)
    if (!chat) {
      throw new ApiErrorResponse("Chat not found.", 404)
    }

    // 3. Load history
    const recentHistory = await ChatRepository.getRecentHistory(chatId, MAX_HISTORY_TURNS * 2)
    // First-turn test only — a COUNT/EXISTS, not the whole history (BUG-005).
    const isFirstMessage = !(await ChatRepository.hasMessages(chatId))

    // 4. Save user message
    await ChatRepository.saveMessage(chatId, "user", question)

    // 5. Build prompt (with RAG retrieval if the chat is bound to a syllabus)
    const { messages, citations } = await this.prepareMessages(
      chat.syllabus_id,
      chat.course_id,
      userId,
      recentHistory,
      question,
      { web: opts.web },
    )

    // 6. Route model
    const routing = selectModel({
      userTier: getRateLimitTier(userRole),
      preferredModel: chat.active_model,
      preferredProvider: undefined,
    })

    // 6.5 Actions & Tools layer (gated by TOOLS_ENABLED): let the model call
    // tools, fold results into the messages before the final completion.
    const { messages: finalMessages } = await resolveToolsIfEnabled(
      messages,
      { provider: routing.provider, model: routing.model },
      { userId, syllabusId: chat.syllabus_id, chatId },
    )

    // 7. Call LLM
    const { result: llmResponse, ms: llmLatencyMs } = await timed("llm.call", () =>
      chatCompletion(finalMessages, {
        provider: routing.provider,
        model: routing.model,
      }),
    )

    // 8. Output guardrails
    const outputCheck = validateOutput(llmResponse.content)
    const finalAnswer = outputCheck.sanitized ?? llmResponse.content

    // 9. Save AI message
    await ChatRepository.saveMessage(chatId, "ai", finalAnswer, citations)

    // 10. Generate title for first message
    let title: string | undefined
    if (isFirstMessage) {
      try {
        const titlePrompt = getPrompt("chat:title-gen", { question })
        const titleResp = await chatCompletion(
          [
            { role: "system", content: titlePrompt.system },
            { role: "user", content: titlePrompt.userMessage ?? question },
          ],
          // Higher cap so reasoning models (e.g. deepseek-v4-pro) have room to
          // emit an actual title after their hidden reasoning tokens; cheaper
          // models still stop early at the end-of-title.
          { provider: routing.provider, model: routing.model, maxTokens: 512 },
        )
        title = titleResp.content.trim().replace(/^["']|["']$/g, "") || question.slice(0, 48)
        await ChatRepository.updateTitle(chatId, title)
      } catch {
        title = question.slice(0, 48)
        await ChatRepository.updateTitle(chatId, title)
      }
    }

    // 11. Record usage (fire-and-forget; recordUsage is void and self-handles errors)
    recordUsage({
      userId,
      provider: llmResponse.provider,
      model: llmResponse.model,
      promptTokens: llmResponse.usage.promptTokens,
      completionTokens: llmResponse.usage.completionTokens,
      totalTokens: llmResponse.usage.totalTokens,
      estimatedCostUsd: estimateCost(
        llmResponse.model,
        llmResponse.usage.promptTokens,
        llmResponse.usage.completionTokens,
      ),
      latencyMs: llmLatencyMs,
      chatId,
      success: true,
    })

    return {
      finalAnswer,
      title,
      citations,
      provider: llmResponse.provider,
      model: llmResponse.model,
      latencyMs: llmLatencyMs,
    }
  },

  async processMessageStream(
    chatId: string,
    userId: string,
    userRole: Role,
    question: string,
    opts: { web?: boolean } = {},
  ) {
    const { chatStream } = await import("@/lib/llm")

    // 1. Input guardrails
    const inputCheck = validateInput(question)
    if (!inputCheck.passed) {
      throw new ApiErrorResponse(inputCheck.reason ?? "Input validation failed.", 400)
    }

    // 2. Verify chat ownership
    const chat = await ChatRepository.findByIdAndUser(chatId, userId)
    if (!chat) {
      throw new ApiErrorResponse("Chat not found.", 404)
    }

    // 3. Load history
    const recentHistory = await ChatRepository.getRecentHistory(chatId, MAX_HISTORY_TURNS * 2)
    // First-turn test only — a COUNT/EXISTS, not the whole history (BUG-005).
    const isFirstMessage = !(await ChatRepository.hasMessages(chatId))

    // 4. Save user message
    await ChatRepository.saveMessage(chatId, "user", question)

    // 5. Build prompt (with RAG retrieval if the chat is bound to a syllabus)
    const { messages, citations } = await this.prepareMessages(
      chat.syllabus_id,
      chat.course_id,
      userId,
      recentHistory,
      question,
      { web: opts.web },
    )

    // 6. Route model
    const routing = selectModel({
      userTier: getRateLimitTier(userRole),
      preferredModel: chat.active_model,
      preferredProvider: undefined,
    })

    // 6.5 Actions & Tools layer (gated by TOOLS_ENABLED): resolve tool calls
    // (non-streamed) and fold results in before the streamed answer.
    const { messages: finalMessages } = await resolveToolsIfEnabled(
      messages,
      { provider: routing.provider, model: routing.model },
      { userId, syllabusId: chat.syllabus_id, chatId },
    )

    // 7. Get stream
    const startTime = Date.now()
    const stream = chatStream(finalMessages, {
      provider: routing.provider,
      model: routing.model,
    })

    // 8. Generate title asynchronously if needed
    let titlePromise: Promise<string | undefined> = Promise.resolve(undefined)
    if (isFirstMessage) {
      titlePromise = (async () => {
        try {
          const titlePrompt = getPrompt("chat:title-gen", { question })
          const titleResp = await chatCompletion(
            [
              { role: "system", content: titlePrompt.system },
              { role: "user", content: titlePrompt.userMessage ?? question },
            ],
            // Higher cap so reasoning models (e.g. deepseek-v4-pro) have room to
            // emit an actual title after their hidden reasoning tokens; cheaper
            // models still stop early at the end-of-title.
            { provider: routing.provider, model: routing.model, maxTokens: 512 },
          )
          const title =
            titleResp.content.trim().replace(/^["']|["']$/g, "") || question.slice(0, 48)
          await ChatRepository.updateTitle(chatId, title)
          return title
        } catch {
          const fallback = question.slice(0, 48)
          await ChatRepository.updateTitle(chatId, fallback)
          return fallback
        }
      })()
    }

    // 9. Build ReadableStream
    const readable = new ReadableStream({
      async start(controller) {
        let fullContent = ""
        let llmProvider = routing.provider
        let llmModel = routing.model
        let promptTokens = 0
        let completionTokens = 0
        let totalTokens = 0

        try {
          for await (const chunk of stream) {
            if (chunk.type === "text") {
              fullContent += chunk.content
              const sse = `data: ${JSON.stringify({ content: chunk.content })}\n\n`
              controller.enqueue(new TextEncoder().encode(sse))
            } else if (chunk.type === "finish") {
              llmProvider = chunk.provider
              llmModel = chunk.model
              promptTokens = chunk.usage.promptTokens
              completionTokens = chunk.usage.completionTokens
              totalTokens = chunk.usage.totalTokens
            }
          }

          // Output guardrails (best effort since we already streamed, we can't redact retroactively, but we save sanitized)
          const outputCheck = validateOutput(fullContent)
          const finalAnswer = outputCheck.sanitized ?? fullContent

          await ChatRepository.saveMessage(chatId, "ai", finalAnswer, citations)

          const ms = Date.now() - startTime
          recordUsage({
            userId,
            provider: llmProvider,
            model: llmModel,
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUsd: estimateCost(llmModel, promptTokens, completionTokens),
            latencyMs: ms,
            chatId,
            success: true,
          })

          const generatedTitle = await titlePromise

          // Final event
          const finalEvent = `data: ${JSON.stringify({
            id: crypto.randomUUID(),
            content: "", // We already sent the content
            citations,
            title: generatedTitle,
            provider: llmProvider,
            model: llmModel,
          })}\n\n`
          controller.enqueue(new TextEncoder().encode(finalEvent))
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
          controller.close()
        } catch (err) {
          logError("llm.stream_loop.error", {
            error: err instanceof Error ? err.message : String(err),
          })
          // BUG-004: the user turn was already persisted before streaming. If we
          // fail mid-stream, save whatever partial answer we streamed (marked
          // truncated) so the history isn't left with an orphaned user turn, and
          // record the failure so error rate is visible in metering. Best-effort:
          // never let bookkeeping throw out of the catch.
          try {
            const partial = fullContent.trim()
            if (partial) {
              await ChatRepository.saveMessage(
                chatId,
                "ai",
                `${partial}\n\n_(respuesta interrumpida)_`,
                citations,
              )
            }
            recordUsage({
              userId,
              provider: llmProvider,
              model: llmModel,
              promptTokens,
              completionTokens,
              totalTokens,
              estimatedCostUsd: estimateCost(llmModel, promptTokens, completionTokens),
              latencyMs: Date.now() - startTime,
              chatId,
              success: false,
              errorType: err instanceof Error ? err.name : "stream_error",
            })
          } catch (saveErr) {
            logError("llm.stream_loop.partial_persist_error", {
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            })
          }
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
            ),
          )
          controller.close()
        }
      },
    })

    return readable
  },
}
