"use client"

/**
 * settings-modal.tsx — Configuración (diseño Configuracion.dc.html).
 * Se abre desde el botón de perfil (sidebar desktop y drawer móvil). Sidebar
 * interno con secciones; Perfil y Preferencias de estudio son funcionales
 * (persisten en user_preferences.language + .profile), el resto placeholder.
 */

import { useEffect, useRef, useState } from "react"
import {
  Bell,
  BookOpen,
  Compass,
  CreditCard,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Settings,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useUser } from "@/context/UserContext"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AccountSection } from "@/components/settings/account-section"
import { BillingSection } from "@/components/settings/billing-section"
import { applyTheme, type ThemePref } from "@/lib/ui/theme"
import {
  getPreferences,
  updatePreferences,
  uploadAvatar,
  removeAvatar,
  type UserProfileAPI,
  type UserStudyPrefsAPI,
} from "@/lib/api"

type SectionId = "perfil" | "cuenta" | "estudio" | "notificaciones" | "apariencia" | "facturacion"

const NAV: {
  id: SectionId
  label: string
  Icon: typeof UserIcon
  title: string
  desc: string
  hint?: string
}[] = [
  {
    id: "perfil",
    label: "Perfil",
    Icon: UserIcon,
    title: "Configuración de perfil",
    desc: "Cómo te ven y cómo Navigator te acompaña.",
  },
  {
    id: "cuenta",
    label: "Cuenta",
    Icon: Lock,
    title: "Cuenta y seguridad",
    desc: "Correo y sesiones activas.",
  },
  {
    id: "estudio",
    label: "Preferencias de estudio",
    Icon: BookOpen,
    title: "Preferencias de estudio",
    desc: "Cómo generamos y programamos tu repaso.",
  },
  {
    id: "notificaciones",
    label: "Notificaciones",
    Icon: Bell,
    title: "Notificaciones",
    desc: "Recordatorios de estudio y resúmenes.",
    hint: "Elige qué recordatorios recibes por correo o push y a qué hora del día.",
  },
  {
    id: "apariencia",
    label: "Apariencia",
    Icon: Sun,
    title: "Apariencia",
    desc: "Tema de la interfaz.",
  },
  {
    id: "facturacion",
    label: "Plan y facturación",
    Icon: CreditCard,
    title: "Plan y facturación",
    desc: "Tu suscripción y método de pago.",
    hint: "Revisa tu plan, historial de pagos y actualiza tu método de facturación.",
  },
]

const TONES = ["Cercano", "Neutro", "Directo"] as const
const DETAILS = ["Conciso", "Equilibrado", "Detallado"] as const
const DIFFICULTIES = ["Fácil", "Media", "Difícil", "Adaptativa"] as const
const COUNTS = [5, 10, 15] as const
const SESSIONS = [15, 25, 45] as const
const LEVELS = ["Secundaria", "Preparatoria", "Universidad", "Posgrado", "Autodidacta"] as const
const CARD_FORMATS = ["Pregunta y respuesta", "Rellenar huecos", "Definición", "Mixto"] as const

const THEME_OPTIONS: {
  id: ThemePref
  label: string
  Icon: typeof Sun
  swatch: string
}[] = [
  { id: "dark", label: "Oscuro", Icon: Moon, swatch: "#080a09" },
  { id: "light", label: "Claro", Icon: Sun, swatch: "#f4f6f5" },
  {
    id: "system",
    label: "Sistema",
    Icon: Monitor,
    swatch: "linear-gradient(120deg,#080a09 0 50%,#f4f6f5 50% 100%)",
  },
]

const DIFF_HINT: Record<(typeof DIFFICULTIES)[number], string> = {
  Fácil: "Preguntas directas de recuerdo. Ideal para empezar un tema.",
  Media: "Mezcla recuerdo y comprensión. El punto de equilibrio.",
  Difícil: "Preguntas de aplicación y casos. Para consolidar.",
  Adaptativa: "La dificultad sube o baja según tus aciertos.",
}

const DEFAULT_STUDY: Required<UserStudyPrefsAPI> = {
  difficulty: "Adaptativa",
  cardFormat: "Pregunta y respuesta",
  questionCount: 10,
  sessionLen: 25,
  spaced: true,
  mixSubjects: false,
}

const AVATAR_SIZE = 256 // px — downscaled client-side before upload

/**
 * Downscale/crop an image to a square AVATAR_SIZE webp (cover). Keeps uploads
 * tiny so the 2MB server limit is never the user's problem. Falls back to the
 * original file if the canvas pipeline fails (server still enforces limits).
 */
async function toAvatarBlob(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    )
    return blob ?? file
  } catch {
    return file
  }
}

const inputCls =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-[#F2F6F4] outline-none transition-[border-color,box-shadow] placeholder:text-[#5C6661] focus:border-[rgba(63,191,132,0.6)] focus:shadow-[0_0_0_4px_rgba(63,191,132,0.1)]"

const labelCls = "mb-1.5 block text-[12.5px] font-semibold text-[#A9B2AD]"

const sectionTitleCls = "text-[11px] font-bold uppercase tracking-[0.1em] text-[#5BE39A]"

function SelectBox({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  ariaLabel: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={cn(inputCls, "cursor-pointer appearance-none pr-9")}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#5C6661"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

function Seg<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  render?: (v: T) => string
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => {
        const on = o === value
        return (
          <button
            key={String(o)}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              "h-11 min-w-0 flex-1 rounded-[11px] border px-1.5 text-[12.5px] font-semibold transition-colors",
              on
                ? "border-[rgba(63,191,132,0.4)] bg-[rgba(63,191,132,0.14)] text-[#9FEDC4]"
                : "border-white/[0.09] bg-white/[0.03] text-[#8A938E] hover:bg-white/[0.06]",
            )}
          >
            {render ? render(o) : String(o)}
          </button>
        )
      })}
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  on,
  onToggle,
}: {
  label: string
  desc: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/5 py-3.5">
      <div className="pr-4">
        <div className="text-[13px] font-semibold text-[#D6DEDA]">{label}</div>
        <div className="mt-0.5 text-xs text-[#7C8983]">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "relative h-6 w-[42px] shrink-0 rounded-full transition-colors",
          on ? "bg-[linear-gradient(90deg,#3FBF84,#5BE39A)]" : "bg-white/10",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left]",
            on ? "left-[21px]" : "left-[3px]",
          )}
        />
      </button>
    </div>
  )
}

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { displayName: sessionName, avatarUrl, setAvatarUrl } = useUser()
  const [section, setSection] = useState<SectionId>("perfil")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [language, setLanguage] = useState<"es" | "en">("es")
  const [theme, setTheme] = useState<ThemePref>("dark")
  const [profile, setProfile] = useState<UserProfileAPI>({})
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getPreferences()
      .then((data) => {
        if (data?.preferences) {
          setLanguage(data.preferences.language === "en" ? "en" : "es")
          setTheme(data.preferences.theme ?? "dark")
          setProfile(data.preferences.profile ?? {})
        }
      })
      .catch(() => toast.error("No se pudieron cargar tus preferencias."))
      .finally(() => setLoading(false))
    setDirty(false)
    setSection("perfil")
  }, [open])

  const patchProfile = (patch: Partial<UserProfileAPI>) => {
    setProfile((p) => ({ ...p, ...patch }))
    setDirty(true)
  }
  // Theme applies live (instant preview) and persists on Save. If the user
  // closes without saving, UserContext re-syncs from the server on next load.
  const changeTheme = (next: ThemePref) => {
    setTheme(next)
    applyTheme(next)
    setDirty(true)
  }
  const patchStudy = (patch: Partial<UserStudyPrefsAPI>) => {
    setProfile((p) => ({ ...p, study: { ...DEFAULT_STUDY, ...p.study, ...patch } }))
    setDirty(true)
  }

  const study: Required<UserStudyPrefsAPI> = { ...DEFAULT_STUDY, ...profile.study }
  const cur = NAV.find((n) => n.id === section) ?? NAV[0]
  const hasFooter = section === "perfil" || section === "estudio" || section === "apariencia"

  const fullName = profile.fullName?.trim() || sessionName || "Estudiante"
  const initials =
    fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "NV"

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const data = await updatePreferences({ language, theme, profile })
      if (data?.preferences) {
        setLanguage(data.preferences.language === "en" ? "en" : "es")
        setTheme(data.preferences.theme ?? theme)
        setProfile(data.preferences.profile ?? profile)
      }
      setDirty(false)
      toast.success("Cambios guardados")
    } catch {
      toast.error("No se pudieron guardar los cambios.")
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarPick = async (file: File | null) => {
    if (!file || avatarBusy) return
    setAvatarBusy(true)
    try {
      const blob = await toAvatarBlob(file)
      const upload = new File([blob], "avatar.webp", { type: blob.type || file.type })
      const data = await uploadAvatar(upload)
      if (data?.url) {
        setAvatarUrl(data.url)
        toast.success("Foto de perfil actualizada")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir la imagen.")
    } finally {
      setAvatarBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleAvatarRemove = async () => {
    if (avatarBusy) return
    setAvatarBusy(true)
    try {
      await removeAvatar()
      setAvatarUrl(null)
      toast.success("Foto de perfil eliminada")
    } catch {
      toast.error("No se pudo quitar la imagen.")
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-3xl border-white/10 bg-[#0B0F0D] p-0 shadow-[0_40px_120px_rgba(0,0,0,0.6)] md:h-[600px] md:max-w-[940px] md:flex-row"
      >
        <DialogTitle className="sr-only">Configuración</DialogTitle>

        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="hidden w-[238px] shrink-0 flex-col border-r border-white/[0.06] bg-[linear-gradient(180deg,#0c110e,#090c0a)] px-4 py-[22px] md:flex">
          <div className="flex items-center gap-2.5 px-2 pb-4">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-[rgba(63,191,132,0.4)] bg-[linear-gradient(150deg,#1c2a22,#0f1611)]">
              <Compass className="h-4 w-4 text-[#5BE39A]" strokeWidth={2} />
            </div>
            <div className="leading-[1.1]">
              <div className="text-[13.5px] font-extrabold text-[#F2F6F4]">Ajustes</div>
              <div className="text-[10px] font-semibold text-[#5C6661]">Navigator · Study OS</div>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-[3px]">
            {NAV.map((n) => {
              const active = n.id === section
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSection(n.id)}
                  className={cn(
                    "flex w-full items-center gap-[11px] rounded-[11px] px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors",
                    active
                      ? "bg-[rgba(63,191,132,0.1)] text-[#F2F6F4] shadow-[inset_0_0_0_1px_rgba(63,191,132,0.2)]"
                      : "text-[#9AA5A0] hover:bg-white/[0.04]",
                  )}
                >
                  <n.Icon
                    className={cn("h-4 w-4 shrink-0", active ? "text-[#5BE39A]" : "text-[#7C8983]")}
                    strokeWidth={1.9}
                  />
                  <span className="min-w-0 flex-1 truncate">{n.label}</span>
                  {active && (
                    <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#5BE39A] shadow-[0_0_7px_#5BE39A]" />
                  )}
                </button>
              )
            })}
          </nav>

          {/* user card */}
          <div className="flex items-center gap-2.5 rounded-[13px] border border-white/[0.06] bg-white/[0.03] p-[11px]">
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(140deg,#2c8d5f,#1b5a3c)] text-[13px] font-bold text-[#E8F7EE]">
              {initials}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[12.5px] font-bold text-[#E8EDEA]">{fullName}</div>
              <div className="text-[10.5px] font-semibold text-[#5BE39A]">Estudiante</div>
            </div>
          </div>
        </aside>

        {/* ---------- Content ---------- */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#0B0F0D]">
          {/* header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 pb-4 pt-5 sm:px-7">
            <div className="min-w-0">
              <h2 className="text-[19px] font-extrabold tracking-tight text-[#F4F8F6]">
                {cur.title}
              </h2>
              <p className="mt-1 text-[12.5px] text-[#7C8983]">{cur.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar configuración"
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-[#9AA5A0] transition-colors hover:bg-white/[0.08] hover:text-[#E8EDEA]"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>

          {/* section chips (mobile replaces the sidebar) */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/[0.06] px-5 py-2.5 md:hidden">
            {NAV.map((n) => {
              const active = n.id === section
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSection(n.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "border-[rgba(63,191,132,0.4)] bg-[rgba(63,191,132,0.12)] text-[#9FEDC4]"
                      : "border-white/[0.08] bg-white/[0.02] text-[#8A938E]",
                  )}
                >
                  <n.Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {n.label}
                </button>
              )
            })}
          </div>

          {/* scroll body */}
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-5 pt-5 sm:px-7",
              hasFooter ? "pb-24" : "pb-8",
            )}
          >
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#5BE39A]" />
              </div>
            ) : section === "perfil" ? (
              <div
                key="perfil"
                className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                {/* avatar */}
                <div className="flex items-center gap-4 border-b border-white/[0.06] pb-6">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt="Foto de perfil"
                      className="h-[74px] w-[74px] shrink-0 rounded-[20px] object-cover shadow-[0_0_28px_rgba(63,191,132,0.2)]"
                    />
                  ) : (
                    <div className="flex h-[74px] w-[74px] shrink-0 items-center justify-center rounded-[20px] bg-[linear-gradient(140deg,#2c8d5f,#1b5a3c)] text-[27px] font-extrabold text-[#E8F7EE] shadow-[0_0_28px_rgba(63,191,132,0.2)]">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold text-[#F2F6F4]">Foto de perfil</div>
                    <div className="mt-0.5 text-[12.5px] text-[#7C8983]">
                      PNG, JPG o WebP. La recortamos en cuadrado automáticamente.
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => void handleAvatarPick(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        disabled={avatarBusy}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-9 items-center gap-2 rounded-[10px] border border-[rgba(63,191,132,0.35)] bg-[rgba(63,191,132,0.1)] px-3.5 text-[12.5px] font-semibold text-[#9FEDC4] transition-colors hover:bg-[rgba(63,191,132,0.16)] disabled:opacity-60"
                      >
                        {avatarBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Subir imagen
                      </button>
                      <button
                        type="button"
                        disabled={avatarBusy}
                        onClick={() => void handleAvatarRemove()}
                        className="h-9 rounded-[10px] border border-white/10 px-3.5 text-[12.5px] font-semibold text-[#8A938E] transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                </div>

                {/* identidad */}
                <div className="border-b border-white/[0.06] py-[22px]">
                  <div className={cn(sectionTitleCls, "mb-4")}>Identidad</div>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
                    <div>
                      <label htmlFor="cf-name" className={labelCls}>
                        Nombre completo
                      </label>
                      <input
                        id="cf-name"
                        value={profile.fullName ?? ""}
                        onChange={(e) => patchProfile({ fullName: e.target.value })}
                        placeholder={sessionName ?? "Tu nombre"}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor="cf-display" className={labelCls}>
                        Nombre para mostrar
                      </label>
                      <input
                        id="cf-display"
                        value={profile.displayName ?? ""}
                        onChange={(e) => patchProfile({ displayName: e.target.value })}
                        placeholder="Cómo te llamamos"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>

                {/* estudios */}
                <div className="border-b border-white/[0.06] py-[22px]">
                  <div className={cn(sectionTitleCls, "mb-4")}>Tus estudios</div>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="cf-career" className={labelCls}>
                        ¿Qué estudias?
                      </label>
                      <input
                        id="cf-career"
                        value={profile.career ?? ""}
                        onChange={(e) => patchProfile({ career: e.target.value })}
                        placeholder="Ej. Medicina, Ingeniería, Derecho…"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor="cf-school" className={labelCls}>
                        Institución
                      </label>
                      <input
                        id="cf-school"
                        value={profile.school ?? ""}
                        onChange={(e) => patchProfile({ school: e.target.value })}
                        placeholder="Universidad / colegio"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <span className={labelCls}>Nivel</span>
                      <SelectBox
                        ariaLabel="Nivel de estudios"
                        value={profile.level ?? "Universidad"}
                        options={LEVELS}
                        onChange={(v) => patchProfile({ level: v as UserProfileAPI["level"] })}
                      />
                    </div>
                  </div>
                </div>

                {/* personalización */}
                <div className="py-[22px]">
                  <div className={cn(sectionTitleCls, "mb-1")}>Personalización</div>
                  <div className="mb-4 text-xs text-[#7C8983]">
                    Cómo Navigator te habla y se muestra.
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <span className={labelCls}>Idioma de la app</span>
                      <SelectBox
                        ariaLabel="Idioma de la app"
                        value={language === "en" ? "English" : "Español"}
                        options={["Español", "English"]}
                        onChange={(v) => {
                          setLanguage(v === "English" ? "en" : "es")
                          setDirty(true)
                        }}
                      />
                    </div>
                    <div>
                      <span className={labelCls}>Tono del asistente</span>
                      <Seg
                        options={TONES}
                        value={profile.tone ?? "Cercano"}
                        onChange={(v) => patchProfile({ tone: v })}
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <span className={labelCls}>Nivel de detalle en las explicaciones</span>
                    <Seg
                      options={DETAILS}
                      value={profile.detail ?? "Equilibrado"}
                      onChange={(v) => patchProfile({ detail: v })}
                    />
                  </div>
                </div>
              </div>
            ) : section === "cuenta" ? (
              <AccountSection key="cuenta" />
            ) : section === "facturacion" ? (
              <BillingSection key="facturacion" />
            ) : section === "estudio" ? (
              <div
                key="estudio"
                className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                {/* generación */}
                <div className="border-b border-white/[0.06] pb-[22px]">
                  <div className={cn(sectionTitleCls, "mb-1")}>Generación de material</div>
                  <div className="mb-4 text-xs text-[#7C8983]">
                    Cómo Navigator crea tus quizzes y tarjetas.
                  </div>

                  <div className="mb-4">
                    <span className={labelCls}>Dificultad de los quizzes</span>
                    <Seg
                      options={DIFFICULTIES}
                      value={study.difficulty}
                      onChange={(v) => patchStudy({ difficulty: v })}
                    />
                    <div className="mt-2 text-[11.5px] text-[#5C6661]">
                      {DIFF_HINT[study.difficulty]}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <span className={labelCls}>Formato de tarjetas</span>
                      <SelectBox
                        ariaLabel="Formato de tarjetas"
                        value={study.cardFormat}
                        options={CARD_FORMATS}
                        onChange={(v) =>
                          patchStudy({ cardFormat: v as UserStudyPrefsAPI["cardFormat"] })
                        }
                      />
                    </div>
                    <div>
                      <span className={labelCls}>Preguntas por quiz</span>
                      <Seg
                        options={COUNTS}
                        value={study.questionCount}
                        onChange={(v) => patchStudy({ questionCount: v })}
                      />
                    </div>
                  </div>
                </div>

                {/* repaso */}
                <div className="pt-[22px]">
                  <div className={cn(sectionTitleCls, "mb-1")}>Repaso y sesiones</div>
                  <div className="mb-3.5 text-xs text-[#7C8983]">
                    Cuándo y cuánto te toca repasar.
                  </div>

                  <div className="mb-4 max-w-[280px]">
                    <span className={labelCls}>Duración de sesión de estudio</span>
                    <Seg
                      options={SESSIONS}
                      value={study.sessionLen}
                      onChange={(v) => patchStudy({ sessionLen: v })}
                      render={(v) => `${v} min`}
                    />
                  </div>

                  <ToggleRow
                    label="Repaso espaciado inteligente"
                    desc="Reordena el repaso según lo que estás por olvidar."
                    on={study.spaced}
                    onToggle={() => patchStudy({ spaced: !study.spaced })}
                  />
                  <ToggleRow
                    label="Mezclar materias en el repaso"
                    desc="Combina temas de distintos cursos en una misma sesión."
                    on={study.mixSubjects}
                    onToggle={() => patchStudy({ mixSubjects: !study.mixSubjects })}
                  />
                </div>
              </div>
            ) : section === "apariencia" ? (
              <div
                key="apariencia"
                className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                <div className="pb-[22px]">
                  <div className={cn(sectionTitleCls, "mb-1")}>Tema</div>
                  <div className="mb-4 text-xs text-[#7C8983]">
                    Elige cómo se ve Navigator. &quot;Sistema&quot; sigue la preferencia de tu
                    dispositivo.
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {THEME_OPTIONS.map((opt) => {
                      const on = theme === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => changeTheme(opt.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex flex-col gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                            on
                              ? "border-[rgba(63,191,132,0.5)] bg-[rgba(63,191,132,0.08)]"
                              : "border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.05]",
                          )}
                        >
                          <div
                            className="h-16 w-full overflow-hidden rounded-lg border border-white/10"
                            style={{ background: opt.swatch }}
                          >
                            <div className="flex h-full items-end p-2">
                              <div className="h-2 w-2/3 rounded-full bg-[#3FBF84]" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-[13px] font-semibold text-[#E8EDEA]">
                              <opt.Icon className="h-4 w-4 text-[#5BE39A]" strokeWidth={1.9} />
                              {opt.label}
                            </span>
                            {on && (
                              <span className="h-[7px] w-[7px] rounded-full bg-[#5BE39A] shadow-[0_0_7px_#5BE39A]" />
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={section}
                className="flex min-h-[340px] flex-col items-center justify-center text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                <div className="mb-4 flex h-[58px] w-[58px] items-center justify-center rounded-[17px] border border-[rgba(63,191,132,0.24)] bg-[linear-gradient(150deg,rgba(63,191,132,0.14),rgba(63,191,132,0.03))]">
                  <Settings className="h-[26px] w-[26px] text-[#5BE39A]" strokeWidth={1.7} />
                </div>
                <div className="text-base font-bold text-[#E8EDEA]">{cur.title}</div>
                <div className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-[#7C8983]">
                  {cur.hint} Próximamente.
                </div>
              </div>
            )}
          </div>

          {/* sticky footer */}
          {hasFooter && !loading && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-white/[0.06] bg-[linear-gradient(180deg,rgba(11,15,13,0),#0B0F0D_34%)] px-5 py-3.5 sm:px-7">
              <span className="hidden items-center gap-2 text-xs text-[#5C6661] sm:flex">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    dirty ? "bg-[#FFB45B]" : "bg-[#5BE39A]",
                  )}
                />
                {dirty ? "Cambios sin guardar" : "Todo guardado"}
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-10 rounded-[11px] border border-white/10 px-4 text-[13.5px] font-semibold text-[#C9D2CD] transition-colors hover:bg-white/[0.04]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex h-10 items-center gap-2 rounded-[11px] bg-[linear-gradient(180deg,#5BE39A,#3FBF84)] px-5 text-[13.5px] font-bold text-[#08110B] shadow-[0_8px_22px_rgba(63,191,132,0.22)] transition-transform hover:-translate-y-px disabled:opacity-70"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          )}
        </main>
      </DialogContent>
    </Dialog>
  )
}
