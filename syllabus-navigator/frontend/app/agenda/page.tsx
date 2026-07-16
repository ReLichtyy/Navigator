"use client"

/**
 * /agenda — retired. The agenda (calendario, próximos días y notas) now lives
 * in the unified Knowledge page (/knowledge, right column). This route just
 * redirects there so old bookmarks still land somewhere sane.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AgendaRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/knowledge")
  }, [router])

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
    </div>
  )
}
