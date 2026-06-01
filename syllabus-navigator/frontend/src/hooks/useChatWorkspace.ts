"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { AttachedFile, Chat, Message } from "@/components/navigator/types"
import { useSyllabus } from "@/context/SyllabusContext"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  ApiError,
  deleteChat,
  fetchGraph,
  getChatDetail,
  listChats,
  newChat,
  querySyllabus,
  reprocessGraph,
  updateChat,
  uploadSyllabus,
  type CitationAPI,
  type GraphResponseAPI,
} from "@/lib/api"

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

function mapApiChat(c: {
  id: string
  title: string
  active_model: string
  syllabus_id: string | null
  created_at: string
  message_count: number
}): Chat {
  return {
    id: c.id,
    title: c.title,
    activeModel: c.active_model,
    syllabusId: c.syllabus_id,
    createdAt: c.created_at,
    timestamp: relativeTime(c.created_at),
    messageCount: c.message_count,
    messages: [],
  }
}

function mapApiMessage(m: {
  id: string
  role: string
  content: string
  citations?: CitationAPI[]
}): Message {
  return {
    id: m.id,
    role: m.role as "user" | "ai",
    content: m.content,
    citations: m.citations ?? [],
  }
}

export function useChatWorkspace() {
  const { userId, ready: userReady, status: userStatus } = useUser()
  const { activeSyllabusId, setActiveSyllabusId, viewMode, setViewMode, pendingQuery, setPendingQuery } =
    useSyllabus()
  const { openAuthModal } = useAuthModal()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState("")
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [graphData, setGraphData] = useState<GraphResponseAPI | null>(null)
  const [transitionKey, setTransitionKey] = useState(0)
  const [activeDocumentName, setActiveDocumentName] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId

  const activeChat = chats.find((c) => c.id === activeChatId)

  const showError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
      toast.error(err.message)
      openAuthModal("signup")
      return
    }
    const msg = err instanceof ApiError ? err.message : fallback
    toast.error(msg)
    console.error(err)
  }, [openAuthModal])

  const loadChatMessages = useCallback(
    async (chatId: string) => {
      try {
        const detail = await getChatDetail(chatId)
        const msgs = detail.messages.map(mapApiMessage)
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: msgs,
                  activeModel: detail.active_model,
                  syllabusId: detail.syllabus_id,
                  messageCount: detail.message_count,
                }
              : c,
          ),
        )
      } catch (err) {
        showError(err, "Failed to load chat messages")
      }
    },
    [userId, showError],
  )

  const restoreSyllabusForChat = useCallback(
    (chat: Chat) => {
      setActiveSyllabusId(chat.syllabusId ?? null)
      if (chat.syllabusId) {
        setAttachments([
          {
            id: chat.syllabusId,
            name: activeDocumentName ?? "Attached syllabus",
            size: "",
            syllabus_id: chat.syllabusId,
            status: "ready",
          },
        ])
      } else {
        setAttachments([])
      }
    },
    [setActiveSyllabusId, activeDocumentName],
  )

  const bootstrapChats = useCallback(async () => {
    setChatsLoading(true)
    setChatsError(null)
    try {
      const { chats: apiChats } = await listChats()
      if (apiChats.length === 0) {
        const created = await newChat()
        const fresh = mapApiChat(created)
        setChats([fresh])
        setActiveChatId(created.id)
        return
      }
      const mapped = apiChats.map(mapApiChat)
      setChats(mapped)
      setActiveChatId(mapped[0].id)
      await loadChatMessages(mapped[0].id)
      if (mapped[0].syllabusId) {
        setActiveSyllabusId(mapped[0].syllabusId)
      }
    } catch (err) {
      setChatsError("Could not load chat history")
      showError(err, "Failed to load chats")
    } finally {
      setChatsLoading(false)
    }
  }, [userId, loadChatMessages, setActiveSyllabusId, showError])

  useEffect(() => {
    if (userReady) bootstrapChats()
  }, [userReady, bootstrapChats])

  const selectChat = useCallback(
    (id: string) => {
      abortRef.current?.abort()
      setActiveChatId(id)
      setTransitionKey((k) => k + 1)
      setMobileHistoryOpen(false)
      const chat = chats.find((c) => c.id === id)
      if (chat) restoreSyllabusForChat(chat)
      loadChatMessages(id)
    },
    [chats, loadChatMessages, restoreSyllabusForChat],
  )

  const handleNewChat = useCallback(async () => {
    if (userStatus === "anonymous") {
      openAuthModal("login")
      return
    }
    try {
      const created = await newChat(activeSyllabusId ?? undefined)
      const fresh = mapApiChat(created)
      setChats((prev) => [fresh, ...prev])
      setActiveChatId(created.id)
      setTransitionKey((k) => k + 1)
      setMobileHistoryOpen(false)
    } catch (err) {
      showError(err, "Failed to create new chat")
    }
  }, [activeSyllabusId, userId, userStatus, openAuthModal, showError])

  const handleDeleteChat = useCallback(
    async (id: string) => {
      try {
        await deleteChat(id)
        const remaining = chats.filter((c) => c.id !== id)
        if (id === activeChatId) {
          if (remaining.length > 0) {
            setChats(remaining)
            setActiveChatId(remaining[0].id)
            loadChatMessages(remaining[0].id)
            restoreSyllabusForChat(remaining[0])
          } else {
            const created = await newChat(activeSyllabusId ?? undefined)
            const fresh = mapApiChat(created)
            setChats([fresh])
            setActiveChatId(created.id)
          }
        } else {
          setChats(remaining)
        }
      } catch (err) {
        showError(err, "Failed to delete chat")
      }
    },
    [activeChatId, userId, chats, activeSyllabusId, loadChatMessages, restoreSyllabusForChat, showError],
  )

  const handleRenameChat = useCallback(
    async (id: string, title: string) => {
      try {
        const updated = await updateChat(id, { title })
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)))
      } catch (err) {
        showError(err, "Failed to rename chat")
      }
    },
    [userId, showError],
  )

  const bindSyllabusToChat = useCallback(
    async (chatId: string, syllabusId: string, filename?: string) => {
      try {
        await updateChat(chatId, { syllabus_id: syllabusId })
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, syllabusId } : c)),
        )
        if (filename) setActiveDocumentName(filename)
      } catch (err) {
        showError(err, "Failed to bind syllabus to chat")
      }
    },
    [userId, showError],
  )

  const handleModelChange = useCallback(
    async (model: string) => {
      if (!activeChatId) {
        toast.error("No active chat. Please create a new chat first.")
        return
      }
      try {
        const updated = await updateChat(activeChatId, { active_model: model })
        setChats((prev) =>
          prev.map((c) => (c.id === activeChatId ? { ...c, activeModel: updated.active_model } : c)),
        )
      } catch (err) {
        showError(err, "Failed to change model")
      }
    },
    [activeChatId, userId, showError],
  )

  const sendMessage = useCallback(
    (text: string) => {
      if (userStatus === "anonymous") {
        openAuthModal("login")
        return
      }

      const trimmed = text.trim()
      if (!trimmed) return
      
      if (!activeChatId) {
        toast.error("No active chat. Please create a new chat first.")
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const chatIdForRequest = activeChatId

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed }
      const pendingId = `p-${Date.now()}`
      const pendingMsg: Message = { id: pendingId, role: "ai", content: "", pending: true }

      setChats((prev) =>
        prev.map((c) =>
          c.id === chatIdForRequest
            ? { ...c, messages: [...c.messages, userMsg, pendingMsg] }
            : c,
        ),
      )

      querySyllabus(activeSyllabusId, trimmed, chatIdForRequest, undefined, controller.signal)
        .then((data) => {
          if (activeChatIdRef.current !== chatIdForRequest) return
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatIdForRequest
                ? {
                    ...c,
                    title: data.title ?? c.title,
                    messages: c.messages.map((m) =>
                      m.id === pendingId
                        ? {
                            ...m,
                            pending: false,
                            content: data.answer,
                            citations: data.citations ?? [],
                          }
                        : m,
                    ),
                  }
                : c,
            ),
          )
        })
        .catch((error) => {
          if (error instanceof Error && error.name === "AbortError") return
          if (activeChatIdRef.current !== chatIdForRequest) return

          // Build a user-friendly error message for the chat bubble.
          const friendlyMsg =
            error instanceof ApiError
              ? error.message
              : "Sorry, I encountered an error connecting to the AI."

          showError(error, friendlyMsg)
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatIdForRequest
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === pendingId
                        ? {
                            ...m,
                            pending: false,
                            content: `⚠️ ${friendlyMsg}`,
                          }
                        : m,
                    ),
                  }
                : c,
            ),
          )
        })
    },
    [activeChatId, activeSyllabusId, userId, userStatus, openAuthModal, showError],
  )

  useEffect(() => {
    if (pendingQuery) {
      sendMessage(pendingQuery)
      setPendingQuery(null)
    }
  }, [pendingQuery, sendMessage, setPendingQuery])

  const addAttachment = useCallback(
    async (file: AttachedFile) => {
      if (userStatus === "anonymous") {
        openAuthModal("login")
        return
      }

      setAttachments((prev) => (prev.some((f) => f.id === file.id) ? prev : [...prev, file]))

      if (file.file) {
        try {
          const data = await uploadSyllabus(file.file)
          setAttachments((prev) =>
            prev.map((f) =>
              f.id === file.id ? { ...f, status: "ready", syllabus_id: data.syllabus_id } : f,
            ),
          )
          setActiveSyllabusId(data.syllabus_id)
          setActiveDocumentName(file.name)
          if (activeChatId) {
            await bindSyllabusToChat(activeChatId, data.syllabus_id, file.name)
          }
          toast.success("Syllabus uploaded and indexed")
        } catch (error) {
          showError(error, "File upload failed")
          setAttachments((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, status: "error" } : f)),
          )
        }
      } else if (file.syllabus_id && activeChatId) {
        setActiveSyllabusId(file.syllabus_id)
        setActiveDocumentName(file.name)
        await bindSyllabusToChat(activeChatId, file.syllabus_id, file.name)
      }
    },
    [userId, activeChatId, setActiveSyllabusId, bindSyllabusToChat, userStatus, openAuthModal, showError],
  )

  const selectKnowledge = useCallback(
    async (upload: { id: string; original_filename: string }) => {
      setActiveSyllabusId(upload.id)
      setActiveDocumentName(upload.original_filename)
      setAttachments([
        {
          id: upload.id,
          name: upload.original_filename,
          size: "",
          syllabus_id: upload.id,
          status: "ready",
        },
      ])
      if (activeChatId) {
        await bindSyllabusToChat(activeChatId, upload.id, upload.original_filename)
      }
      toast.success(`Using ${upload.original_filename}`)
    },
    [activeChatId, setActiveSyllabusId, bindSyllabusToChat],
  )

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((f) => f.id !== id))
      setActiveSyllabusId(null)
      setActiveDocumentName(null)
      if (activeChatId) {
        updateChat(activeChatId, { syllabus_id: null }).catch((err) =>
          showError(err, "Failed to unbind syllabus"),
        )
        setChats((prev) =>
          prev.map((c) => (c.id === activeChatId ? { ...c, syllabusId: null } : c)),
        )
      }
    },
    [activeChatId, userId, setActiveSyllabusId, showError],
  )

  const loadGraph = useCallback(async () => {
    if (!activeSyllabusId) return
    try {
      const data = await fetchGraph(activeSyllabusId)
      setGraphData(data)
    } catch (e) {
      showError(e, "Failed to load graph")
    }
  }, [activeSyllabusId, userId, showError])

  const handleReprocessGraph = useCallback(async () => {
    if (!activeSyllabusId) return
    try {
      const data = await reprocessGraph(activeSyllabusId)
      setGraphData(data)
      toast.info("Graph reprocessing started")
    } catch (e) {
      showError(e, "Failed to reprocess graph")
    }
  }, [activeSyllabusId, userId, showError])

  const toggleViewMode = () => {
    if (viewMode === "chat") {
      setViewMode("graph")
      loadGraph()
    } else {
      setViewMode("chat")
    }
  }

  useEffect(() => {
    if (viewMode === "graph" && activeSyllabusId) loadGraph()
  }, [viewMode, activeSyllabusId, loadGraph])

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    if (
      viewMode === "graph" &&
      activeSyllabusId &&
      graphData &&
      (graphData.graph_status === "processing" || graphData.graph_status === "pending")
    ) {
      intervalId = setInterval(loadGraph, 3000)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [viewMode, activeSyllabusId, graphData, loadGraph])

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileHistoryOpen,
    setMobileHistoryOpen,
    chats,
    activeChat,
    activeChatId,
    attachments,
    chatsLoading,
    chatsError,
    graphData,
    transitionKey,
    activeSyllabusId,
    activeDocumentName,
    viewMode,
    selectChat,
    handleNewChat,
    handleDeleteChat,
    handleRenameChat,
    handleModelChange,
    sendMessage,
    addAttachment,
    selectKnowledge,
    removeAttachment,
    loadGraph,
    handleReprocessGraph,
    toggleViewMode,
    bootstrapChats,
  }
}
