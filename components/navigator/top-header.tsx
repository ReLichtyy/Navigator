"use client"

import { ChevronDown, FileText, Library, LogOut, PanelLeft, Plus, Settings, User, UserCircle } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { AttachedFile } from "@/components/navigator/types"

type KnowledgeFile = {
  id: string
  name: string
  size: string
  updated: string
}

const knowledgeFiles: KnowledgeFile[] = [
  { id: "k1", name: "Company_Guidelines.pdf", size: "1.8 MB", updated: "Updated today" },
  { id: "k2", name: "API_Documentation.pdf", size: "3.2 MB", updated: "Updated 2d ago" },
  { id: "k3", name: "Brand_Voice_2025.pdf", size: "640 KB", updated: "Updated last week" },
  { id: "k4", name: "Onboarding_Handbook.pdf", size: "2.1 MB", updated: "Updated last month" },
]

export function TopHeader({
  sidebarCollapsed = false,
  onToggleSidebar,
  onAttachKnowledge,
}: {
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onAttachKnowledge?: (file: AttachedFile) => void
}) {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Brand + sidebar toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold tracking-tight text-accent">Navigator</span>

        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={!sidebarCollapsed}
          className="ml-1 hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex"
        >
          <PanelLeft
            className={cn(
              "h-4 w-4 transition-transform duration-300",
              sidebarCollapsed && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* Right cluster: Knowledge + Profile (parity) */}
      <div className="flex items-center gap-1">
        <Popover open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open account knowledge"
              className={cn(
                "hidden items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:flex",
                knowledgeOpen
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Library className="h-4 w-4" strokeWidth={2.25} />
              <span>Knowledge</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-80 rounded-xl border border-border/70 p-0 shadow-lg"
          >
            <div className="px-4 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-accent ring-1 ring-accent/20"
                >
                  <Library className="h-3.5 w-3.5" strokeWidth={2.25} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">Account Knowledge</p>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    Files grounded across every chat.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-border/60 px-2 py-1.5">
              <ul className="flex flex-col">
                {knowledgeFiles.map((file) => (
                  <li key={file.id}>
                    <div className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-secondary">
                      <FileText
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-accent"
                        strokeWidth={2.25}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] leading-tight text-foreground">{file.name}</p>
                        <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/70">
                          {file.size} · {file.updated}
                        </p>
                      </div>

                      {/* Hover-only "Add to Chat" */}
                      <button
                        type="button"
                        onClick={() => {
                          onAttachKnowledge?.({ id: file.id, name: file.name, size: file.size })
                          setKnowledgeOpen(false)
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent opacity-0 transition-opacity hover:bg-accent-soft group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Plus className="h-3 w-3" strokeWidth={2.5} />
                        Add to Chat
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border/60 px-3 py-2">
              <button
                type="button"
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Manage knowledge base
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={profileOpen} onOpenChange={setProfileOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open profile menu"
              className={cn(
                "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors",
                profileOpen
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <User className="h-4 w-4" strokeWidth={2.25} />
              <span className="hidden sm:inline">User Name</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-56 rounded-xl border border-border/70 p-0 shadow-lg"
          >
            <div className="flex items-center gap-2 px-3 py-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/20"
              >
                <UserCircle className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight">User Name</p>
                <p className="truncate text-[11px] leading-tight text-muted-foreground">
                  user@navigator.app
                </p>
              </div>
            </div>

            <div className="border-t border-border/60 p-1">
              <ProfileItem icon={Settings} label="Settings" />
              <ProfileItem icon={UserCircle} label="Account" />
            </div>
            <div className="border-t border-border/60 p-1">
              <ProfileItem icon={LogOut} label="Sign Out" />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}

function ProfileItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
    >
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2.25} />
      <span>{label}</span>
      <ChevronDown className="ml-auto hidden h-3.5 w-3.5 -rotate-90 text-muted-foreground/60" strokeWidth={2.25} />
    </button>
  )
}
