"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, RotateCcw, Check, X, Eye } from "lucide-react"
import { recordFlashcardReview, flashcardKey, type FlashcardAPI } from "@/lib/api"
import { orderDueFirst } from "@/lib/ui/study-cards"

/** Doc or whole-course. Combined scopes have no ledger to write to → no scope, no recording. */
type Scope = { kind: "doc"; docId: string } | { kind: "course"; courseId: string }

interface Props {
  title: string
  courseLabel: string
  cards: FlashcardAPI[]
  onBack: () => void
  /** When set, "La sé" / "No la sé" record a review (feeds the SRS box + streak). */
  scope?: Scope
  /** SRS keys due today: matching cards are surfaced first (repaso mode). */
  dueKeys?: string[]
}

export function FlashcardsView({
  title,
  courseLabel,
  cards: rawCards,
  onBack,
  scope,
  dueKeys,
}: Props) {
  // Order due (spaced-repetition) cards first, preserving relative order otherwise.
  const cards = useMemo(
    () => orderDueFirst(rawCards, dueKeys, (c) => flashcardKey(c.front)),
    [rawCards, dueKeys],
  )

  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [graded, setGraded] = useState<Record<number, boolean>>({}) // index → known
  const [done, setDone] = useState(false)

  const total = cards.length
  const card = cards[i]

  const go = useCallback(
    (delta: number) => {
      setFlipped(false)
      setI((v) => {
        const n = v + delta
        if (n >= total) {
          setDone(true)
          return v
        }
        return Math.max(0, n)
      })
    },
    [total],
  )

  const flip = useCallback(() => setFlipped((v) => !v), [])

  /** Self-grade the current card, record it, then advance. */
  const grade = useCallback(
    (known: boolean) => {
      if (card && scope) void recordFlashcardReview(scope, card.front, known).catch(() => {})
      setGraded((g) => ({ ...g, [i]: known }))
      go(1)
    },
    [card, scope, i, go],
  )

  const restart = () => {
    setI(0)
    setFlipped(false)
    setGraded({})
    setDone(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return
      if (e.key === "ArrowRight") go(1)
      else if (e.key === "ArrowLeft") go(-1)
      else if (e.key === " ") {
        e.preventDefault()
        flip()
      } else if (flipped && (e.key === "1" || e.key.toLowerCase() === "n")) grade(false)
      else if (flipped && (e.key === "2" || e.key.toLowerCase() === "y")) grade(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [done, flipped, go, flip, grade])

  if (total === 0) {
    return <EmptyMode onBack={onBack} label="No hay tarjetas para este curso." />
  }

  const knownCount = Object.values(graded).filter(Boolean).length
  const reviewCount = Object.values(graded).filter((v) => !v).length

  // ── Session summary ──
  if (done) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
            <Check className="h-7 w-7 text-accent" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">¡Sesión completa!</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Repasaste {Object.keys(graded).length} de {total} tarjetas.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <span className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-2 text-sm font-semibold text-accent">
              {knownCount} sabidas
            </span>
            <span className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm font-semibold text-amber-500">
              {reviewCount} para repasar
            </span>
          </div>
          <button
            onClick={restart}
            className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" /> Repasar de nuevo
          </button>
        </div>
      </div>
    )
  }

  const pct = Math.round(((i + (flipped ? 1 : 0)) / total) * 100)

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
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Flip card (3D) */}
      <div className="mt-6 [perspective:1400px]">
        <div
          role="button"
          tabIndex={0}
          onClick={flip}
          onKeyDown={(e) => {
            if (e.key === "Enter") flip()
          }}
          aria-label={flipped ? "Ver el concepto" : "Revelar la respuesta"}
          className="relative h-[340px] w-full cursor-pointer transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* Front */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-11 text-center [backface-visibility:hidden]">
            <span className="absolute left-5 top-5 text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground">
              Concepto
            </span>
            <span className="absolute right-5 top-5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Eye className="h-3 w-3" /> clic para revelar
            </span>
            <div className="max-w-2xl text-2xl font-bold leading-relaxed text-foreground">
              {card.front}
            </div>
          </div>
          {/* Back */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-accent/40 bg-accent/5 p-11 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="absolute left-5 top-5 text-[10.5px] font-bold uppercase tracking-widest text-accent/80">
              Respuesta
            </span>
            <div className="max-w-2xl text-lg font-medium leading-relaxed text-foreground">
              {card.back}
            </div>
          </div>
        </div>
      </div>

      {/* Primary action: reveal, then self-grade */}
      {!flipped ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={() => go(-1)}
            disabled={i === 0}
            className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <button
            onClick={flip}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90"
          >
            <Eye className="h-4 w-4" /> Mostrar respuesta
          </button>
          <button
            onClick={() => go(1)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            Saltar <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">¿Sabías la respuesta?</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => grade(false)}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/5 px-6 py-2.5 text-sm font-bold text-red-500 transition-colors hover:bg-red-500/10"
            >
              <X className="h-4 w-4" /> No la sé
            </button>
            <button
              onClick={() => grade(true)}
              className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-6 py-2.5 text-sm font-bold text-accent transition-colors hover:bg-accent/20"
            >
              <Check className="h-4 w-4" /> La sé
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        Espacio: voltear · ← →: navegar{flipped ? " · 1: no la sé · 2: la sé" : ""}
      </p>
    </div>
  )
}

/**
 * The back-to-menu control now lives in the Área de Estudio page header bar
 * (striking accent, below the header) — see app/estudio/page.tsx. This is kept
 * as a no-op so every existing call site stays valid without rendering a
 * duplicate in-scroll button. `onBack` is still wired via the page bar.
 */
export function BackButton(_props: { onBack: () => void }) {
  return null
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
