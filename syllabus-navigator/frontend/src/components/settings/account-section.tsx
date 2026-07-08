"use client"

/**
 * account-section.tsx — Configuración → Cuenta (UI propia + API de Clerk).
 * Sin contraseña: el login es Google/OAuth, así que solo correo (lectura),
 * sesiones activas (revocables) y la zona de peligro (eliminar cuenta:
 * Neon primero vía DELETE /api/user, Clerk después con user.delete()).
 */

import { useCallback, useEffect, useState } from "react"
import { useUser as useClerkUser, useSession } from "@clerk/nextjs"
import { Laptop, Loader2, Smartphone, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { deleteAccount } from "@/lib/api"

const sectionTitleCls = "text-[11px] font-bold uppercase tracking-[0.1em] text-[#5BE39A]"

// Inferred from Clerk's own hook so we don't take a direct dep on @clerk/types.
type ClerkUser = NonNullable<ReturnType<typeof useClerkUser>["user"]>
type SessionRes = Awaited<ReturnType<ClerkUser["getSessions"]>>[number]

function formatLastActive(date: Date | null): string {
  if (!date) return "—"
  const mins = Math.round((Date.now() - date.getTime()) / 60_000)
  if (mins < 2) return "Activa ahora"
  if (mins < 60) return `Hace ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.round(hours / 24)
  return `Hace ${days} ${days === 1 ? "día" : "días"}`
}

function sessionLabel(s: SessionRes): string {
  const a = s.latestActivity
  const browser = a?.browserName ? `${a.browserName}` : "Navegador"
  const os = a?.deviceType ?? ""
  const place = [a?.city, a?.country].filter(Boolean).join(", ")
  return [browser, os, place].filter(Boolean).join(" · ")
}

export function AccountSection() {
  const { user } = useClerkUser()
  const { session: currentSession } = useSession()
  const [sessions, setSessions] = useState<SessionRes[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const email = user?.primaryEmailAddress?.emailAddress ?? "—"
  const viaGoogle = (user?.externalAccounts ?? []).some((a) => a.provider === "google")

  const loadSessions = useCallback(() => {
    if (!user) return
    user
      .getSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [user])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const revokeOne = async (s: SessionRes) => {
    if (busyId) return
    setBusyId(s.id)
    try {
      await s.revoke()
      toast.success("Sesión cerrada")
      loadSessions()
    } catch {
      toast.error("No se pudo cerrar la sesión.")
    } finally {
      setBusyId(null)
    }
  }

  const revokeOthers = async () => {
    if (busyId || !sessions) return
    setBusyId("all")
    try {
      const others = sessions.filter((s) => s.id !== currentSession?.id)
      await Promise.all(others.map((s) => s.revoke()))
      toast.success(others.length > 0 ? "Sesiones cerradas" : "No hay otras sesiones")
      loadSessions()
    } catch {
      toast.error("No se pudieron cerrar todas las sesiones.")
    } finally {
      setBusyId(null)
    }
  }

  // Doble paso: Neon primero (datos), Clerk después (identidad + signout).
  const handleDelete = async () => {
    if (deleting || confirmText.trim().toUpperCase() !== "ELIMINAR") return
    setDeleting(true)
    try {
      await deleteAccount()
      await user?.delete()
      window.location.href = "/sign-in"
    } catch {
      toast.error("No se pudo eliminar la cuenta. Intenta de nuevo.")
      setDeleting(false)
    }
  }

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* correo */}
      <div className="border-b border-white/[0.06] pb-[22px]">
        <div className={cn(sectionTitleCls, "mb-4")}>Correo</div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[#F2F6F4]">{email}</div>
            <div className="mt-0.5 text-xs text-[#7C8983]">Correo principal de tu cuenta</div>
          </div>
          {viaGoogle && (
            <span className="shrink-0 rounded-full border border-[rgba(63,191,132,0.35)] bg-[rgba(63,191,132,0.1)] px-2.5 py-1 text-[11px] font-bold text-[#9FEDC4]">
              Conectado con Google
            </span>
          )}
        </div>
        <p className="mt-2 text-[11.5px] text-[#5C6661]">
          Tu correo lo gestiona tu cuenta de Google; no se puede cambiar desde aquí.
        </p>
      </div>

      {/* sesiones */}
      <div className="border-b border-white/[0.06] py-[22px]">
        <div className="mb-4 flex items-center justify-between">
          <div className={sectionTitleCls}>Sesiones activas</div>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void revokeOthers()}
            className="text-xs font-semibold text-[#8A938E] transition-colors hover:text-[#E8EDEA] disabled:opacity-60"
          >
            {busyId === "all" ? "Cerrando…" : "Cerrar todas las demás"}
          </button>
        </div>
        {sessions === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-[#5BE39A]" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-[#7C8983]">No se pudieron cargar las sesiones.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((s) => {
              const isCurrent = s.id === currentSession?.id
              const mobile = s.latestActivity?.isMobile
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-[#9AA5A0]">
                    {mobile ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-[#E8EDEA]">
                        {sessionLabel(s)}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-[rgba(63,191,132,0.14)] px-2 py-0.5 text-[10px] font-bold text-[#9FEDC4]">
                          Esta sesión
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-[#7C8983]">
                      {formatLastActive(s.lastActiveAt ? new Date(s.lastActiveAt) : null)}
                    </div>
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void revokeOne(s)}
                      className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[#C9D2CD] transition-colors hover:bg-white/[0.05] disabled:opacity-60"
                    >
                      {busyId === s.id ? "Cerrando…" : "Cerrar"}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* zona de peligro */}
      <div className="py-[22px]">
        <div className={cn(sectionTitleCls, "mb-4 text-red-400")}>Zona de peligro</div>
        <div className="rounded-xl border border-red-500/25 bg-red-500/[0.04] p-4">
          <div className="text-[13px] font-semibold text-[#E8EDEA]">Eliminar cuenta</div>
          <p className="mt-1 text-xs leading-relaxed text-[#7C8983]">
            Borra tu cuenta y todos tus datos (cursos, documentos, chats, progreso de estudio).
            Esta acción no se puede deshacer.
          </p>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 flex items-center gap-2 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-[12.5px] font-semibold text-red-400 transition-colors hover:bg-red-500/15"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar mi cuenta
            </button>
          ) : (
            <div className="mt-3">
              <label htmlFor="cf-del-confirm" className="block text-xs font-semibold text-[#A9B2AD]">
                Escribe <span className="font-mono text-red-400">ELIMINAR</span> para confirmar
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  id="cf-del-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="ELIMINAR"
                  className="h-10 w-[160px] rounded-[10px] border border-red-500/30 bg-white/[0.03] px-3 text-sm text-[#F2F6F4] outline-none placeholder:text-[#5C6661] focus:border-red-500/60"
                />
                <button
                  type="button"
                  disabled={deleting || confirmText.trim().toUpperCase() !== "ELIMINAR"}
                  onClick={() => void handleDelete()}
                  className="flex h-10 items-center gap-2 rounded-[10px] bg-red-500/90 px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {deleting ? "Eliminando…" : "Eliminar definitivamente"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false)
                    setConfirmText("")
                  }}
                  className="h-10 rounded-[10px] border border-white/10 px-3.5 text-[12.5px] font-semibold text-[#C9D2CD] transition-colors hover:bg-white/[0.04]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
