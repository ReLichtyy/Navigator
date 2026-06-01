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
  }
}
