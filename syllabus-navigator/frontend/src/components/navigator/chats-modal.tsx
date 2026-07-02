"use client"

import { useMemo, useState } from "react"
import { MessageSquare, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Chat } from "@/components/navigator/types"

/** Navigator v2 "Tus chats" modal: full chat list with search, opened from the
 *  app sidebar's "Ver todos los chats". */
export function ChatsModal({
  open,
  onOpenChange,
  chats,
  activeId,
  onSelect,
  onNewChat,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chats: Chat[]
  activeId: string
  onSelect: (id: string) => void
  onNewChat: () => void
}) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) || (c.syllabusName ?? "").toLowerCase().includes(q),
    )
  }, [chats, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10%] max-h-[80dvh] translate-y-0 gap-0 overflow-hidden rounded-[20px] border-border bg-card p-0 sm:max-w-[620px]">
        {/* header */}
        <div className="border-b border-border/60 px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3 pr-8">
            <div>
              <DialogTitle className="text-[17px] font-extrabold tracking-tight text-foreground">
                Tus chats
              </DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {chats.length} {chats.length === 1 ? "conversación" : "conversaciones"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onNewChat()
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[linear-gradient(135deg,#3FBF84,#2c9a66)] px-3.5 py-2 text-xs font-bold text-[#06140D] transition-[filter] hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Nuevo chat
            </button>
          </div>

          {/* search */}
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-background/40 px-3.5 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por tema, curso o palabra clave…"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
              autoFocus
            />
          </div>
        </div>

        {/* list */}
        <div className="flex flex-col gap-2 overflow-y-auto p-3.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {query ? "Ningún chat coincide con tu búsqueda." : "Aún no tienes chats."}
            </p>
          ) : (
            filtered.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  onSelect(chat.id)
                  onOpenChange(false)
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[13px] border px-3.5 py-3 text-left transition-colors hover:border-accent/35 hover:bg-accent/5",
                  activeId === chat.id ? "border-accent/35 bg-accent/5" : "border-border/60",
                )}
              >
                <span className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent/10">
                  <MessageSquare className="h-4 w-4 text-accent-bright" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-foreground">
                      {chat.title}
                    </span>
                    {chat.syllabusName && (
                      <span className="shrink-0 rounded-[5px] border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-bright">
                        {chat.syllabusName}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground/70">
                    {chat.timestamp}
                    {chat.messageCount != null && chat.messageCount > 0
                      ? ` · ${chat.messageCount} mensajes`
                      : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
