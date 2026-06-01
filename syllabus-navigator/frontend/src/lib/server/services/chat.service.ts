import { validateInput, validateOutput } from "@/lib/guardrails"
import { getPrompt } from "@/lib/prompts"
import { chatCompletion, selectModel } from "@/lib/llm"
import { recordUsage } from "@/lib/metering"
import { estimateCost } from "@/lib/llm/config"
import { getRateLimitTier, type Role } from "@/lib/auth/rbac"
import { timed } from "@/lib/observability/timing"
import { ChatRepository } from "../repositories/chat.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import type { LLMMessage } from "@/lib/llm"

const MAX_HISTORY_TURNS = 6

export const ChatService = {
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
    const allHistory = await ChatRepository.getAllHistory(chatId)

    // 4. Save user message
    await ChatRepository.saveMessage(chatId, "user", question)

    // 5. Build prompt
    const prompt = getPrompt("chat:general")
    const messages: LLMMessage[] = [{ role: "system", content: prompt.system }]

    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "ai" ? "assistant" : "user",
        content: msg.content,
      })
    }
    messages.push({ role: "user", content: question })

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
    await ChatRepository.saveMessage(chatId, "ai", finalAnswer)

    // 10. Generate title for first message
    let title: string | undefined
    if (allHistory.length === 0) {
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

    // 11. Record usage
    await recordUsage({
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
      provider: llmResponse.provider,
      model: llmResponse.model,
      latencyMs: llmLatencyMs
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
    const allHistory = await ChatRepository.getAllHistory(chatId)

    // 4. Save user message
    await ChatRepository.saveMessage(chatId, "user", question)

    // 5. Build prompt
    const prompt = getPrompt("chat:general")
    const messages: LLMMessage[] = [{ role: "system", content: prompt.system }]

    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "ai" ? "assistant" : "user",
        content: msg.content,
      })
    }
    messages.push({ role: "user", content: question })

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
    if (allHistory.length === 0) {
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
          const title = titleResp.content.trim().replace(/^["']|["']$/g, "") || question.slice(0, 48)
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

          await ChatRepository.saveMessage(chatId, "ai", finalAnswer)

          const ms = Date.now() - startTime
          await recordUsage({
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
            citations: [], 
            title: generatedTitle,
            provider: llmProvider,
            model: llmModel
          })}\n\n`
          controller.enqueue(new TextEncoder().encode(finalEvent))
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
          controller.close()
        } catch (err) {
          logError("llm.stream_loop.error", { error: err instanceof Error ? err.message : String(err) })
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`))
          controller.close()
        }
      }
    })

    return readable
  }
}
