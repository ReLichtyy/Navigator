"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { fetchStudyStats, listChats, type StudyStatsAPI } from "@/lib/api"
import { ChevronDown, Compass, List, PanelLeft, Plus, Flame, User as UserIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { useChatNav } from "@/context/ChatNavContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MAIN_NAV, STUDY_NAV, type NavItem } from "@/components/navigator/nav-items"

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()
  const { requestChat, requestNewChat, setAllChatsOpen } = useChatNav()
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<StudyStatsAPI | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [recentChats, setRecentChats] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    if (status === "anonymous") {
      setStats(null)
      setRecentChats([])
      return
    }
    let alive = true
    fetchStudyStats()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats(null))
    listChats()
      .then(
        (d) =>
          alive && setRecentChats(d.chats.slice(0, 4).map((c) => ({ id: c.id, title: c.title }))),
      )
      .catch(() => alive && setRecentChats([]))
    return () => {
      alive = false
    }
  }, [status, pathname])

  // Hide the app chrome on Clerk auth screens (sign-in/up + legacy redirects).
  if (["/sign-in", "/sign-up", "/login", "/signup"].some((r) => pathname.startsWith(r))) {
    return null
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

  const assistantItem = MAIN_NAV[0]
  const AssistantIcon = assistantItem.icon

  function NavLink({ item }: { item: NavItem }) {
    const active = isActive(item.href)
    const link = (
      <Link
        href={item.href}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          active
            ? "border border-accent/30 bg-accent/15 text-accent"
            : "border border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            {item.isNew && (
              <Badge variant="new" className="ml-auto px-1.5 py-0.5 text-[9px] uppercase">
                Nuevo
              </Badge>
            )}
          </>
        )}
        {collapsed && <span className="sr-only">{item.label}</span>}
      </Link>
    )
    if (!collapsed) return link
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 md:flex",
        collapsed ? "w-16 px-2 py-4" : "w-60 px-3 py-4",
      )}
    >
      <TooltipProvider delayDuration={0}>
        {/* Brand */}
        <div className={cn("flex items-center gap-2.5 px-1", collapsed && "justify-center px-0")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-accent/35 bg-[linear-gradient(150deg,#1c2a22,#0f1611)] text-accent-bright shadow-[0_0_18px_rgba(63,191,132,0.12)]">
            <Compass className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold leading-tight text-sidebar-foreground">
                Navigator
              </div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Study OS
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            "mt-4 w-full justify-start gap-2 border-sidebar-border bg-transparent text-muted-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <PanelLeft className="h-4 w-4" />
          {!collapsed && <span>Colapsar</span>}
        </Button>

        {/* Main nav — "Asistente" expands to new-chat + recent chats (Navigator v2) */}
        <nav className="mt-4 flex flex-col gap-1">
          {collapsed ? (
            <NavLink item={assistantItem} />
          ) : (
            <div>
              <div
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive("/")
                    ? "border border-accent/30 bg-accent/15 text-accent"
                    : "border border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Link href="/" className="flex min-w-0 flex-1 items-center gap-3">
                  <AssistantIcon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{assistantItem.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setAssistantOpen((v) => !v)}
                  aria-label={assistantOpen ? "Contraer chats" : "Expandir chats"}
                  aria-expanded={assistantOpen}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", !assistantOpen && "-rotate-90")}
                  />
                </button>
              </div>

              {assistantOpen && (
                <div className="ml-[22px] mt-1 flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      requestNewChat()
                      if (pathname !== "/") router.push("/")
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold text-[#9FEDC4] transition-colors hover:bg-accent/10"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
                    Nuevo chat
                  </button>
                  {recentChats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        requestChat(c.id)
                        if (pathname !== "/") router.push("/")
                      }}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-accent" />
                      <span className="truncate">{c.title}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setAllChatsOpen(true)
                      if (pathname !== "/") router.push("/")
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <List className="h-3.5 w-3.5 shrink-0" />
                    Ver todos los chats
                  </button>
                </div>
              )}
            </div>
          )}

          {MAIN_NAV.slice(1).map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Study group */}
        <div className={cn("mt-5 mb-1 px-2", collapsed && "px-0 text-center")}>
          {!collapsed ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Estudio
            </span>
          ) : (
            <div className="mx-auto h-px w-6 bg-sidebar-border" />
          )}
        </div>
        <nav className="flex flex-col gap-1">
          {STUDY_NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Streak card — real study activity from /api/study/stats */}
        {!collapsed && status !== "anonymous" && (
          <div className="mb-3 rounded-[13px] border border-accent/20 bg-[linear-gradient(160deg,rgba(63,191,132,0.10),rgba(63,191,132,0.02))] p-3">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-accent-bright" />
              <span className="text-[13px] font-bold text-[#9FEDC4]">
                Racha de {stats?.streakDays ?? 0} {stats?.streakDays === 1 ? "día" : "días"}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#3fbf84,#5be39a)] transition-[width] duration-500"
                style={{ width: `${Math.min(100, ((stats?.streakDays ?? 0) / 7) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {stats?.cardsThisWeek ?? 0} tarjetas repasadas esta semana
            </p>
          </div>
        )}

        {/* Profile */}
        {status === "anonymous" ? (
          <Button
            variant="outline"
            onClick={() => openAuthModal("login")}
            className={cn(
              "w-full justify-start gap-2 border-sidebar-border",
              collapsed && "justify-center px-0",
            )}
          >
            <UserIcon className="h-4 w-4" />
            {!collapsed && <span>Iniciar sesión</span>}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border bg-card/40 p-2.5 text-left transition-colors hover:bg-sidebar-accent focus:outline-none",
                  collapsed && "justify-center p-2",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(140deg,#2c8d5f,#1b5a3c)] text-xs font-bold text-[#E8F7EE]">
                  {(displayName ?? "U").slice(0, 2).toUpperCase()}
                </span>
                {!collapsed && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                      {displayName ?? "Usuario"}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Estudiante
                    </span>
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" sideOffset={10} className="w-56">
              <div className="px-2 py-1.5 text-sm font-medium">{displayName ?? "Usuario"}</div>
              <DropdownMenuItem onClick={resetIdentity} className="cursor-pointer text-destructive">
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TooltipProvider>
    </aside>
  )
}
