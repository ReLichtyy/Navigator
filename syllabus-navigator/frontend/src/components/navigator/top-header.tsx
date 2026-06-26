/**
 * top-header.tsx — Top header with Clerk session integration.
 */

"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Compass, MessageSquare, History, User as UserIcon } from "lucide-react"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { MobileNav } from "@/components/navigator/mobile-nav"

import type { AttachedFile, Chat } from "@/components/navigator/types"

interface TopHeaderProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenMobileHistory: () => void
  onAttachKnowledge: (file: AttachedFile) => Promise<void>
  onSelectKnowledge: (upload: { id: string; original_filename: string }) => Promise<void>
  activeDocumentName: string | null
  chats: Chat[]
  activeChatId: string
  onSelectChat: (id: string) => void
}

export function TopHeader({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenMobileHistory,
  onAttachKnowledge,
  onSelectKnowledge,
  activeDocumentName,
  chats,
  activeChatId,
  onSelectChat,
}: TopHeaderProps) {
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()

  // Collapse anchored on the brand: the 4 most recent chats + "Ver todos".
  const recentChats = chats.slice(0, 4)

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm md:hidden">
      <div className="flex items-center gap-1">
        <MobileNav />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-secondary"
              aria-label="Chats recientes"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-accent/35 bg-[linear-gradient(150deg,#1c2a22,#0f1611)] text-accent-bright">
                <Compass className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">Asistente</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {recentChats.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">Aún no hay chats.</div>
            ) : (
              recentChats.map((chat) => (
                <DropdownMenuItem
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className="cursor-pointer gap-2"
                >
                  <MessageSquare
                    className={
                      chat.id === activeChatId
                        ? "h-3.5 w-3.5 shrink-0 text-accent"
                        : "h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                    }
                  />
                  <span className="truncate">{chat.title}</span>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onOpenMobileHistory}
              className="cursor-pointer gap-2 font-medium text-accent"
            >
              <History className="h-3.5 w-3.5 shrink-0" />
              Ver todos los chats
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        {status === "anonymous" ? (
          <Button
            variant="ghost"
            size="sm"
            className="font-medium"
            onClick={() => openAuthModal("login")}
          >
            Sign In
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full bg-accent/10">
                <UserIcon className="h-5 w-5" />
                <span className="sr-only">Menú de perfil</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-sm font-medium">{displayName ?? "Usuario"}</div>
              <DropdownMenuItem onClick={resetIdentity} className="cursor-pointer text-destructive">
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
