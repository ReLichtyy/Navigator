# Syllabus Navigator — Frontend

Next.js 14 UI for the Syllabus Navigator MVP.

## Setup

1. Copy `.env.example` to `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

2. From `syllabus-navigator`, start the stack:

```bash
docker compose -f docker/docker-compose.yml up --build
```

3. Open http://localhost:3000

Set `OPENAI_API_KEY` in `syllabus-navigator/.env` for upload, chat, and graph features.

## Local dev (without Docker)

```bash
cd frontend
npm install
npm run dev
```

## Features

- Local user identity (`UserContext` + `X-User-Id`)
- Chat threads with history search
- Knowledge library (uploaded PDFs per user)
- Per-chat OpenAI model selection
- Multi-turn RAG with persisted citations
- Knowledge graph viewer

API client: `src/lib/api.ts`
