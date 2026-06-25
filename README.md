<p align="center">
  <h1 align="center">Navigator</h1>
  <p align="center">
    <strong>Tu asistente académico con IA — sube tu sílabo, pregunta lo que quieras, estudia con material generado.</strong>
  </p>
  <p align="center">
    <a href="#-features">Features</a> · <a href="#-cómo-funciona">Cómo funciona</a> · <a href="#-stack-técnico">Stack</a>
  </p>
</p>

---

## El problema

Los estudiantes reciben sílabos en PDF y los pierden en una carpeta. Cuando llegan los exámenes, no recuerdan qué temas son prerrequisito de qué, qué evaluación viene primero, ni tienen material de práctica personalizado. La información está ahí — pero **no es accesible, no es interactiva, y no se adapta a lo que cada alumno necesita repasar.**

## La solución

**Navigator** convierte cualquier sílabo académico en un **sistema de aprendizaje completo**:

1. **Sube tu PDF** — Navigator lo parsea, lo trocea y genera embeddings vectoriales.
2. **Pregúntale al chat** — Respuestas ancladas al contenido real del sílabo, con citas exactas. Sin alucinaciones.
3. **Visualiza el mapa de conocimiento** — Un grafo editable de temas y prerrequisitos, generado automáticamente.
4. **Estudia con material adaptativo** — Flashcards, quizzes, resúmenes y mapas mentales generados desde tu material, con dificultad configurable y anti-repetición.
5. **Consulta tu agenda** — Evaluaciones, temas por semana y recomendaciones de repaso cruzando todos tus cursos.

> Una sola app. Un solo deploy. Cero infraestructura adicional.

---

## ✨ Features

| Feature | Descripción |
|---|---|
| **Chat RAG** | Preguntas sobre el sílabo con respuestas aterrizadas y citas reales del PDF. Consciente del cronograma: sabe qué evaluaciones tienes esta semana. |
| **Knowledge Graph** | Grafo de temas y prerrequisitos generado con IA. Editable: añade, renombra, conecta y guarda nodos. |
| **Área de Estudio** | 6 modos: flashcards (flip 3D), quiz dinámico, simulacro, modo repaso, mapa mental y resumen automático. Elige dificultad y tema. |
| **Agenda inteligente** | Calendario mensual con eventos detectados del cronograma. Notas por día. Recomendaciones de qué repasar según prerrequisitos. |
| **Multi-curso** | El chat busca en todos tus cursos. La agenda cruza evaluaciones. El estudio se enfoca en tus temas más débiles. |
| **Invitados** | Usa la app sin cuenta: el PDF se procesa y se borra automáticamente en 24h. Al registrarte, tus datos se vuelven permanentes. |
| **Streaming SSE** | Respuestas del chat en tiempo real, con título, citas y modelo usados en el evento final. |

---

## 🔍 Cómo funciona

```
PDF → parseo (unpdf) → chunks por página → embeddings (OpenAI) → pgvector (Neon)
                                                          ↓
                                           grafo de temas (structured output)
                                           cronograma (structured output)
                                           material de estudio (multi-agente)
                                                          ↓
Chat: pregunta → embed → similitud coseno → rerank híbrido → contexto + agenda → LLM → SSE
```

**Todo vive en una sola app Next.js full-stack.** No hay backend separado, no hay Python, no hay Docker en producción. El pipeline RAG (ingesta, embeddings, retrieval, generación) está implementado en TypeScript y corre como API routes de Next.js.

La ingesta es **asíncrona en 2 fases**: el upload responde inmediatamente, una cola de jobs durable (`FOR UPDATE SKIP LOCKED`) procesa embeddings y genera grafo/cronograma en background con reintentos y backoff exponencial.

<p align="center">
  <img src="./rag-architecture.png" alt="Navigator RAG Architecture" width="900"/>
</p>

### Capas del pipeline RAG


| Capa | Qué hace |
|---|---|
| **Ingesta (sync)** | Parseo PDF (`unpdf`), chunking por página (1200 chars / 120 overlap), validación magic bytes, hash SHA-256. Guarda texto en Neon sin embeddings aún. |
| **Worker async** | Lee chunks pendientes → embeddings batch (`text-embedding-3-small`, 1536d) → pgvector HNSW. Después: genera grafo de temas (structured output + validación de ciclos por DFS) y cronograma de evaluaciones. |
| **Multi-índice** | Dense (pgvector `<=>`) + léxico híbrido (`tsvector` GIN + RRF) para recuperación por tema. Cubre todo el temario, no solo los primeros 24k chars. |
| **Retrieval** | Over-fetch K=24 candidatos → gate de relevancia (coseno > 0.9 → sin contexto) → rerank vectorial + léxico → top-8 chunks con citas (página / offset). |
| **Agentes de estudio** | Router adaptativo (peso examen × dominio × urgencia cronograma) → orquestador en grafo TS → agentes especializados (flashcard, inquisitor, synth) → verifier de familia distinta → banco de ítems con dedupe por embedding. |
| **Generación (chat)** | Contexto RAG + bloque agenda (todos los cursos) + historial 6 turnos → `GROUNDED_SYSTEM_PROMPT` (mentor) → `chatStream` SSE. Evento final: `title`, `citations`, `provider`, `model`. |
| **Cola de jobs** | Claim atómico (`FOR UPDATE SKIP LOCKED`), backoff exponencial `2^attempts`, rescate de jobs colgados (> 10 min), fire-and-forget en upload + Cron de respaldo. |

---

## 🏗 Stack técnico

| Capa | Tecnología |
|---|---|
| **Framework** | Next.js 14 (App Router), React 18, TypeScript strict |
| **Base de datos** | Neon serverless Postgres + pgvector (embeddings 1536d, HNSW) |
| **Auth** | NextAuth v5, bcrypt, roles (guest → free → pro → admin) |
| **LLM** | OpenAI SDK + OpenRouter (fallback por tier). GPT-4o-mini por defecto. |
| **Grafos** | @xyflow/react (editable: add/rename/delete/connect) |
| **UI** | Tailwind CSS, shadcn/ui, Lucide icons, Sonner toasts |
| **Validación** | Zod (server) + react-hook-form (client) |
| **PDF** | unpdf (text extraction, sin deps nativas) |
| **Cache / Rate limit** | Upstash Redis (opcional; fallback in-memory) |
| **CI** | GitHub Actions (typecheck + 197 tests, Vitest) |
| **Deploy** | Vercel (una sola app) |

---


<p align="center">
  <sub>Built with Next.js, OpenAI, pgvector y muchas noches de café. ☕</sub>
</p>
