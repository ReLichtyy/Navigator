"use client"

import { ChevronDown, FileText, History, Library, LogOut, PanelLeft, Plus, Settings, User, UserCircle } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { AttachedFile } from "@/components/navigator/types"
import { useUser } from "@/context/UserContext"
import { listSyllabi, type SyllabusUploadAPI } from "@/lib/api"
import { relativeTime } from "@/hooks/useChatWorkspace"

export function TopHeader({
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenMobileHistory,
  onAttachKnowledge,
  onSelectKnowledge,
  activeDocumentName,
}: {
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onOpenMobileHistory?: () => void
  onAttachKnowledge?: (file: AttachedFile) => void
  onSelectKnowledge?: (upload: SyllabusUploadAPI) => void
  activeDocumentName?: string | null
}) {
  const { userId, displayName, setDisplayName, resetIdentity } = useUser()
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [loadingUploads, setLoadingUploads] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(displayName)

  const loadUploads = useCallback(async () => {
    setLoadingUploads(true)
    try {
      const data = await listSyllabi()
      setUploads(data.uploads)
    } catch {
      setUploads([])
    } finally {
      setLoadingUploads(false)
    }
  }, [])

  useEffect(() => {
    if (knowledgeOpen) loadUploads()
  }, [knowledgeOpen, loadUploads])

  const shortId = userId ? `${userId.slice(0, 8)}…` : "…"

  return (
    <header className="flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[15px] font-semibold tracking-tight text-accent shrink-0">Navigator</span>

        <button
          type="button"
          onClick={onOpenMobileHistory}
          aria-label="Open chat history"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
        >
          <History className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={!sidebarCollapsed}
          className="ml-1 hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex"
        >
          <PanelLeft
            className={cn("h-4 w-4 transition-transform duration-300", sidebarCollapsed && "rotate-180")}
          />
        </button>

        {activeDocumentName && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline max-w-[200px]">
            · {activeDocumentName}
          </span>
        )}
      </div>

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
          <PopoverContent align="end" sideOffset={8} className="w-80 rounded-xl border border-border/70 p-0 shadow-lg">
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
                  <p className="text-[11px] leading-tight text-muted-foreground">Your uploaded syllabi.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border/60 px-2 py-1.5 max-h-64 overflow-y-auto">
              {loadingUploads ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
              ) : uploads.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">No uploads yet. Attach a PDF in chat.</p>
              ) : (
                <ul className="flex flex-col">
                  {uploads.map((file) => (
                    <li key={file.id}>
                      <div className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-secondary">
                        <FileText
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-accent"
                          strokeWidth={2.25}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] leading-tight text-foreground">{file.original_filename}</p>
                          <p className="mt-0.5 text-[11px] leading-none text-muted-foreground/70">
                            {file.status} · {relativeTime(file.created_at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectKnowledge?.(file)
                            setKnowledgeOpen(false)
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent opacity-0 transition-opacity hover:bg-accent-soft group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Plus className="h-3 w-3" strokeWidth={2.5} />
                          Use
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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
              <span className="hidden sm:inline max-w-[120px] truncate">{displayName}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-56 rounded-xl border border-border/70 p-0 shadow-lg">
            <div className="flex items-center gap-2 px-3 py-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/20"
              >
                <UserCircle className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => {
                      setDisplayName(nameDraft)
                      setEditingName(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setDisplayName(nameDraft)
                        setEditingName(false)
                      }
                    }}
                    className="w-full text-sm font-medium bg-transparent outline-none ring-1 ring-accent/40 rounded px-1"
                    autoFocus
                  />
                ) : (
                  <button type="button" onClick={() => { setNameDraft(displayName); setEditingName(true) }} className="truncate text-sm font-medium leading-tight text-left w-full hover:text-accent">
                    {displayName}
                  </button>
                )}
                <p className="truncate text-[11px] leading-tight text-muted-foreground">ID: {shortId}</p>
              </div>
            </div>

            <div className="border-t border-border/60 p-1">
              <ProfileItem icon={Settings} label="Settings" disabled />
              <ProfileItem icon={UserCircle} label="Account" disabled />
            </div>
            <div className="border-t border-border/60 p-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Connections
              </p>
              <button
                type="button"
                disabled
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground cursor-not-allowed opacity-60"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>Connect with Google</span>
                <span className="ml-auto rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium">Soon</span>
              </button>
            </div>
            <div className="border-t border-border/60 p-1">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Reset your local identity? Your previous chats and uploads will no longer be accessible under the new ID.")) {
                    resetIdentity()
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" strokeWidth={2.25} />
                <span>Reset identity</span>
              </button>
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
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-secondary",
      )}
    >
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2.25} />
      <span>{label}</span>
      <ChevronDown className="ml-auto hidden h-3.5 w-3.5 -rotate-90 text-muted-foreground/60" strokeWidth={2.25} />
    </button>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.995 3.018v2.51h3.232c1.89-1.741 2.981-4.305 2.981-7.35z" fill="#4285F4" />
      <path d="M12 22c2.7 0 4.964-.895 6.619-2.422l-3.232-2.51c-.895.6-2.04.955-3.387.955-2.605 0-4.81-1.76-5.596-4.122H3.064v2.59A9.996 9.996 0 0 0 12 22z" fill="#34A853" />
      <path d="M6.404 13.9a6.005 6.005 0 0 1 0-3.8V7.51H3.064a9.996 9.996 0 0 0 0 8.98l3.34-2.59z" fill="#FBBC05" />
      <path d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.96 2.99 14.696 2 12 2A9.996 9.996 0 0 0 3.064 7.51l3.34 2.59C7.19 7.737 9.395 5.977 12 5.977z" fill="#EA4335" />
    </svg>
  )
}
