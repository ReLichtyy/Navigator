/**
 * top-header.tsx — Top header with NextAuth session integration.
 */

"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Menu, Plus, Upload, User as UserIcon } from "lucide-react"
import { useUser } from "@/context/UserContext"

import type { AttachedFile } from "@/components/navigator/types"

interface TopHeaderProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenMobileHistory: () => void
  onAttachKnowledge: (file: AttachedFile) => Promise<void>
  onSelectKnowledge: (upload: { id: string; original_filename: string }) => Promise<void>
  activeDocumentName: string | null
}

export function TopHeader({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenMobileHistory,
  onAttachKnowledge,
  onSelectKnowledge,
  activeDocumentName,
}: TopHeaderProps) {
  const { displayName, resetIdentity } = useUser()

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm md:hidden">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onOpenMobileHistory} className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full bg-accent/10">
              <UserIcon className="h-5 w-5" />
              <span className="sr-only">Profile menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5 text-sm font-medium">
              {displayName ?? "User"}
            </div>
            <DropdownMenuItem onClick={resetIdentity} className="text-red-500 cursor-pointer">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
