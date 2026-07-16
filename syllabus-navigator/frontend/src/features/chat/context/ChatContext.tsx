"use client"

import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import type { AttachedFile, Chat, Message } from "@/types/models"
import { useSyllabus, type PendingAsk } from "@/context/SyllabusContext"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { useChatList } from "../hooks/useChatList"
import { useChatSession } from "../hooks/useChatSession"
import { useChatOrchestrator } from "../hooks/useChatOrchestrator"
import {
  querySyllabus,
  uploadSyllabus,
  updateChat,
  ApiError,
  fetchGraph,
  reprocessGraph,
} from "@/lib/api"
import type { GraphResponseAPI } from "@/types/api"

export interface ChatWorkspaceState {
  // UI State
  sidebarCollapsed: boolean
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  transitionKey: number

  // Chat List
  chats: Chat[]
  chatsLoading: boolean
  chatsError: string | null
  activeChatId: string
  activeChat: Chat | null
  messagesLoading: boolean

  // Orchestrator States
  isSending: boolean
  isCreatingChat: boolean

  // Actions
  selectChat: (id: string) => void
  handleNewChat: () => void
  handleDeleteChat: (id: string) => void
  handleRenameChat: (id: string, title: string) => void
  sendMessage: (text: string, opts?: { syllabusId?: string | null; web?: boolean }) => Promise<boolean>
  handleModelChange: (model: string) => void

  // Attachments & Knowledge
  attachments: AttachedFile[]
  addAttachment: (file: AttachedFile) => Promise<void>
  removeAttachment: (id: string) => void
  activeDocumentName: string | null
  selectKnowledge: (upload: { id: string; original_filename: string }) => Promise<void>

  // View Modes (Chat vs Graph)
  viewMode: "chat" | "graph"
  toggleViewMode: () => void
  graphData: GraphResponseAPI | null
  handleReprocessGraph: () => void

  // RAG Syllabus integration
  activeSyllabusId: string | null
}

const ChatWorkspaceContext = createContext<ChatWorkspaceState | undefined>(undefined)

// ── Dedicated ask-chat per course/doc ─────────────────────────────────────────
// "Preguntar al chat" from the study/map views routes every question of the same
// course (or document) into ONE chat. The chat is created lazily on the FIRST
// ask — never upfront — and the scope→chat mapping lives in localStorage.
const askChatKey = (ask: PendingAsk) =>
  ask.courseId
    ? `sn:ask-chat:course:${ask.courseId}`
    : ask.syllabusId
      ? `sn:ask-chat:doc:${ask.syllabusId}`
      : null

function readAskChat(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storeAskChat(key: string, chatId: string) {
  try {
    window.localStorage.setItem(key, chatId)
  } catch {
    // storage unavailable → the next ask just creates a fresh chat
  }
}

export function ChatWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { userId, ready: userReady, status: userStatus } = useUser()
  const {
    activeSyllabusId,
    setActiveSyllabusId,
    viewMode,
    setViewMode,
    pendingQuery,
    setPendingQuery,
  } = useSyllabus()
  const { openAuthModal } = useAuthModal()

  // Navigator v2: recent chats live in the app sidebar, so the full history
  // panel starts hidden ("Ver todos los chats" / the header toggle opens it).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [activeChatId, setActiveChatId] = useState("")
  const [transitionKey, setTransitionKey] = useState(0)

  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [activeDocumentName, setActiveDocumentName] = useState<string | null>(null)

  const [graphData, setGraphData] = useState<GraphResponseAPI | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId

  // --- Domain Hooks ---
  const { chats, setChats, chatsLoading, chatsError, createChat, deleteChat, renameChat } =
    useChatList()
  const { activeChat, setActiveChat, initializeSession, updateMessage, messagesLoading } =
    useChatSession(activeChatId)

  // --- Orchestrator ---
  const { handleNewChat, sendMessage, isSending, isCreatingChat } = useChatOrchestrator({
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
  })

  // --- Bootstrapping ---
  useEffect(() => {
    if (chats.length > 0 && !activeChatId && !chatsLoading) {
      setActiveChatId(chats[0].id)
      if (chats[0].syllabusId) {
        setActiveSyllabusId(chats[0].syllabusId)
      }
    }
  }, [chats, activeChatId, chatsLoading, setActiveSyllabusId])

  // --- Actions ---
  const selectChat = useCallback(
    (id: string) => {
      abortRef.current?.abort()
      setActiveChatId(id)
      setTransitionKey((k) => k + 1)
      const c = chats.find((x) => x.id === id)
      if (c?.syllabusId) setActiveSyllabusId(c.syllabusId)
    },
    [chats, setActiveSyllabusId],
  )

  const handleDeleteChat = useCallback(
    async (id: string) => {
      const success = await deleteChat(id)
      if (success && id === activeChatId) {
        const remaining = chats.filter((c) => c.id !== id)
        if (remaining.length > 0) {
          setActiveChatId(remaining[0].id)
        } else {
          handleNewChat()
        }
      }
    },
    [deleteChat, activeChatId, chats, handleNewChat],
  )

  const handleRenameChat = useCallback(
    async (id: string, title: string) => {
      await renameChat(id, title)
    },
    [renameChat],
  )

  const handleModelChange = useCallback(
    async (model: string) => {
      // Optimistically reflect the change in the UI (composer reads
      // activeChat.activeModel). Do this even for a brand-new "draft" chat that
      // hasn't been persisted yet — the model is carried over when it's created.
      setActiveChat((prev) => (prev ? { ...prev, activeModel: model } : prev))
      setChats((prev) =>
        prev.map((c) => (c.id === activeChatId ? { ...c, activeModel: model } : c)),
      )

      // Only persist when there is a real (saved) chat to PATCH.
      if (!activeChatId || activeChatId === "draft") return
      try {
        await updateChat(activeChatId, { active_model: model })
      } catch (err) {
        toast.error("No se pudo cambiar el modelo")
      }
    },
    [activeChatId, setChats, setActiveChat],
  )

  // An ask waiting for its target chat to become active (history loaded) before
  // sending, so the optimistic bubbles append to the right thread.
  const deferredAskRef = useRef<{ chatId: string; text: string; syllabusId: string | null } | null>(
    null,
  )

  // Consume a stashed "Preguntar al chat" query. Bound to a course/doc → reuse
  // that scope's dedicated chat (or create it now, on this first ask). Unbound →
  // legacy behavior: send into the current chat / a new draft.
  useEffect(() => {
    if (!pendingQuery || chatsLoading) return // wait for the list to validate the mapping
    const ask = pendingQuery
    setPendingQuery(null)

    const key = askChatKey(ask)
    if (!key) {
      sendMessage(ask.text)
      return
    }

    const storedId = readAskChat(key)
    const existing = storedId ? chats.find((c) => c.id === storedId) : undefined
    if (existing && (!ask.courseId || existing.courseId === ask.courseId)) {
      // Reuse: switch to the course's chat; the deferred effect sends once its
      // history has loaded.
      deferredAskRef.current = {
        chatId: existing.id,
        text: ask.text,
        syllabusId: ask.syllabusId ?? existing.syllabusId ?? null,
      }
      selectChat(existing.id)
      return
    }

    // First ask for this scope (or its chat was deleted) → create the chat NOW
    // and remember it for every later ask of the same course.
    void (async () => {
      const created = await createChat(undefined, ask.syllabusId ?? null, ask.courseId ?? null)
      if (!created) return
      storeAskChat(key, created.id)
      deferredAskRef.current = {
        chatId: created.id,
        text: ask.text,
        syllabusId: ask.syllabusId ?? null,
      }
      setActiveChatId(created.id)
      initializeSession({ ...created, messages: [] })
      setTransitionKey((k) => k + 1)
    })()
  }, [
    pendingQuery,
    setPendingQuery,
    chatsLoading,
    chats,
    sendMessage,
    selectChat,
    createChat,
    initializeSession,
  ])

  // Fire the deferred ask once the target chat is active with its messages in.
  useEffect(() => {
    const d = deferredAskRef.current
    if (!d || messagesLoading || activeChat?.id !== d.chatId) return
    deferredAskRef.current = null
    sendMessage(d.text, { syllabusId: d.syllabusId })
  }, [activeChat, messagesLoading, sendMessage])

  // --- Attachments & Knowledge Base ---
  const addAttachment = useCallback(
    async (file: AttachedFile) => {
      if (userStatus === "anonymous") {
        openAuthModal("login")
        return
      }
      setAttachments((prev) => [...prev, file])
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
            await updateChat(activeChatId, { syllabus_id: data.syllabus_id })
          }
        } catch (err) {
          toast.error("No se pudo subir el documento")
        }
      }
    },
    [userStatus, openAuthModal, activeChatId, setActiveSyllabusId],
  )

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((f) => f.id !== id))
      setActiveSyllabusId(null)
      setActiveDocumentName(null)
      if (activeChatId) {
        updateChat(activeChatId, { syllabus_id: null }).catch(console.error)
      }
    },
    [activeChatId, setActiveSyllabusId],
  )

  const selectKnowledge = useCallback(
    async (upload: { id: string; original_filename: string }) => {
      setActiveSyllabusId(upload.id)
      setActiveDocumentName(upload.original_filename)
      if (activeChatId) {
        await updateChat(activeChatId, { syllabus_id: upload.id }).catch(console.error)
      }
    },
    [activeChatId, setActiveSyllabusId],
  )

  // --- Graph ---
  const fetchGraphData = useCallback(async (id: string) => {
    try {
      const data = await fetchGraph(id)
      setGraphData(data as any)
    } catch {
      toast.error("No se pudo cargar el mapa de conocimiento")
    }
  }, [])

  const handleReprocessGraph = useCallback(async () => {
    if (!activeSyllabusId) return
    try {
      const data = await reprocessGraph(activeSyllabusId)
      setGraphData(data as any)
      toast.success("Reprocesamiento iniciado")
    } catch {
      toast.error("No se pudo reprocesar")
    }
  }, [activeSyllabusId])

  const toggleViewMode = useCallback(() => {
    const next = viewMode === "chat" ? "graph" : "chat"
    setViewMode(next)
    if (next === "graph" && activeSyllabusId) {
      fetchGraphData(activeSyllabusId)
    }
  }, [activeSyllabusId, viewMode, setViewMode, fetchGraphData])

  return (
    <ChatWorkspaceContext.Provider
      value={{
        sidebarCollapsed,
        setSidebarCollapsed,
        transitionKey,
        chats,
        chatsLoading,
        chatsError,
        activeChatId,
        activeChat,
        messagesLoading,
        isSending,
        isCreatingChat,
        selectChat,
        handleNewChat,
        handleDeleteChat,
        handleRenameChat,
        sendMessage,
        handleModelChange,
        attachments,
        addAttachment,
        removeAttachment,
        activeDocumentName,
        selectKnowledge,
        viewMode,
        toggleViewMode,
        graphData,
        handleReprocessGraph,
        activeSyllabusId,
      }}
    >
      {children}
    </ChatWorkspaceContext.Provider>
  )
}

export function useChatWorkspace() {
  const context = useContext(ChatWorkspaceContext)
  if (!context) throw new Error("useChatWorkspace must be used within ChatWorkspaceProvider")
  return context
}
