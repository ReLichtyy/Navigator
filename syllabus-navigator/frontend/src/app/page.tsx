"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChatComposer } from "@/components/navigator/chat-composer"
import { ChatThread } from "@/components/navigator/chat-thread"
import { HistorySidebar } from "@/components/navigator/history-sidebar"
import { TopHeader } from "@/components/navigator/top-header"
import type { AttachedFile, Chat, Message } from "@/components/navigator/types"
import GraphCanvas from "@/components/GraphCanvas"
import { SyllabusProvider, useSyllabus } from "@/context/SyllabusContext"

const initialChats: Chat[] = [
  {
    id: "1",
    title: "Q3 financial report summary",
    timestamp: "Today",
    messages: [
      { id: "m1", role: "user", content: "Can you summarize the Q3 financial report?" },
      {
        id: "m2",
        role: "ai",
        content:
          "Q3 revenue grew 12% YoY to $48.2M, driven by enterprise upsells. Operating margin held at 21%, and net new ARR was $6.4M. Want me to break down the segments?",
      },
    ],
  },
  {
    id: "2",
    title: "Compare lease agreements",
    timestamp: "Today",
    messages: [
      { id: "m3", role: "user", content: "Compare the two lease drafts I attached earlier." },
      {
        id: "m4",
        role: "ai",
        content:
          "Lease A has a 5-year term with a 3% annual escalator and a tenant-favorable exit clause. Lease B is 7 years, flat rent for the first two years, then 4% escalators. The biggest delta is total rent over term: ~$1.1M lower for Lease A.",
      },
    ],
  },
  { id: "3", title: "Research notes on climate tech", timestamp: "Yesterday", messages: [] },
  { id: "4", title: "Onboarding handbook review", timestamp: "Yesterday", messages: [] },
  { id: "5", title: "Product spec — v2 launch", timestamp: "2 days ago", messages: [] },
  { id: "6", title: "Travel itinerary draft", timestamp: "Last week", messages: [] },
  { id: "7", title: "Investor memo feedback", timestamp: "Last week", messages: [] },
]

type GraphData = {
  syllabus_id: string;
  graph_status: string;
  graph_error: string | null;
  nodes: any[];
  edges: any[];
};

function SyllabusWorkspace() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chats, setChats] = useState<Chat[]>(initialChats)
  const [activeChatId, setActiveChatId] = useState<string>(initialChats[0].id)
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  
  const { activeSyllabusId, setActiveSyllabusId, viewMode, setViewMode, pendingQuery, setPendingQuery } = useSyllabus();
  const [graphData, setGraphData] = useState<GraphData | null>(null)

  // Used to retrigger the fade-in animation when switching chats.
  const [transitionKey, setTransitionKey] = useState(0)

  // Track in-flight AI replies so we can clean them up on unmount/switch.
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0]

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id)
    setTransitionKey((k) => k + 1)
  }, [])

  const newChat = useCallback(() => {
    const id = `c-${Date.now()}`
    const fresh: Chat = { id, title: "New chat", timestamp: "Now", messages: [] }
    setChats((prev) => [fresh, ...prev])
    setActiveChatId(id)
    setTransitionKey((k) => k + 1)
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed }
      const pendingId = `p-${Date.now()}`
      const pendingMsg: Message = { id: pendingId, role: "ai", content: "", pending: true }

      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId
            ? {
                ...c,
                title: c.messages.length === 0 ? trimmed.slice(0, 48) : c.title,
                messages: [...c.messages, userMsg, pendingMsg],
              }
            : c,
        ),
      )

      if (!activeSyllabusId) {
        setChats((prev) => prev.map((c) => c.id === activeChatId ? {
          ...c, messages: c.messages.map((m) => m.id === pendingId ? {
            ...m, pending: false, content: "Please attach a syllabus PDF first before asking questions."
          } : m)
        } : c))
        return
      }

      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/chat/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "dev-user-1",
        },
        body: JSON.stringify({
          syllabus_id: activeSyllabusId,
          question: trimmed,
        }),
      })
      .then(async (response) => {
        if (!response.ok) throw new Error("Chat query failed")
        const data = await response.json()
        let content = data.answer
        if (data.citations && data.citations.length > 0) {
          content += "\n\n**Sources:**\n" + data.citations.map((c: any) => `- "${c.quote}" (Page ${c.page_start})`).join("\n")
        }
        setChats((prev) => prev.map((c) => c.id === activeChatId ? {
          ...c, messages: c.messages.map((m) => m.id === pendingId ? {
            ...m, pending: false, content
          } : m)
        } : c))
      })
      .catch((error) => {
        console.error(error)
        setChats((prev) => prev.map((c) => c.id === activeChatId ? {
          ...c, messages: c.messages.map((m) => m.id === pendingId ? {
            ...m, pending: false, content: "Sorry, I encountered an error connecting to the AI."
          } : m)
        } : c))
      })
    },
    [activeChatId, activeSyllabusId],
  )

  // Listen to context's pendingQuery for dual-navigation triggering
  useEffect(() => {
    if (pendingQuery) {
      sendMessage(pendingQuery);
      setPendingQuery(null);
    }
  }, [pendingQuery, sendMessage, setPendingQuery]);

  const addAttachment = useCallback(async (file: AttachedFile) => {
    setAttachments((prev) => (prev.some((f) => f.id === file.id) ? prev : [...prev, file]))

    if (file.file) {
      try {
        const formData = new FormData()
        formData.append("file", file.file)
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/upload/syllabus`, {
          method: "POST",
          headers: {
            "X-User-Id": "dev-user-1", // Hardcoded for dev parity with backend MVP
          },
          body: formData,
        })
        
        if (!response.ok) throw new Error("Upload failed")
        
        const data = await response.json()
        setAttachments((prev) => 
          prev.map((f) => f.id === file.id ? { ...f, status: "ready", syllabus_id: data.syllabus_id } : f)
        )
        setActiveSyllabusId(data.syllabus_id);
      } catch (error) {
        console.error(error)
        setAttachments((prev) => 
          prev.map((f) => f.id === file.id ? { ...f, status: "error" } : f)
        )
      }
    }
  }, [setActiveSyllabusId])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((f) => f.id !== id))
    // Also reset active syllabus in context if removed
    setActiveSyllabusId(null);
  }, [setActiveSyllabusId])

  const loadGraph = useCallback(async () => {
    if (!activeSyllabusId) return

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/graph/${activeSyllabusId}`)
      if (response.ok) {
        const data = await response.json()
        setGraphData(data)
      }
    } catch (e) {
      console.error("Failed to load graph", e)
    }
  }, [activeSyllabusId])

  const handleReprocessGraph = useCallback(async () => {
    if (!activeSyllabusId) return

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/graph/${activeSyllabusId}/reprocess`, {
        method: "POST"
      })
      if (response.ok) {
        const data = await response.json()
        setGraphData(data)
      }
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

  // Trigger loading graph when viewMode switches to graph or when activeSyllabusId changes
  useEffect(() => {
    if (viewMode === "graph" && activeSyllabusId) {
      loadGraph();
    }
  }, [viewMode, activeSyllabusId, loadGraph]);

  // Polling for processing/pending graph statuses every 3 seconds
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (
      viewMode === "graph" &&
      activeSyllabusId &&
      graphData &&
      (graphData.graph_status === "processing" || graphData.graph_status === "pending")
    ) {
      intervalId = setInterval(() => {
        loadGraph();
      }, 3000);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [viewMode, activeSyllabusId, graphData, loadGraph]);

  return (
    <main className="flex h-dvh w-full bg-background text-foreground">
      <HistorySidebar
        collapsed={sidebarCollapsed}
        chats={chats}
        activeId={activeChat.id}
        onSelect={selectChat}
        onNewChat={newChat}
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
                <button onClick={toggleViewMode} className="text-xs bg-secondary px-3 py-1.5 rounded-full transition-colors hover:bg-secondary/80 text-foreground font-medium border border-border">
                  {viewMode === "chat" ? "View Knowledge Graph" : "Back to Chat"}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-hidden mt-2">
              {viewMode === "chat" ? (
                <ChatThread key={transitionKey} messages={activeChat.messages} />
              ) : (
                graphData ? (
                  <GraphCanvas
                    nodes={graphData.nodes}
                    edges={graphData.edges}
                    graphStatus={graphData.graph_status}
                    graphError={graphData.graph_error}
                    onReprocess={handleReprocessGraph}
                  />
                ) : (
                  <p className="text-center p-4 text-muted-foreground text-sm">Loading Graph...</p>
                )
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
