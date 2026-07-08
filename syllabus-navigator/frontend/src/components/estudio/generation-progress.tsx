"use client"

import { useEffect, useState } from "react"

/**
 * Simulated 0→100% progress for study-material generation. The request is a
 * single blocking GET (no server-side progress events), so the percentage ramps
 * asymptotically toward 90 while the fetch is in flight, then sprints to 100
 * when it resolves. The content is revealed only once 100% is reached — callers
 * should keep rendering the progress screen while `visible` is true.
 */
export function useGenerationProgress(active: boolean) {
  const [pct, setPct] = useState(0)
  const [visible, setVisible] = useState(false)

  // Ramp while the generation request is in flight: quick at first, crawling
  // as it approaches 90 (long generations keep visibly moving, never "stuck").
  useEffect(() => {
    if (!active) return
    setVisible(true)
    setPct(0)
    const id = setInterval(() => {
      setPct((p) => Math.min(90, p + Math.max(0.3, (90 - p) * 0.03)))
    }, 250)
    return () => clearInterval(id)
  }, [active])

  // Request settled → sprint to 100.
  useEffect(() => {
    if (active || !visible) return
    const id = setInterval(() => setPct((p) => Math.min(100, p + 4)), 30)
    return () => clearInterval(id)
  }, [active, visible])

  // Hold 100% for a beat so the completion registers, then reveal the content.
  useEffect(() => {
    if (!visible || pct < 100) return
    const t = setTimeout(() => {
      setVisible(false)
      setPct(0)
    }, 450)
    return () => clearTimeout(t)
  }, [visible, pct])

  return { pct: Math.round(pct), visible }
}

export function GenerationProgress({
  pct,
  label = "Generando material de estudio…",
}: {
  pct: number
  label?: string
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-4">
      <div className="text-4xl font-bold tabular-nums text-accent">{pct}%</div>
      <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">{pct >= 100 ? "¡Listo!" : label}</p>
    </div>
  )
}
