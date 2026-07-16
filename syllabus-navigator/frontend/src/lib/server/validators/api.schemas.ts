import { z } from "zod"

export const MessageRequestSchema = z.object({
  question: z.string().min(1, "Question is required").max(4000, "Question is too long"),
  // Augment the answer with a live web search (composer "Web" toggle).
  web: z.boolean().optional(),
})

// Inline "ask about this mind map" (question bar). Either courseId or syllabusId
// scopes retrieval; refine chips transform the previous answer instead.
export const GraphAskSchema = z
  .object({
    question: z.string().trim().max(1000, "La pregunta es demasiado larga").optional(),
    courseId: z.string().uuid().optional(),
    syllabusId: z.string().uuid().optional(),
    refine: z.enum(["concise", "detail", "translate", "regenerate"]).optional(),
    previousAnswer: z.string().max(4000).optional(),
    lang: z.string().max(40).optional(),
  })
  .refine((v) => !!v.courseId || !!v.syllabusId, {
    message: "Falta el mapa (courseId o syllabusId).",
  })

export const UploadLinkSchema = z.object({
  url: z.string().url("URL inválida").max(2048, "URL demasiado larga"),
})

export const UploadTextSchema = z.object({
  title: z.string().trim().max(200, "Título demasiado largo").optional(),
  text: z
    .string()
    .trim()
    .min(1, "El texto es obligatorio")
    .max(200_000, "El texto excede el límite (200k caracteres)"),
})

// Client→Blob direct upload: after the browser uploads to Vercel Blob, it sends
// the resulting URL here for ingestion. The URL host is re-validated server-side.
export const UploadFromBlobSchema = z.object({
  url: z.string().url("URL inválida").max(2048, "URL demasiado larga"),
  filename: z.string().trim().min(1, "Nombre de archivo requerido").max(512),
  contentType: z.string().max(255).optional(),
})

export const CreateChatSchema = z.object({
  syllabus_id: z.string().uuid("Invalid syllabus ID").optional(),
  course_id: z.string().uuid("Invalid course ID").optional(),
  active_model: z.string().optional(),
}).refine((value) => !(value.syllabus_id && value.course_id), {
  message: "Choose either a syllabus or a course scope",
})

export const UpdateChatSchema = z.object({
  title: z.string().optional(),
  syllabus_id: z.string().uuid("Invalid syllabus ID").nullable().optional(),
  active_model: z.string().optional(),
})

export const GraphUpdateSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1, "Label required").max(200),
        weight_percent: z.number().min(0).max(100).nullable().optional(),
        // Tree hierarchy — default to level 1 / no parent so the legacy
        // root-only editor (which doesn't send these) keeps working unchanged.
        level: z.number().int().min(1).max(6).default(1),
        parentId: z.string().min(1).nullable().optional().default(null),
        detail: z.string().max(140).nullable().optional(),
      }),
    )
    .max(220, "Too many nodes"),
  edges: z
    .array(z.object({ source: z.string().min(1), target: z.string().min(1) }))
    .max(1000, "Too many edges"),
  crossLinks: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        label: z.string().min(1).max(60),
      }),
    )
    .max(60, "Too many cross-links")
    .default([]),
})

export type GraphUpdateInput = z.infer<typeof GraphUpdateSchema>

// Regenerate the whole-course mind map from a subset of the course's documents
// (the "Editar mapa" drawer): multi-select of files + optional focus topics +
// free-form instructions for the generator.
export const CourseGraphRegenerateSchema = z.object({
  fileIds: z
    .array(z.string().uuid("Invalid document ID"))
    .min(1, "Selecciona un documento")
    .max(40),
  focusTopics: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  instructions: z.string().trim().max(600).optional(),
})

export type CourseGraphRegenerateInput = z.infer<typeof CourseGraphRegenerateSchema>

/** A study scope: one document, or a whole course. Mirrors StudyScope server-side. */
export const StudyScopeSchema = z.object({
  kind: z.enum(["doc", "course"]),
  id: z.string().uuid("Invalid scope ID"),
})

export const FlashcardReviewSchema = StudyScopeSchema.extend({
  card_key: z.string().min(1, "card_key required").max(200),
  known: z.boolean(),
})

/** Grade a submitted exam attempt (Examen mode). MCQ answers are option
 *  indexes; short/development answers are free text. */
export const ExamGradeSchema = StudyScopeSchema.extend({
  attemptId: z.string().uuid("Invalid attempt ID"),
  answers: z
    .array(
      z.object({
        key: z.string().min(1).max(8),
        response: z.union([z.number().int().min(0).max(9), z.string().max(8000)]),
      }),
    )
    .max(40, "Too many answers"),
})

export const MasteryRecordSchema = StudyScopeSchema.extend({
  outcomes: z
    .array(z.object({ label: z.string().trim().min(1).max(200), correct: z.boolean() }))
    .min(1, "At least one outcome required")
    .max(100, "Too many outcomes"),
})

// --- Course Intelligence Layer ---
/** Course color: a hex string (#RRGGBB) from the shared palette. */
const CourseColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (usa #RRGGBB)")

export const CreateCourseSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120, "Nombre demasiado largo"),
  description: z.string().trim().max(1000).nullish(),
  subject_tags: z.array(z.string().trim().min(1).max(40)).max(12).nullish(),
  color: CourseColorSchema.nullish(),
})

// Update a course folder: rename, set the color, and/or set the term start
// ("Semana N" → date resolution anchor; null clears it). At least one field.
export const UpdateCourseSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es obligatorio")
      .max(120, "Nombre demasiado largo")
      .optional(),
    color: CourseColorSchema.nullable().optional(),
    term_start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)")
      .nullable()
      .optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined || d.term_start !== undefined, {
    message: "Nada que actualizar",
  })
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>

// Act on a document's pending course suggestion. For 'confirm' the caller may
// target an existing course (course_id), create a new one (new_course_name), or
// pass neither to accept the standing suggestion as-is.
export const CourseActionSchema = z.object({
  action: z.enum(["confirm", "reject", "skip"]),
  course_id: z.string().uuid("ID de curso inválido").nullish(),
  new_course_name: z.string().trim().min(1).max(120).nullish(),
  new_course_tags: z.array(z.string().trim().min(1).max(40)).max(12).nullish(),
})

// User settings: closed enums / bounded strings — the previous handler stored
// arbitrary `String(body[key])` values straight into the DB.

// Perfil del estudiante (modal Configuración) — stored as one JSONB blob; the
// client always sends the full object, so PATCH replaces it wholesale.
export const UserProfileSchema = z.object({
  fullName: z.string().trim().max(80).optional(),
  displayName: z.string().trim().max(40).optional(),
  career: z.string().trim().max(80).optional(),
  school: z.string().trim().max(80).optional(),
  level: z
    .enum(["Secundaria", "Preparatoria", "Universidad", "Posgrado", "Autodidacta"])
    .optional(),
  tone: z.enum(["Cercano", "Neutro", "Directo"]).optional(),
  detail: z.enum(["Conciso", "Equilibrado", "Detallado"]).optional(),
  study: z
    .object({
      difficulty: z.enum(["Fácil", "Media", "Difícil", "Adaptativa"]).optional(),
      cardFormat: z
        .enum(["Pregunta y respuesta", "Rellenar huecos", "Definición", "Mixto"])
        .optional(),
      questionCount: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
      sessionLen: z.union([z.literal(15), z.literal(25), z.literal(45)]).optional(),
      spaced: z.boolean().optional(),
      mixSubjects: z.boolean().optional(),
    })
    .optional(),
})
export type UserProfileInput = z.infer<typeof UserProfileSchema>

export const UpdatePreferencesSchema = z
  .object({
    defaultProvider: z.enum(["openai", "deepseek", "openrouter"]).optional(),
    defaultModel: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[\w./:-]+$/, "Modelo inválido")
      .optional(),
    theme: z.enum(["dark", "light", "system"]).optional(),
    language: z.enum(["es", "en"]).optional(),
    profile: UserProfileSchema.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "No valid fields to update.",
  })
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const NoteTitleSchema = z.string().trim().min(1, "Title is required").max(120, "Title is too long")
const NoteColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Invalid note color")

export const CreateNoteSchema = z.object({
  note_date: z.string().regex(ISO_DATE, "Invalid date (expected YYYY-MM-DD)"),
  body: z.string().trim().min(1, "Note is required").max(2000, "Note is too long"),
  title: NoteTitleSchema.optional(),
  color: NoteColorSchema.optional(),
})

export const UpdateNoteSchema = z
  .object({
    body: z.string().trim().min(1, "Note is required").max(2000, "Note is too long").optional(),
    title: NoteTitleSchema.optional(),
    color: NoteColorSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "No valid fields to update.",
  })
