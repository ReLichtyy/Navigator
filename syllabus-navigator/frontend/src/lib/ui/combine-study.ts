/**
 * combine-study.ts — client-side fusion of per-course study material.
 *
 * Both the Mapa mental page and the Área de Estudio let the user pick several
 * course folders at once. The backend only generates material per course, so we
 * fetch each course's set and merge them here:
 *  - `fuseMindmaps` merges the topic maps (dedup-merging topics that repeat
 *    across courses, tagging each branch with its course/courses of origin).
 *  - `combineStudySets` concatenates flashcards/quiz/study-guide and fuses the
 *    mind map + summary into one combined StudySet.
 */
import type { Mindmap } from "@/components/estudio/mind-map-canvas"
import type { StudySetAPI } from "@/lib/api"

export type NamedMindmap = { name: string; mindmap: Mindmap }

/**
 * Fuse several course mind maps into one. Topics are merged round-robin across
 * courses (so every course is represented before any course contributes a second
 * topic — important because the canvas caps visible branches). Topics that share
 * a label across courses are combined: their sub-items are unioned and the branch
 * is tagged with every course it came from.
 */
export function fuseMindmaps(sources: NamedMindmap[]): Mindmap {
  const valid = sources.filter((s) => s.mindmap?.branches?.length)
  if (valid.length === 0) return { center: "Sin temas", branches: [] }
  if (valid.length === 1) return valid[0].mindmap

  const byKey = new Map<string, { label: string; courses: Set<string>; items: string[] }>()
  const order: string[] = []
  const maxLen = Math.max(...valid.map((s) => s.mindmap.branches.length))

  // Round-robin: branch i of course A, branch i of course B, … then i+1, …
  for (let i = 0; i < maxLen; i++) {
    for (const s of valid) {
      const b = s.mindmap.branches[i]
      if (!b) continue
      const key = b.label.trim().toLowerCase()
      let e = byKey.get(key)
      if (!e) {
        e = { label: b.label.trim(), courses: new Set(), items: [] }
        byKey.set(key, e)
        order.push(key)
      }
      e.courses.add(s.name)
      for (const it of b.items) if (!e.items.includes(it)) e.items.push(it)
    }
  }

  const branches = order.map((k) => {
    const e = byKey.get(k)!
    return { label: `${e.label} (${[...e.courses].join(" · ")})`, items: e.items }
  })
  return { center: `${valid.length} cursos`, branches }
}

export type NamedStudySet = { name: string; set: StudySetAPI }

/**
 * Combine several course study sets into one. Single set passes through
 * unchanged; multiple sets concatenate their cards/questions/guide and fuse the
 * mind map + summary, tagging each summary point with its course of origin.
 */
export function combineStudySets(sets: NamedStudySet[]): StudySetAPI {
  const valid = sets.filter((s) => s.set)
  if (valid.length === 0) {
    return {
      syllabus_id: "combined",
      flashcards: [],
      quiz: [],
      summary: { intro: "", points: [] },
      mindmap: { center: "Sin temas", branches: [] },
      studyGuide: [],
    }
  }
  if (valid.length === 1) return valid[0].set

  return {
    syllabus_id: "combined",
    flashcards: valid.flatMap((s) => s.set.flashcards),
    quiz: valid.flatMap((s) => s.set.quiz),
    summary: {
      intro: `Material combinado de ${valid.length} cursos: ${valid.map((s) => s.name).join(", ")}.`,
      points: valid.flatMap((s) =>
        s.set.summary.points.map((p) => ({ title: `${p.title} · ${s.name}`, body: p.body })),
      ),
    },
    mindmap: fuseMindmaps(valid.map((s) => ({ name: s.name, mindmap: s.set.mindmap }))),
    studyGuide: valid.flatMap((s) => s.set.studyGuide ?? []),
  }
}
