/**
 * top-header.tsx — mobile chat header (Chat Movil design).
 * Left: drawer trigger (sidebar with sections + chat history). Center: assistant
 * brand + status. Right: new-chat. History lives inside the sidebar drawer.
 */

"use client"

import { ChevronDown, Compass, MessageSquare, History, SquarePen } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { useChatNav } from "@/context/ChatNavContext"
import { useBienvenida } from "@/context/BienvenidaContext"

import type { AttachedFile, Chat } from "@/components/navigator/types"

interface TopHeaderProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onAttachKnowledge: (file: AttachedFile) => Promise<void>
  onSelectKnowledge: (upload: { id: string; original_filename: string }) => Promise<void>
  activeDocumentName: string | null
  chats: Chat[]
  activeChatId: string
  onSelectChat: (id: string) => void
  onNewChat: () => void
}

export function TopHeader({
  activeDocumentName,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
}: TopHeaderProps) {
  // Chat history rendered inside the sidebar drawer (mobile). Collapsible like
  // the desktop sidebar so a long history never crowds the nav sections.
  const [chatsOpen, setChatsOpen] = useState(true)
  const nav = useChatNav()
  const { openBienvenida } = useBienvenida()
  const drawerHistory = (
    <>
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          aria-expanded={chatsOpen}
          // The drawer wrapper closes on any click; collapsing must not close it.
          onClick={(e) => {
            e.stopPropagation()
            setChatsOpen((v) => !v)
          }}
          className="flex items-center gap-1 rounded-md py-0.5 pr-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-3 w-3 shrink-0 transition-transform", !chatsOpen && "-rotate-90")}
          />
          Chats
        </button>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          + Nuevo
        </button>
      </div>

      <div className={cn("-mr-1 min-h-0 flex-1 overflow-y-auto pr-1", !chatsOpen && "hidden")}>
        {chats.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Aún no hay chats.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {chats.map((chat) => {
              const active = chat.id === activeChatId
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-accent-soft text-sidebar-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <MessageSquare
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-accent" : "text-muted-foreground/70",
                      )}
                      strokeWidth={2.25}
                    />
                    <span className="truncate">{chat.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => nav.setAllChatsOpen(true)}
        className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
      >
        <History className="h-3.5 w-3.5 shrink-0" />
        Ver todos los chats
      </button>
    </>
  )

  return (
    <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-border/60 bg-background/85 pb-0 pl-3 pr-[calc(3.5rem+env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        <MobileNav>{drawerHistory}</MobileNav>

        <button
          type="button"
          onClick={openBienvenida}
          aria-label="Ver la bienvenida"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-accent/35 bg-[linear-gradient(150deg,#1c2a22,#0f1611)] text-accent shadow-[0_0_16px_rgba(63,191,132,0.12)]"
        >
          <Compass className="h-[17px] w-[17px]" strokeWidth={1.9} />
        </button>

        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[15px] font-extrabold tracking-tight text-foreground">
            Asistente
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            <span className="truncate">{activeDocumentName ?? "En línea"}</span>
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onNewChat}
        aria-label="Nuevo chat"
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <SquarePen className="h-[19px] w-[19px]" strokeWidth={1.9} />
      </button>
    </header>
  )
}
