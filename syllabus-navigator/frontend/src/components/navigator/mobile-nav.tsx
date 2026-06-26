"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { Compass, Menu, User as UserIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { MAIN_NAV, STUDY_NAV, type NavItem } from "@/components/navigator/nav-items"

/**
 * mobile-nav.tsx — section navigation for phones/tablets (<md).
 * Self-contained: renders a hamburger trigger (hidden on md+) plus a left
 * drawer with the same links as the desktop AppSidebar. Drop it into any page
 * header so every screen is reachable on small viewports.
 */
export function MobileNav({
  className,
  trigger,
  children,
}: {
  className?: string
  /** Custom trigger element; defaults to a hamburger icon button. */
  trigger?: ReactNode
  /** Optional drawer content (e.g. the chat history on the assistant page). */
  children?: ReactNode
}) {
  const pathname = usePathname()
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()
  const [open, setOpen] = useState(false)

  // Close the drawer on navigation.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

  function NavLink({ item }: { item: NavItem }) {
    const active = isActive(item.href)
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
          active
            ? "border border-accent/30 bg-accent/15 text-accent"
            : "border border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
        {item.isNew && (
          <Badge variant="new" className="ml-auto px-1.5 py-0.5 text-[9px] uppercase">
            Nuevo
          </Badge>
        )}
      </Link>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn("md:hidden", className)}
          aria-label="Abrir menú"
        >
          {trigger}
        </button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          className={cn("md:hidden", className)}
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      <SheetContent
        side="left"
        className="flex w-72 flex-col gap-0 bg-sidebar p-3 text-sidebar-foreground md:hidden"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">Navegación</SheetTitle>
        </SheetHeader>

        {/* Brand */}
        <div className="flex items-center gap-2.5 px-1 pb-2 pt-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-accent/35 bg-[linear-gradient(150deg,#1c2a22,#0f1611)] text-accent-bright">
            <Compass className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight text-sidebar-foreground">
              Navigator
            </div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Study OS
            </div>
          </div>
        </div>

        {/* Main nav */}
        <nav className="mt-2 flex flex-col gap-1">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Study group */}
        <div className="mb-1 mt-5 px-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Estudio
          </span>
        </div>
        <nav className="flex flex-col gap-1">
          {STUDY_NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Optional chat history (assistant page injects it here). */}
        {children ? (
          <div className="mt-5 flex min-h-0 flex-1 flex-col" onClick={() => setOpen(false)}>
            {children}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Profile / auth */}
        {status === "anonymous" ? (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false)
              openAuthModal("login")
            }}
            className="w-full justify-start gap-2 border-sidebar-border"
          >
            <UserIcon className="h-4 w-4" />
            <span>Iniciar sesión</span>
          </Button>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-card/40 p-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(140deg,#2c8d5f,#1b5a3c)] text-xs font-bold text-[#E8F7EE]">
              {(displayName ?? "U").slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {displayName ?? "Usuario"}
              </span>
              <button
                onClick={resetIdentity}
                className="text-[11px] text-destructive hover:underline"
              >
                Cerrar sesión
              </button>
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
