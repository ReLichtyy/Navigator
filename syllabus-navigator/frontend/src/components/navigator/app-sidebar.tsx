"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { fetchStudyStats, type StudyStatsAPI } from "@/lib/api"
import {
  MessageSquare,
  Library,
  CalendarDays,
  GraduationCap,
  Network,
  Compass,
  PanelLeft,
  Flame,
  User as UserIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface NavItem {
  icon: typeof MessageSquare
  label: string
  href: string
  isNew?: boolean
}

const MAIN_NAV: NavItem[] = [
  { icon: MessageSquare, label: "Asistente", href: "/" },
  { icon: Library, label: "Cursos", href: "/knowledge" },
  { icon: CalendarDays, label: "Agenda", href: "/agenda" },
]

const STUDY_NAV: NavItem[] = [
  { icon: GraduationCap, label: "Área de Estudio", href: "/estudio", isNew: true },
  { icon: Network, label: "Mapa mental", href: "/mapa", isNew: true },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()
  const [collapsed, setCollapsed] = useState(false)
  const [stats, setStats] = useState<StudyStatsAPI | null>(null)

  useEffect(() => {
    if (status === "anonymous") {
      setStats(null)
      return
    }
    let alive = true
    fetchStudyStats()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats(null))
    return () => {
      alive = false
    }
  }, [status, pathname])

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

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

        {/* Main nav */}
        <nav className="mt-4 flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
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
                      {status === "guest" ? "Invitado" : (displayName ?? "Usuario")}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {status === "guest" ? "Sesión temporal" : "Estudiante"}
                    </span>
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" sideOffset={10} className="w-56">
              <div className="px-2 py-1.5 text-sm font-medium">
                {status === "guest" ? "Guest User" : (displayName ?? "User")}
              </div>
              {status === "guest" && (
                <DropdownMenuItem
                  onClick={() => openAuthModal("signup")}
                  className="cursor-pointer text-accent"
                >
                  Crear cuenta
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={resetIdentity} className="cursor-pointer text-destructive">
                {status === "guest" ? "Salir de invitado" : "Cerrar sesión"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TooltipProvider>
    </aside>
  )
}
