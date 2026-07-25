"use client"

import React, { createContext, useCallback, useContext, useRef, useState } from "react"
import { toast } from "sonner"
import { deleteChat as apiDeleteChat } from "@/lib/api"
import { useConfirm } from "@/components/ui/confirm-dialog"

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
  /** Shared deletion flow for the app shell and the chat workspace. */
  deleteChat: (id: string) => Promise<boolean>
  deletedChat: { id: string; revision: number } | null
}

const ChatNavContext = createContext<ChatNavState | undefined>(undefined)

export function ChatNavProvider({ children }: { children: React.ReactNode }) {
  const [pendingChatId, setPendingChatId] = useState<string | null>(null)
  const [newChatTick, setNewChatTick] = useState(0)
  const [allChatsOpen, setAllChatsOpen] = useState(false)
  const [deletedChat, setDeletedChat] = useState<{ id: string; revision: number } | null>(null)
  const deleteInFlightRef = useRef(false)
  const { confirm, confirmDialog } = useConfirm()

  const requestChat = useCallback((id: string) => setPendingChatId(id), [])
  const clearPendingChat = useCallback(() => setPendingChatId(null), [])
  const requestNewChat = useCallback(() => setNewChatTick((t) => t + 1), [])
  const deleteChat = useCallback(
    async (id: string) => {
      if (deleteInFlightRef.current) return false
      const approved = await confirm({
        title: "¿Eliminar este chat?",
        description: "Se eliminarán también todos sus mensajes. Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar chat",
        destructive: true,
      })
      if (!approved || deleteInFlightRef.current) return false

      deleteInFlightRef.current = true
      try {
        await apiDeleteChat(id)
        setDeletedChat((current) => ({
          id,
          revision: (current?.revision ?? 0) + 1,
        }))
        toast.success("Chat eliminado")
        return true
      } catch {
        toast.error("No se pudo eliminar el chat")
        return false
      } finally {
        deleteInFlightRef.current = false
      }
    },
    [confirm],
  )

  return (
    <>
      <ChatNavContext.Provider
        value={{
          pendingChatId,
          requestChat,
          clearPendingChat,
          newChatTick,
          requestNewChat,
          allChatsOpen,
          setAllChatsOpen,
          deleteChat,
          deletedChat,
        }}
      >
        {children}
      </ChatNavContext.Provider>
      {confirmDialog}
    </>
  )
}

export function useChatNav() {
  const ctx = useContext(ChatNavContext)
  if (!ctx) throw new Error("useChatNav must be used within ChatNavProvider")
  return ctx
}
