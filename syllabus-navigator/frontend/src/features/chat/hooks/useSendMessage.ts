"use client"

import { useCallback } from "react"
import type { Message } from "@/types/models"
import { useUser } from "@/context/UserContext"

export function useSendMessage() {
  const { userId, status: userStatus } = useUser()

  const sendMessage = useCallback(
    async (
      chatId: string,
      question: string,
      activeModel?: string,
      onStart?: (tempId: string) => void,
      onUpdate?: (tempId: string, delta: string) => void,
      onComplete?: (tempId: string, finalMessage: Message) => void,
      onError?: (tempId: string, error: string) => void
    ) => {
      const tempId = crypto.randomUUID()
      if (onStart) onStart(tempId)

      try {
        const res = await fetch(`/api/chat/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, activeModel }),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          throw new Error(errData?.error || `Request failed with status ${res.status}`)
        }

        if (!res.body) throw new Error("No response body")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let contentBuffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split("\n")

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.replace("data: ", "").trim()
              if (dataStr === "[DONE]") {
                continue
              }
              try {
                const parsed = JSON.parse(dataStr)
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                if (parsed.content !== undefined && parsed.content !== "") {
                  contentBuffer += parsed.content
                  if (onUpdate) onUpdate(tempId, contentBuffer)
                }
                if (parsed.citations) {
                  // Final completion event
                  if (onComplete) {
                    onComplete(tempId, {
                      id: parsed.id ?? crypto.randomUUID(),
                      chatId,
                      role: "ai",
                      content: contentBuffer,
                      createdAt: new Date().toISOString(),
                      citations: parsed.citations,
                    } as any)
                  }
                }
              } catch (e) {
                // Ignore incomplete JSON chunks, wait for next frame
              }
            }
          }
        }
      } catch (err) {
        console.error("Chat Error:", err)
        if (onError) {
          onError(tempId, err instanceof Error ? err.message : "Failed to send message")
        }
      }
    },
    [userId, userStatus]
  )

  return { sendMessage }
}
