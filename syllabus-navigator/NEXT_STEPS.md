# Next Steps Roadmap

## Sprint 1 (MVP Core)

1. Implement PDF parsing in `backend/app/services/ingestor.py`.
2. Persist chunks and topics in PostgreSQL.
3. Wire semantic retrieval in `rag_engine.py`.
4. Return grounded answers with citations in `/chat/query`.

## Sprint 2 (Graph Intelligence)

1. Implement robust dependency extraction in `graph_gen.py`.
2. Run cycle validation before persistence.
3. Add graph endpoints for topic neighborhood and learning path.
4. Add frontend graph interactions in `GraphCanvas`.

## Sprint 3 (Reliability and Ops)

1. Add integration tests for upload -> parse -> query flow.
2. Add observability (OpenTelemetry traces, structured logs).
3. Add migrations (Alembic) and seed data.
4. Add feature flags for LLM provider and vector DB swapping.

## Sprint 4 (Product Expansion)

1. Add mastery ledger update loop (topic confidence over time).
2. Generate study guides and flashcards from weighted topics.
3. Add multi-syllabus cross-course prerequisite graph.
