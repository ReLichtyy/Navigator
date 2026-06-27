import { z } from "zod"

export const MessageRequestSchema = z.object({
  question: z.string().min(1, "Question is required").max(4000, "Question is too long"),
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

export type UploadLinkInput = z.infer<typeof UploadLinkSchema>
export type UploadTextInput = z.infer<typeof UploadTextSchema>
export type UploadFromBlobInput = z.infer<typeof UploadFromBlobSchema>

export const CreateChatSchema = z.object({
  syllabus_id: z.string().uuid("Invalid syllabus ID").optional(),
  active_model: z.string().optional(),
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
      }),
    )
    .max(200, "Too many nodes"),
  edges: z
    .array(z.object({ source: z.string().min(1), target: z.string().min(1) }))
    .max(1000, "Too many edges"),
})

export type GraphUpdateInput = z.infer<typeof GraphUpdateSchema>

export const FlashcardReviewSchema = z.object({
  syllabus_id: z.string().uuid("Invalid syllabus ID"),
  card_key: z.string().min(1, "card_key required").max(200),
  known: z.boolean(),
})

export type FlashcardReviewInput = z.infer<typeof FlashcardReviewSchema>

export const MasteryRecordSchema = z.object({
  syllabus_id: z.string().uuid("Invalid syllabus ID"),
  outcomes: z
    .array(z.object({ label: z.string().trim().min(1).max(200), correct: z.boolean() }))
    .min(1, "At least one outcome required")
    .max(100, "Too many outcomes"),
})

export type MasteryRecordInput = z.infer<typeof MasteryRecordSchema>

// --- Course Intelligence Layer ---
export const CreateCourseSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120, "Nombre demasiado largo"),
  description: z.string().trim().max(1000).nullish(),
  subject_tags: z.array(z.string().trim().min(1).max(40)).max(12).nullish(),
  color: z.string().trim().max(32).nullish(),
})
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>

// Act on a document's pending course suggestion. For 'confirm' the caller may
// target an existing course (course_id), create a new one (new_course_name), or
// pass neither to accept the standing suggestion as-is.
export const CourseActionSchema = z.object({
  action: z.enum(["confirm", "reject", "skip"]),
  course_id: z.string().uuid("ID de curso inválido").nullish(),
  new_course_name: z.string().trim().min(1).max(120).nullish(),
  new_course_tags: z.array(z.string().trim().min(1).max(40)).max(12).nullish(),
})
export type CourseActionInput = z.infer<typeof CourseActionSchema>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const CreateNoteSchema = z.object({
  note_date: z.string().regex(ISO_DATE, "Invalid date (expected YYYY-MM-DD)"),
  body: z.string().trim().min(1, "Note is required").max(2000, "Note is too long"),
})

export const UpdateNoteSchema = z.object({
  body: z.string().trim().min(1, "Note is required").max(2000, "Note is too long"),
})

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
