"use client"

/**
 * /settings — retired. Preferences + usage now live in the Configuración modal
 * (opened from the profile menu). This route just redirects home and asks the
 * app shell to open that modal, so any old bookmark still lands somewhere sane.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { OPEN_SETTINGS_FLAG } from "@/lib/ui/settings-intent"

export default function SettingsRedirect() {
  const router = useRouter()
  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_SETTINGS_FLAG, "1")
    } catch {
      // storage unavailable → just land on home without auto-opening
    }
    router.replace("/")
  }, [router])

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
    </div>
  )
}
