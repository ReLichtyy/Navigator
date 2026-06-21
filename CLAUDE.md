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
    frontend/          ← Next.js 14 FULL-STACK app — THIS IS THE LIVE APP
    backend/           ← FastAPI RAG service — LEGACY / REFERENCE, NOT WIRED (see below)
    docker/            ← docker-compose for local all-in-one (postgres + chroma + both apps)
    docs/              ← older Spanish deployment/integration notes
    scripts/           ← bulk_ingest.py (backend tooling)
```

## ⚠️ The single most important fact

There are **two backends**, but only one is live:

- **`frontend/`** evolved into a full-stack Next.js app. `src/lib/api.ts` calls `"/api"`
  (its **own internal** App Router routes). This is what gets deployed (Vercel).
- **`backend/`** (FastAPI + Chroma) holds the *original* RAG/graph logic in Python but the
  frontend **no longer calls it**. Treat it as reference, not a running dependency.

Do not assume the FastAPI backend is involved in a request unless a route explicitly fetches it.

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
| LLM calls | `lib/llm/` | `selectModel`, `chatCompletion`, `chatStream`; providers `openai` + `openrouter` |
| Model catalog/pricing | `lib/llm/config.ts` | `MODELS`, `DEFAULT_MODEL`, `estimateCost` |
| Caching | `lib/cache/` | L1 in-memory + optional L2 Upstash; `invalidatePrefix` |
| Guardrails | `lib/guardrails/` | `validateInput` / `validateOutput` |
| Usage metering | `lib/metering/` | `recordUsage` → `usage_records` table |
| Observability | `lib/observability/` | `logger`, `timing` (`timed`), `trace` |
| Prompts | `lib/prompts/` | `getPrompt("chat:general" | "chat:title-gen", vars)` |
| Rate limit | `lib/rate-limit/` | Upstash ratelimit (falls back when unconfigured) |
| Auth | `lib/auth/` | `auth.ts`, `auth.config.ts` (NextAuth 5), `rbac.ts` (roles/tiers) |

### Where things live (`frontend/`)

> Path alias: **`@/* → frontend/src/*`**. Note `app/` lives at `frontend/app` (NOT under `src`).

| Path | Contents |
|---|---|
| `app/` | Routes. Pages: `/` (chat workspace), `/knowledge`, `/settings`, `(auth)/login`, `(auth)/signup` |
| `app/api/` | API routes (see table below) |
| `src/lib/api.ts` | **Single frontend→backend adapter.** All client calls go through here. SSE for chat. |
| `src/lib/server/` | Server-only: `services/`, `repositories/`, `validators/`, `utils/` |
| `src/lib/` | Cross-cutting libs (llm, cache, guardrails, metering, observability, prompts, auth, db) |
| `src/components/ui/` | shadcn-style primitives (via `@base-ui` / Radix). **Use these; don't hand-roll.** |
| `src/components/navigator/` | App shell: `app-sidebar`, `top-header`, `history-sidebar`, `chat-thread`, `chat-composer` |
| `src/components/` | Feature components: `GraphCanvas` (xyflow), `FileUpload`, `ChatPanel` |
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
| `upload` (POST), `upload/list`, `upload/[id]` (PATCH/DELETE) | Document upload & management |
| `usage`, `user/preferences`, `feedback` | Metering summary, settings, thumbs up/down |
| `health`, `cron/cleanup` | Ops: healthcheck, scheduled guest cleanup (needs `CRON_SECRET`). `db/migrate` exists but is disabled (404). |

> There is **no `app/api/graph` route yet** — `api.ts#fetchGraph` will 404. See `NEXT_STEPS.md`.

### Database (Neon Postgres)

- Client: `src/lib/db.ts` — `sql` (pooled, runtime) and `sqlDirect` (migrations).
- Schema: `src/lib/schema.sql`, idempotent (`IF NOT EXISTS`). Apply with `npm run db:migrate`
  (`scripts/migrate.mjs`). The `/api/db/migrate` route is **disabled** (returns 404, by design).
- Tables: `users`, `user_preferences`, `syllabus_uploads`, `programs`, `courses`, `syllabi`,
  `topics`, `topic_dependencies`, `chats`, `messages`, `usage_records`, `feedback`, `jobs`.
- ⚠️ No embeddings/chunks table and no `pgvector` column → real retrieval is not possible yet.

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

Backend (legacy): FastAPI, SQLAlchemy, `psycopg`, ChromaDB, `pymupdf`, OpenAI.

---

## Commands

```bash
# Frontend (the live app) — run from syllabus-navigator/frontend
npm run dev            # dev server on :3000
npm run build          # production build (Vercel uses `vercel-build` = next build)
npm start              # serve production build
npm run db:migrate     # apply src/lib/schema.sql to Neon
npm run db:users       # list users (debug)

# Backend (legacy/reference) — run from syllabus-navigator/backend
uvicorn main:app --reload      # FastAPI on :8000, docs at /docs
pytest                         # backend tests

# Everything local via Docker (postgres + chroma + both apps)
docker compose -f syllabus-navigator/docker/docker-compose.yml up --build
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
| `DEFAULT_LLM_PROVIDER` / `DEFAULT_LLM_MODEL` | no | Defaults: `openai` / `gpt-4o-mini` |
| `RATE_LIMIT_ENABLED`, `LOG_LEVEL` | no | Ops toggles |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | Omit → in-memory cache (resets on cold start) |

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

- **Frontend → Vercel.** Root Directory = `syllabus-navigator/frontend`. Needs Neon + (optional) Upstash + OpenAI key.
- The FastAPI backend is **not** part of the Vercel deploy.
