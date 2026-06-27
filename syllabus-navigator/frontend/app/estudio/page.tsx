"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  listSyllabi,
  listCourses,
  fetchStudySet,
  fetchCourseStudySet,
  fetchSchedule,
  fetchRecommendations,
  fetchStudyStats,
  fetchStudySession,
  fetchQuizStage,
  type SyllabusUploadAPI,
  type CourseAPI,
  type StudySetAPI,
  type StudyDifficulty,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
  type StudyStatsAPI,
} from "@/lib/api"
import { groupByRealCourse, type RealCourse, type RealCourseGroup } from "@/lib/ui/course-group"
import { combineStudySets, type NamedStudySet } from "@/lib/ui/combine-study"
import { Textarea } from "@/components/ui/textarea"
import { pickWeekTopics } from "@/lib/ui/week-topics"
import { pickStudySuggestion, type StudySuggestion } from "@/lib/ui/study-suggestion"
import {
  GraduationCap,
  Loader2,
  AlertCircle,
  HelpCircle,
  Layers,
  RotateCcw,
  Timer,
  Network,
  AlignLeft,
  Zap,
  Sparkles,
  BookText,
  FileText,
  FolderOpen,
  Flame,
  MousePointerClick,
  ChevronDown,
  Globe,
} from "lucide-react"
import { FlashcardsView, EmptyMode } from "@/components/estudio/flashcards-view"
import { QuizView } from "@/components/estudio/quiz-view"
import { QuizReviewView } from "@/components/estudio/review-view"
import { MindView, ResumenView } from "@/components/estudio/mind-resumen-view"
import type { MindCourse } from "@/components/estudio/mind-map-canvas"
import { MasteryPanel } from "@/components/estudio/mastery-panel"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { MobileNav } from "@/components/navigator/mobile-nav"

type Mode = "menu" | "flash" | "repaso" | "quiz" | "simulacro" | "mind" | "resumen"

/**
 * Study scope: the whole course (aggregated), one specific PDF, or several
 * course folders combined into one set (`combo`, keyed by folder keys).
 */
type Scope =
  | { kind: "course"; courseId: string }
  | { kind: "doc"; docId: string }
  | { kind: "combo"; groupKeys: string[] }

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

const cleanName = (f: string) => f.replace(/\.pdf$/i, "")

// Stable key for a course folder (the "Sin curso" bucket has a null id).
const folderKey = (g: RealCourseGroup) => g.id ?? "__none__"

function EstudioContent() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()
  const params = useSearchParams()
  const router = useRouter()
  // Highlight any text in the study material → ask the chat to explain it.
  const askInChat = useAskInChat("tu material de estudio")

  const [uploads, setUploads] = useState<SyllabusUploadAPI[]>([])
  const [courses, setCourses] = useState<CourseAPI[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)

  // Selected course folders (multi-select). One folder → its own scope picker;
  // several folders → their study material is combined into one set.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  // Selected scope within the folder. null until the folder resolves a default.
  const [scope, setScope] = useState<Scope | null>(null)
  const [mode, setMode] = useState<Mode>("menu")
  // Course/scope selector collapse (manual on the menu; auto-hidden inside a mode).
  const [selectorsOpen, setSelectorsOpen] = useState(true)

  const [set, setSet] = useState<StudySetAPI | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [setError, setSetError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  // Difficulty is adaptive (driven by mastery/SRS), not user-chosen — fixed base here.
  const difficulty: StudyDifficulty = "medio"
  // Optional topic focus. Instant UI selection; applied via the focus button / on launch.
  const [topic, setTopic] = useState<string | null>(null)
  // Web augmentation: when on, generation pulls live web context (always fresh).
  const [webSearch, setWebSearch] = useState(false)
  // The (scope|difficulty|topic) signature the currently-loaded `set` was generated with.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  // The selected scope's cronograma events + the user's weekly plan (for week-topic chips).
  const [courseEvents, setCourseEvents] = useState<ScheduleEventAPI[]>([])
  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  // Spaced-repetition cards due today for the active PDF (drives repaso ordering).
  const [dueCardKeys, setDueCardKeys] = useState<string[]>([])

  const scopeTarget = (s: Scope) =>
    s.kind === "course" ? s.courseId : s.kind === "doc" ? s.docId : s.groupKeys.slice().sort().join(",")
  const scopeKey = (s: Scope | null, d: StudyDifficulty, t: string | null, w = false) =>
    `${s ? `${s.kind}:${scopeTarget(s)}` : "none"}::${d}::${t ?? ""}::${w ? "web" : ""}`

  // ── Group uploads into real course folders; keep only folders with ≥1 ready doc.
  const realCourses = useMemo<RealCourse[]>(
    () => courses.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    [courses],
  )
  const groups = useMemo<RealCourseGroup[]>(
    () => groupByRealCourse(uploads, realCourses).filter((g) => g.docs.some(isReady)),
    [uploads, realCourses],
  )
  // Folders currently selected; one → single mode, several → combined mode.
  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedKeys.includes(folderKey(g))),
    [groups, selectedKeys],
  )
  const multi = selectedGroups.length > 1
  const selectedGroup = multi ? null : (selectedGroups[0] ?? null)
  const selKey = selectedGroups.map(folderKey).sort().join("|")
  const readyDocs = useMemo(
    () => (selectedGroup ? selectedGroup.docs.filter(isReady) : []),
    [selectedGroup],
  )
  // "Todo el curso" is only meaningful for a real course folder (not "Sin curso").
  const canWholeCourse = !!selectedGroup?.id && readyDocs.length >= 1

  // Resolve the active scope target → ids used by the views.
  const activeDocId = scope?.kind === "doc" ? scope.docId : null
  const activeDoc = activeDocId ? (readyDocs.find((d) => d.id === activeDocId) ?? null) : null
  const scopeLabel =
    scope?.kind === "combo"
      ? `${selectedGroups.length} cursos combinados`
      : scope?.kind === "course"
        ? (selectedGroup?.name ?? "Curso")
        : activeDoc
          ? cleanName(activeDoc.original_filename)
          : ""
  // Mind-map switcher pills = the ready PDFs of the current folder.
  const mindCourses = useMemo<MindCourse[]>(
    () =>
      readyDocs.map((c, i) => ({
        id: c.id,
        code: `C-${String(i + 1).padStart(2, "0")}`,
        label: cleanName(c.original_filename),
      })),
    [readyDocs],
  )

  // Load the user's uploads + course folders.
  useEffect(() => {
    if (!ready) return
    if (status === "anonymous" || status === "guest") {
      setCoursesLoading(false)
      return
    }
    let alive = true
    Promise.all([listSyllabi(), listCourses().catch(() => ({ courses: [] as CourseAPI[] }))])
      .then(([u, c]) => {
        if (!alive) return
        setUploads(u.uploads)
        setCourses(c.courses)
      })
      .catch(() => alive && setSetError("No se pudieron cargar los cursos."))
      .finally(() => alive && setCoursesLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status])

  // Pick an initial folder once groups are available (honoring ?course=<docId|courseId>).
  useEffect(() => {
    if (selectedKeys.length > 0 || groups.length === 0) return
    const wanted = params.get("course")
    // ?course may be a document id (from the "Estudiar" link) or a course id.
    const byDoc = groups.find((g) => g.docs.some((d) => d.id === wanted))
    const byCourse = groups.find((g) => g.id === wanted)
    const pick = byDoc ?? byCourse ?? groups[0]
    if (pick) setSelectedKeys([folderKey(pick)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // When the folder changes, default the scope. Prefer a specific PDF so the
  // adaptive engine runs (per-PDF mastery panel, review/SRS recording, the Router
  // topic plan) — whole-course scope has none of that. Honor ?course=<docId> when
  // it points at a ready doc; else first ready PDF; else whole course as a fallback.
  useEffect(() => {
    // Several folders selected → combined whole-course set (no per-PDF scope).
    if (multi) {
      setScope({ kind: "combo", groupKeys: selectedGroups.map(folderKey) })
      setMode("menu")
      setTopic(null)
      return
    }
    if (!selectedGroup) {
      setScope(null)
      return
    }
    const wanted = params.get("course")
    const wantedDoc = readyDocs.find((d) => d.id === wanted)
    if (wantedDoc) {
      setScope({ kind: "doc", docId: wantedDoc.id })
    } else if (readyDocs[0]) {
      setScope({ kind: "doc", docId: readyDocs[0].id })
    } else if (canWholeCourse && selectedGroup.id) {
      setScope({ kind: "course", courseId: selectedGroup.id })
    } else {
      setScope(null)
    }
    setMode("menu")
    setTopic(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])

  // Load (or regenerate) the study set for the active scope, honoring difficulty/topic.
  const loadSet = useCallback(
    async (
      s: Scope,
      opts: {
        refresh?: boolean
        difficulty?: StudyDifficulty
        topic?: string | null
        web?: boolean
        // Keep the current set visible and show an inline spinner instead of the
        // full-screen loader (used by the "Aplicar enfoque" button).
        inline?: boolean
      } = {},
    ) => {
      const d = opts.difficulty ?? "medio"
      const t = opts.topic ?? null
      const w = opts.web ?? false
      if (opts.refresh || opts.inline) setRegenerating(true)
      else {
        setSetLoading(true)
        setSet(null)
      }
      setSetError(null)
      const fetchOpts = { refresh: opts.refresh, difficulty: d, topic: t ?? undefined, web: w }
      // Fetch a single folder's whole-course set (or its first PDF for "Sin curso").
      const fetchFolder = (g: RealCourseGroup) =>
        g.id
          ? fetchCourseStudySet(g.id, fetchOpts)
          : fetchStudySet(g.docs.filter(isReady)[0].id, fetchOpts)
      try {
        let data: StudySetAPI
        if (s.kind === "combo") {
          const gs = groups.filter((g) => s.groupKeys.includes(folderKey(g)))
          const named: NamedStudySet[] = await Promise.all(
            gs.map(async (g) => ({ name: g.name, set: await fetchFolder(g) })),
          )
          data = combineStudySets(named)
        } else if (s.kind === "course") {
          data = await fetchCourseStudySet(s.courseId, fetchOpts)
        } else {
          data = await fetchStudySet(s.docId, fetchOpts)
        }
        setSet(data)
        setLoadedKey(scopeKey(s, d, t, w))
      } catch (e) {
        setSetError(e instanceof Error ? e.message : "No se pudo generar el material de estudio.")
      } finally {
        setSetLoading(false)
        setRegenerating(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups],
  )

  // Base set for the menu (medium). Reloads whenever the active scope changes.
  useEffect(() => {
    if (scope) loadSet(scope, { difficulty: "medio", topic: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, loadSet])

  // Cronograma events for the active scope: per-PDF when a doc is selected, else
  // the first ready doc of the course (representative week context).
  useEffect(() => {
    const id = activeDocId ?? readyDocs[0]?.id ?? null
    if (!id) {
      setCourseEvents([])
      return
    }
    let alive = true
    fetchSchedule(id)
      .then((d) => alive && setCourseEvents(d.events))
      .catch(() => alive && setCourseEvents([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, selKey])

  // Adaptive session for the active PDF: which cards are due today (SRS). Doc
  // scope only — closes the learning loop on the repaso side. Whole-course has no
  // per-card tracking, so it clears.
  useEffect(() => {
    if (!activeDocId) {
      setDueCardKeys([])
      return
    }
    let alive = true
    fetchStudySession(activeDocId)
      .then((s) => alive && setDueCardKeys(s.dueCardKeys))
      .catch(() => alive && setDueCardKeys([]))
    return () => {
      alive = false
    }
  }, [activeDocId])

  // Pre-warm the staged quiz: when a scope settles, kick stage-1 generation in
  // the background (debounced, once per scope) so the bank is hot by the time the
  // user opens the Quiz — hides the cold-start latency behind menu browsing.
  const warmedScopes = useRef<Set<string>>(new Set())
  useEffect(() => {
    const qs =
      scope?.kind === "doc"
        ? ({ kind: "doc", docId: scope.docId } as const)
        : scope?.kind === "course"
          ? ({ kind: "course", courseId: scope.courseId } as const)
          : null
    if (!qs) return
    const key = qs.kind === "doc" ? `doc:${qs.docId}` : `course:${qs.courseId}`
    if (warmedScopes.current.has(key)) return
    const t = setTimeout(() => {
      warmedScopes.current.add(key)
      fetchQuizStage(qs, { stage: 0 }).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [scope])

  // Weekly plan (today + week range), once — used to rank week-relevant topics.
  useEffect(() => {
    let alive = true
    fetchRecommendations()
      .then((p) => alive && setPlan(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const weekTopics = useMemo(
    () =>
      pickWeekTopics(
        courseEvents,
        { today: plan?.today, weekStart: plan?.week_start, weekEnd: plan?.week_end },
        3,
      ),
    [courseEvents, plan],
  )

  const suggestion = useMemo(
    () => pickStudySuggestion(courseEvents, plan?.today, weekTopics.length > 0),
    [courseEvents, plan, weekTopics],
  )

  const applyTopic = (t: string | null) => setTopic(t)
  // Load the set with the current focus applied. A topic makes it a "custom" set,
  // which the server always generates fresh (never cached) — so no refresh flag is
  // needed. With no topic (General) this just returns the cached default set.
  const applyFocus = () => {
    if (scope) loadSet(scope, { difficulty, topic, web: webSearch, inline: true })
  }

  // Launch a mode, regenerating the set for the chosen difficulty/topic if needed.
  const launchMode = async (m: Mode) => {
    // The mind map has its own page, but only single PDFs have a stored graph.
    // Whole-course renders the aggregated mindmap inline instead.
    if (m === "mind" && scope?.kind === "doc") {
      router.push(`/mapa?course=${scope.docId}`)
      return
    }
    if (scope && loadedKey !== scopeKey(scope, difficulty, topic, webSearch)) {
      await loadSet(scope, { difficulty, topic, web: webSearch })
    }
    setSelectorsOpen(false)
    setMode(m)
  }

  // Honor ?mode= deep links once a set is available.
  useEffect(() => {
    const m = params.get("mode") as Mode | null
    if (m === "mind" && scope?.kind === "doc") {
      router.push(`/mapa?course=${scope.docId}`)
      return
    }
    if (m && set && ["flash", "repaso", "quiz", "simulacro", "resumen", "mind"].includes(m)) {
      setMode(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])

  const backToMenu = () => setMode("menu")

  // Toggle a folder in/out of the multi-selection; never let it become empty.
  const toggleFolder = (g: RealCourseGroup) => {
    const k = folderKey(g)
    setSelectedKeys((prev) =>
      prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k],
    )
  }

  // ---------- gates ----------
  if (ready && (status === "anonymous" || status === "guest")) {
    return <Gate onSignup={() => openAuthModal("signup")} />
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3 sm:px-6">
        <MobileNav />
        <GraduationCap className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Área de Estudio</h1>
        <Badge variant="new" className="ml-1 uppercase">
          Nuevo
        </Badge>
      </header>

      <div className="flex-1 overflow-auto p-6 sm:px-10 sm:py-9">
        <div
          className={`mx-auto transition-[max-width] duration-300 ${
            mode === "menu" ? "max-w-4xl" : "max-w-3xl"
          }`}
        >
          {coursesLoading ? (
            <CenterSpinner />
          ) : groups.length === 0 ? (
            <EmptyCourses />
          ) : (
            <>
              {/* ── Course + scope selector — collapsible; hidden inside a study mode so the activity stays centered ── */}
              {mode === "menu" && (
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
                  <button
                    onClick={() => setSelectorsOpen((o) => !o)}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                  >
                    <FolderOpen className="h-4 w-4 flex-none text-accent" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {multi ? `${selectedGroups.length} cursos combinados` : (selectedGroup?.name ?? "Curso")}
                      {!multi && scopeLabel && (
                        <span className="font-normal text-muted-foreground"> · {scopeLabel}</span>
                      )}
                    </span>
                    <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
                      {selectedGroups.length} de {groups.length}{" "}
                      {groups.length === 1 ? "curso" : "cursos"}
                    </span>
                    <ChevronDown
                      className="h-4 w-4 flex-none text-muted-foreground transition-transform"
                      style={{ transform: selectorsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                  </button>

                  {selectorsOpen && (
                    <div className="border-t border-border/50 p-4">
                      <div className="mb-2.5 text-[11px] font-medium text-muted-foreground">
                        Elige un curso, o varios para combinar su material de estudio.
                      </div>
                      {/* Course folders (horizontal, multi-select) */}
                      <div className="flex flex-wrap gap-2.5">
                        {groups.map((g) => {
                          const active = selectedKeys.includes(folderKey(g))
                          const count = g.docs.filter(isReady).length
                          return (
                            <Button
                              key={folderKey(g)}
                              variant={active ? "secondary" : "outline"}
                              onClick={() => toggleFolder(g)}
                              className={
                                active
                                  ? "gap-2 border-accent/40 bg-accent/10 text-foreground"
                                  : "gap-2 text-muted-foreground"
                              }
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  active ? "border-accent bg-accent/20" : "border-border"
                                }`}
                              >
                                {active && <span className="h-2 w-2 rounded-sm bg-accent" />}
                              </span>
                              <BookText
                                className="h-4 w-4 text-accent"
                                style={g.color ? { color: g.color } : undefined}
                              />
                              {g.name}
                              <span className="rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-muted-foreground">
                                {count}
                              </span>
                            </Button>
                          )
                        })}
                      </div>

                      {/* Scope: Todo el curso / specific PDF (vertical) — single folder only */}
                      {selectedGroup && (
                        <ScopePicker
                          group={selectedGroup}
                          readyDocs={readyDocs}
                          canWholeCourse={canWholeCourse}
                          scope={scope}
                          onPickWhole={() =>
                            selectedGroup.id &&
                            setScope({ kind: "course", courseId: selectedGroup.id })
                          }
                          onPickDoc={(id) => setScope({ kind: "doc", docId: id })}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6">
                {setLoading ? (
                  <CenterSpinner label="Generando material de estudio…" />
                ) : setError ? (
                  <SetError message={setError} onRetry={() => scope && loadSet(scope)} />
                ) : set && scope ? (
                  <SelectionAsk onAsk={askInChat} enabled={mode !== "menu"}>
                    <ModeRouter
                      mode={mode}
                      set={set}
                      scope={scope}
                      syllabusId={activeDocId}
                      dueKeys={dueCardKeys}
                      scopeLabel={scopeLabel}
                      mindCourses={mindCourses}
                      onPickDoc={(id) => setScope({ kind: "doc", docId: id })}
                      onAsk={askInChat}
                      regenerating={regenerating}
                      onRegenerate={() =>
                        scope && loadSet(scope, { refresh: true, difficulty, topic, web: webSearch })
                      }
                      setMode={setMode}
                      onLaunch={launchMode}
                      backToMenu={backToMenu}
                      topic={topic}
                      weekTopics={weekTopics}
                      suggestion={suggestion}
                      onTopic={applyTopic}
                      onApplyFocus={applyFocus}
                      web={webSearch}
                      onWeb={setWebSearch}
                    />
                  </SelectionAsk>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

/** Vertical scope list: "Todo el curso" (when available) + each ready PDF. */
function ScopePicker({
  group,
  readyDocs,
  canWholeCourse,
  scope,
  onPickWhole,
  onPickDoc,
}: {
  group: RealCourseGroup
  readyDocs: SyllabusUploadAPI[]
  canWholeCourse: boolean
  scope: Scope | null
  onPickWhole: () => void
  onPickDoc: (id: string) => void
}) {
  const wholeActive = scope?.kind === "course"
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card/40">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" /> Alcance · {group.name}
      </div>
      <ul className="divide-y divide-border/40">
        {canWholeCourse && (
          <ScopeRow
            active={wholeActive}
            onClick={onPickWhole}
            icon={<Layers className="h-4 w-4 text-accent" />}
            label="Todo el curso"
            meta={`${readyDocs.length} ${readyDocs.length === 1 ? "PDF" : "PDFs"} · preguntas que cruzan temas`}
          />
        )}
        {readyDocs.map((d) => (
          <ScopeRow
            key={d.id}
            active={scope?.kind === "doc" && scope.docId === d.id}
            onClick={() => onPickDoc(d.id)}
            icon={<FileText className="h-4 w-4 text-accent/70" />}
            label={cleanName(d.original_filename)}
            meta="PDF específico"
          />
        ))}
      </ul>
    </div>
  )
}

function ScopeRow({
  active,
  onClick,
  icon,
  label,
  meta,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  meta: string
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
          active ? "bg-accent/10" : "hover:bg-secondary/50"
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            active ? "border-accent" : "border-border"
          }`}
        >
          {active && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        {icon}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${active ? "font-semibold text-foreground" : ""}`}
          >
            {label}
          </span>
          <span className="block text-[11px] text-muted-foreground">{meta}</span>
        </span>
      </button>
    </li>
  )
}

function ModeRouter({
  mode,
  set,
  scope,
  syllabusId,
  dueKeys,
  scopeLabel,
  mindCourses,
  onPickDoc,
  onAsk,
  regenerating,
  onRegenerate,
  setMode,
  onLaunch,
  backToMenu,
  topic,
  weekTopics,
  suggestion,
  onTopic,
  onApplyFocus,
  web,
  onWeb,
}: {
  mode: Mode
  set: StudySetAPI
  scope: Scope
  /** The PDF id when scope is a single doc; null for whole-course (no per-doc tracking). */
  syllabusId: string | null
  /** SRS card keys due today (repaso ordering). Empty for whole-course scope. */
  dueKeys: string[]
  scopeLabel: string
  mindCourses: MindCourse[]
  onPickDoc: (id: string) => void
  onAsk: (text: string) => void
  regenerating: boolean
  onRegenerate: () => void
  setMode: (m: Mode) => void
  onLaunch: (m: Mode) => void
  backToMenu: () => void
  topic: string | null
  weekTopics: string[]
  suggestion: StudySuggestion | null
  onTopic: (t: string | null) => void
  onApplyFocus: () => void
  web: boolean
  onWeb: (on: boolean) => void
}) {
  // Staged quiz / Repaso run per single PDF or per whole course. Combined
  // multi-course scope has no per-scope endpoint → ask the user to narrow it.
  const quizScope =
    scope.kind === "doc"
      ? ({ kind: "doc", docId: scope.docId } as const)
      : scope.kind === "course"
        ? ({ kind: "course", courseId: scope.courseId } as const)
        : null
  const narrowScopeNotice = (
    <EmptyMode
      onBack={backToMenu}
      label="No disponible para varios cursos combinados. Elige un curso o un PDF específico."
    />
  )

  switch (mode) {
    case "flash":
      return (
        <FlashcardsView
          title="Tarjetas dinámicas"
          courseLabel={scopeLabel}
          cards={set.flashcards}
          onBack={backToMenu}
          syllabusId={syllabusId ?? undefined}
          dueKeys={dueKeys}
        />
      )
    case "repaso":
      if (!quizScope) return narrowScopeNotice
      return (
        <QuizReviewView
          courseLabel={scopeLabel}
          scope={quizScope}
          syllabusId={syllabusId ?? undefined}
          onBack={backToMenu}
        />
      )
    case "quiz":
    case "simulacro": {
      if (!quizScope) return narrowScopeNotice
      return (
        <QuizView
          title={mode === "simulacro" ? "Simulacro · Prueba corta" : "Quiz dinámico"}
          courseLabel={scopeLabel}
          scope={quizScope}
          syllabusId={syllabusId ?? undefined}
          onBack={backToMenu}
        />
      )
    }
    case "mind":
      return (
        <MindView
          courseCode=""
          courseLabel={scopeLabel}
          mindmap={set.mindmap}
          courses={scope.kind === "doc" ? mindCourses : []}
          activeCourseId={syllabusId ?? ""}
          onPickCourse={onPickDoc}
          onTopicDouble={onAsk}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
          onBack={backToMenu}
        />
      )
    case "resumen":
      return (
        <ResumenView
          courseName={scopeLabel}
          summary={set.summary}
          studyGuide={set.studyGuide}
          regenerating={regenerating}
          onRegenerate={onRegenerate}
          onFlash={() => setMode("flash")}
          onQuiz={() => setMode("quiz")}
          onBack={backToMenu}
        />
      )
    default:
      return (
        <Menu
          set={set}
          syllabusId={syllabusId}
          scopeLabel={scopeLabel}
          scopeNote={
            scope.kind === "doc"
              ? "PDF específico"
              : scope.kind === "combo"
                ? "cursos combinados"
                : "todo el curso"
          }
          onLaunch={onLaunch}
          topic={topic}
          weekTopics={weekTopics}
          suggestion={suggestion}
          onTopic={onTopic}
          onApplyFocus={onApplyFocus}
          regenerating={regenerating}
          web={web}
          onWeb={onWeb}
        />
      )
  }
}

const MODES: {
  key: Mode
  title: string
  desc: string
  Icon: typeof HelpCircle
  meta: (s: StudySetAPI) => string
}[] = [
  {
    key: "quiz",
    title: "Quiz dinámico",
    desc: "3 etapas que suben de dificultad (15 c/u), generadas de tu material.",
    Icon: HelpCircle,
    meta: () => "3 etapas · 45",
  },
  {
    key: "flash",
    title: "Tarjetas dinámicas",
    desc: "Flashcards de concepto → definición con repetición espaciada.",
    Icon: Layers,
    meta: (s) => `${s.flashcards.length} tarjetas`,
  },
  {
    key: "repaso",
    title: "Modo repaso",
    desc: "Repasa solo las preguntas que fallaste en el quiz, hasta dominarlas.",
    Icon: RotateCcw,
    meta: () => "fallos",
  },
  {
    key: "simulacro",
    title: "Simulacro · Prueba corta",
    desc: "Examen con el formato de la próxima evaluación.",
    Icon: Timer,
    meta: () => "cronometrado",
  },
  {
    key: "mind",
    title: "Mapa mental",
    desc: "Estructura visual de los temas y cómo se conectan.",
    Icon: Network,
    meta: () => "visual",
  },
  {
    key: "resumen",
    title: "Resumen automático",
    desc: "Síntesis de los temas clave, lista para repasar.",
    Icon: AlignLeft,
    meta: () => "auto",
  },
]

// Max focus-instruction length — mirrors the server cap in app/api/study/[syllabusId]/route.ts.
const MAX_TOPIC = 160

function Menu({
  set,
  syllabusId,
  scopeLabel,
  scopeNote,
  onLaunch,
  topic,
  weekTopics,
  suggestion,
  onTopic,
  onApplyFocus,
  regenerating,
  web,
  onWeb,
}: {
  set: StudySetAPI
  syllabusId: string | null
  scopeLabel: string
  scopeNote: string
  onLaunch: (m: Mode) => void
  topic: string | null
  weekTopics: string[]
  suggestion: StudySuggestion | null
  onTopic: (t: string | null) => void
  onApplyFocus: () => void
  regenerating: boolean
  web: boolean
  onWeb: (on: boolean) => void
}) {
  return (
    <div>
      <StatsStrip />

      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        Material de estudio generado dinámicamente desde tu base de conocimiento. La dificultad se
        ajusta sola según tu dominio. Si quieres, enfócalo en un tema; luego elige un modo.
      </p>

      <Card className="mt-5 flex-row items-center gap-3 p-3.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-accent/10">
          <Zap className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">
            <b>{scopeLabel}</b> · {scopeNote}
          </div>
        </div>
        <Badge variant="accent" className="flex-none">
          ● Indexado
        </Badge>
      </Card>

      {/* ─── Topic focus ─── */}
      <div className="mt-5 rounded-2xl border border-border/70 bg-card/40 p-4">
        {/* Focus instruction — free-text prompt + week-topic shortcuts */}
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Instrucción de enfoque (opcional)
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground/80">
          Escribe en qué enfocar el material (un tema o una instrucción), o déjalo en blanco para
          todo el alcance.
        </p>
        <div className="relative">
          <Textarea
            value={topic ?? ""}
            onChange={(e) => onTopic(e.target.value.trimStart() || null)}
            maxLength={MAX_TOPIC}
            placeholder="ej: solo ejercicios prácticos de derivadas, con casos límite"
            className="min-h-[4.5rem] resize-none pb-6 text-[13px]"
          />
          <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-muted-foreground/70">
            {topic?.length ?? 0}/{MAX_TOPIC}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Atajos
          </span>
          <TopicChip label="General" active={!topic} onClick={() => onTopic(null)} />
          {weekTopics.map((t) => (
            <TopicChip key={t} label={t} active={topic === t} onClick={() => onTopic(t)} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onWeb(!web)}
            aria-pressed={web}
            title="Enriquecer el material con una búsqueda web en vivo"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              web
                ? "border-accent/40 bg-accent/[0.06] text-accent"
                : "border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:bg-accent/10 hover:text-foreground"
            }`}
          >
            <Globe className="h-4 w-4" strokeWidth={2.25} />
            Búsqueda web
            <span
              className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                web ? "bg-accent/20 text-accent" : "bg-secondary text-muted-foreground"
              }`}
            >
              {web ? "ON" : "OFF"}
            </span>
          </button>
          <Button
            variant="accent"
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
            {regenerating ? "Generando…" : "Aplicar enfoque"}
          </Button>
        </div>
        {web && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <Globe className="h-3 w-3 text-accent" />
            El material se generará combinando tus documentos con resultados web actuales.
          </p>
        )}
      </div>

      {/* Mastery is tracked per PDF; only show it for a single-document scope. */}
      {syllabusId && <MasteryPanel syllabusId={syllabusId} />}

      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m) => {
          const suggested = suggestion?.mode === m.key
          return (
            <Card
              key={m.key}
              asChild
              className={`cursor-pointer gap-0 p-5 transition-all hover:-translate-y-0.5 hover:border-accent/40 ${
                suggested ? "border-accent/50 bg-accent/[0.04] ring-1 ring-accent/30" : ""
              }`}
            >
              <button onClick={() => onLaunch(m.key)} className="text-left">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                    <m.Icon className="h-5 w-5 text-accent" />
                  </div>
                  {suggested ? (
                    <Badge variant="accent" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      Sugerido · {suggestion!.reason}
                    </Badge>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">{m.meta(set)}</span>
                  )}
                </div>
                <div className="mt-3.5 text-[15px] font-bold text-foreground">{m.title}</div>
                <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.desc}</div>
              </button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------- small presentational helpers ----------

/** Compact streak / weekly-volume strip + highlight-to-ask hint at the top of the menu. */
function StatsStrip() {
  const [stats, setStats] = useState<StudyStatsAPI | null>(null)
  useEffect(() => {
    let alive = true
    fetchStudyStats()
      .then((s) => alive && setStats(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-3.5 py-2">
        <Flame
          className={`h-4 w-4 ${stats && stats.streakDays > 0 ? "text-orange-400" : "text-muted-foreground"}`}
        />
        <span className="text-sm font-bold text-foreground tabular-nums">
          {stats?.streakDays ?? 0}
        </span>
        <span className="text-xs text-muted-foreground">
          {stats?.streakDays === 1 ? "día de racha" : "días de racha"}
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-3.5 py-2">
        <Layers className="h-4 w-4 text-accent" />
        <span className="text-sm font-bold text-foreground tabular-nums">
          {stats?.cardsThisWeek ?? 0}
        </span>
        <span className="text-xs text-muted-foreground">repasos esta semana</span>
      </div>
      <div className="ml-auto hidden items-center gap-1.5 rounded-xl border border-accent/25 bg-accent/[0.06] px-3.5 py-2 text-[11.5px] font-medium text-muted-foreground sm:flex">
        <MousePointerClick className="h-3.5 w-3.5 text-accent" />
        Subraya cualquier texto para preguntárselo a la IA
      </div>
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
          ? "border-accent bg-accent/15 text-accent shadow-[0_0_0_1px_rgba(63,191,132,0.25)]"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:bg-accent/10 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

function SetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-border bg-card p-6 text-center">
      <AlertCircle className="mb-2 h-8 w-8 text-amber-500" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="link" onClick={onRetry} className="mt-3 text-accent">
        Reintentar
      </Button>
    </div>
  )
}

function EmptyCourses() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
      <GraduationCap className="mb-3 h-10 w-10 opacity-20" />
      <p className="mb-1 text-sm font-medium">Aún no hay cursos indexados.</p>
      <p className="text-xs">
        Sube el programa de tu curso en Cursos para generar material de estudio.
      </p>
    </div>
  )
}

function Gate({ onSignup }: { onSignup: () => void }) {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
      <div className="flex max-w-md flex-col items-center rounded-xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <GraduationCap className="mb-4 h-12 w-12 text-accent" />
        <h2 className="mb-2 text-xl font-semibold">Área de Estudio</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Inicia sesión para generar quizzes, tarjetas y resúmenes desde tus cursos.
        </p>
        <Button variant="accent" size="pill" onClick={onSignup}>
          Crear cuenta
        </Button>
      </div>
    </main>
  )
}

export default function EstudioPage() {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center">Loading…</div>}>
      <EstudioContent />
    </Suspense>
  )
}
