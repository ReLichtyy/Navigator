"use client"

import { useEffect, useState } from "react"
import { Brain } from "lucide-react"
import { fetchMastery, type MasteryTopicAPI } from "@/lib/api"

// Confidence band → label + color (accent green high, amber mid, red low).
function band(c: number): { label: string; color: string } {
  if (c >= 0.75) return { label: "Dominado", color: "#3FBF84" }
  if (c >= 0.45) return { label: "En progreso", color: "#F0C27C" }
  return { label: "A reforzar", color: "#E86E6E" }
}

/**
 * "Tu dominio" — per-topic confidence from the mastery ledger, fed by quiz runs.
 * Hidden entirely until the student has practised at least one tagged topic.
 */
export function MasteryPanel({ syllabusId }: { syllabusId: string }) {
  const [topics, setTopics] = useState<MasteryTopicAPI[] | null>(null)

  useEffect(() => {
    let alive = true
    setTopics(null)
    fetchMastery(syllabusId)
      .then((d) => alive && setTopics(d.topics))
      .catch(() => alive && setTopics([]))
    return () => {
      alive = false
    }
  }, [syllabusId])

  if (!topics || topics.length === 0) return null

  return (
    <div className="mt-5 rounded-2xl border border-border/70 bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <Brain className="h-3.5 w-3.5" /> Tu dominio
        <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground/70">
          se actualiza con cada quiz
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {topics.slice(0, 8).map((t) => {
          const pct = Math.round(t.confidence * 100)
          const b = band(t.confidence)
          return (
            <div key={t.topic_key} className="flex items-center gap-3">
              <span className="w-40 flex-none truncate text-[13px] font-medium text-foreground" title={t.label}>
                {t.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: b.color }} />
              </div>
              <span className="w-24 flex-none text-right text-[11px] font-semibold" style={{ color: b.color }}>
                {pct}% · {b.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
