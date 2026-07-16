"use client"

/**
 * quiz-parts.tsx — presentational pieces for the redesigned Quiz / Repaso
 * (AreaEstudio.dc views 4a/4b/4g). Kept out of quiz-view.tsx so the engine file
 * stays focused on the staged-quiz logic.
 *
 *  · RevealExplain  — the "POR QUÉ SÍ / POR QUÉ NO LA TUYA" bullet grid.
 *  · CiteChip       — the source-citation pill ("Repaso DML · p.4 · ver en el PDF").
 *  · QuizResults    — score ring + per-topic bars + "puntos que mejorar".
 *  · Conexiones     — the matching exercise (tap a concept, then its definition).
 *  · Ordenar        — arrange-the-steps exercise (tap in the believed order).
 *  · CompletarHueco — fill-the-gap exercise (type the missing term).
 */

import { useState } from "react"
import { Check, X, FileText, Target, RotateCcw } from "lucide-react"
import type { QuizQuestionAPI } from "@/lib/api"

// ── Reveal: why the correct answer is right / why the chosen one isn't ──────────
export function RevealExplain({
  whyYes,
  whyNo,
  pickedWrong,
}: {
  whyYes: string[]
  whyNo: string[]
  pickedWrong: boolean
}) {
  const showNo = pickedWrong && whyNo.length > 0
  if (whyYes.length === 0 && !showNo) return null
  return (
    <div className={`mt-4 grid gap-2.5 ${showNo ? "sm:grid-cols-2" : "grid-cols-1"}`}>
      {whyYes.length > 0 && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.6} />
            <span className="text-[11px] font-extrabold tracking-wide text-accent">POR QUÉ SÍ</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {whyYes.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showNo && (
        <div className="rounded-xl border border-red-500/15 bg-red-500/[0.04] p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <X className="h-3.5 w-3.5 text-red-400" strokeWidth={2.6} />
            <span className="text-[11px] font-extrabold tracking-wide text-red-400">
              POR QUÉ NO LA TUYA
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {whyNo.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Source citation pill ────────────────────────────────────────────────────────
export function CiteChip({ cite, topic }: { cite?: string; topic?: string }) {
  const label = cite ?? topic
  if (!label) return <span />
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1.5">
      <FileText className="h-3 w-3 text-muted-foreground" />
      <span className="text-[11.5px] text-muted-foreground">
        {label}
        {cite && " · ver en el PDF"}
      </span>
    </span>
  )
}

// ── Results: score ring + per-topic bars + points to improve ────────────────────
export function QuizResults({
  correct,
  total,
  outcomes,
  failed,
  onRepaso,
  onBack,
}: {
  correct: number
  total: number
  outcomes: { topic: string; correct: boolean }[]
  failed: QuizQuestionAPI[]
  onRepaso?: () => void
  onBack: () => void
}) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0
  const msg = pct >= 80 ? "¡excelente!" : pct >= 60 ? "¡bien!" : "a repasar"

  // Aggregate outcomes into per-topic bars.
  const byTopic = new Map<string, { ok: number; tot: number }>()
  for (const o of outcomes) {
    const t = byTopic.get(o.topic) ?? { ok: 0, tot: 0 }
    t.tot += 1
    if (o.correct) t.ok += 1
    byTopic.set(o.topic, t)
  }
  const bars = Array.from(byTopic.entries()).map(([name, { ok, tot }]) => {
    const p = tot > 0 ? Math.round((ok / tot) * 100) : 0
    return { name, frac: `${ok}/${tot}`, pct: p, weak: p < 60 }
  })

  // "Puntos que mejorar" — one line per failed question.
  const improve = failed.map((q) => ({
    text: q.improve ?? q.topic ?? "Repasa esta pregunta",
    cite: q.cite ? q.cite.replace(/^.*·\s*/, "") : "",
  }))

  // SVG score ring geometry.
  const R = 70
  const C = 2 * Math.PI * R
  const offset = C * (1 - pct / 100)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="grid items-center gap-6 sm:grid-cols-[176px_1fr]">
        <div className="relative mx-auto h-[156px] w-[156px]">
          <svg viewBox="0 0 156 156" className="h-[156px] w-[156px] -rotate-90 text-accent">
            <circle cx="78" cy="78" r={R} fill="none" strokeWidth="12" className="stroke-secondary" />
            <circle
              cx="78"
              cy="78"
              r={R}
              fill="none"
              strokeWidth="12"
              strokeLinecap="round"
              stroke="currentColor"
              strokeDasharray={C}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-bold text-foreground">
              {correct}
              <span className="text-base text-muted-foreground">/{total}</span>
            </span>
            <span className="text-[11px] font-semibold text-accent">
              {pct}% {msg}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {bars.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin desglose por tema.</p>
          ) : (
            bars.map((b) => (
              <div key={b.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className={`font-semibold ${b.weak ? "text-amber-500" : "text-foreground"}`}>
                    {b.name}
                  </span>
                  <span
                    className={`font-mono ${b.weak ? "text-amber-500" : "text-accent"}`}
                  >
                    {b.frac}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full ${b.weak ? "bg-amber-500" : "bg-accent"}`}
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {improve.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-extrabold tracking-wide text-amber-500">
              PUNTOS QUE MEJORAR
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {improve.map((im, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>
                  {im.text}
                  {im.cite && <span className="text-muted-foreground/60"> · {im.cite}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        {improve.length > 0 && onRepaso && (
          <button
            onClick={onRepaso}
            className="flex-1 rounded-xl bg-accent py-3 text-sm font-extrabold text-accent-foreground transition-opacity hover:opacity-90"
          >
            Repasar mis {improve.length} {improve.length === 1 ? "fallo" : "fallos"} →
          </button>
        )}
        <button
          onClick={onBack}
          className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          Volver al Área de estudio
        </button>
      </div>
    </div>
  )
}

// ── Conexiones (matching) ───────────────────────────────────────────────────────
export function Conexiones({
  question,
  pairs,
  rightOrder,
  cite,
  onComplete,
  onNext,
  nextLabel,
  loading,
}: {
  question: string
  pairs: { l: string; r: string }[]
  /** Display order of the right column (indexes into `pairs`); defaults to identity. */
  rightOrder?: number[]
  cite?: string
  onComplete: (allRight: boolean) => void
  onNext: () => void
  nextLabel: string
  loading?: boolean
}) {
  const order = rightOrder && rightOrder.length === pairs.length ? rightOrder : pairs.map((_, i) => i)
  const [sel, setSel] = useState<number | null>(null) // selected left pair index
  const [matched, setMatched] = useState<Record<number, boolean>>({})
  const [errors, setErrors] = useState(0)
  const [wrongAt, setWrongAt] = useState<number | null>(null) // right-column slot flashing red
  const [done, setDone] = useState(false)

  const matchCount = Object.keys(matched).length
  const total = pairs.length

  const pickRight = (pairIdx: number) => {
    if (sel === null || matched[pairIdx]) return
    if (sel === pairIdx) {
      const next = { ...matched, [pairIdx]: true }
      setMatched(next)
      setSel(null)
      if (Object.keys(next).length === total) {
        setDone(true)
        onComplete(errors === 0)
      }
    } else {
      setErrors((e) => e + 1)
      setWrongAt(pairIdx)
      setTimeout(() => setWrongAt(null), 450)
    }
  }

  return (
    <>
      <div className="text-lg font-bold leading-snug text-foreground">{question}</div>
      <div className="mb-1 mt-1 text-[11.5px] text-muted-foreground/70">
        Toca un concepto y luego su definición · {matchCount}/{total} unidas
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-x-4">
        {/* Left: concepts */}
        <div className="flex flex-col gap-2">
          {pairs.map((p, i) => {
            const on = !!matched[i]
            const active = sel === i
            return (
              <button
                key={i}
                onClick={() => !on && setSel(i)}
                disabled={on}
                className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left font-mono text-[13px] font-bold transition-colors ${
                  on
                    ? "border-accent/40 bg-accent/[0.08] text-accent"
                    : active
                      ? "border-accent bg-accent/10 text-foreground shadow-[0_0_16px_-6px_hsl(var(--accent))]"
                      : "border-border bg-card text-muted-foreground hover:border-accent/40"
                }`}
              >
                {p.l}
                <span
                  className={`h-2 w-2 rounded-full ${
                    on ? "bg-accent" : active ? "ring-2 ring-accent" : "border border-border"
                  }`}
                />
              </button>
            )
          })}
        </div>
        <div className="self-stretch" />
        {/* Right: definitions (shuffled) */}
        <div className="flex flex-col gap-2">
          {order.map((pairIdx) => {
            const on = !!matched[pairIdx]
            const wrong = wrongAt === pairIdx
            return (
              <button
                key={pairIdx}
                onClick={() => pickRight(pairIdx)}
                disabled={on}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-colors ${
                  on
                    ? "border-accent/40 bg-accent/[0.08] text-foreground"
                    : wrong
                      ? "border-red-500/50 bg-red-500/[0.07] text-muted-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-accent/40"
                }`}
                style={wrong ? { animation: "shake 0.3s ease" } : undefined}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-accent" : "border border-border"}`}
                />
                {pairs[pairIdx].r}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CiteChip cite={cite} />
          {errors > 0 && !done && (
            <span className="text-[11.5px] text-muted-foreground/70">Errores: {errors}</span>
          )}
        </div>
        <button
          onClick={onNext}
          disabled={!done || loading}
          className={`rounded-xl px-6 py-3 text-sm font-bold transition-opacity ${
            done
              ? "bg-accent text-accent-foreground hover:opacity-90"
              : "cursor-not-allowed bg-secondary text-muted-foreground"
          }`}
        >
          {nextLabel}
        </button>
      </div>
    </>
  )
}

/** Shuffle [0..n) avoiding the identity permutation when possible. */
function shuffledIdx(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    if (order.some((v, i) => v !== i)) break
  }
  return order
}

// ── Ordenar pasos (arrange the sequence) ────────────────────────────────────────
export function Ordenar({
  question,
  steps,
  whyYes,
  cite,
  onComplete,
  onNext,
  nextLabel,
  loading,
}: {
  question: string
  /** Steps in the CORRECT order (display is shuffled locally). */
  steps: string[]
  whyYes?: string[]
  cite?: string
  onComplete: (correct: boolean) => void
  onNext: () => void
  nextLabel: string
  loading?: boolean
}) {
  // Stable shuffled display order for this mount.
  const [display] = useState(() => shuffledIdx(steps.length))
  // Original step indexes in the order the student tapped them.
  const [picks, setPicks] = useState<number[]>([])
  const [checked, setChecked] = useState(false)
  const [correct, setCorrect] = useState(false)

  const toggle = (orig: number) => {
    if (checked) return
    setPicks((p) => (p.includes(orig) ? p.filter((x) => x !== orig) : [...p, orig]))
  }

  const check = () => {
    if (checked || picks.length !== steps.length) return
    const ok = picks.every((orig, pos) => orig === pos)
    setChecked(true)
    setCorrect(ok)
    onComplete(ok)
  }

  return (
    <>
      <div className="text-lg font-bold leading-snug text-foreground">{question}</div>
      <div className="mb-1 mt-1 text-[11.5px] text-muted-foreground/70">
        Toca los pasos en el orden correcto · {picks.length}/{steps.length}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {display.map((orig) => {
          const pos = picks.indexOf(orig) // -1 when unpicked
          const isRight = checked && pos === orig
          const isWrong = checked && pos !== orig
          return (
            <button
              key={orig}
              onClick={() => toggle(orig)}
              disabled={checked}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-colors ${
                isRight
                  ? "border-accent/50 bg-accent/[0.08] text-foreground"
                  : isWrong
                    ? "border-red-500/50 bg-red-500/[0.06] text-muted-foreground"
                    : pos >= 0
                      ? "border-accent/40 bg-accent/[0.06] text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-accent/40"
              }`}
            >
              <span
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold ${
                  isRight
                    ? "border-none bg-accent text-accent-foreground"
                    : isWrong
                      ? "border-none bg-red-500 text-white"
                      : pos >= 0
                        ? "border-accent text-accent"
                        : "border-border/60 text-transparent"
                }`}
              >
                {checked && isWrong ? orig + 1 : pos >= 0 ? pos + 1 : "·"}
              </span>
              {steps[orig]}
            </button>
          )
        })}
      </div>

      {checked && (
        <div
          className={`mt-4 rounded-xl border p-3 text-sm font-bold ${
            correct
              ? "border-accent/25 bg-accent/5 text-accent"
              : "border-red-500/25 bg-red-500/[0.04] text-red-400"
          }`}
        >
          {correct
            ? "¡Orden correcto!"
            : "Orden incorrecto — los números muestran la posición correcta de cada paso"}
        </div>
      )}
      {checked && whyYes && whyYes.length > 0 && (
        <RevealExplain whyYes={whyYes} whyNo={[]} pickedWrong={false} />
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CiteChip cite={cite} />
          {!checked && picks.length > 0 && (
            <button
              onClick={() => setPicks([])}
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground/70 hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Reiniciar
            </button>
          )}
        </div>
        {checked ? (
          <button
            onClick={onNext}
            disabled={loading}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {nextLabel}
          </button>
        ) : (
          <button
            onClick={check}
            disabled={picks.length !== steps.length}
            className={`rounded-xl px-6 py-3 text-sm font-bold transition-opacity ${
              picks.length === steps.length
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "cursor-not-allowed bg-secondary text-muted-foreground"
            }`}
          >
            Comprobar orden
          </button>
        )}
      </div>
    </>
  )
}

// ── Completar el hueco (fill the gap) ───────────────────────────────────────────
/** Gap marker inside `fillText` — mirrors FILL_GAP in the fillblank agent. */
const GAP = "_____"

/** Normalize for a fair comparison: case, surrounding space, inner runs of space. */
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ").replace(/;+$/, "")

export function CompletarHueco({
  question,
  fillText,
  fillAnswers,
  whyYes,
  cite,
  onComplete,
  onNext,
  nextLabel,
  loading,
}: {
  question: string
  /** Snippet containing one `_____` gap. */
  fillText: string
  /** Accepted completions (canonical first). */
  fillAnswers: string[]
  whyYes?: string[]
  cite?: string
  onComplete: (correct: boolean) => void
  onNext: () => void
  nextLabel: string
  loading?: boolean
}) {
  const [value, setValue] = useState("")
  const [checked, setChecked] = useState(false)
  const [correct, setCorrect] = useState(false)
  const [before, after] = fillText.split(GAP)

  const check = () => {
    if (checked || !value.trim()) return
    const ok = fillAnswers.some((a) => norm(a) === norm(value))
    setChecked(true)
    setCorrect(ok)
    onComplete(ok)
  }

  return (
    <>
      <div className="text-lg font-bold leading-snug text-foreground">{question}</div>
      <div className="mb-1 mt-1 text-[11.5px] text-muted-foreground/70">
        Escribe lo que falta en el hueco
      </div>

      <div className="mt-4 whitespace-pre-wrap rounded-xl border border-border bg-secondary/30 p-4 font-mono text-[13px] leading-relaxed text-foreground">
        {before}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              check()
            }
          }}
          disabled={checked}
          placeholder="?????"
          size={Math.max(6, value.length + 1)}
          className={`mx-1 inline-block rounded-md border border-dashed bg-transparent px-2 py-0.5 text-center font-mono text-[13px] outline-none transition-colors ${
            checked
              ? correct
                ? "border-accent bg-accent/10 text-accent"
                : "border-red-500 bg-red-500/10 text-red-400"
              : "border-accent/50 text-accent focus:border-accent"
          }`}
        />
        {after}
      </div>

      {checked && (
        <div
          className={`mt-4 rounded-xl border p-3 text-sm font-bold ${
            correct
              ? "border-accent/25 bg-accent/5 text-accent"
              : "border-red-500/25 bg-red-500/[0.04] text-red-400"
          }`}
        >
          {correct ? (
            "¡Correcto!"
          ) : (
            <>
              Incorrecto — la respuesta era{" "}
              <span className="font-mono text-foreground">{fillAnswers[0]}</span>
            </>
          )}
        </div>
      )}
      {checked && whyYes && whyYes.length > 0 && (
        <RevealExplain whyYes={whyYes} whyNo={[]} pickedWrong={false} />
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <CiteChip cite={cite} />
        {checked ? (
          <button
            onClick={onNext}
            disabled={loading}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {nextLabel}
          </button>
        ) : (
          <button
            onClick={check}
            disabled={!value.trim()}
            className={`rounded-xl px-6 py-3 text-sm font-bold transition-opacity ${
              value.trim()
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "cursor-not-allowed bg-secondary text-muted-foreground"
            }`}
          >
            Comprobar
          </button>
        )}
      </div>
    </>
  )
}
