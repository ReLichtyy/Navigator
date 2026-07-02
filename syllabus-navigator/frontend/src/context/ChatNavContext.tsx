"use client"

import React, { createContext, useCallback, useContext, useState } from "react"

/**
 * Chat navigation intents shared between the app sidebar (outside the chat
 * workspace) and the Asistente page (inside it). The sidebar records an intent;
 * the page consumes it once the chat workspace is ready. Replaces the previous
 * URL-param signaling (?chat= / ?new= / ?history=), which raced with navigation.
 */
interface ChatNavState {
  /** Chat the sidebar asked to open; page consumes + clears. */
  pendingChatId: string | null
  requestChat: (id: string) => void
  clearPendingChat: () => void
  /** Monotonic counter; each bump = one "Nuevo chat" request. */
  newChatTick: number
  requestNewChat: () => void
  /** "Tus chats" modal (Ver todos los chats). */
  allChatsOpen: boolean
  setAllChatsOpen: (open: boolean) => void
}

const ChatNavContext = createContext<ChatNavState | undefined>(undefined)

export function ChatNavProvider({ children }: { children: React.ReactNode }) {
  const [pendingChatId, setPendingChatId] = useState<string | null>(null)
  const [newChatTick, setNewChatTick] = useState(0)
  const [allChatsOpen, setAllChatsOpen] = useState(false)

  const requestChat = useCallback((id: string) => setPendingChatId(id), [])
  const clearPendingChat = useCallback(() => setPendingChatId(null), [])
  const requestNewChat = useCallback(() => setNewChatTick((t) => t + 1), [])

  return (
    <ChatNavContext.Provider
      value={{
        pendingChatId,
        requestChat,
        clearPendingChat,
        newChatTick,
        requestNewChat,
        allChatsOpen,
        setAllChatsOpen,
      }}
    >
      {children}
    </ChatNavContext.Provider>
  )
}

export function useChatNav() {
  const ctx = useContext(ChatNavContext)
  if (!ctx) throw new Error("useChatNav must be used within ChatNavProvider")
  return ctx
}
