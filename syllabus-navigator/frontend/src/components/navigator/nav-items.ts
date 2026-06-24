import { MessageSquare, Library, CalendarDays, GraduationCap, Network } from "lucide-react"

export interface NavItem {
  icon: typeof MessageSquare
  label: string
  href: string
  isNew?: boolean
}

export const MAIN_NAV: NavItem[] = [
  { icon: MessageSquare, label: "Asistente", href: "/" },
  { icon: Library, label: "Cursos", href: "/knowledge" },
  { icon: CalendarDays, label: "Agenda", href: "/agenda" },
]

export const STUDY_NAV: NavItem[] = [
  { icon: GraduationCap, label: "Área de Estudio", href: "/estudio", isNew: true },
  { icon: Network, label: "Mapa mental", href: "/mapa", isNew: true },
]
