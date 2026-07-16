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
  {
    key: "quiz",
    title: "Quiz",
    cta: "Generar quiz",
    Icon: HelpCircle,
    meta: () => "3 etapas · 45 preguntas",
  },
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
  {
    key: "repaso",
    title: "Repaso",
    cta: "Iniciar repaso",
    Icon: RotateCcw,
    meta: () => "tus fallos",
  },
  {
    key: "examen",
    title: "Examen",
    cta: "Iniciar examen",
    Icon: Timer,
    meta: () => "20 min · nota /20",
  },
  { key: "mind", title: "Mapa mental", cta: "Ver mapa", Icon: Network, meta: () => "visual" },
  {
    key: "resumen",
    title: "Resumen",
    cta: "Generar resumen",
    Icon: AlignLeft,
    meta: () => "síntesis",
  },
]

const cleanName = (f: string) => f.replace(/\.pdf$/i, "")
const isReady = (d: SyllabusUploadAPI) => d.status === "processed"

interface Props {
  // ── Material (left) ──
  groups: RealCourseGroup[]
  selectedKey: string | null
  folderKey: (g: RealCourseGroup) => string
  onSelectCourse: (g: RealCourseGroup) => void
  selectedGroup: RealCourseGroup | null
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
  selectedKey,
  folderKey,
  onSelectCourse,
  selectedGroup,
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
  // The course selector is the only collapsible part of the material panel.
  const [coursesOpen, setCoursesOpen] = useState(false)
  const activeMode = MODES.find((m) => m.key === selectedMode) ?? MODES[0]
  const modeBlockedByScope = comboScope && SINGLE_SCOPE_MODES.includes(selectedMode)
  const hasMaterial = selectedDocIds.length > 0 || wholeCourseActive
  const canGenerate = hasMaterial && !generating && !modeBlockedByScope

  const selCount = wholeCourseActive ? readyDocs.length : selectedDocIds.length
  const totalCount = readyDocs.length

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] xl:gap-8">
      {/* ── Material ── */}
      <aside className="flex h-fit flex-col rounded-2xl border border-border/70 bg-card/70 p-3 shadow-sm shadow-accent/5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        <div className="flex items-start gap-3 px-2 pb-4 pt-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <BookText className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              Material de estudio
            </h2>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Elige un curso y limita sus materiales si lo necesitas
            </p>
          </div>
        </div>

        {/* Single-course selector */}
        <section aria-label="Curso seleccionado" className="px-1">
          <span className="mb-1.5 block px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Curso
          </span>
          <button
            type="button"
            onClick={() => setCoursesOpen((open) => !open)}
            disabled={!selectedGroup}
            aria-expanded={coursesOpen}
            aria-controls="study-course-options"
            className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
              <FolderOpen
                className="h-[18px] w-[18px] text-accent"
                style={selectedGroup?.color ? { color: selectedGroup.color } : undefined}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-foreground">
                {selectedGroup?.name ?? "Selecciona un curso"}
              </span>
              <span className="block text-[10px] leading-4 text-muted-foreground">
                {totalCount} {totalCount === 1 ? "material" : "materiales"}
              </span>
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
              style={{ transform: coursesOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>

          {coursesOpen && (
            <nav
              id="study-course-options"
              aria-label="Cursos disponibles"
              className="mt-1 rounded-xl border border-border/60 bg-background/45 p-1"
            >
              <ul className="space-y-0.5">
                {groups.map((g) => {
                  const active = selectedKey === folderKey(g)
                  const count = g.docs.filter(isReady).length
                  return (
                    <li key={folderKey(g)}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectCourse(g)
                          setCoursesOpen(false)
                        }}
                        aria-pressed={active}
                        title={g.name}
                        className={`group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                          active
                            ? "bg-accent/[0.09] text-foreground"
                            : "text-muted-foreground hover:bg-secondary/55 hover:text-foreground"
                        }`}
                      >
                        <BookText
                          className="h-4 w-4 shrink-0 text-accent"
                          style={g.color ? { color: g.color } : undefined}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-[12px] ${active ? "font-semibold" : "font-medium"}`}
                        >
                          {g.name}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {count}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
                            active
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border/80"
                          }`}
                        >
                          {active && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          )}
        </section>

        {selectedGroup && (
          <section
            aria-label="Materiales opcionales"
            className="mt-4 border-t border-border/60 px-1 pt-4"
          >
            <div className="px-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-semibold text-foreground">Materiales opcionales</h3>
                <span className="text-[10px] font-medium tabular-nums text-accent">
                  {wholeCourseActive ? "Curso completo" : `${selCount} de ${totalCount}`}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                {canWholeCourse
                  ? "Todo el curso está incluido. Elige archivos solo para limitar el estudio."
                  : "Selecciona uno o varios archivos para estudiar."}
              </p>
            </div>

            <ul
              id="study-material-options"
              className="mt-2 space-y-1 rounded-xl bg-background/25 p-1"
            >
              {canWholeCourse && (
                <ScopeRow
                  active={wholeCourseActive}
                  onClick={onPickWhole}
                  icon={<Layers className="h-4 w-4 text-accent" />}
                  label="Todo el curso"
                  meta="Predeterminado"
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
                <li className="mx-2 my-2 border-l-2 border-accent/30 pl-3 text-[10px] leading-4 text-muted-foreground">
                  {selectedDocIds.length} PDFs combinados: Tarjetas, Resumen y Mapa. Para Quiz,
                  Repaso o Examen elige un solo PDF o el curso completo.
                </li>
              )}
            </ul>
          </section>
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
                ? wholeCourseActive
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
            El enfoque y la búsqueda web aplican a Tarjetas, Resumen y Mapa. El Quiz y el Examen
            usan el banco de preguntas del curso completo.
          </p>

          {/* Summary + CTA row inside the card (design footer). */}
          <div className="mt-4 flex flex-col gap-3 border-t border-accent/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {!hasMaterial ? (
                "Marca al menos un PDF o el curso completo."
              ) : modeBlockedByScope ? (
                "Ese modo necesita un solo PDF o el curso completo."
              ) : (
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
        type="button"
        onClick={onClick}
        aria-pressed={active}
        title={label}
        className={`group flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 text-left transition-[background-color,border-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.99] ${
          active
            ? "border-accent/20 bg-accent/[0.08] text-foreground"
            : "text-muted-foreground hover:border-border/60 hover:bg-secondary/45 hover:text-foreground"
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-accent/[0.12]" : "bg-secondary/55 group-hover:bg-secondary"}`}
        >
          {icon}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[12px] ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
        {meta && (
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {meta}
          </span>
        )}
        <span
          aria-hidden="true"
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border transition-colors ${
            checkbox ? "rounded-md" : "rounded-full"
          } ${
            active
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border/80 bg-background/30"
          }`}
        >
          {active && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      </button>
    </li>
  )
}
