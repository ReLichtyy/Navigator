"use client"

import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import type { AttachedFile, Chat, Message } from "@/types/models"
import { useSyllabus } from "@/context/SyllabusContext"
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
  mobileHistoryOpen: boolean
  setMobileHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
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
  sendMessage: (text: string) => Promise<boolean>
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
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
    setMobileHistoryOpen,
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
      setMobileHistoryOpen(false)
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

  useEffect(() => {
    if (pendingQuery) {
      sendMessage(pendingQuery)
      setPendingQuery(null)
    }
  }, [pendingQuery, sendMessage, setPendingQuery])

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
        mobileHistoryOpen,
        setMobileHistoryOpen,
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
