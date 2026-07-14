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
  fetchStudyStatus,
  warmStudyBank,
  type SyllabusUploadAPI,
  type CourseAPI,
  type StudySetAPI,
  type StudyDifficulty,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
  type StudyStatsAPI,
  type StudyStatusAPI,
} from "@/lib/api"
import { groupByRealCourse, type RealCourse, type RealCourseGroup } from "@/lib/ui/course-group"
import { combineStudySets, type NamedStudySet } from "@/lib/ui/combine-study"
import { toast } from "sonner"
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
  Sparkles,
  BookText,
  FileText,
  FolderOpen,
  Flame,
  ChevronDown,
  Globe,
  ArrowLeft,
} from "lucide-react"
import { FlashcardsView, EmptyMode } from "@/components/estudio/flashcards-view"
import { QuizView } from "@/components/estudio/quiz-view"
import { QuizReviewView } from "@/components/estudio/review-view"
import { ResumenView } from "@/components/estudio/mind-resumen-view"
import { MasteryPanel } from "@/components/estudio/mastery-panel"
import {
  GenerationProgress,
  useGenerationProgress,
} from "@/components/estudio/generation-progress"
import { SelectionAsk } from "@/components/SelectionAsk"
import { useAskInChat } from "@/hooks/use-ask-in-chat"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { MobileNav } from "@/components/navigator/mobile-nav"

type Mode = "menu" | "flash" | "repaso" | "quiz" | "simulacro" | "mind" | "resumen"

/**
 * Study scope: the whole course (aggregated), one specific PDF, a subset of the
 * course's PDFs combined client-side (`docs`), or several course folders
 * combined into one set (`combo`, keyed by folder keys).
 */
type Scope =
  | { kind: "course"; courseId: string }
  | { kind: "doc"; docId: string }
  | { kind: "docs"; docIds: string[] }
  | { kind: "combo"; groupKeys: string[] }

function isReady(d: SyllabusUploadAPI): boolean {
  return d.status === "processed"
}

const cleanName = (f: string) => f.replace(/\.pdf$/i, "")

// Stable key for a course folder (the "Sin curso" bucket has a null id).
const folderKey = (g: RealCourseGroup) => g.id ?? "__none__"

// Last course/scope selection, restored on return visits — a student expects to
// pick up where they left off, not to be reset to the first PDF of the list.
const LAST_SELECTION_KEY = "estudio:last-selection"
type StoredSelection = { keys: string[]; scope: Scope | null }

function readLastSelection(): StoredSelection | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(LAST_SELECTION_KEY)
    return raw ? (JSON.parse(raw) as StoredSelection) : null
  } catch {
    return null
  }
}

function writeLastSelection(sel: StoredSelection) {
  try {
    window.localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(sel))
  } catch {
    // storage blocked/full — non-fatal, the default picker still works
  }
}

/** How the current focus (topic/web) relates to the loaded material. */
type FocusState = "none" | "pending" | "applied"

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
  // Closed by default — the trigger row already names the active course · scope.
  const [selectorsOpen, setSelectorsOpen] = useState(false)

  const [set, setSet] = useState<StudySetAPI | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  // 0→100% while the study set generates; the material is revealed at 100.
  const genProgress = useGenerationProgress(setLoading)
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
  // Light status for the active scope: bank counts + whether the default set is
  // cached. Lets the menu render instantly without generating anything.
  const [studyStatus, setStudyStatus] = useState<StudyStatusAPI | null>(null)
  // The selected scope's cronograma events + the user's weekly plan (for week-topic chips).
  const [courseEvents, setCourseEvents] = useState<ScheduleEventAPI[]>([])
  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  // Spaced-repetition cards due today for the active PDF (drives repaso ordering).
  const [dueCardKeys, setDueCardKeys] = useState<string[]>([])

  const scopeTarget = (s: Scope) =>
    s.kind === "course"
      ? s.courseId
      : s.kind === "doc"
        ? s.docId
        : s.kind === "docs"
          ? s.docIds.slice().sort().join(",")
          : s.groupKeys.slice().sort().join(",")
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
  // Bind asks to the selected course (or PDF in the "Sin curso" bucket) so every
  // question from this course lands in its ONE dedicated chat.
  const ask = useCallback(
    (text: string) =>
      askInChat(text, { courseId: selectedGroup?.id ?? null, syllabusId: activeDocId }),
    [askInChat, selectedGroup?.id, activeDocId],
  )
  const scopeLabel =
    scope?.kind === "combo"
      ? `${selectedGroups.length} cursos combinados`
      : scope?.kind === "docs"
        ? `${scope.docIds.length} PDFs combinados`
        : scope?.kind === "course"
          ? (selectedGroup?.name ?? "Curso")
          : activeDoc
            ? cleanName(activeDoc.original_filename)
            : ""
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

  // Pick an initial folder once groups are available: ?course deep link first,
  // then the folders of the last visit (localStorage), then the first group.
  useEffect(() => {
    if (selectedKeys.length > 0 || groups.length === 0) return
    const wanted = params.get("course")
    // ?course may be a document id (from the "Estudiar" link) or a course id.
    const byDoc = groups.find((g) => g.docs.some((d) => d.id === wanted))
    const byCourse = groups.find((g) => g.id === wanted)
    const linked = byDoc ?? byCourse
    if (linked) {
      setSelectedKeys([folderKey(linked)])
      return
    }
    const storedKeys =
      readLastSelection()?.keys.filter((k) => groups.some((g) => folderKey(g) === k)) ?? []
    if (storedKeys.length > 0) {
      setSelectedKeys(storedKeys)
      return
    }
    setSelectedKeys([folderKey(groups[0])])
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
    // Restore the last visit's scope when it belongs to this same folder
    // selection and its targets are still ready.
    const stored = readLastSelection()
    const storedScope =
      stored && stored.keys.slice().sort().join("|") === selKey ? stored.scope : null
    const validStored =
      storedScope?.kind === "doc" && readyDocs.some((d) => d.id === storedScope.docId)
        ? storedScope
        : storedScope?.kind === "docs" &&
            storedScope.docIds.length > 0 &&
            storedScope.docIds.every((id) => readyDocs.some((d) => d.id === id))
          ? storedScope
          : storedScope?.kind === "course" &&
              canWholeCourse &&
              selectedGroup.id === storedScope.courseId
            ? storedScope
            : null
    if (wantedDoc) {
      setScope({ kind: "doc", docId: wantedDoc.id })
    } else if (validStored) {
      setScope(validStored)
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

  // Remember the selection so the next visit resumes here (not the first PDF).
  useEffect(() => {
    if (selectedKeys.length === 0) return
    writeLastSelection({ keys: selectedKeys, scope })
  }, [selectedKeys, scope])

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
        // Background hydration (cached set only): no loaders, errors swallowed.
        silent?: boolean
      } = {},
    ) => {
      const d = opts.difficulty ?? "medio"
      const t = opts.topic ?? null
      const w = opts.web ?? false
      if (opts.silent) {
        // no loading flags — the menu stays interactive
      } else if (opts.refresh || opts.inline) setRegenerating(true)
      else {
        setSetLoading(true)
        setSet(null)
      }
      if (!opts.silent) setSetError(null)
      const fetchOpts = {
        refresh: opts.refresh,
        difficulty: d,
        topic: t ?? undefined,
        web: w,
      }
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
        } else if (s.kind === "docs") {
          // Subset of the course's PDFs: fetch each doc's set, combine client-side.
          const named: NamedStudySet[] = await Promise.all(
            s.docIds.map(async (id) => {
              const doc = uploads.find((u) => u.id === id)
              return {
                name: doc ? cleanName(doc.original_filename) : "PDF",
                set: await fetchStudySet(id, fetchOpts),
              }
            }),
          )
          data = combineStudySets(named)
        } else if (s.kind === "course") {
          data = await fetchCourseStudySet(s.courseId, fetchOpts)
        } else {
          data = await fetchStudySet(s.docId, fetchOpts)
        }
        setSet(data)
        setLoadedKey(scopeKey(s, d, t, w))
        return true
      } catch (e) {
        if (!opts.silent) {
          setSetError(
            e instanceof Error ? e.message : "No se pudo generar el material de estudio.",
          )
        }
        return false
      } finally {
        if (!opts.silent) {
          setSetLoading(false)
          setRegenerating(false)
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, uploads],
  )

  // Scope change → menu renders instantly; NOTHING generates until a mode is
  // opened. We only fetch the light status (bank counts + cached flag), and when
  // a fresh default set is already cached we hydrate it silently (cache hit —
  // no LLM cost). Cold scopes generate on demand in `launchMode`.
  useEffect(() => {
    // Drop the previous scope's material so stale counts/sets never leak.
    setSet(null)
    setLoadedKey(null)
    setSetError(null)
    setStudyStatus(null)
    const qs =
      scope?.kind === "doc"
        ? ({ kind: "doc", docId: scope.docId } as const)
        : scope?.kind === "course"
          ? ({ kind: "course", courseId: scope.courseId } as const)
          : null
    if (!qs || !scope) return
    let alive = true
    fetchStudyStatus(qs)
      .then((st) => {
        if (!alive) return
        setStudyStatus(st)
        if (st.cached) loadSet(scope, { difficulty: "medio", topic: null, silent: true })
      })
      .catch(() => {})
    // Start filling the question bank NOW, in the background. The student is about
    // to spend a while on this menu; that idle time is what pays for the quiz being
    // instant when they open it, instead of the generation landing inside their
    // first request (the old "stuck at 90%").
    warmStudyBank(qs)
    return () => {
      alive = false
    }
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
  const applyFocus = async () => {
    if (!scope) return
    const ok = await loadSet(scope, { difficulty, topic, web: webSearch, inline: true })
    if (ok) {
      toast.success(
        topic
          ? `Enfoque aplicado: ${topic}`
          : webSearch
            ? "Material regenerado con búsqueda web"
            : "Material general restaurado",
      )
    }
  }

  // Focus lifecycle for the UI: nothing set → none; set but the loaded material
  // doesn't match it yet → pending (Aplicar, or launching a mode, regenerates);
  // loaded material matches → applied.
  const focusState: FocusState =
    !topic && !webSearch
      ? "none"
      : scope && loadedKey === scopeKey(scope, difficulty, topic, webSearch)
        ? "applied"
        : "pending"

  // Modes that consume the generated set. Quiz/Simulacro/Repaso stream from
  // their own staged/queue endpoints and never touch it, so they open instantly.
  const SET_MODES: Mode[] = ["flash", "resumen"]

  // Launch a mode, generating the set on demand (first open) or regenerating it
  // for the chosen difficulty/topic if needed. This is where the heavy work now
  // happens — never on scope selection.
  const launchMode = async (m: Mode) => {
    // The mind map lives on its own page (/mapa), which owns the course→doc
    // selector; a specific doc/course deep-links straight into its graph.
    if (m === "mind") {
      const target =
        scope?.kind === "doc"
          ? `/mapa?course=${scope.docId}`
          : scope?.kind === "course"
            ? `/mapa?course=${scope.courseId}`
            : "/mapa"
      router.push(target)
      return
    }
    if (
      SET_MODES.includes(m) &&
      scope &&
      loadedKey !== scopeKey(scope, difficulty, topic, webSearch)
    ) {
      await loadSet(scope, { difficulty, topic, web: webSearch })
    }
    setSelectorsOpen(false)
    setMode(m)
  }

  // Honor ?mode= deep links once a scope resolves (launchMode loads material
  // on demand). Fires once.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current || !scope) return
    deepLinked.current = true
    const m = params.get("mode") as Mode | null
    if (m && ["flash", "repaso", "quiz", "simulacro", "resumen", "mind"].includes(m)) {
      launchMode(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  const backToMenu = () => setMode("menu")

  // Toggle a folder in/out of the multi-selection; never let it become empty.
  const toggleFolder = (g: RealCourseGroup) => {
    const k = folderKey(g)
    setSelectedKeys((prev) =>
      prev.includes(k) ? (prev.length > 1 ? prev.filter((x) => x !== k) : prev) : [...prev, k],
    )
  }

  // Toggle a PDF in/out of the doc selection. 1 doc → full-featured `doc` scope;
  // ≥2 → client-combined `docs` scope. Never let the selection go empty.
  const toggleDoc = (id: string) => {
    setScope((prev) => {
      const cur = prev?.kind === "doc" ? [prev.docId] : prev?.kind === "docs" ? prev.docIds : []
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      if (next.length === 0) return prev
      return next.length === 1 ? { kind: "doc", docId: next[0] } : { kind: "docs", docIds: next }
    })
  }
  const selectedDocIds =
    scope?.kind === "doc" ? [scope.docId] : scope?.kind === "docs" ? scope.docIds : []

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
        <StatsInline />
      </header>

      {/* Back-to-menu control lives here (below the header, striking accent) so it
          reads clearly as "regreso" and never eats vertical space inside a mode. */}
      {mode !== "menu" && (
        <div className="shrink-0 border-b border-border/60 bg-background/95 px-3 py-2.5 sm:px-6">
          <button
            onClick={backToMenu}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
            Volver al Área de Estudio
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto overscroll-contain p-6 sm:px-10 sm:py-9">
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
                <div className="overflow-hidden rounded-xl border border-border bg-card/30">
                  <button
                    onClick={() => setSelectorsOpen((o) => !o)}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40"
                  >
                    <FolderOpen className="h-4 w-4 flex-none text-accent" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {multi
                        ? `${selectedGroups.length} cursos combinados`
                        : (selectedGroup?.name ?? "Curso")}
                      {!multi && scopeLabel && (
                        <span className="font-normal text-muted-foreground"> · {scopeLabel}</span>
                      )}
                    </span>
                    <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
                      {selectedGroups.length}/{groups.length}
                    </span>
                    <ChevronDown
                      className="h-4 w-4 flex-none text-muted-foreground transition-transform"
                      style={{ transform: selectorsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                  </button>

                  {selectorsOpen && (
                    <div className="border-t border-border/60 p-4">
                      {/* Course folders (horizontal, multi-select) */}
                      <div className="flex flex-wrap gap-2">
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

                      {/* Scope: Todo el curso / PDFs (multi-select) — single folder only */}
                      {selectedGroup && (
                        <ScopePicker
                          readyDocs={readyDocs}
                          canWholeCourse={canWholeCourse}
                          scope={scope}
                          selectedDocIds={selectedDocIds}
                          onPickWhole={() =>
                            selectedGroup.id &&
                            setScope({ kind: "course", courseId: selectedGroup.id })
                          }
                          onToggleDoc={toggleDoc}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6">
                {setLoading || genProgress.visible ? (
                  <GenerationProgress pct={genProgress.pct} />
                ) : setError ? (
                  <SetError message={setError} onRetry={() => scope && loadSet(scope)} />
                ) : scope ? (
                  <SelectionAsk onAsk={ask} enabled={mode !== "menu"}>
                    {/* keyed on mode → gentle fade when entering/leaving an activity */}
                    <div key={mode} className="animate-fade-in">
                      <ModeRouter
                        mode={mode}
                        set={set}
                        status={studyStatus}
                        focusState={focusState}
                        scope={scope}
                        syllabusId={activeDocId}
                        dueKeys={dueCardKeys}
                        scopeLabel={scopeLabel}
                        onAsk={ask}
                        regenerating={regenerating}
                        onRegenerate={() =>
                          scope &&
                          loadSet(scope, { refresh: true, difficulty, topic, web: webSearch })
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
                    </div>
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

/**
 * Vertical scope list: "Todo el curso" (when available) + each ready PDF.
 * PDFs are multi-selectable: one checked → `doc` scope (full adaptive features),
 * several → `docs` scope (sets combined client-side).
 */
function ScopePicker({
  readyDocs,
  canWholeCourse,
  scope,
  selectedDocIds,
  onPickWhole,
  onToggleDoc,
}: {
  readyDocs: SyllabusUploadAPI[]
  canWholeCourse: boolean
  scope: Scope | null
  selectedDocIds: string[]
  onPickWhole: () => void
  onToggleDoc: (id: string) => void
}) {
  return (
    <ul className="mt-4 divide-y divide-border/40 border-t border-border/60">
      {canWholeCourse && (
        <ScopeRow
          active={scope?.kind === "course"}
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
        <li className="px-2 py-2 text-[11px] text-muted-foreground">
          {selectedDocIds.length} PDFs combinados — Tarjetas, Resumen y Mapa. Para Quiz o Repaso
          elige un solo PDF o el curso completo.
        </li>
      )}
    </ul>
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
  /** Square multi-select indicator (PDF rows) instead of the radio circle. */
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
        className={`flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors ${
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
          <span className="flex-none text-[11px] tabular-nums text-muted-foreground">{meta}</span>
        )}
      </button>
    </li>
  )
}

function ModeRouter({
  mode,
  set,
  status,
  focusState,
  scope,
  syllabusId,
  dueKeys,
  scopeLabel,
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
  /** Null until a set-consuming mode first loads it (or a cached set hydrates). */
  set: StudySetAPI | null
  /** Light bank counts for the menu metadata (null while loading / combined scopes). */
  status: StudyStatusAPI | null
  focusState: FocusState
  scope: Scope
  /** The PDF id when scope is a single doc; null for whole-course (no per-doc tracking). */
  syllabusId: string | null
  /** SRS card keys due today (repaso ordering). Empty for whole-course scope. */
  dueKeys: string[]
  scopeLabel: string
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
  // scopes (multi-course `combo`, multi-PDF `docs`) have no per-scope endpoint →
  // ask the user to narrow it.
  const quizScope =
    scope.kind === "doc"
      ? ({ kind: "doc", docId: scope.docId } as const)
      : scope.kind === "course"
        ? ({ kind: "course", courseId: scope.courseId } as const)
        : null
  const narrowScopeNotice = (
    <EmptyMode
      onBack={backToMenu}
      label="No disponible para material combinado. Elige un solo PDF o un curso completo."
    />
  )

  // Set-consuming modes can't render without material (e.g. a failed load) —
  // fall back to the menu view instead of crashing.
  const menu = (
    <Menu
      set={set}
      status={status}
      focusState={focusState}
      syllabusId={syllabusId}
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

  // Active-focus chips shown inside set-consuming modes, so the student always
  // sees what the current material was narrowed to (topic and/or web).
  const focusBanner =
    topic || web ? (
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {topic && (
          <span
            className="flex max-w-[18rem] items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-2.5 py-1 text-[11px] font-medium text-accent"
            title={`Material enfocado en: ${topic}`}
          >
            <Sparkles className="h-3 w-3 flex-none" />
            <span className="truncate">{topic}</span>
          </span>
        )}
        {web && (
          <span
            className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-2.5 py-1 text-[11px] font-medium text-accent"
            title="Material enriquecido con búsqueda web"
          >
            <Globe className="h-3 w-3" />
            web
          </span>
        )}
      </div>
    ) : null

  switch (mode) {
    case "flash":
      if (!set) return menu
      return (
        <div>
          {focusBanner}
          <FlashcardsView
            title="Tarjetas dinámicas"
            courseLabel={scopeLabel}
            cards={set.flashcards}
            onBack={backToMenu}
            scope={quizScope ?? undefined}
            dueKeys={dueKeys}
          />
        </div>
      )
    case "repaso":
      if (!quizScope) return narrowScopeNotice
      return (
        <QuizReviewView courseLabel={scopeLabel} scope={quizScope} onBack={backToMenu} />
      )
    case "quiz":
    case "simulacro": {
      if (!quizScope) return narrowScopeNotice
      return (
        <QuizView
          title={mode === "simulacro" ? "Simulacro · Prueba corta" : "Quiz dinámico"}
          courseLabel={scopeLabel}
          scope={quizScope}
          mode={mode}
          onBack={backToMenu}
        />
      )
    }
    // "mind" never renders here — launchMode routes it to the /mapa page.
    case "resumen":
      if (!set) return menu
      return (
        <div>
          {focusBanner}
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
        </div>
      )
    default:
      return menu
  }
}

// Server-side cap on flashcards surfaced per assembled set (study.service SET_FLASHCARDS).
const SET_FLASHCARDS_CAP = 14

const MODES: {
  key: Mode
  title: string
  Icon: typeof HelpCircle
  meta: (s: StudySetAPI | null, st: StudyStatusAPI | null) => string
}[] = [
  { key: "quiz", title: "Quiz", Icon: HelpCircle, meta: () => "3 etapas · 45 preguntas" },
  {
    key: "flash",
    title: "Tarjetas",
    Icon: Layers,
    // Real count once the set is loaded; bank count before that; generic when cold.
    meta: (s, st) =>
      s
        ? `${s.flashcards.length} tarjetas`
        : st && st.flashcards > 0
          ? `${Math.min(st.flashcards, SET_FLASHCARDS_CAP)} tarjetas`
          : "tarjetas dinámicas",
  },
  { key: "repaso", title: "Repaso", Icon: RotateCcw, meta: () => "tus fallos" },
  { key: "simulacro", title: "Simulacro", Icon: Timer, meta: () => "cronometrado" },
  { key: "mind", title: "Mapa mental", Icon: Network, meta: () => "visual" },
  { key: "resumen", title: "Resumen", Icon: AlignLeft, meta: () => "síntesis" },
]

// Max focus-instruction length — mirrors the server cap in app/api/study/[syllabusId]/route.ts.
const MAX_TOPIC = 160

function Menu({
  set,
  status,
  focusState,
  syllabusId,
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
  set: StudySetAPI | null
  status: StudyStatusAPI | null
  focusState: FocusState
  syllabusId: string | null
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
  // Focus is secondary — collapsed until the student wants to narrow the material.
  const [focusOpen, setFocusOpen] = useState(false)
  return (
    <div>
      {/* ─── Study modes — the point of the page, so they come first ─── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {MODES.map((m) => {
          const suggested = suggestion?.mode === m.key
          return (
            <Card
              key={m.key}
              asChild
              className={`cursor-pointer gap-0 p-5 transition-colors hover:border-accent/50 ${
                suggested ? "border-accent/40 bg-accent/[0.03]" : "bg-card/40"
              }`}
            >
              <button onClick={() => onLaunch(m.key)} className="text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                    <m.Icon className="h-[18px] w-[18px] text-accent" />
                  </span>
                  {suggested && (
                    <Badge variant="accent" className="min-w-0 shrink gap-1 whitespace-normal">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="truncate">Sugerido · {suggestion!.reason}</span>
                    </Badge>
                  )}
                </div>
                <div className="mt-4 text-sm font-semibold text-foreground">{m.title}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {m.meta(set, status)}
                </div>
              </button>
            </Card>
          )
        })}
      </div>

      {/* ─── Topic focus — collapsed disclosure ─── */}
      <div className="mt-10 border-t border-border/60">
        <button
          onClick={() => setFocusOpen((o) => !o)}
          className="flex w-full items-center gap-2 py-3.5 text-left"
        >
          <Sparkles className="h-4 w-4 flex-none text-accent" />
          <span className="text-sm font-medium text-foreground">Enfocar material</span>
          {!focusOpen && topic && (
            <span className="min-w-0 truncate text-xs text-accent" title={topic}>
              · {topic}
            </span>
          )}
          {!focusOpen && web && <Globe className="h-3.5 w-3.5 flex-none text-accent" />}
          {focusState === "pending" && (
            <span
              className="flex-none rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500"
              title="El material actual aún no refleja este enfoque. Pulsa Aplicar o abre un modo para regenerarlo."
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
          <ChevronDown
            className="ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform"
            style={{ transform: focusOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>

        {focusOpen && (
          <div className="pb-4">
            <div className="relative">
              <Textarea
                value={topic ?? ""}
                onChange={(e) => onTopic(e.target.value.trimStart() || null)}
                onKeyDown={(e) => {
                  // Enter = Aplicar (Shift+Enter keeps the newline).
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    if (!regenerating) onApplyFocus()
                  }
                }}
                maxLength={MAX_TOPIC}
                placeholder="ej: solo ejercicios prácticos de derivadas, con casos límite"
                className="min-h-[4.5rem] resize-none pb-6 text-[13px]"
              />
              <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-muted-foreground/70">
                {topic?.length ?? 0}/{MAX_TOPIC}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <TopicChip label="General" active={!topic} onClick={() => onTopic(null)} />
              {weekTopics.map((t) => (
                <TopicChip key={t} label={t} active={topic === t} onClick={() => onTopic(t)} />
              ))}
            </div>
            <div className="mt-3.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onWeb(!web)}
                aria-pressed={web}
                title="Enriquecer el material con una búsqueda web en vivo"
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  web
                    ? "border-accent/40 bg-accent/[0.06] text-accent"
                    : "border-border bg-secondary/40 text-muted-foreground hover:border-accent/40 hover:text-foreground"
                }`}
              >
                <Globe className="h-4 w-4" strokeWidth={2.25} />
                Búsqueda web
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
                {regenerating ? "Generando…" : "Aplicar"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
              El enfoque y la búsqueda web aplican a Tarjetas, Resumen y Mapa. El Quiz y el
              Simulacro usan el banco de preguntas por etapas del curso completo.
            </p>
          </div>
        )}
      </div>

      {/* Mastery is tracked per PDF; only show it for a single-document scope. */}
      {syllabusId && <MasteryPanel syllabusId={syllabusId} />}
    </div>
  )
}

// ---------- small presentational helpers ----------

/** Quiet streak / weekly-volume readout, lives in the page header. */
function StatsInline() {
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
  if (!stats) return null
  return (
    <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
      <span
        className="flex items-center gap-1.5"
        title={stats.streakDays === 1 ? "1 día de racha" : `${stats.streakDays} días de racha`}
      >
        <Flame className={`h-3.5 w-3.5 ${stats.streakDays > 0 ? "text-orange-400" : ""}`} />
        <span className="tabular-nums">
          {stats.streakDays} {stats.streakDays === 1 ? "día" : "días"}
        </span>
      </span>
      <span className="hidden items-center gap-1.5 sm:flex" title="Repasos esta semana">
        <Layers className="h-3.5 w-3.5 text-accent" />
        <span className="tabular-nums">{stats.cardsThisWeek} esta semana</span>
      </span>
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
