"use client"

import { ChatComposer } from "@/components/navigator/chat-composer"
import { ChatThread } from "@/components/navigator/chat-thread"
import { ChatSkeleton } from "@/components/navigator/chat-skeleton"
import { ChatsModal } from "@/components/navigator/chats-modal"
import { HistorySidebar } from "@/components/navigator/history-sidebar"
import { MobileHistorySheet } from "@/components/navigator/mobile-history-sheet"
import { TopHeader } from "@/components/navigator/top-header"
import GraphCanvas from "@/components/GraphCanvas"
import { Button } from "@/components/ui/button"
import { ChatWorkspaceProvider, useChatWorkspace } from "@/features/chat/context/ChatContext"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { useEffect, useRef, useState } from "react"
import { Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"

function PageContent() {
  const ws = useChatWorkspace()
  const { status, ready } = useUser()
  const { openAuthModal, isOpen } = useAuthModal()
  const hasShownWelcome = useRef(false)
  const [allChatsOpen, setAllChatsOpen] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    if (!ready || (!ws.chatsLoading && ws.activeChatId)) {
      const docId = searchParams.get("docId")
      const docName = searchParams.get("docName")
      if (docId && docName && status !== "anonymous") {
        ws.selectKnowledge({ id: docId, original_filename: docName })
        router.replace("/") // clear the query params
      }
    }
  }, [ready, ws.chatsLoading, ws.activeChatId, searchParams, status, ws, router])

  // Actions arriving from the app sidebar (Asistente section): ?new=1, ?chat=<id>, ?history=1
  useEffect(() => {
    if (!ready || ws.chatsLoading) return
    const chatId = searchParams.get("chat")
    if (chatId) {
      if (ws.chats.some((c) => c.id === chatId)) ws.selectChat(chatId)
      router.replace("/")
      return
    }
    if (searchParams.get("new")) {
      ws.handleNewChat()
      router.replace("/")
      return
    }
    if (searchParams.get("history")) {
      setAllChatsOpen(true)
      router.replace("/")
    }
  }, [ready, ws.chatsLoading, searchParams, ws, router])

  useEffect(() => {
    if (ready && status === "anonymous" && !hasShownWelcome.current) {
      hasShownWelcome.current = true
      const timer = setTimeout(() => openAuthModal("welcome"), 100)
      return () => clearTimeout(timer)
    }
  }, [ready, status, openAuthModal])

  return (
    <main className="flex h-full w-full bg-background text-foreground">
      <HistorySidebar
        collapsed={ws.sidebarCollapsed}
        chats={ws.chats}
        activeId={ws.activeChat?.id ?? ""}
        loading={ws.chatsLoading}
        error={ws.chatsError}
        onSelect={ws.selectChat}
        onNewChat={ws.handleNewChat}
        onDelete={ws.handleDeleteChat}
        onRename={ws.handleRenameChat}
      />

      <ChatsModal
        open={allChatsOpen}
        onOpenChange={setAllChatsOpen}
        chats={ws.chats}
        activeId={ws.activeChat?.id ?? ""}
        onSelect={ws.selectChat}
        onNewChat={ws.handleNewChat}
      />

      <MobileHistorySheet
        open={ws.mobileHistoryOpen}
        onOpenChange={ws.setMobileHistoryOpen}
        chats={ws.chats}
        activeId={ws.activeChat?.id ?? ""}
        loading={ws.chatsLoading}
        onSelect={ws.selectChat}
        onNewChat={ws.handleNewChat}
        onDelete={ws.handleDeleteChat}
        onRename={ws.handleRenameChat}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col border-l border-border/60 transition-[border-color] duration-300">
        <TopHeader
          sidebarCollapsed={ws.sidebarCollapsed}
          onToggleSidebar={() => ws.setSidebarCollapsed((v) => !v)}
          onOpenMobileHistory={() => ws.setMobileHistoryOpen(true)}
          onAttachKnowledge={ws.addAttachment}
          onSelectKnowledge={ws.selectKnowledge}
          activeDocumentName={ws.activeDocumentName}
          chats={ws.chats}
          activeChatId={ws.activeChat?.id ?? ""}
          onSelectChat={ws.selectChat}
          onNewChat={ws.handleNewChat}
        />

        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
            <div className="flex justify-end pt-2">
              {ws.activeSyllabusId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={ws.toggleViewMode}
                  className="rounded-full text-xs"
                >
                  {ws.viewMode === "chat" ? "View Knowledge Graph" : "Back to Chat"}
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-hidden mt-2">
              {ws.chatsLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/50">
                  <div className="h-2 w-32 animate-pulse rounded-full bg-muted-foreground/20" />
                  <div className="h-2 w-24 animate-pulse rounded-full bg-muted-foreground/20" />
                  <div className="h-2 w-28 animate-pulse rounded-full bg-muted-foreground/20" />
                </div>
              ) : ws.viewMode === "chat" ? (
                ws.messagesLoading ? (
                  <ChatSkeleton />
                ) : (
                  <ChatThread
                    key={ws.transitionKey}
                    messages={ws.activeChat?.messages ?? []}
                    onPrompt={ws.sendMessage}
                  />
                )
              ) : ws.graphData ? (
                <GraphCanvas
                  nodes={ws.graphData.nodes}
                  edges={ws.graphData.edges}
                  graphStatus={ws.graphData.graph_status}
                  graphError={ws.graphData.graph_error}
                  onReprocess={ws.handleReprocessGraph}
                />
              ) : (
                <p className="text-center p-4 text-muted-foreground text-sm">Loading Graph...</p>
              )}
            </div>

            {ws.viewMode === "chat" && (
              <div className="pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">
                <ChatComposer
                  attachments={ws.attachments}
                  activeModel={ws.activeChat?.activeModel}
                  hasSyllabus={Boolean(ws.activeSyllabusId)}
                  disabled={ws.isSending || ws.isCreatingChat || ws.messagesLoading}
                  onAddAttachment={ws.addAttachment}
                  onRemoveAttachment={ws.removeAttachment}
                  onSend={ws.sendMessage}
                  onModelChange={ws.handleModelChange}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center">Loading...</div>}>
      <ChatWorkspaceProvider>
        <PageContent />
      </ChatWorkspaceProvider>
    </Suspense>
  )
}
