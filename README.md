<p align="center">
  <h1 align="center">Navigator</h1>
  <p align="center">
    <strong>Tu asistente académico con IA — sube tu sílabo, pregunta lo que quieras, estudia con material generado.</strong>
  </p>
  <p align="center">
    <a href="#-features">Features</a> · <a href="#-cómo-funciona">Cómo funciona</a> · <a href="#-quick-start">Quick Start</a> · <a href="#-stack-técnico">Stack</a> · <a href="#-deploy">Deploy</a>
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

## 🚀 Quick Start

```bash
cd syllabus-navigator/frontend
cp .env.example .env.local     # Configura al menos OPENAI_API_KEY y las URLs de Neon
npm install
npm run db:migrate             # Aplica el schema a Neon (idempotente)
npm run dev                    # → http://localhost:3000
```

### Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `AUTH_SECRET` | Secreto de sesión (`npx auth secret`) |
| `NEXTAUTH_URL` | URL base (ej. `http://localhost:3000`) |
| `DATABASE_URL` | Neon pooled connection |
| `DATABASE_URL_DIRECT` | Neon direct connection (migraciones) |
| `OPENAI_API_KEY` | LLM + embeddings |
| `CRON_SECRET` | Protege los cron jobs y dispara el worker de ingesta |

> Variables opcionales: `OPENROUTER_API_KEY`, `BLOB_READ_WRITE_TOKEN` (Vercel Blob para PDFs), `UPSTASH_REDIS_REST_URL/TOKEN`, Google OAuth. Ver [`.env.example`](syllabus-navigator/frontend/.env.example).

---

## 📦 Deploy

Navigator se despliega como **una sola app en Vercel**:

1. **Neon**: Crear proyecto Postgres, habilitar `pgvector`, correr `npm run db:migrate`.
2. **Vercel**: New Project → Root Directory = `syllabus-navigator/frontend`. Framework: Next.js.
3. **Env vars**: Configurar las 6 requeridas + opcionales.
4. **Smoke test**: `/api/health` → signup → upload PDF → chat con citas → grafo visible.

> Checklist detallado en [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md).

---

## 📁 Estructura del proyecto

```
Navigator/
  README.md              ← este archivo
  CLAUDE.md              ← guía de desarrollo (estructura, convenciones, layering)
  DEPLOY_CHECKLIST.md    ← pre-flight checklist para producción
  NEXT_STEPS.md          ← log de trabajo + sprints pendientes
  syllabus-navigator/
    frontend/            ← LA APP COMPLETA (Next.js full-stack)
      app/               ← Routes: /, /knowledge, /agenda, /estudio, /mapa, /settings
      app/api/           ← API routes (chat, upload, graph, schedule, study, auth...)
      src/lib/           ← Core: LLM, RAG, cache, auth, guardrails, metering
      src/components/    ← UI: shadcn primitives + feature components
      tests/             ← Vitest (197 tests, mocks auth + DB)
```

---

## 🧪 Tests y calidad

```bash
npm test               # 197 tests (Vitest)
npm run lint           # ESLint (0 errores)
npm run format:check   # Prettier
npm run knip           # Código muerto (revisar antes de podar)
```

---

## 📄 Licencia

Proyecto académico. Consulta con el autor antes de uso comercial.

---

<p align="center">
  <sub>Built with Next.js, OpenAI, pgvector y muchas noches de café. ☕</sub>
</p>
