"use client"

import { Clock, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X, User as UserIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/components/navigator/types"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function HistorySidebar({
  chats,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  collapsed = false,
  loading = false,
  error = null,
  embedded = false,
}: {
  chats: Chat[]
  activeId: string
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
  collapsed?: boolean
  loading?: boolean
  error?: string | null
  embedded?: boolean
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => c.title.toLowerCase().includes(q))
  }, [chats, searchQuery])

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setMenuOpenId((prev) => (prev === id ? null : id))
  }

  const startRename = (e: React.MouseEvent, chat: Chat) => {
    e.stopPropagation()
    setMenuOpenId(null)
    setEditingId(chat.id)
    setEditValue(chat.title)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const commitRename = (id: string) => {
    const trimmed = editValue.trim()
    if (trimmed && onRename) onRename(id, trimmed)
    setEditingId(null)
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setMenuOpenId(null)
    if (onDelete) onDelete(id)
  }

  return (
    <aside
      aria-label="Chat history"
      aria-hidden={collapsed}
      className={cn(
        "h-full shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        embedded ? "flex w-full opacity-100" : "hidden transition-[width,opacity] duration-300 ease-in-out md:flex",
        !embedded && (collapsed ? "w-0 opacity-0 pointer-events-none" : "w-72 opacity-100"),
      )}
    >
      <div className="flex h-full w-72 shrink-0 flex-col">
        <div className="px-4 pt-6 pb-3">
          <button
            type="button"
            onClick={onNewChat}
            className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:border-accent/40 hover:bg-sidebar-accent"
          >
            <Plus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-accent" />
            <span>New chat</span>
          </button>

          {searchOpen ? (
            <div className="mt-1 flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2 py-1">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery("")
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true)
                setTimeout(() => searchRef.current?.focus(), 50)
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Search className="h-4 w-4" />
              <span>Search</span>
            </button>
          )}
        </div>

        <div className="px-7 pt-4 pb-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>History</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {loading ? (
            <div className="flex flex-col gap-2 px-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted-foreground/10" />
              ))}
            </div>
          ) : error ? (
            <p className="px-3 py-4 text-sm text-red-400">{error}</p>
          ) : filteredChats.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {searchQuery ? "No chats match your search." : "No chats yet. Start a new conversation."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filteredChats.map((chat) => {
                const isActive = activeId === chat.id
                const isEditing = editingId === chat.id
                const isMenuOpen = menuOpenId === chat.id

                return (
                  <li key={chat.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isEditing) onSelect(chat.id)
                      }}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "group relative flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                        isActive
                          ? "bg-accent-soft text-sidebar-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <MessageSquare
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors",
                          isActive ? "text-accent" : "text-muted-foreground/70 group-hover:text-foreground",
                        )}
                        strokeWidth={2.25}
                      />
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitRename(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(chat.id)
                              if (e.key === "Escape") setEditingId(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full truncate rounded bg-transparent text-sm leading-tight outline-none ring-1 ring-accent/50 px-1 -mx-1 text-sidebar-foreground"
                          />
                        ) : (
                          <p className="truncate text-sm leading-tight">{chat.title}</p>
                        )}
                        <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/70">
                          {chat.timestamp}
                          {chat.messageCount != null && chat.messageCount > 0
                            ? ` · ${chat.messageCount} msg`
                            : ""}
                        </p>
                      </div>

                      {(onDelete || onRename) && (
                        <button
                          type="button"
                          onClick={(e) => openMenu(e, chat.id)}
                          aria-label="Chat options"
                          className={cn(
                            "ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity",
                            "text-muted-foreground/60 hover:text-foreground",
                            isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {isActive && !isMenuOpen && (
                        <span
                          aria-label="Active chat"
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--color-accent-soft)]"
                        />
                      )}
                    </button>

                    {isMenuOpen && (
                      <div
                        className={cn(
                          "absolute right-2 top-8 z-50 min-w-[140px] rounded-lg border border-border/60 bg-card shadow-lg",
                          "animate-in fade-in-0 zoom-in-95 duration-100",
                        )}
                        onMouseLeave={() => setMenuOpenId(null)}
                      >
                        {onRename && (
                          <button
                            type="button"
                            onClick={(e) => startRename(e, chat)}
                            className="flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-sidebar-accent"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            Rename
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, chat.id)}
                            className="flex w-full items-center gap-2 rounded-b-lg px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </nav>

        <div className="px-4 pb-5 pt-3 border-t border-border/40">
          {status === "anonymous" ? (
            <button 
              onClick={() => openAuthModal("login")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
                <UserIcon className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sidebar-foreground">Sign In</p>
              </div>
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
                    <UserIcon className="h-4 w-4 text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sidebar-foreground">
                      {status === "guest" ? "Guest User" : displayName ?? "User"}
                    </p>
                  </div>
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" sideOffset={8} className="w-56">
                <div className="px-2 py-1.5 text-sm font-medium">
                  {status === "guest" ? "Guest User" : displayName ?? "User"}
                </div>
                {status === "guest" ? (
                  <DropdownMenuItem onClick={() => openAuthModal("signup")} className="cursor-pointer text-accent">
                    Create Account
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={resetIdentity} className="text-red-500 cursor-pointer">
                  {status === "guest" ? "Leave Guest Session" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </aside>
  )
}
