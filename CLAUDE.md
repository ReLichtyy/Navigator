# Syllabus Navigator — Development Guidelines

> Reference doc for future sessions. **Stable** info only (structure, where things live,
> conventions). For open work items see **`PENDIENTES.md`** (the old `NEXT_STEPS.md` log
> lives in git history).

## Project Overview

Syllabus Navigator is a **RAG-over-academic-syllabi** app with a knowledge graph: upload a
syllabus PDF, chat about it with citations, and visualize topics + prerequisites as a graph.

Git repo root: `PROYECTO/` → contains `README.md` + the actual project in `syllabus-navigator/`.

```
PROYECTO/
  CLAUDE.md            ← this file (auto-loaded by Claude Code)
  PENDIENTES.md        ← open implementation plans + ops checklist (changing state)
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
| Auth gating | `lib/server/utils/auth-helpers.ts` | `getAuthedUser()` / `requireAuth()` resolve **Clerk** session → Neon user row (stable UUID + role); `requireRateLimit()`, `ApiErrorResponse` |
| Input validation | `lib/server/validators/api.schemas.ts` | zod schemas |
| RAG / ingestion | `lib/server/rag/` | `chunking` (`pdfToPageChunks` via `unpdf` + office/link/text), `graph-gen`, `schedule-gen`, `study-gen` (types + normalize + shared prompts), `course-infer`, `web-search` |
| Study Engine | `lib/server/rag/orchestrator/` + `agents/` + `eval/` + `retrieval/` | `runner#orchestrateStudySet` (flashcard/inquisitor/synth agents in parallel → `eval/gates` critic), `router` (study plan by mastery×weight×urgency), `planner#getTodaySession` (SRS), `retrieval/hybrid` (dense+lexical RRF per topic) |
| PDF storage | `lib/server/storage/blob.ts` | `storePdf` → Vercel Blob (accounts only); degrades w/ warning if no token |
| LLM calls | `lib/llm/` | `selectModel`, `chatCompletion`, `chatStream`; providers `openai`, `openrouter`, `deepseek` (chat default). Study Engine agents run on **direct OpenAI** (+ DeepSeek: `deepseek-chat` verifier — el reasoner hacía 1.5-3 min el quiz frío, restaurable vía `MODEL_VERIFIER` —, `deepseek-reasoner` grader sin uso) — `agent-models.ts` role→model map, `_base.ts`. RAG generators use `gateway-generate.ts` (**OpenAI direct**, `MODEL_RAG`, default gpt-5-mini; the name is historical — the Bluesmind gateway died 2026-07-01 and was dropped as default). Embeddings = OpenAI direct (`embeddings.ts`, text-embedding-3-large @ dim 2000) |
| Model catalog/pricing | `lib/llm/config.ts` | `MODELS`, `DEFAULT_MODEL`, `estimateCost` |
| Feature flags | `lib/config/flags.ts` | `ragEnabled` (RAG_ENABLED), `toolsEnabled` (TOOLS_ENABLED), default provider/model — resolved once at module load |
| Tools (chat actions) | `lib/tools/` | 5 tools (retrieve-context, get-schedule, get-recommendations, generate-study-set, record-review) → services; loop in `lib/llm/tools-loop.ts`, gated by `TOOLS_ENABLED` |
| Caching | `lib/cache/` | L1 in-memory + optional L2 Upstash; `invalidatePrefix` |
| Guardrails | `lib/guardrails/` | `validateInput` / `validateOutput` |
| Usage metering | `lib/metering/` | `recordUsage` → `usage_records` table |
| Observability | `lib/observability/` | `logger`, `timing` (`timed`), `trace` |
| Prompts | `lib/prompts/` | `getPrompt("chat:general" | "chat:title-gen", vars)`. Chat persona = **student mentor** (also `GROUNDED_SYSTEM_PROMPT` in `retrieval.service.ts` for the RAG path). |
| Rate limit | `lib/rate-limit/` | Upstash ratelimit (falls back when unconfigured) |
| Auth | `@clerk/nextjs` + `lib/auth/rbac.ts` | Clerk owns sessions/UI (`/sign-in`, `/sign-up`, `/sso-callback`); `rbac.ts` = roles/tiers only. NextAuth was removed. |

### Where things live (`frontend/`)

> Path alias: **`@/* → frontend/src/*`**. Note `app/` lives at `frontend/app` (NOT under `src`).

| Path | Contents |
|---|---|
| `app/` | Routes. Pages: `/` (chat workspace), `/knowledge`, `/agenda`, `/estudio`, `/mapa`, `/settings`, `/sign-in`, `/sign-up`, `/sso-callback` (Clerk). `(auth)/login|signup` are legacy redirects. |
| `app/api/` | API routes (see table below) |
| `src/lib/api.ts` | **Single frontend→backend adapter.** All client calls go through here. SSE for chat. |
| `src/lib/server/` | Server-only: `services/`, `repositories/`, `rag/`, `storage/`, `validators/`, `utils/` |
| `src/lib/` | Cross-cutting libs (llm, cache, guardrails, metering, observability, prompts, auth, db) |
| `src/components/ui/` | shadcn-style primitives (via `@base-ui` / Radix). **Use these; don't hand-roll.** |
| `src/components/navigator/` | App shell: `app-sidebar`, `top-header`, `history-sidebar`, `chat-thread`, `chat-composer` |
| `src/components/` | Feature components: `GraphCanvas` (wraps the custom `estudio/mind-map-canvas` — xyflow was removed), `SelectionAsk`, `ClientProviders`; feature dirs `agenda/`, `estudio/` (incl. `cross-course-view`), `auth/`, `bienvenida/` |
| `src/lib/ui/` | Pure UI helpers (unit-testable): `course-group`, `doc-status`, `combine-study`, `graph-edit` (branch edits → PATCH-graph payload) |
| `src/context/` | `UserContext`, `AuthModalContext`, `SyllabusContext` |
| `src/features/chat/` | `context/ChatContext` (`useChatWorkspace`), `hooks/` (chat orchestration) |
| `src/hooks/` | `useChatWorkspace`, `use-mobile`, `use-toast` |
| `src/types/` | `api.ts` (API DTOs, e.g. `ChatOutAPI`), `models.ts` |
| `src/lib/schema.sql` | **Source of truth for the DB schema** (applied via migrate, see below) |
| `scripts/` | `migrate.mjs`, `list-users.mjs`, `seed-user.mjs`, `test-connection.js` |

### API routes (`app/api/`)

| Route | Purpose |
|---|---|
| `chat/history` (GET list / POST new) | List & create chats |
| `chat/[chatId]` (GET/PATCH/DELETE) | Chat detail, rename, set model/syllabus, delete |
| `chat/[chatId]/messages` (POST) | Send message → **SSE stream** of the answer |
| `chat/models` | Available models for the user's tier |
| `upload` (POST multipart ≤4MB), `upload/blob` + `upload/from-blob` (client→Vercel Blob for big files), `upload/link`, `upload/text` | Ingest sources (PDF/docx/pptx/xlsx, URL, pasted text) |
| `upload/list`, `upload/[id]` (PATCH/DELETE), `upload/[id]/process` (POST), `upload/[id]/course` (POST) | Manage docs; fire slow enrichment (graph/schedule/inference); act on course suggestion |
| `courses` (GET/POST), `courses/[id]` (PATCH/DELETE) | Course Intelligence Layer: real course folders (docs survive course deletion). PATCH = `{name?, term_start?}` — `term_start` anchors "Semana N" → real dates. `course-infer` also extracts it from the syllabus (stored on `course_suggestions`, applied on confirm only if the course has none — user-set value wins) |
| `graph/[syllabusId]` (GET/PATCH), `graph/[syllabusId]/reprocess` (POST), `graph/cross` (GET) | Read graph; PATCH saves an edited graph (cycle-validated) — UI: structural editor in the canvas drawer, wired from the `/knowledge` preview (`GraphCanvas` + `src/lib/ui/graph-edit.ts`); re-enqueue ingest; cross-course graph |
| `schedule` (GET), `recommendations` (GET) | Cronograma agenda (all courses / `?syllabusId=`); weekly plan (assessments + this-week topics + review hints). Both resolve `week_label` → dates at serve time via `lib/server/rag/week-date.ts` when the course has `term_start` (never persisted) |
| `study/[syllabusId]`, `study/course/[courseId]` (GET) | Study set (bank-assembled; `?refresh&difficulty&topic&web`) per doc or whole course |
| `study/[syllabusId]/quiz-stage`, `study/course/[courseId]/quiz-stage` (GET) | Staged quiz (3 escalating stages, lazy bank generation) |
| `study/quiz-review` (GET/POST/PATCH), `study/quiz-seen` (POST) | Repaso queue (failed questions) / mark served questions |
| `study/session` (GET), `study/review` (POST), `study/stats` (GET) | Adaptive today-session (SRS + plan-ordered items); record flashcard review; streak/cards |
| `mastery` (GET/POST), `mastery/[syllabusId]` (GET) | Per-topic mastery ledger (quiz outcomes → confidence) |
| `notes` (GET/POST), `notes/[id]` (PATCH/DELETE) | Per-date agenda notes (`?dates=1` for calendar markers, `?date=` for a day) |
| `usage`, `user/preferences`, `feedback` | Metering summary, settings, thumbs up/down |
| `health`, `cron/cleanup`, `cron/process` | Ops: healthcheck, scheduled guest cleanup, ingest-worker drain (crons need `CRON_SECRET`). `db/migrate` exists but is disabled (404). |

### Database (Neon Postgres)

- Client: `src/lib/db.ts` — `sql` (pooled, runtime). Migrations use their own client in
  `scripts/migrate.mjs` (reads `DATABASE_URL`).
- Schema: `src/lib/schema.sql`, idempotent (`IF NOT EXISTS`). Apply with `npm run db:migrate`
  (`scripts/migrate.mjs`). The `/api/db/migrate` route is **disabled** (returns 404, by design).
- Tables: `users`, `user_preferences`, `syllabus_uploads`, `chunks`, `programs`, `courses`,
  `syllabi`, `topics`, `topic_dependencies`, `schedule_events`, `chats`, `messages`,
  `usage_records`, `feedback`, `jobs`, `study_sets`, `date_notes`, `flashcard_reviews`,
  `topic_mastery`, `user_courses`, `course_suggestions`, `course_study_sets`, `study_items`
  (item bank, embedding-deduped), `quiz_review`, `quiz_seen`.
- ✅ Retrieval is live: `CREATE EXTENSION vector` + `chunks.embedding vector(2000)`
  (text-embedding-3-large truncated via the `dimensions` param; HNSW caps at 2000 dims) with an
  HNSW (`vector_cosine_ops`) index, plus a generated `ts` tsvector (spanish) column + GIN index
  for the lexical leg of hybrid retrieval; `chunk.repo#search` / `searchByUser` do `embedding <=> $q`.
- ⚠️ The retrieval relevance gate (`RAG_MAX_DISTANCE`, default 0.75 in `retrieval.service.ts`) is
  calibrated to THIS embedding model+dims. If either changes, re-measure with
  `scratch/test-retrieval-live.mjs` — with the old 0.9 default the gate let everything through.
- ⚠️ `schema.sql` adds new columns/tables via `IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT
  EXISTS`, so existing DBs need `npm run db:migrate` re-run after a pull that touches the schema.

### Auth & access control

- **Clerk** (`@clerk/nextjs`): `middleware.ts` runs `clerkMiddleware`; session UI at `/sign-in`,
  `/sign-up`, `/sso-callback`. Server code never sees Clerk ids beyond
  `auth-helpers.ts#getAuthedUser`, which maps Clerk → Neon `users` row (stable UUID + role) via
  `user.repo#getOrCreateUserByClerk`. `ADMIN_EMAILS` promotes matching emails to admin.
- Roles: `guest`, `free`, `pro`, `admin` (see `lib/auth/rbac.ts`).
- Unauthenticated API calls → 401; pages gate via Clerk redirects.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2 (App Router), React 18.3, TypeScript strict |
| Auth | Clerk (`@clerk/nextjs` + `@clerk/themes`) |
| DB | Neon serverless Postgres (`@neondatabase/serverless`) |
| Cache / rate limit | Upstash Redis (optional; in-memory fallback) |
| LLM | OpenAI SDK client; providers: DeepSeek (chat + verifier `deepseek-chat`), OpenAI (embeddings + Study Engine + RAG generators), OpenRouter (fallback). Bluesmind gateway dead (2026-07-01) — only reachable via env override |
| Graph / mind-map UI | Custom canvas (`components/estudio/mind-map-canvas`) — `@xyflow/react` removed |
| Styling | Tailwind CSS 4, shadcn/ui (Radix), `lucide-react`, `sonner` |
| Validation | `zod` (API schemas + LLM output contracts) |
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
npm run db:users       # list users (debug); also db:seed-user, db:seed-demo, db:wipe
npm test               # Vitest (tests/*, alias @→src; mocks auth+DB, no live services)
npm run lint           # ESLint (next/core-web-vitals)
npm run format         # Prettier --write (format:check to verify only)
npm run knip           # report unused files/exports/deps (review, don't blind-delete)
```

## Environment variables (`frontend/.env.local`)

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | yes | Clerk auth |
| `DATABASE_URL` | yes | Neon pooled connection (runtime + `scripts/migrate.mjs`) |
| `OPENAI_API_KEY` | yes | Embeddings + openai chat provider + web-search context |
| `DEEPSEEK_API_KEY` | yes (chat + study) | Direct DeepSeek provider — chat default + Study Engine verifier (`deepseek-chat`; `MODEL_VERIFIER` para volver al reasoner) |
| `BLUESMIND_API_KEY` / `BLUESMIND_BASE_URL` | no (legacy) | Dead gateway (2026-07-01); only used if a `MODEL_*` env override targets provider bluesmind |
| `MODEL_RAG` | no | Model for graph/schedule/course-infer generators (OpenAI direct, default `gpt-5-mini`) |
| `MODEL_ROUTER/_SYNTH/_FLASHCARD/_INQUISITOR/_CASE/_VERIFIER/_GRADER` | no | Per-role Study Engine model overrides (`lib/llm/agent-models.ts`) |
| `WEB_SEARCH_MODEL` | no | Model for the `?web=1` study augmentation |
| `OPENROUTER_API_KEY` | no | Fallback / extended models |
| `CRON_SECRET` | prod | Gates `cron/*`; also arms the fire-and-forget ingest worker trigger |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel Blob; without it account PDFs aren't persisted (degrades w/ warning) |
| `DEFAULT_LLM_PROVIDER` / `DEFAULT_LLM_MODEL` | no | Defaults: `openai` / `gpt-4o-mini` (see `lib/config/flags.ts`) |
| `RAG_ENABLED` / `TOOLS_ENABLED` | no | Master switches: RAG retrieval (default on) / chat tool-calling (default off) |
| `RAG_MAX_DISTANCE` | no | Cosine cutoff for retrieval relevance gate (default `0.9`) |
| `STUDY_LANGUAGE` | no | Output language for the study area (Study Engine + `?web=1` search), default `es`. App-wide for now (`flags.studyLanguage`); planned to become a per-user preference via `StudyGenOptions.language` |
| `ADMIN_EMAILS` | no | Comma-separated emails auto-promoted to admin |
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

## Deployment (summary)

- **Single Next.js app → Vercel.** Root Directory = `syllabus-navigator/frontend`. Needs Neon +
  (optional) Upstash + OpenAI key. No other service to deploy.
