import { MessageSquare, Library, CalendarDays, GraduationCap, Network } from "lucide-react"

export interface NavItem {
  icon: typeof MessageSquare
  /** Spanish fallback (used verbatim by any consumer that hasn't wired i18n yet). */
  label: string
  /** Key into the "sidebar" message catalog — t(labelKey) for localized consumers. */
  labelKey: string
  href: string
  isNew?: boolean
}

export const MAIN_NAV: NavItem[] = [
  { icon: MessageSquare, label: "Asistente", labelKey: "assistant", href: "/" },
  { icon: Library, label: "Cursos", labelKey: "courses", href: "/knowledge" },
  { icon: CalendarDays, label: "Agenda", labelKey: "agenda", href: "/agenda" },
]

export const STUDY_NAV: NavItem[] = [
  { icon: GraduationCap, label: "Área de Estudio", labelKey: "studyArea", href: "/estudio" },
  { icon: Network, label: "Mapa mental", labelKey: "mindMap", href: "/mapa" },
]
