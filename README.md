# SilabusInvestigator

Monorepo for **Syllabus Navigator** — RAG over academic syllabi with knowledge graphs.

## Quick start

```bash
cd syllabus-navigator
cp .env.example .env          # set OPENAI_API_KEY
docker compose -f docker/docker-compose.yml up --build
```

- **Frontend:** http://localhost:3000 (`syllabus-navigator/frontend`)
- **API docs:** http://localhost:8000/docs

See [`syllabus-navigator/README.md`](syllabus-navigator/README.md) for details.
