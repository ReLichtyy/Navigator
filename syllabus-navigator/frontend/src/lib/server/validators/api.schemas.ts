import { z } from "zod"

export const MessageRequestSchema = z.object({
  question: z.string().min(1, "Question is required").max(4000, "Question is too long"),
})

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
