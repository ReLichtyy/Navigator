"use client"

import React, { createContext, useContext, useState, ReactNode } from "react"

/**
 * A question stashed for the chat workspace (consumed by ChatContext). When it
 * carries a course/doc binding, it is routed to that scope's dedicated ask-chat
 * — created lazily on the first ask and reused afterwards — instead of spawning
 * a new chat per question.
 */
export type PendingAsk = {
  text: string
  /** Route to this course's dedicated ask-chat (takes precedence over syllabusId). */
  courseId?: string | null
  /** Doc-scoped asks: per-document ask-chat + RAG bound to that document. */
  syllabusId?: string | null
}

type SyllabusContextType = {
  activeSyllabusId: string | null
  setActiveSyllabusId: (id: string | null) => void
  viewMode: "chat" | "graph"
  setViewMode: (mode: "chat" | "graph") => void
  pendingQuery: PendingAsk | null
  setPendingQuery: (query: PendingAsk | null) => void
  queryTopicInChat: (topicLabel: string) => void
}

const SyllabusContext = createContext<SyllabusContextType | undefined>(undefined)

export function SyllabusProvider({ children }: { children: ReactNode }) {
  const [activeSyllabusId, setActiveSyllabusId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"chat" | "graph">("chat")
  const [pendingQuery, setPendingQuery] = useState<PendingAsk | null>(null)

  const queryTopicInChat = (topicLabel: string) => {
    setViewMode("chat")
    setPendingQuery({
      text: `Could you provide an in-depth explanation of the topic "${topicLabel}" and how it connects with its prerequisites?`,
    })
  }

  return (
    <SyllabusContext.Provider
      value={{
        activeSyllabusId,
        setActiveSyllabusId,
        viewMode,
        setViewMode,
        pendingQuery,
        setPendingQuery,
        queryTopicInChat,
      }}
    >
      {children}
    </SyllabusContext.Provider>
  )
}

export function useSyllabus() {
  const context = useContext(SyllabusContext)
  if (context === undefined) {
    throw new Error("useSyllabus must be used within a SyllabusProvider")
  }
  return context
}
