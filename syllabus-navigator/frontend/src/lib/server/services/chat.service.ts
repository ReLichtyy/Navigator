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
import { RetrievalService, GROUNDED_SYSTEM_PROMPT, NO_CONTEXT_MESSAGE } from "./retrieval.service"
import type { LLMMessage } from "@/lib/llm"
import type { CitationAPI } from "@/types/api"

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

export const ChatService = {
  /**
   * Build the LLM messages for a turn. If the chat is bound to a syllabus, run
   * retrieval and inject the grounded context + return citations; otherwise fall
   * back to the plain chat prompt.
   */
  async prepareMessages(
    syllabusId: string | null,
    userId: string,
    recentHistory: { role: string; content: string }[],
    question: string,
  ): Promise<{ messages: LLMMessage[]; citations: CitationAPI[] }> {
    let systemContent = getPrompt("chat:general").system
    let userContent = question
    let citations: CitationAPI[] = []

    if (syllabusId) {
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
    // agenda so "what quizzes/topics this week?" works in any chat.
    const scheduleContext = await buildScheduleContext(userId)
    systemContent = `${systemContent}\n\n=== AGENDA / CRONOGRAMA ===\n${scheduleContext}`

    const messages: LLMMessage[] = [{ role: "system", content: systemContent }]
    for (const msg of recentHistory) {
      messages.push({ role: msg.role === "ai" ? "assistant" : "user", content: msg.content })
    }
    messages.push({ role: "user", content: userContent })

    return { messages, citations }
  },

  async processMessage(chatId: string, userId: string, userRole: Role, question: string) {
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
      userId,
      recentHistory,
      question,
    )

    // 6. Route model
    const routing = selectModel({
      userTier: getRateLimitTier(userRole),
      preferredModel: chat.active_model,
      preferredProvider: undefined,
    })

    // 7. Call LLM
    const { result: llmResponse, ms: llmLatencyMs } = await timed("llm.call", () =>
      chatCompletion(messages, {
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
          { provider: routing.provider, model: routing.model, maxTokens: 20 },
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

  async processMessageStream(chatId: string, userId: string, userRole: Role, question: string) {
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
      userId,
      recentHistory,
      question,
    )

    // 6. Route model
    const routing = selectModel({
      userTier: getRateLimitTier(userRole),
      preferredModel: chat.active_model,
      preferredProvider: undefined,
    })

    // 7. Get stream
    const startTime = Date.now()
    const stream = chatStream(messages, {
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
            { provider: routing.provider, model: routing.model, maxTokens: 20 },
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
