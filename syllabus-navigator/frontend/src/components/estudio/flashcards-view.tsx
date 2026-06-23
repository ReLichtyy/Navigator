"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"
import type { FlashcardAPI } from "@/lib/api"

interface Props {
  title: string
  courseLabel: string
  cards: FlashcardAPI[]
  onBack: () => void
}

export function FlashcardsView({ title, courseLabel, cards, onBack }: Props) {
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const total = cards.length
  const card = cards[i]

  const next = () => {
    setFlipped(false)
    setI((v) => (v + 1) % total)
  }
  const prev = () => {
    setFlipped(false)
    setI((v) => (v - 1 + total) % total)
  }
  const flip = () => setFlipped((v) => !v)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") prev()
      else if (e.key === " ") {
        e.preventDefault()
        flip()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  if (total === 0) {
    return (
      <EmptyMode onBack={onBack} label="No hay tarjetas para este curso." />
    )
  }

  const pct = Math.round(((i + 1) / total) * 100)

  return (
    <div>
      <BackButton onBack={onBack} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{courseLabel}</p>
        </div>
        <span className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-sm text-accent">
          {i + 1} / {total}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>

      <button
        onClick={flip}
        className={`relative mt-6 flex min-h-[320px] w-full flex-col items-center justify-center rounded-2xl border p-11 text-center transition-colors ${
          flipped ? "border-accent/40 bg-accent/5" : "border-border bg-card hover:border-accent/30"
        }`}
      >
        <span className="absolute left-5 top-5 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
          {flipped ? "Respuesta" : "Concepto"}
        </span>
        <span className="absolute right-5 top-5 text-[11px] text-muted-foreground">
          {flipped ? "clic para ver el concepto" : "clic para revelar"}
        </span>
        <div
          key={`${i}-${flipped ? "b" : "f"}`}
          className={`max-w-2xl leading-relaxed text-foreground ${
            flipped ? "text-lg font-medium" : "text-2xl font-bold"
          }`}
        >
          {flipped ? card.back : card.front}
        </div>
      </button>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          onClick={prev}
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <button
          onClick={flip}
          className="rounded-xl border border-accent/30 bg-accent/10 px-6 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/20"
        >
          Voltear tarjeta
        </button>
        <button
          onClick={next}
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          Siguiente <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex justify-center gap-2.5">
        <button
          onClick={next}
          className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
        >
          ↻ Repasar luego
        </button>
        <button
          onClick={next}
          className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          ✓ Ya la sé
        </button>
      </div>
    </div>
  )
}

export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Área de Estudio
    </button>
  )
}

export function EmptyMode({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div>
      <BackButton onBack={onBack} />
      <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {label}
      </p>
    </div>
  )
}
