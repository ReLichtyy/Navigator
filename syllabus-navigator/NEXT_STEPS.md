# Next Steps Roadmap

## Sprint 1 (MVP Core) — done

1. ~~Implement PDF parsing in `backend/app/services/ingestor.py`.~~ (PyMuPDF + chunking; vectors in Chroma; metadata in `syllabus_uploads`.)
2. ~~Persist chunks and topics in PostgreSQL.~~ (MVP: row per upload in `syllabus_uploads`; chunk text lives in Chroma. Topics/graph DB still Sprint 2.)
3. ~~Wire semantic retrieval in `rag_engine.py`.~~
4. ~~Return grounded answers with citations in `/chat/query`.~~

## Sprint 2 (Graph Intelligence)

1. ~~Implement robust dependency extraction in `graph_gen.py`.~~
2. ~~Run cycle validation before persistence.~~
3. ~~Add graph endpoints for topic neighborhood and learning path.~~
4. Add frontend graph interactions in `GraphCanvas`.

## Sprint 3 (Reliability and Ops)

1. Add integration tests for upload -> parse -> query flow.
2. Add observability (OpenTelemetry traces, structured logs).
3. Add migrations (Alembic) and seed data.
4. Add feature flags for LLM provider and vector DB swapping.
5. Add deployment + Vercel wiring checklist (HTTPS backend, CORS_ALLOW_ORIGINS, NEXT_PUBLIC_API_URL).

## Sprint 4 (Product Expansion)

1. Add mastery ledger update loop (topic confidence over time).
2. Generate study guides and flashcards from weighted topics.
3. Add multi-syllabus cross-course prerequisite graph.

---
**Log - 2026-05-04:**
- Se implementó la extracción de dependencias de temas mediante IA (OpenAI Structured Outputs) en `graph_gen.py`.
- Se añadió la lógica de validación para prevenir ciclos/dependencias circulares.
- Se completó el endpoint `GET /api/graph/{syllabus_id}` en `routes_graph.py` que lee el contexto desde ChromaDB y genera el grafo on-the-fly.
