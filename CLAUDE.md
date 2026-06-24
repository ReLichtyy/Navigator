# Syllabus Navigator — Development Guidelines

> Reference doc for future sessions. **Stable** info only (structure, where things live,
> conventions). For current state, fixes, and the deployment plan see **`NEXT_STEPS.md`**.

## Project Overview

Syllabus Navigator is a **RAG-over-academic-syllabi** app with a knowledge graph: upload a
syllabus PDF, chat about it with citations, and visualize topics + prerequisites as a graph.

Git repo root: `PROYECTO/` → contains `README.md` + the actual project in `syllabus-navigator/`.

```
PROYECTO/
  CLAUDE.md            ← this file (auto-loaded by Claude Code)
  NEXT_STEPS.md        ← diagnostic + fixes + deploy plan (changing state)
  README.md
  syllabus-navigator/
    frontend/          ← Next.js 14 FULL-STACK app — THIS IS THE WHOLE APP
    docs/              ← cursor-playbook.md (Notion-linked product roadmap)
```

## ⚠️ The single most important fact

**Everything lives in `frontend/` — one full-stack Next.js app, one deploy (Vercel).**

`src/lib/api.ts` calls `"/api"` (its **own internal** App Router routes). The **RAG + graph
pipeline lives here in TypeScript** (chunks+pgvector, async worker via `jobs`, retrieval,
graph-gen, schedule extraction, study OS). There is no separate backend service: an earlier
FastAPI + Chroma prototype was ported to TS and **deleted** (2026-06-23 — recoverable from git
history). Don't look for a Python runtime dependency; there isn't one.

---

## Architecture — Full-stack Next.js (`frontend/`)

### Request flow (the layering — respect it)

```
app/api/<route>/route.ts        ← HTTP handler: auth, validate, call service, shape response
  → lib/server/services/*.service.ts    ← business logic (RAG, chat, documents)
    → lib/server/repositories/*.repo.ts ← all SQL (Neon) lives here
      → lib/db.ts                        ← Neon serverless client (`sql` tagged template)
```

Cross-cutting helpers used by services:

| Concern | Location | Notes |
|---|---|---|
| Auth gating | `lib/server/utils/auth-helpers.ts` | `requireAuth()`, `requireRateLimit()`, `ApiErrorResponse` |
| Input validation | `lib/server/validators/api.schemas.ts` | zod schemas |
| RAG / ingestion | `lib/server/rag/` | `chunking` (`pdfToPageChunks` via `unpdf`), `graph-gen`, `schedule-gen`, `study-gen` (all OpenAI structured output) |
| PDF storage | `lib/server/storage/blob.ts` | `storePdf` → Vercel Blob (accounts only); degrades w/ warning if no token |
| LLM calls | `lib/llm/` | `selectModel`, `chatCompletion`, `chatStream`; providers `openai` + `openrouter`. GPT-5/o-series params built per family in `providers/openai.ts` (`max_completion_tokens`, temp=1) |
| Model catalog/pricing | `lib/llm/config.ts` | `MODELS`, `DEFAULT_MODEL`, `estimateCost` |
| Caching | `lib/cache/` | L1 in-memory + optional L2 Upstash; `invalidatePrefix` |
| Guardrails | `lib/guardrails/` | `validateInput` / `validateOutput` |
| Usage metering | `lib/metering/` | `recordUsage` → `usage_records` table |
| Observability | `lib/observability/` | `logger`, `timing` (`timed`), `trace` |
| Prompts | `lib/prompts/` | `getPrompt("chat:general" | "chat:title-gen", vars)`. Chat persona = **student mentor** (also `GROUNDED_SYSTEM_PROMPT` in `retrieval.service.ts` for the RAG path). |
| Rate limit | `lib/rate-limit/` | Upstash ratelimit (falls back when unconfigured) |
| Auth | `lib/auth/` | `auth.ts`, `auth.config.ts` (NextAuth 5), `rbac.ts` (roles/tiers) |

### Where things live (`frontend/`)

> Path alias: **`@/* → frontend/src/*`**. Note `app/` lives at `frontend/app` (NOT under `src`).

| Path | Contents |
|---|---|
| `app/` | Routes. Pages: `/` (chat workspace), `/knowledge`, `/agenda`, `/estudio`, `/mapa`, `/settings`, `(auth)/login`, `(auth)/signup` |
| `app/api/` | API routes (see table below) |
| `src/lib/api.ts` | **Single frontend→backend adapter.** All client calls go through here. SSE for chat. |
| `src/lib/server/` | Server-only: `services/`, `repositories/`, `rag/`, `storage/`, `validators/`, `utils/` |
| `src/lib/` | Cross-cutting libs (llm, cache, guardrails, metering, observability, prompts, auth, db) |
| `src/components/ui/` | shadcn-style primitives (via `@base-ui` / Radix). **Use these; don't hand-roll.** |
| `src/components/navigator/` | App shell: `app-sidebar`, `top-header`, `history-sidebar`, `chat-thread`, `chat-composer` |
| `src/components/` | Feature components: `GraphCanvas`/`EditableGraph` (xyflow), `SelectionAsk`, `ClientProviders`; feature dirs `agenda/`, `estudio/`, `auth/` |
| `src/context/` | `UserContext`, `AuthModalContext`, `SyllabusContext` |
| `src/features/chat/` | `context/ChatContext` (`useChatWorkspace`), `hooks/` (chat orchestration) |
| `src/hooks/` | `useChatWorkspace`, `use-mobile`, `use-toast` |
| `src/types/` | `api.ts` (API DTOs, e.g. `ChatOutAPI`), `models.ts` |
| `src/lib/schema.sql` | **Source of truth for the DB schema** (applied via migrate, see below) |
| `scripts/` | `migrate.mjs`, `list-users.mjs`, `seed-user.mjs`, `test-connection.js` |

### API routes (`app/api/`)

| Route | Purpose |
|---|---|
| `auth/[...nextauth]`, `auth/signup`, `auth/upgrade` | NextAuth + account creation / guest→user upgrade |
| `chat/history` (GET list / POST new) | List & create chats |
| `chat/[chatId]` (GET/PATCH/DELETE) | Chat detail, rename, set model/syllabus, delete |
| `chat/[chatId]/messages` (POST) | Send message → **SSE stream** of the answer |
| `chat/models` | Available models for the user's tier |
| `upload` (POST), `upload/list`, `upload/[id]` (PATCH/DELETE) | Document upload & management (guests allowed) |
| `graph/[syllabusId]` (GET/PATCH), `graph/[syllabusId]/reprocess` (POST) | Read graph, save edited mind map (cycle-validated), re-enqueue ingest |
| `schedule` (GET), `recommendations` (GET) | Cronograma agenda (all courses / `?syllabusId=`); weekly plan (assessments + this-week topics + review hints) |
| `study/[syllabusId]` (GET), `study/review` (POST), `study/stats` (GET) | Study OS: flashcards/quiz/summary/mindmap (`?refresh&difficulty&topic`); record review; streak/cards |
| `notes` (GET/POST), `notes/[id]` (PATCH/DELETE) | Per-date agenda notes (`?dates=1` for calendar markers, `?date=` for a day) |
| `usage`, `user/preferences`, `feedback` | Metering summary, settings, thumbs up/down |
| `health`, `cron/cleanup`, `cron/process` | Ops: healthcheck, scheduled guest cleanup, ingest-worker drain (crons need `CRON_SECRET`). `db/migrate` exists but is disabled (404). |

### Database (Neon Postgres)

- Client: `src/lib/db.ts` — `sql` (pooled, runtime) and `sqlDirect` (migrations).
- Schema: `src/lib/schema.sql`, idempotent (`IF NOT EXISTS`). Apply with `npm run db:migrate`
  (`scripts/migrate.mjs`). The `/api/db/migrate` route is **disabled** (returns 404, by design).
- Tables: `users`, `user_preferences`, `syllabus_uploads`, `chunks`, `programs`, `courses`,
  `syllabi`, `topics`, `topic_dependencies`, `schedule_events`, `chats`, `messages`,
  `usage_records`, `feedback`, `jobs`, `study_sets`, `date_notes`, `flashcard_reviews`.
- ✅ Retrieval is live: `CREATE EXTENSION vector` + `chunks.embedding vector(1536)` with an HNSW
  (`vector_cosine_ops`) index; `chunk.repo#search` / `searchByUser` do `embedding <=> $q`.
- ⚠️ `schema.sql` adds new columns/tables via `IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT
  EXISTS`, so existing DBs need `npm run db:migrate` re-run after a pull that touches the schema.

### Auth & access control

- `middleware.ts` gates everything. Public: `/`, `/login`, `/signup`, `/api/auth`, `/api/health`, `/api/cron`.
- Roles: `guest`, `free`, `pro`, `admin` (see `lib/auth/rbac.ts`). Guests are blocked from
  `/settings`, `/api/user/preferences`, `/api/usage`, and from uploading.
- Unauthenticated API calls → 401; unauthenticated pages → redirect to `/login`.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2 (App Router), React 18.3, TypeScript strict |
| Auth | NextAuth v5 (beta), bcryptjs |
| DB | Neon serverless Postgres (`@neondatabase/serverless`) |
| Cache / rate limit | Upstash Redis (optional; in-memory fallback) |
| LLM | OpenAI SDK + OpenRouter (router with tier/fallback logic) |
| Graph UI | `@xyflow/react` |
| Styling | Tailwind CSS 4, shadcn/ui (`@base-ui` / Radix), `lucide-react`, `sonner` |
| Forms / validation | `react-hook-form` + `zod` |
| Markdown / math | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex` |
| PDF parse | `unpdf` (text extraction, in-process — no native deps) |
| Tooling | Prettier + ESLint (`next/core-web-vitals`) + `knip` (dead-code); Vitest |

---

## Commands

```bash
# All from syllabus-navigator/frontend — there is only one app
npm run dev            # dev server on :3000
npm run build          # production build (Vercel uses `vercel-build` = next build)
npm start              # serve production build
npm run db:migrate     # apply src/lib/schema.sql to Neon (idempotent; re-run after schema pulls)
npm run db:users       # list users (debug)
npm test               # Vitest (tests/*, alias @→src; mocks auth+DB, no live services)
npm run lint           # ESLint (next/core-web-vitals)
npm run format         # Prettier --write (format:check to verify only)
npm run knip           # report unused files/exports/deps (review, don't blind-delete)
```

## Environment variables (`frontend/.env.local`)

| Var | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | yes | `npx auth secret` |
| `NEXTAUTH_URL` | yes | e.g. `http://localhost:3000` |
| `DATABASE_URL` | yes | Neon pooled connection (runtime) |
| `DATABASE_URL_DIRECT` | yes | Neon direct connection (migrations) |
| `OPENAI_API_KEY` | yes | Default LLM provider |
| `OPENROUTER_API_KEY` | no | Fallback / extended models |
| `CRON_SECRET` | prod | Gates `cron/*`; also arms the fire-and-forget ingest worker trigger |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel Blob; without it account PDFs aren't persisted (degrades w/ warning) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | Google OAuth sign-in (NextAuth provider) |
| `DEFAULT_LLM_PROVIDER` / `DEFAULT_LLM_MODEL` | no | Defaults: `openai` / `gpt-4o-mini` |
| `RAG_MAX_DISTANCE` | no | Cosine cutoff for retrieval relevance gate (default `0.9`) |
| `RATE_LIMIT_ENABLED`, `LOG_LEVEL` | no | Ops toggles |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | Omit → in-memory cache + rate-limit (per-instance, resets on cold start) |

---

## Code conventions

- **One adapter:** all client→server calls go through `src/lib/api.ts`. Don't `fetch("/api/...")` from components.
- **Layering:** route handlers stay thin (auth → validate → call service). SQL only in `repositories/`.
- **Errors:** throw `ApiErrorResponse(message, status)` in services; route handlers map it to the response.
- **Validation:** every request body validated with a zod schema from `validators/api.schemas.ts`.
- **Streaming chat:** answers are SSE (`data: {...}\n\n`, terminated by `data: [DONE]`); the final
  event carries `title`, `citations`, `provider`, `model`. Client parser lives in `api.ts#querySyllabus`.
- **UI:** use `components/ui/*` primitives; don't hand-roll buttons/inputs/dialogs.
- **Types:** API DTOs in `src/types/api.ts`; only component `Props` interfaces inline.
- **Functional components only.** TypeScript strict everywhere.

## Deployment (summary — full plan in `NEXT_STEPS.md`)

- **Single Next.js app → Vercel.** Root Directory = `syllabus-navigator/frontend`. Needs Neon +
  (optional) Upstash + OpenAI key. No other service to deploy.
