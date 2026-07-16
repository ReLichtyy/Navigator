"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import { toast } from "sonner"
import type { Chat, Message } from "@/types/models"
import { getChatDetail, ApiError, CitationAPI } from "@/lib/api"
import { useUser } from "@/context/UserContext"

function mapApiMessage(m: any): Message {
  return {
    id: m.id,
    chatId: "", // Not strictly needed for UI rendering but good for model
    role: m.role as "user" | "ai",
    content: m.content,
    createdAt: m.created_at,
    citations: m.citations ?? [],
  } as any // The `citations` is not in models.ts but we can extend it or use it locally
}

export function useChatSession(activeChatId: string | null) {
  const { ready: userReady, status: userStatus } = useUser()
  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId
  const loadedChatIdRef = useRef<string | null>(null)

  // Fetch chat details when activeChatId changes
  useEffect(() => {
    if (!activeChatId || !userReady) {
      setActiveChat(null)
      loadedChatIdRef.current = null
      return
    }

    if (activeChatId === "draft") {
      setMessagesLoading(false)
      loadedChatIdRef.current = "draft"
      return
    }

    if (loadedChatIdRef.current === activeChatId) {
      return // Pre-seeded, skip fetch
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const ac = new AbortController()
    abortRef.current = ac

    const fetchDetail = async () => {
      try {
        setMessagesLoading(true)
        const detail = await getChatDetail(activeChatId)
        if (activeChatIdRef.current !== activeChatId) return

        setActiveChat({
          id: detail.id,
          title: detail.title,
          activeModel: detail.active_model,
          syllabusId: detail.syllabus_id,
          courseId: detail.course_id,
          createdAt: detail.created_at,
          timestamp: "",
          messageCount: detail.message_count,
          messages: detail.messages.map(mapApiMessage),
        })
        loadedChatIdRef.current = activeChatId
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return
        console.error("[useChatSession] Error fetching details:", err)
        if (userStatus !== "guest") {
          toast.error("No se pudo cargar el historial")
        }
      } finally {
        if (activeChatIdRef.current === activeChatId) {
          setMessagesLoading(false)
        }
      }
    }

    fetchDetail()

    return () => {
      ac.abort()
    }
  }, [activeChatId, userReady, userStatus])

  const initializeSession = useCallback((chat: Chat) => {
    loadedChatIdRef.current = chat.id
    setActiveChat(chat)
    setMessagesLoading(false)
  }, [])

  const addOptimisticMessage = useCallback((msg: Message) => {
    setActiveChat((prev) => {
      if (!prev) return prev
      return { ...prev, messages: [...prev.messages, msg] }
    })
  }, [])

  const updateMessage = useCallback((msgId: string, updates: Partial<Message>) => {
    setActiveChat((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        messages: prev.messages.map((m) => (m.id === msgId ? { ...m, ...updates } : m)),
      }
    })
  }, [])

  const setChatTitle = useCallback((title: string) => {
    setActiveChat((prev) => (prev ? { ...prev, title } : prev))
  }, [])

  return {
    activeChat,
    setActiveChat, // Expose to allow top-level overrides if needed
    initializeSession,
    messagesLoading,
    addOptimisticMessage,
    updateMessage,
    setChatTitle,
  }
}
