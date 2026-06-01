"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { Chat } from "@/types/models"
import { listChats, newChat as apiNewChat, deleteChat as apiDeleteChat, updateChat as apiUpdateChat, ApiError } from "@/lib/api"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"

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
    createdAt: c.created_at,
    timestamp: relativeTime(c.created_at),
    messageCount: c.message_count,
    messages: [], // Initially empty until fetched
  }
}

export function useChatList() {
  const { userId, ready: userReady, status: userStatus } = useUser()
  const { openAuthModal } = useAuthModal()

  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [chatsError, setChatsError] = useState<string | null>(null)

  const fetchChatList = useCallback(async () => {
    if (!userReady || !userId) {
      if (userReady) setChatsLoading(false)
      return
    }
    
    // Guests don't load history from API in the same way, or maybe they do?
    // According to the original logic, guests do load it if they have an ID.
    try {
      setChatsLoading(true)
      const data = await listChats()
      setChats(data.chats.map(mapApiChat))
      setChatsError(null)
    } catch (err) {
      console.error("[useChatList] Load error:", err)
      setChatsError(err instanceof Error ? err.message : "Failed to load chats")
      if (userStatus !== "guest") {
        setChats([])
      }
    } finally {
      setChatsLoading(false)
    }
  }, [userId, userReady, userStatus])

  useEffect(() => {
    fetchChatList()
  }, [fetchChatList])

  const createChat = useCallback(async (activeModel?: string, syllabusId?: string | null) => {
    if (!userReady) return null
    if (userStatus === "anonymous") {
      openAuthModal("login")
      return null
    }

    try {
      const resp = await apiNewChat(syllabusId || undefined)
      const newChatObj = mapApiChat(resp)
      setChats((prev) => [newChatObj, ...prev])
      return newChatObj
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
        toast.error(err.message)
        openAuthModal("signup")
      } else {
        toast.error("Failed to create chat")
      }
      return null
    }
  }, [userReady, userStatus, openAuthModal])

  const deleteChat = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this chat?")) return false
    try {
      await apiDeleteChat(id)
      setChats((prev) => prev.filter((c) => c.id !== id))
      toast.success("Chat deleted")
      return true
    } catch (err) {
      toast.error("Failed to delete chat")
      return false
    }
  }, [])

  const renameChat = useCallback(async (id: string, title: string) => {
    try {
      await apiUpdateChat(id, { title })
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    } catch (err) {
      toast.error("Failed to rename chat")
    }
  }, [])

  return {
    chats,
    setChats,
    chatsLoading,
    chatsError,
    createChat,
    deleteChat,
    renameChat,
    refreshChats: fetchChatList
  }
}
