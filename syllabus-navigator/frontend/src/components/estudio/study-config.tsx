"use client"

/**
 * study-config.tsx — the Área de Estudio start screen (redesign of the
 * AreaEstudio.dc.html "CONFIG" view). Two columns:
 *
 *   ┌──────────────┬─────────────────────────────┐
 *   │ Material     │ Estudiando                  │
 *   │ (courses +   │ 6 mode cards (selectable)   │
 *   │  PDF picker) │ Generar {modo} → CTA        │
 *   └──────────────┴─────────────────────────────┘
 *
 * Unlike the old menu (click a mode → launches instantly), the student now
 * picks material + one mode and presses a single "Generar" CTA. All generation
 * still flows through the existing pipeline via `onGenerate` (page.tsx#launchMode).
 */

import {
  FolderOpen,
  BookText,
  FileText,
  Layers,
  HelpCircle,
  RotateCcw,
  Timer,
  Network,
  AlignLeft,
  Sparkles,
  Globe,
  ChevronDown,
  Check,
  ArrowRight,
  Loader2,
} from "lucide-react"
import type { SyllabusUploadAPI, StudySetAPI, StudyStatusAPI } from "@/lib/api"
import type { RealCourseGroup } from "@/lib/ui/course-group"
import type { StudySuggestion } from "@/lib/ui/study-suggestion"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MasteryPanel } from "@/components/estudio/mastery-panel"
import { useState } from "react"

/** Focus lifecycle for the UI (mirrors page.tsx). */
type FocusState = "none" | "pending" | "applied"
// Max focus-instruction length — mirrors the server cap.
const MAX_TOPIC = 160

export type Mode = "menu" | "flash" | "repaso" | "quiz" | "examen" | "mind" | "resumen"

/** Modes that run per single PDF or whole course — not on a combined scope. */
const SINGLE_SCOPE_MODES: Mode[] = ["quiz", "repaso", "examen"]

// Server-side cap on flashcards surfaced per assembled set (study.service SET_FLASHCARDS).
const SET_FLASHCARDS_CAP = 14

const MODES: {
  key: Mode
  title: string
  cta: string
  Icon: typeof HelpCircle
  meta: (s: StudySetAPI | null, st: StudyStatusAPI | null) => string
}[] = [
  { key: "quiz", title: "Quiz", cta: "Generar quiz", Icon: HelpCircle, meta: () => "3 etapas · 45 preguntas" },
  {
    key: "flash",
    title: "Tarjetas",
    cta: "Generar tarjetas",
    Icon: Layers,
    meta: (s, st) =>
      s
        ? `${s.flashcards.length} tarjetas`
        : st && st.flashcards > 0
          ? `${Math.min(st.flashcards, SET_FLASHCARDS_CAP)} tarjetas`
          : "tarjetas dinámicas",
  },
  { key: "repaso", title: "Repaso", cta: "Iniciar repaso", Icon: RotateCcw, meta: () => "tus fallos" },
  { key: "examen", title: "Examen", cta: "Iniciar examen", Icon: Timer, meta: () => "20 min · nota /20" },
  { key: "mind", title: "Mapa mental", cta: "Ver mapa", Icon: Network, meta: () => "visual" },
  { key: "resumen", title: "Resumen", cta: "Generar resumen", Icon: AlignLeft, meta: () => "síntesis" },
]

const cleanName = (f: string) => f.replace(/\.pdf$/i, "")
const isReady = (d: SyllabusUploadAPI) => d.status === "processed"

interface Props {
  // ── Material (left) ──
  groups: RealCourseGroup[]
  selectedKeys: string[]
  folderKey: (g: RealCourseGroup) => string
  onToggleFolder: (g: RealCourseGroup) => void
  selectedGroup: RealCourseGroup | null
  multi: boolean
  selectedGroups: RealCourseGroup[]
  readyDocs: SyllabusUploadAPI[]
  canWholeCourse: boolean
  wholeCourseActive: boolean
  selectedDocIds: string[]
  onPickWhole: () => void
  onToggleDoc: (id: string) => void
  // ── Estudiando (right) ──
  studyingLabel: string
  scopeLabel: string
  /** scope is a combined set (docs / combo) → single-scope modes disabled. */
  comboScope: boolean
  set: StudySetAPI | null
  status: StudyStatusAPI | null
  suggestion: StudySuggestion | null
  selectedMode: Mode
  onSelectMode: (m: Mode) => void
  onGenerate: () => void
  generating: boolean
  /** PDF id for the mastery ledger (single-doc scope only). */
  syllabusId: string | null
  // ── Enfoque (optional focus/topic + web) ──
  topic: string | null
  onTopic: (t: string | null) => void
  weekTopics: string[]
  onApplyFocus: () => void
  regenerating: boolean
  web: boolean
  onWeb: (on: boolean) => void
  focusState: FocusState
}

export function StudyConfig({
  groups,
  selectedKeys,
  folderKey,
  onToggleFolder,
  selectedGroup,
  multi,
  selectedGroups,
  readyDocs,
  canWholeCourse,
  wholeCourseActive,
  selectedDocIds,
  onPickWhole,
  onToggleDoc,
  studyingLabel,
  scopeLabel,
  comboScope,
  set,
  status,
  suggestion,
  selectedMode,
  onSelectMode,
  onGenerate,
  generating,
  syllabusId,
  topic,
  onTopic,
  weekTopics,
  onApplyFocus,
  regenerating,
  web,
  onWeb,
  focusState,
}: Props) {
  // Material scope list starts expanded; the course header row collapses it
  // (AreaEstudio.dc.html: chevron + collapsed summary line).
  const [scopeOpen, setScopeOpen] = useState(true)
  const activeMode = MODES.find((m) => m.key === selectedMode) ?? MODES[0]
  const modeBlockedByScope = comboScope && SINGLE_SCOPE_MODES.includes(selectedMode)
  const hasMaterial = selectedDocIds.length > 0 || wholeCourseActive || multi
  const canGenerate = hasMaterial && !generating && !modeBlockedByScope

  const selCount = wholeCourseActive ? readyDocs.length : selectedDocIds.length
  const totalCount = readyDocs.length
  const collapsedSummary = wholeCourseActive
    ? `Todo el curso · ${totalCount} ${totalCount === 1 ? "PDF" : "PDFs"}`
    : selectedDocIds.length === 1
      ? cleanName(
          readyDocs.find((d) => d.id === selectedDocIds[0])?.original_filename ?? "1 PDF",
        )
      : selectedDocIds.length > 1
        ? `${selectedDocIds.length} PDFs seleccionados`
        : "Sin selección"

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:gap-8">
      {/* ── Material ── */}
      <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-border bg-card/40 p-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Material
          </span>
          {!multi && totalCount > 0 && (
            <span className="ml-auto font-mono text-[11px] text-accent">
              {selCount}/{totalCount} seleccionado
            </span>
          )}
        </div>

        {/* Course folders (multi-select) */}
        <div className="flex flex-col gap-2">
          {groups.map((g) => {
            const active = selectedKeys.includes(folderKey(g))
            const count = g.docs.filter(isReady).length
            return (
              <button
                key={folderKey(g)}
                onClick={() => onToggleFolder(g)}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  active
                    ? "border-accent/40 bg-accent/[0.08]"
                    : "border-border/60 hover:border-accent/30"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    active ? "border-accent bg-accent/20" : "border-border"
                  }`}
                >
                  {active && <span className="h-2 w-2 rounded-sm bg-accent" />}
                </span>
                <BookText
                  className="h-4 w-4 shrink-0 text-accent"
                  style={g.color ? { color: g.color } : undefined}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    active ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {g.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Scope within the single selected folder */}
        {multi ? (
          <div className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3.5 py-2.5 text-xs text-muted-foreground">
            <FolderOpen className="h-4 w-4 text-accent" />
            {selectedGroups.length} cursos combinados
          </div>
        ) : (
          selectedGroup && (
            <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
              {/* Course header row — toggles the scope list (design: chevron rotates,
                  collapsed shows a one-line summary). */}
              <button
                onClick={() => setScopeOpen((o) => !o)}
                aria-expanded={scopeOpen}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3.5 py-2.5 text-left transition-colors hover:border-accent/30"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 truncate text-sm font-bold text-foreground">
                    {selectedGroup.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {totalCount} {totalCount === 1 ? "PDF" : "PDFs"}
                  </span>
                </span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
                  style={{ transform: scopeOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>

              {scopeOpen ? (
                <ul className="flex flex-col divide-y divide-border/40">
                  {canWholeCourse && (
                    <ScopeRow
                      active={wholeCourseActive}
                      onClick={onPickWhole}
                      icon={<Layers className="h-4 w-4 text-accent" />}
                      label="Todo el curso"
                      meta={`${readyDocs.length} ${readyDocs.length === 1 ? "PDF" : "PDFs"}`}
                    />
                  )}
                  {readyDocs.map((d) => (
                    <ScopeRow
                      key={d.id}
                      active={selectedDocIds.includes(d.id)}
                      checkbox
                      onClick={() => onToggleDoc(d.id)}
                      icon={<FileText className="h-4 w-4 text-accent/70" />}
                      label={cleanName(d.original_filename)}
                    />
                  ))}
                  {selectedDocIds.length > 1 && (
                    <li className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      {selectedDocIds.length} PDFs combinados: Tarjetas, Resumen y Mapa. Para
                      Quiz, Repaso o Examen elige un solo PDF o el curso completo.
                    </li>
                  )}
                </ul>
              ) : (
                <div className="flex items-center gap-2 px-1.5 py-1">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0 truncate text-xs text-accent/80">
                    {collapsedSummary}
                  </span>
                </div>
              )}
            </div>
          )
        )}
      </aside>

      {/* ── Estudiando ── */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Estudiando
            </div>
            <div className="mt-1 break-words text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
              {studyingLabel || "Selecciona material para empezar"}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.08] px-3.5 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="text-xs font-semibold text-accent">
              {hasMaterial
                ? multi
                  ? `${selectedGroups.length} cursos`
                  : wholeCourseActive
                    ? "Todo el curso"
                    : `${selectedDocIds.length} ${selectedDocIds.length === 1 ? "PDF" : "PDFs"}`
                : "Sin selección"}
            </span>
          </span>
        </div>

        {/* Mode cards (selectable) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MODES.map((m) => {
            const active = m.key === selectedMode
            const suggested = suggestion?.mode === m.key
            const blocked = comboScope && SINGLE_SCOPE_MODES.includes(m.key)
            return (
              <Card
                key={m.key}
                asChild
                className={`min-h-[146px] gap-0 p-5 transition-colors ${
                  blocked
                    ? "cursor-not-allowed opacity-40"
                    : active
                      ? "cursor-pointer border-accent/50 bg-accent/[0.06]"
                      : "cursor-pointer bg-card/40 hover:border-accent/40"
                }`}
              >
                <button
                  onClick={() => !blocked && onSelectMode(m.key)}
                  disabled={blocked}
                  className="text-left"
                  title={blocked ? "Elige un solo PDF o el curso completo" : undefined}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                      <m.Icon className="h-5 w-5 text-accent" />
                    </span>
                    <div className="flex items-center gap-1">
                      {suggested && !active && (
                        <Badge variant="accent" className="gap-1">
                          <Sparkles className="h-3 w-3 shrink-0" />
                          Sugerido
                        </Badge>
                      )}
                      {active && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
                          <Check className="h-3 w-3" strokeWidth={3.4} />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 text-[15px] font-bold text-foreground">{m.title}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {m.meta(set, status)}
                  </div>
                </button>
              </Card>
            )
          })}
        </div>

        {/* ─── Enfoque — always-visible card (AreaEstudio.dc.html): textarea +
            sugerencia chips + web toggle, with the Generar CTA inside. Shown for
            every mode selection. ─── */}
        <div className="rounded-2xl border border-accent/20 bg-accent/[0.04] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 flex-none text-accent" />
            <span className="text-sm font-bold text-foreground">Enfoque</span>
            <span className="text-xs text-accent/70">
              opcional · dile a Navigator en qué concentrarse
            </span>
            {focusState === "pending" && (
              <span
                className="flex-none rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500"
                title="El material actual aún no refleja este enfoque. Pulsa Aplicar o genera un modo para regenerarlo."
              >
                pendiente
              </span>
            )}
            {focusState === "applied" && (
              <span
                className="flex-none rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent"
                title="El material actual ya refleja este enfoque."
              >
                ✓ aplicado
              </span>
            )}
          </div>

          <div className="relative mt-3">
            <Textarea
              value={topic ?? ""}
              onChange={(e) => onTopic(e.target.value.trimStart() || null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  if (!regenerating) onApplyFocus()
                }
              }}
              maxLength={MAX_TOPIC}
              placeholder="ej: solo ejercicios prácticos de derivadas, con casos límite"
              className="min-h-[4.5rem] resize-none border-border/60 bg-background/40 pb-6 text-sm"
            />
            <span className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[10px] text-muted-foreground/70">
              {topic?.length ?? 0}/{MAX_TOPIC}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sugerencias
            </span>
            <TopicChip label="General" active={!topic} onClick={() => onTopic(null)} />
            {weekTopics.map((t) => (
              <TopicChip key={t} label={t} active={topic === t} onClick={() => onTopic(t)} />
            ))}
            {/* Web toggle — pill with sliding knob, pushed to the right (design). */}
            <button
              type="button"
              onClick={() => onWeb(!web)}
              aria-pressed={web}
              title="Enriquecer el material con una búsqueda web en vivo"
              className="ml-auto flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5" strokeWidth={2.25} />
              Búsqueda web
              <span
                className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                  web ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-background transition-[left] ${
                    web ? "left-[16px]" : "left-[2px]"
                  }`}
                />
              </span>
            </button>
          </div>

          <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/80">
            El enfoque y la búsqueda web aplican a Tarjetas, Resumen y Mapa. El Quiz y el
            Examen usan el banco de preguntas del curso completo.
          </p>

          {/* Summary + CTA row inside the card (design footer). */}
          <div className="mt-4 flex flex-col gap-3 border-t border-accent/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {!hasMaterial
                ? "Marca al menos un PDF o el curso completo."
                : modeBlockedByScope
                  ? "Ese modo necesita un solo PDF o el curso completo."
                  : (
                    <>
                      <span className="font-semibold text-foreground">{activeMode.title}</span> ·{" "}
                      {activeMode.meta(set, status)}
                      {scopeLabel && <span> · {scopeLabel}</span>}
                    </>
                  )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {focusState === "pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onApplyFocus}
                  disabled={regenerating}
                  className="gap-2"
                >
                  {regenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {regenerating ? "Generando…" : "Aplicar"}
                </Button>
              )}
              <button
                onClick={onGenerate}
                disabled={!canGenerate}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generando…
                  </>
                ) : (
                  <>
                    {activeMode.cta} <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mastery is tracked per PDF; only for a single-document scope. */}
        {syllabusId && <MasteryPanel syllabusId={syllabusId} />}
      </section>
    </div>
  )
}

function TopicChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`max-w-[15rem] truncate rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function ScopeRow({
  active,
  checkbox = false,
  onClick,
  icon,
  label,
  meta,
}: {
  active: boolean
  checkbox?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  meta?: string
}) {
  return (
    <li>
      <button
        onClick={onClick}
        aria-pressed={active}
        className={`flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
            checkbox ? "rounded" : "rounded-full"
          } ${active ? "border-accent" : "border-border"}`}
        >
          {active && (
            <span className={`h-2 w-2 bg-accent ${checkbox ? "rounded-sm" : "rounded-full"}`} />
          )}
        </span>
        {icon}
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-medium" : ""}`}>
          {label}
        </span>
        {meta && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
        )}
      </button>
    </li>
  )
}
