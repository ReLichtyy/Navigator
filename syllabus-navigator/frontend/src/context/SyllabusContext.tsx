"use client"

import React, { createContext, useContext, useState, ReactNode } from "react"

type SyllabusContextType = {
  activeSyllabusId: string | null
  setActiveSyllabusId: (id: string | null) => void
  viewMode: "chat" | "graph"
  setViewMode: (mode: "chat" | "graph") => void
  pendingQuery: string | null
  setPendingQuery: (query: string | null) => void
  queryTopicInChat: (topicLabel: string) => void
}

const SyllabusContext = createContext<SyllabusContextType | undefined>(undefined)

export function SyllabusProvider({ children }: { children: ReactNode }) {
  const [activeSyllabusId, setActiveSyllabusId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"chat" | "graph">("chat")
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)

  const queryTopicInChat = (topicLabel: string) => {
    setViewMode("chat")
    setPendingQuery(
      `Could you provide an in-depth explanation of the topic "${topicLabel}" and how it connects with its prerequisites?`,
    )
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
