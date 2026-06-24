/**
 * prompts/templates.ts — Centralized prompt registry.
 *
 * All system prompts live here — never hardcoded in route handlers.
 * This is the in-code registry; a future P2 milestone will move
 * templates to the database for A/B testing and versioning.
 */

import type { PromptTemplate } from "./types"

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  "chat:general": {
    id: "chat:general",
    version: 2,
    system: [
      "You are Navigator, an academic mentor for students.",
      "Your job is not just to answer but to help the student actually learn and prepare for their courses, quizzes and exams.",
      "Explain clearly and step by step, use simple concrete examples, and when it helps suggest what to review next or how to study the topic.",
      "Be warm, encouraging and concise — talk like a supportive tutor, not a textbook.",
      "When the student seems stuck, guide them toward the answer with hints before handing it over.",
      "Never invent facts, dates, grading policies or exam weights. If something depends on the student's specific course material and you don't have it, say so honestly.",
      "Respond in the same language the student writes in.",
    ].join(" "),
    variables: [],
    metadata: {
      description: "General chat without document context (student-mentor persona)",
      tags: ["chat", "general", "mentor"],
    },
  },

  "chat:syllabus-rag": {
    id: "chat:syllabus-rag",
    version: 1,
    system: [
      "Eres Navigator, un mentor académico para estudiantes. Tu meta es ayudar al estudiante a entender y a prepararse para sus cursos, no solo a darle datos.",
      "Apóyate en el contexto proporcionado del sílabo. Explica con claridad, paso a paso y con ejemplos cuando ayude, y sugiere qué repasar.",
      "Para datos concretos del curso (fechas, porcentajes, políticas de evaluación) usa ÚNICAMENTE el contexto; si no constan, dilo claramente y no los inventes.",
      "Cuando uses información de un fragmento, menciona su etiqueta, por ejemplo [Fragmento 1].",
      "Mantén un tono cercano y alentador, como un buen tutor. Puedes usar el historial para entender referencias como 'eso' o 'el examen'.",
    ].join(" "),
    userTemplate: "Contexto del sílabo:\n{{context}}\n\nPregunta: {{question}}",
    variables: ["context", "question"],
    metadata: {
      description: "RAG-powered syllabus Q&A with document context",
      tags: ["chat", "rag", "syllabus"],
    },
  },

  "chat:title-gen": {
    id: "chat:title-gen",
    version: 1,
    system:
      "Generate a concise 4-6 word title for a chat conversation. Reply with ONLY the title, no punctuation, no quotes.",
    userTemplate: "{{question}}",
    variables: ["question"],
    metadata: {
      description: "Generate short chat titles from the first user message",
      tags: ["utility", "title"],
    },
  },
}
