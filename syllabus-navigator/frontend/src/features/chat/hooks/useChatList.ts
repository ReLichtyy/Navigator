"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Chat } from "@/types/models"
import { listChats, newChat as apiNewChat, updateChat as apiUpdateChat, ApiError } from "@/lib/api"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { useChatNav } from "@/context/ChatNavContext"

export function relativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays <= 6) return `${diffDays} days ago`
  if (diffDays <= 13) return "Last week"
  return date.toLocaleDateString()
}

function mapApiChat(c: any): Chat {
  return {
    id: c.id,
    title: c.title,
    activeModel: c.active_model,
    syllabusId: c.syllabus_id,
    courseId: c.course_id,
    syllabusName: c.syllabus_name ?? null,
    createdAt: c.created_at,
    timestamp: relativeTime(c.created_at),
    messageCount: c.message_count,
    messages: [], // Initially empty until fetched
  }
}

export function useChatList() {
  const { userId, ready: userReady, status: userStatus } = useUser()
  const { openAuthModal } = useAuthModal()
  const { deletedChat } = useChatNav()

  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const fetchVersionRef = useRef(0)

  const fetchChatList = useCallback(async () => {
    const requestVersion = ++fetchVersionRef.current
    if (!userReady || !userId) {
      if (userReady) setChatsLoading(false)
      return
    }

    // Guests don't load history from API in the same way, or maybe they do?
    // According to the original logic, guests do load it if they have an ID.
    try {
      setChatsLoading(true)
      const data = await listChats()
      if (requestVersion !== fetchVersionRef.current) return
      setChats(data.chats.map(mapApiChat))
      setChatsError(null)
    } catch (err) {
      if (requestVersion !== fetchVersionRef.current) return
      console.error("[useChatList] Load error:", err)
      setChatsError(err instanceof Error ? err.message : "Failed to load chats")
      if (userStatus !== "guest") {
        setChats([])
      }
    } finally {
      if (requestVersion === fetchVersionRef.current) setChatsLoading(false)
    }
  }, [userId, userReady, userStatus])

  useEffect(() => {
    if (deletedChat) {
      setChats((current) => current.filter((chat) => chat.id !== deletedChat.id))
    }
    fetchChatList()
  }, [fetchChatList, deletedChat])

  const createChat = useCallback(
    async (activeModel?: string, syllabusId?: string | null, courseId?: string | null) => {
      if (!userReady) return null
      if (userStatus === "anonymous") {
        openAuthModal("login")
        return null
      }

      try {
        const resp = await apiNewChat(syllabusId || undefined, courseId || undefined)
        const newChatObj = mapApiChat(resp)
        setChats((prev) => [newChatObj, ...prev])
        return newChatObj
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
          toast.error(err.message)
          openAuthModal("signup")
        } else {
          toast.error("No se pudo crear el chat")
        }
        return null
      }
    },
    [userReady, userStatus, openAuthModal],
  )

  const renameChat = useCallback(async (id: string, title: string) => {
    try {
      await apiUpdateChat(id, { title })
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    } catch (err) {
      toast.error("No se pudo renombrar el chat")
    }
  }, [])

  return {
    chats,
    setChats,
    chatsLoading,
    chatsError,
    createChat,
    renameChat,
    refreshChats: fetchChatList,
  }
}
