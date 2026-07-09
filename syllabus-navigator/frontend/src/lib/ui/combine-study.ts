/**
 * combine-study.ts — client-side fusion of per-course study material.
 *
 * The Área de Estudio lets the user pick several course folders at once. The
 * backend only generates material per course, so we fetch each course's set and
 * merge them here: `combineStudySets` concatenates flashcards/quiz/study-guide
 * and fuses the summary into one combined StudySet.
 */
import type { StudySetAPI } from "@/lib/api"

export type NamedStudySet = { name: string; set: StudySetAPI }

/**
 * Combine several course study sets into one. Single set passes through
 * unchanged; multiple sets concatenate their cards/questions/guide and fuse the
 * summary, tagging each summary point with its course of origin.
 */
export function combineStudySets(sets: NamedStudySet[]): StudySetAPI {
  const valid = sets.filter((s) => s.set)
  if (valid.length === 0) {
    return {
      syllabus_id: "combined",
      flashcards: [],
      quiz: [],
      summary: {
        titulo: "",
        temaPrincipal: "",
        introduccion: "",
        ideasPrincipales: [],
        conceptos: [],
        conclusion: "",
      },
      studyGuide: [],
    }
  }
  if (valid.length === 1) return valid[0].set

  return {
    syllabus_id: "combined",
    flashcards: valid.flatMap((s) => s.set.flashcards),
    quiz: valid.flatMap((s) => s.set.quiz),
    summary: {
      titulo: `${valid.length} cursos combinados`,
      temaPrincipal: valid.map((s) => s.name).join(", "),
      introduccion: `Material combinado de ${valid.length} cursos: ${valid.map((s) => s.name).join(", ")}.`,
      ideasPrincipales: valid.flatMap((s) =>
        s.set.summary.ideasPrincipales.map((i) => `${i} · ${s.name}`),
      ),
      conceptos: valid.flatMap((s) => s.set.summary.conceptos),
      conclusion: "",
    },
    studyGuide: valid.flatMap((s) => s.set.studyGuide ?? []),
  }
}
