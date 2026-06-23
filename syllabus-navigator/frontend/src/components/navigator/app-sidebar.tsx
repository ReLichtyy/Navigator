"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { MessageSquare, Library, CalendarDays, GraduationCap, Settings, User as UserIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function AppSidebar() {
  const pathname = usePathname()
  const { displayName, status, resetIdentity } = useUser()
  const { openAuthModal } = useAuthModal()

  const navItems = [
    { icon: MessageSquare, label: "Chat", href: "/" },
    { icon: Library, label: "Knowledge Base", href: "/knowledge" },
    { icon: GraduationCap, label: "Área de Estudio", href: "/estudio" },
    { icon: CalendarDays, label: "Agenda", href: "/agenda" },
  ]

  return (
    <aside className="hidden md:flex flex-col items-center w-16 h-full border-r border-border/60 bg-sidebar pt-4 pb-4 shrink-0">
      <div className="flex-1 flex flex-col gap-4 w-full px-3">
        <TooltipProvider delayDuration={0}>
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="sr-only">{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </TooltipProvider>
      </div>

      <div className="flex flex-col gap-2 w-full px-3">
        {status === "anonymous" ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openAuthModal("login")}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors hover:bg-accent/20 mx-auto"
                >
                  <UserIcon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                Sign In
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors hover:bg-accent/20 mx-auto focus:outline-none">
                <UserIcon className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" sideOffset={10} className="w-56">
              <div className="px-2 py-1.5 text-sm font-medium">
                {status === "guest" ? "Guest User" : displayName ?? "User"}
              </div>
              {status === "guest" ? (
                <DropdownMenuItem onClick={() => openAuthModal("signup")} className="cursor-pointer text-accent">
                  Create Account
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={resetIdentity} className="text-red-500 cursor-pointer">
                {status === "guest" ? "Leave Guest Session" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </aside>
  )
}
