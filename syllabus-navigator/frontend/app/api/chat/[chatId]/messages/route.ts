/**
 * POST /api/chat/[chatId]/messages — Send a message and get an LLM response.
 *
 * Full pipeline: guardrails → prompt → router → LLM → guardrails → metering → response.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { sql } from "@/lib/db"
import { validateInput, validateOutput } from "@/lib/guardrails"
import { getPrompt } from "@/lib/prompts"
import { chatCompletion, selectModel } from "@/lib/llm"
import type { LLMMessage } from "@/lib/llm"
import { recordUsage } from "@/lib/metering"
import { estimateCost } from "@/lib/llm/config"
import { getRateLimitTier } from "@/lib/auth/rbac"
import { logError, logInfo } from "@/lib/observability/logger"
import { timed } from "@/lib/observability/timing"
import type { Role } from "@/lib/auth/rbac"
import { checkRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const MAX_HISTORY_TURNS = 6

type RouteParams = { params: Promise<{ chatId: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ answer: null, error: "Unauthorized" }, { status: 401 })
    }

    const { chatId } = await params
    const userId = session.user.id
    const userRole = (session.user.role ?? "free") as Role

    // Parse request body
    const body = await request.json().catch(() => null)
    if (!body?.question) {
      return NextResponse.json(
        { answer: null, error: "Question is required." },
        { status: 400 },
      )
    }

    const question = String(body.question)

    // ── 0. Rate Limiting ───────────────────────────────────────────────────
    const rl = await checkRateLimit(userId, userRole === "guest" ? "guest" : "authenticated")
    if (!rl.success) {
      return NextResponse.json(
        { answer: null, error: "Rate limit exceeded. Please wait before sending more messages." },
        { status: 429, headers: { "Retry-After": Math.ceil((rl.reset - Date.now()) / 1000).toString() } }
      )
    }

    // ── 1. Input guardrails ────────────────────────────────────────────────
    const inputCheck = validateInput(question)
    if (!inputCheck.passed) {
      return NextResponse.json(
        { answer: null, error: inputCheck.reason ?? "Input validation failed." },
        { status: 400 },
      )
    }

    // ── 2. Verify chat ownership ───────────────────────────────────────────
    const chatRows = await sql`
      SELECT id, active_model, syllabus_id FROM chats
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    const chat = (chatRows as { id: string; active_model: string; syllabus_id: string | null }[])[0]
    if (!chat) {
      return NextResponse.json({ answer: null, error: "Chat not found." }, { status: 404 })
    }

    // ── 3. Load conversation history ───────────────────────────────────────
    const historyRows = await sql`
      SELECT role, content FROM messages
      WHERE chat_id = ${chatId}::uuid
      ORDER BY created_at ASC
    `
    const allHistory = historyRows as { role: string; content: string }[]
    const recentHistory = allHistory.slice(-MAX_HISTORY_TURNS * 2)

    // ── 4. Save user message ───────────────────────────────────────────────
    await sql`
      INSERT INTO messages (chat_id, role, content)
      VALUES (${chatId}::uuid, 'user', ${question})
    `

    // ── 5. Build prompt ────────────────────────────────────────────────────
    const prompt = getPrompt("chat:general")

    const messages: LLMMessage[] = [
      { role: "system", content: prompt.system },
    ]

    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "ai" ? "assistant" : "user",
        content: msg.content,
      })
    }

    messages.push({ role: "user", content: question })

    // ── 6. Route model ─────────────────────────────────────────────────────
    const routing = selectModel({
      userTier: getRateLimitTier(userRole),
      preferredModel: chat.active_model,
      preferredProvider: undefined,
    })

    // ── 7. Call LLM ────────────────────────────────────────────────────────
    const { result: llmResponse, ms: llmLatencyMs } = await timed("llm.call", () =>
      chatCompletion(messages, {
        provider: routing.provider,
        model: routing.model,
      }),
    )

    // ── 8. Output guardrails ───────────────────────────────────────────────
    const outputCheck = validateOutput(llmResponse.content)
    const finalAnswer = outputCheck.sanitized ?? llmResponse.content

    // ── 9. Save AI message ─────────────────────────────────────────────────
    await sql`
      INSERT INTO messages (chat_id, role, content)
      VALUES (${chatId}::uuid, 'ai', ${finalAnswer})
    `

    // ── 10. Generate title for first message ───────────────────────────────
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
        await sql`UPDATE chats SET title = ${title} WHERE id = ${chatId}::uuid`
      } catch {
        title = question.slice(0, 48)
        await sql`UPDATE chats SET title = ${title} WHERE id = ${chatId}::uuid`
      }
    }

    // ── 11. Record usage ─────────────────────────────────
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

    // ── 12. Respond ────────────────────────────────────────────────────────
    logInfo("api.chat.message.success", {
      chatId,
      provider: llmResponse.provider,
      model: llmResponse.model,
      latencyMs: llmLatencyMs,
    })

    return NextResponse.json({
      chat_id: chatId,
      answer: finalAnswer,
      citations: [],
      title,
      provider: llmResponse.provider,
      model: llmResponse.model,
      error: null,
    })
  } catch (err) {
    logError("api.chat.message.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      {
        answer: null,
        error: err instanceof Error ? err.message : "Failed to process message.",
      },
      { status: 500 },
    )
  }
}
