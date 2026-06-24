"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { querySyllabus, ApiError } from "@/lib/api"
import type { Message, Chat } from "@/types/models"

interface UseChatOrchestratorProps {
  userStatus: string
  openAuthModal: (mode: any) => void
  activeSyllabusId: string | null
  chats: Chat[]
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>
  createChat: (activeModel?: string, syllabusId?: string | null) => Promise<Chat | null>
  activeChatId: string
  setActiveChatId: (id: string) => void
  activeChat: Chat | null
  setActiveChat: React.Dispatch<React.SetStateAction<Chat | null>>
  initializeSession: (chat: Chat) => void
  updateMessage: (msgId: string, updates: Partial<Message>) => void
  abortRef: React.MutableRefObject<AbortController | null>
  activeChatIdRef: React.MutableRefObject<string>
  setTransitionKey: React.Dispatch<React.SetStateAction<number>>
  setMobileHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useChatOrchestrator({
  userStatus,
  openAuthModal,
  activeSyllabusId,
  chats,
  setChats,
  createChat,
  activeChatId,
  setActiveChatId,
  activeChat,
  setActiveChat,
  initializeSession,
  updateMessage,
  abortRef,
  activeChatIdRef,
  setTransitionKey,
  setMobileHistoryOpen,
}: UseChatOrchestratorProps) {
  const [isSending, setIsSending] = useState(false)
  const [isCreatingChat, setIsCreatingChat] = useState(false)

  // Centralized Auth Policy
  const canMutateChat = useCallback(() => {
    if (userStatus === "anonymous") {
      openAuthModal("login")
      return false
    }
    return true
  }, [userStatus, openAuthModal])

  const handleNewChat = useCallback(() => {
    if (!canMutateChat()) return

    // Create Local Draft
    setActiveChatId("draft")
    initializeSession({
      id: "draft",
      title: "New Chat",
      activeModel: "gpt-4o-mini", // Fallback, will be replaced by actual default
      syllabusId: activeSyllabusId,
      createdAt: new Date().toISOString(),
      timestamp: "Just now",
      messageCount: 0,
      messages: [],
    })
    setTransitionKey((k) => k + 1)
    setMobileHistoryOpen(false)
  }, [
    canMutateChat,
    activeSyllabusId,
    setActiveChatId,
    initializeSession,
    setTransitionKey,
    setMobileHistoryOpen,
  ])

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!canMutateChat()) return false

      const trimmed = text.trim()
      if (!trimmed || isSending || isCreatingChat) return false

      setIsSending(true)
      let targetChatId = activeChatId

      // 1. Implicit Creation for Draft
      if (!targetChatId || targetChatId === "draft") {
        setIsCreatingChat(true)
        const created = await createChat(undefined, activeSyllabusId)
        setIsCreatingChat(false)

        if (!created) {
          setIsSending(false)
          return false // Rollback implicitly handled by Composer
        }

        targetChatId = created.id
        setActiveChatId(targetChatId)

        // Instantly inject the newly created chat to avoid fetch race conditions
        initializeSession({ ...created, messages: [] })
      }

      // 2. Setup Optimistic Update
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const pendingId = `p-${Date.now()}`
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        chatId: targetChatId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      }
      const pendingMsg: Message = {
        id: pendingId,
        chatId: targetChatId,
        role: "ai",
        content: "",
        createdAt: new Date().toISOString(),
        pending: true,
      } as any

      setActiveChat((prev) =>
        prev ? { ...prev, messages: [...prev.messages, userMsg, pendingMsg] } : prev,
      )

      // 3. Backend Mutation via SSE Stream
      try {
        const data = await querySyllabus(
          activeSyllabusId ?? null,
          trimmed,
          targetChatId,
          (chunk) => {
            // Append each text chunk to the pending bubble. Guard against an
            // undefined starting value so we never render the literal "undefined".
            if (activeChatIdRef.current === targetChatId) {
              setActiveChat((prev) => {
                if (!prev) return prev
                return {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === pendingId ? { ...m, content: (m.content ?? "") + chunk } : m,
                  ),
                }
              })
            }
          },
          controller.signal,
        )

        if (activeChatIdRef.current === targetChatId) {
          // Mark pending as done, attach title/citations from final event
          setActiveChat((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              title: data.title ?? prev.title,
              messages: prev.messages.map((m) =>
                m.id === pendingId
                  ? { ...m, pending: false, citations: (data.citations ?? []) as any }
                  : m,
              ),
            }
          })
        }

        setChats((prev) =>
          prev.map((c) => (c.id === targetChatId ? { ...c, title: data.title ?? c.title } : c)),
        )
        setIsSending(false)
        return true
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          setIsSending(false)
          return true // User switched chats, don't rollback text
        }

        const friendlyMsg =
          error instanceof ApiError ? error.message : "Sorry, I encountered an error."

        // Keep the user's message in the thread; turn the empty pending bubble into
        // an error reply instead of deleting both (which looked like the message
        // "disappeared"). The composer keeps its input clear since the turn is shown.
        if (activeChatIdRef.current === targetChatId) {
          setActiveChat((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === pendingId
                  ? ({ ...m, pending: false, content: friendlyMsg, error: true } as any)
                  : m,
              ),
            }
          })
        }

        toast.error(friendlyMsg)
        setIsSending(false)
        return true // turn is preserved in the thread; don't restore composer text
      }
    },
    [
      canMutateChat,
      isSending,
      isCreatingChat,
      activeChatId,
      activeSyllabusId,
      createChat,
      setActiveChatId,
      setActiveChat,
      abortRef,
      activeChatIdRef,
      setChats,
    ],
  )

  return {
    handleNewChat,
    sendMessage,
    isSending,
    isCreatingChat,
  }
}
