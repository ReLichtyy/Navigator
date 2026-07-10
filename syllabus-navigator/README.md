# Syllabus Navigator

Industrial-grade foundation for an academic RAG platform.

## Project Layout

- `backend/`: FastAPI API gateway + ingestion and graph services
- `frontend/`: Next.js UI (chat, upload, knowledge graph)
- `docker/`: local orchestration and database initialization
- `scripts/`: utility scripts
- `.github/workflows/`: CI pipeline

## Quick Start

1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (required for ingest and chat).
2. From repo root `syllabus-navigator`, run `docker compose -f docker/docker-compose.yml up --build`.
3. If Postgres already existed before the MVP table was added, recreate the volume once: `docker compose -f docker/docker-compose.yml down -v` (data loss) or apply the `syllabus_uploads` DDL manually.
4. Open:
   - API docs: `http://localhost:8000/docs`
   - Frontend: `http://localhost:3000`

## Connect a Vercel frontend

1. Expose the backend over HTTPS and confirm `GET /health` works.
2. Add your Vercel URL to `CORS_ALLOW_ORIGINS` in `.env` (comma-separated).
3. In Vercel, set `NEXT_PUBLIC_API_URL` to your backend base URL (no `/api` prefix).

## Data model (MVP)

Graph-oriented tables from `docker/postgres/init.sql` (`programs`, `courses`, `syllabi`, `topics`, …) remain for future Sprint 2 work. **MVP uploads** use the parallel table **`syllabus_uploads`** (see same `init.sql`) so PDF ingest does not require seeding `courses` / `syllabi` FKs.

## Current Status

MVP pipeline implemented: PDF upload with header **`X-User-Id`**, chunking + OpenAI embeddings into **Chroma** (filtered by `user_id` + `syllabus_id`), grounded **`/chat/query`** with citations. Operational guide: [`docs/cursor-playbook.md`](docs/cursor-playbook.md).

Backend tests: from `backend/`, run `python -m pytest -q` (uses [`backend/pytest.ini`](backend/pytest.ini)).
s