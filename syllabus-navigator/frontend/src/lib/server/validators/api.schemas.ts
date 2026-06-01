import { z } from "zod"

export const MessageRequestSchema = z.object({
  question: z.string().min(1, "Question is required").max(4000, "Question is too long"),
  activeModel: z.string().optional(),
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
