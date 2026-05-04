"use client"

import { Clock, MessageSquare, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/components/navigator/types"

export function HistorySidebar({
  chats,
  activeId,
  onSelect,
  onNewChat,
  collapsed = false,
}: {
  chats: Chat[]
  activeId: string
  onSelect: (id: string) => void
  onNewChat: () => void
  collapsed?: boolean
}) {
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
              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(chat.id)}
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
                      <p className="truncate text-sm leading-tight">{chat.title}</p>
                      <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/70">{chat.timestamp}</p>
                    </div>
                    {isActive && (
                      <span
                        aria-label="Active chat"
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--color-accent-soft)]"
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer hint */}
        <div className="px-6 pb-5 pt-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Navigator keeps your chats local and private.
          </p>
        </div>
      </div>
    </aside>
  )
}
