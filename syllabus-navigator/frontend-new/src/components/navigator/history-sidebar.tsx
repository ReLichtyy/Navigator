"use client"

import { Clock, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/components/navigator/types"

export function HistorySidebar({
  chats,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  collapsed = false,
}: {
  chats: Chat[]
  activeId: string
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
  collapsed?: boolean
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

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
        "hidden h-full shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        "transition-[width,opacity] duration-300 ease-in-out md:flex",
        collapsed ? "w-0 opacity-0 pointer-events-none" : "w-72 opacity-100",
      )}
    >
      {/* Inner wrapper keeps content at fixed width while parent animates */}
      <div className="flex h-full w-72 shrink-0 flex-col">
        {/* New chat */}
        <div className="px-4 pt-6 pb-3">
          <button
            type="button"
            onClick={onNewChat}
            className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:border-accent/40 hover:bg-sidebar-accent"
          >
            <Plus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-accent" />
            <span>New chat</span>
          </button>

          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Search className="h-4 w-4" />
            <span>Search</span>
          </button>
        </div>

        {/* History label */}
        <div className="px-7 pt-4 pb-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>History</span>
          </div>
        </div>

        {/* Chat list */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="flex flex-col gap-0.5">
            {chats.map((chat) => {
              const isActive = activeId === chat.id
              const isEditing = editingId === chat.id
              const isMenuOpen = menuOpenId === chat.id

              return (
                <li key={chat.id} className="relative">
                  <button
                    type="button"
                    onClick={() => { if (!isEditing) onSelect(chat.id) }}
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
                      <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/70">{chat.timestamp}</p>
                    </div>

                    {/* Three-dot context menu trigger */}
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

                  {/* Context dropdown */}
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
        </nav>

        {/* Footer hint */}
        <div className="px-6 pb-5 pt-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Navigator keeps your chats synced and private.
          </p>
        </div>
      </div>
    </aside>
  )
}
