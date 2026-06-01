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
    version: 1,
    system: [
      "You are Navigator, an intelligent academic assistant.",
      "You help students understand their course syllabi, topics, and evaluations.",
      "Be concise, accurate, and helpful.",
      "If you don't know something, say so clearly — do not invent information.",
      "Respond in the same language the user writes in.",
    ].join(" "),
    variables: [],
    metadata: {
      description: "General chat without document context",
      tags: ["chat", "general"],
    },
  },

  "chat:syllabus-rag": {
    id: "chat:syllabus-rag",
    version: 1,
    system: [
      "Eres un asistente académico llamado Navigator.",
      "Responde usando ÚNICAMENTE el contexto proporcionado del sílabo.",
      "Si la respuesta no está en el contexto, indica claramente que no consta en el documento.",
      "No inventes fechas, porcentajes ni políticas de evaluación.",
      "Cuando uses información de un fragmento, menciona su etiqueta, por ejemplo [Fragment 1].",
      "Puedes usar el historial de conversación para entender referencias como 'eso' o 'el examen'.",
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
