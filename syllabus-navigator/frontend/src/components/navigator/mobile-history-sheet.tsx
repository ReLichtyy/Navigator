"use client"

import { HistorySidebar } from "@/components/navigator/history-sidebar"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { Chat } from "@/components/navigator/types"

export function MobileHistorySheet({
  open,
  onOpenChange,
  chats,
  activeId,
  loading,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chats: Chat[]
  activeId: string
  loading?: boolean
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 md:hidden">
        <SheetHeader className="sr-only">
          <SheetTitle>Chat history</SheetTitle>
        </SheetHeader>
        <div className="h-full">
          <HistorySidebar
            embedded
            chats={chats}
            activeId={activeId}
            loading={loading}
            onSelect={onSelect}
            onNewChat={onNewChat}
            onDelete={onDelete}
            onRename={onRename}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
