"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChatComposer } from "@/components/navigator/chat-composer"
import { ChatThread } from "@/components/navigator/chat-thread"
import { HistorySidebar } from "@/components/navigator/history-sidebar"
import { TopHeader } from "@/components/navigator/top-header"
import type { AttachedFile, Chat, Message } from "@/components/navigator/types"
import GraphCanvas from "@/components/GraphCanvas"
import { SyllabusProvider, useSyllabus } from "@/context/SyllabusContext"
import {
  deleteChat,
  fetchGraph,
  getChatDetail,
  listChats,
  newChat,
  querySyllabus,
  renameChat,
  reprocessGraph,
  uploadSyllabus,
} from "@/lib/api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoString: string): string {
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

type GraphData = {
  syllabus_id: string
  graph_status: string
  graph_error: string | null
  nodes: any[]
  edges: any[]
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------

function SyllabusWorkspace() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string>("")
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)

  const { activeSyllabusId, setActiveSyllabusId, viewMode, setViewMode, pendingQuery, setPendingQuery } = useSyllabus()
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Used to retrigger the fade-in animation when switching chats.
  const [transitionKey, setTransitionKey] = useState(0)

  // Track in-flight AI replies so we can clean them up on unmount/switch.
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0]

  // ---------------------------------------------------------------------------
  // Load chats from backend on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setChatsLoading(true)
    listChats()
      .then(({ chats: apiChats }) => {
        const mapped: Chat[] = apiChats.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.created_at,
          timestamp: relativeTime(c.created_at),
          messages: [], // messages are loaded lazily on chat selection
        }))
        setChats(mapped)
        if (mapped.length > 0) {
          setActiveChatId(mapped[0].id)
          // Load the most-recent chat's messages immediately
          loadChatMessages(mapped[0].id)
        }
      })
      .catch((err) => console.error("Failed to load chats:", err))
      .finally(() => setChatsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Load messages for a specific chat from backend
  // ---------------------------------------------------------------------------
  const loadChatMessages = useCallback(async (chatId: string) => {
    try {
      const detail = await getChatDetail(chatId)
      const msgs: Message[] = detail.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "ai",
        content: m.content,
      }))
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, messages: msgs } : c)),
      )
    } catch (err) {
      console.error("Failed to load chat messages:", err)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Select a chat — load its messages if not yet loaded
  // ---------------------------------------------------------------------------
  const selectChat = useCallback(
    (id: string) => {
      setActiveChatId(id)
      setTransitionKey((k) => k + 1)
      const existing = chats.find((c) => c.id === id)
      if (existing && existing.messages.length === 0) {
        loadChatMessages(id)
      }
    },
    [chats, loadChatMessages],
  )

  // ---------------------------------------------------------------------------
  // New chat — creates on backend, prepends to list
  // ---------------------------------------------------------------------------
  const handleNewChat = useCallback(async () => {
    try {
      const created = await newChat()
      const fresh: Chat = {
        id: created.id,
        title: created.title,
        createdAt: created.created_at,
        timestamp: "Now",
        messages: [],
      }
      setChats((prev) => [fresh, ...prev])
      setActiveChatId(created.id)
      setTransitionKey((k) => k + 1)
    } catch (err) {
      console.error("Failed to create new chat:", err)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Delete a chat
  // ---------------------------------------------------------------------------
  const handleDeleteChat = useCallback(
    async (id: string) => {
      try {
        await deleteChat(id)
        setChats((prev) => {
          const remaining = prev.filter((c) => c.id !== id)
          // If we deleted the active chat, switch to the next one
          if (id === activeChatId && remaining.length > 0) {
            setActiveChatId(remaining[0].id)
            loadChatMessages(remaining[0].id)
          } else if (remaining.length === 0) {
            setActiveChatId("")
          }
          return remaining
        })
      } catch (err) {
        console.error("Failed to delete chat:", err)
      }
    },
    [activeChatId, loadChatMessages],
  )

  // ---------------------------------------------------------------------------
  // Rename a chat
  // ---------------------------------------------------------------------------
  const handleRenameChat = useCallback(async (id: string, title: string) => {
    try {
      const updated = await renameChat(id, title)
      setChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)),
      )
    } catch (err) {
      console.error("Failed to rename chat:", err)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !activeChatId) return

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed }
      const pendingId = `p-${Date.now()}`
      const pendingMsg: Message = { id: pendingId, role: "ai", content: "", pending: true }

      // Optimistic update — add messages to UI immediately
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId
            ? { ...c, messages: [...c.messages, userMsg, pendingMsg] }
            : c,
        ),
      )

      if (!activeSyllabusId) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === activeChatId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === pendingId
                      ? { ...m, pending: false, content: "Please attach a syllabus PDF first before asking questions." }
                      : m,
                  ),
                }
              : c,
          ),
        )
        return
      }

      // Call the backend — querySyllabus now requires chatId
      querySyllabus(activeSyllabusId, trimmed, activeChatId)
        .then((data) => {
          let content = data.answer
          if (data.citations && data.citations.length > 0) {
            content +=
              "\n\n**Sources:**\n" +
              data.citations
                .map((c: any) => `- "${c.quote}" (Page ${c.page_start})`)
                .join("\n")
          }
          setChats((prev) =>
            prev.map((c) =>
              c.id === activeChatId
                ? {
                    ...c,
                    // Update the title if the backend returned a new one (first message auto-title)
                    title: data.title ?? c.title,
                    messages: c.messages.map((m) =>
                      m.id === pendingId ? { ...m, pending: false, content } : m,
                    ),
                  }
                : c,
            ),
          )
        })
        .catch((error) => {
          console.error(error)
          setChats((prev) =>
            prev.map((c) =>
              c.id === activeChatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === pendingId
                        ? { ...m, pending: false, content: "Sorry, I encountered an error connecting to the AI." }
                        : m,
                    ),
                  }
                : c,
            ),
          )
        })
    },
    [activeChatId, activeSyllabusId],
  )

  // Listen to context's pendingQuery for dual-navigation triggering
  useEffect(() => {
    if (pendingQuery) {
      sendMessage(pendingQuery)
      setPendingQuery(null)
    }
  }, [pendingQuery, sendMessage, setPendingQuery])

  // ---------------------------------------------------------------------------
  // File attachments
  // ---------------------------------------------------------------------------
  const addAttachment = useCallback(
    async (file: AttachedFile) => {
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
        } catch (error) {
          console.error(error)
          setAttachments((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, status: "error" } : f)),
          )
        }
      }
    },
    [setActiveSyllabusId],
  )

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((f) => f.id !== id))
      setActiveSyllabusId(null)
    },
    [setActiveSyllabusId],
  )

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------
  const loadGraph = useCallback(async () => {
    if (!activeSyllabusId) return
    try {
      const data = await fetchGraph(activeSyllabusId)
      setGraphData(data)
    } catch (e) {
      console.error("Failed to load graph", e)
    }
  }, [activeSyllabusId])

  const handleReprocessGraph = useCallback(async () => {
    if (!activeSyllabusId) return
    try {
      const data = await reprocessGraph(activeSyllabusId)
      setGraphData(data)
    } catch (e) {
      console.error("Failed to reprocess graph", e)
    }
  }, [activeSyllabusId])

  const toggleViewMode = () => {
    if (viewMode === "chat") {
      setViewMode("graph")
      loadGraph()
    } else {
      setViewMode("chat")
    }
  }

  useEffect(() => {
    if (viewMode === "graph" && activeSyllabusId) {
      loadGraph()
    }
  }, [viewMode, activeSyllabusId, loadGraph])

  // Polling for processing/pending graph statuses every 3 seconds
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null
    if (
      viewMode === "graph" &&
      activeSyllabusId &&
      graphData &&
      (graphData.graph_status === "processing" || graphData.graph_status === "pending")
    ) {
      intervalId = setInterval(() => {
        loadGraph()
      }, 3000)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [viewMode, activeSyllabusId, graphData, loadGraph])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <main className="flex h-dvh w-full bg-background text-foreground">
      <HistorySidebar
        collapsed={sidebarCollapsed}
        chats={chats}
        activeId={activeChat?.id ?? ""}
        onSelect={selectChat}
        onNewChat={handleNewChat}
        onDelete={handleDeleteChat}
        onRename={handleRenameChat}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col border-l border-border/60 transition-[border-color] duration-300">
        <TopHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onAttachKnowledge={addAttachment}
        />

        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
            <div className="flex justify-end pt-2">
              {activeSyllabusId && (
                <button
                  onClick={toggleViewMode}
                  className="text-xs bg-secondary px-3 py-1.5 rounded-full transition-colors hover:bg-secondary/80 text-foreground font-medium border border-border"
                >
                  {viewMode === "chat" ? "View Knowledge Graph" : "Back to Chat"}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-hidden mt-2">
              {chatsLoading ? (
                // Loading skeleton
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/50">
                  <div className="h-2 w-32 animate-pulse rounded-full bg-muted-foreground/20" />
                  <div className="h-2 w-24 animate-pulse rounded-full bg-muted-foreground/20" />
                  <div className="h-2 w-28 animate-pulse rounded-full bg-muted-foreground/20" />
                </div>
              ) : viewMode === "chat" ? (
                <ChatThread key={transitionKey} messages={activeChat?.messages ?? []} onPrompt={sendMessage} />
              ) : graphData ? (
                <GraphCanvas
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  graphStatus={graphData.graph_status}
                  graphError={graphData.graph_error}
                  onReprocess={handleReprocessGraph}
                />
              ) : (
                <p className="text-center p-4 text-muted-foreground text-sm">Loading Graph...</p>
              )}
            </div>

            <div className="pb-6 pt-2">
              <ChatComposer
                attachments={attachments}
                onAddAttachment={addAttachment}
                onRemoveAttachment={removeAttachment}
                onSend={sendMessage}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default function Page() {
  return (
    <SyllabusProvider>
      <SyllabusWorkspace />
    </SyllabusProvider>
  )
}
