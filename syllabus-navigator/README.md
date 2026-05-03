# Syllabus Navigator

Industrial-grade foundation for an academic RAG platform.

## Project Layout

- `backend/`: FastAPI API gateway + ingestion and graph services
- `frontend/`: Next.js UI scaffold (chat, upload, graph components)
- `docker/`: local orchestration and database initialization
- `scripts/`: utility scripts
- `.github/workflows/`: CI pipeline

## Quick Start

1. Copy `.env.example` to `.env`.
2. Run `docker compose -f docker/docker-compose.yml up --build`.
3. Open:
   - API docs: `http://localhost:8000/docs`
   - Frontend: `http://localhost:3000`

## Current Status

This repository is a scaffold with API contracts and architecture placeholders ready for feature implementation.
