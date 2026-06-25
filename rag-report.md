# Reporte — Estado actual del RAG (implementación real)

> Auditoría de cómo está construido HOY el pipeline RAG (ingesta → almacenamiento → recuperación →
> generación), con referencias a archivo:línea. Sirve de línea base para la propuesta multi-RAG de
> `bugreport.md` §8-9. Fecha: 2026-06-24. Todo vive en `syllabus-navigator/frontend`.

---

## 1. Resumen ejecutivo

RAG **clásico de un solo vector store**, bien estructurado y robusto en *plumbing* (ingesta en 2
fases, cola de trabajos durable, citas, gate de relevancia). Pero es **mono-modelo, mono-índice** y
con piezas **ingenuas** donde importa la calidad:

- **Embeddings:** un solo modelo OpenAI `text-embedding-3-small` (1536d), hardcodeado.
- **Índice:** un solo HNSW pgvector sobre `chunks`. No hay índice léxico/estructurado.
- **Recuperación (chat):** vector ANN + **rerank híbrido léxico, pero en memoria** (overlap de
  tokens en JS sobre 24 candidatos), no un BM25/tsvector real ni reranker de modelo.
- **Generación (graph/schedule/study):** **no usan recuperación** — leen el texto **concatenado
  completo** (y lo truncan). El RAG real (vector) solo alimenta el **chat**.
- **Chunking:** ventanas fijas de 1200 chars / 120 overlap, por página; no estructural.

Madurez: **plumbing 8/10, calidad de recuperación 5/10, multi-modelo/multi-índice 1/10.**

---

## 2. Arquitectura real (flujo extremo a extremo)

```
SUBIDA (request, síncrono)                          WORKER (async, cola jobs)
─────────────────────────────                       ─────────────────────────
document.service.processUpload                      ingestion.service.runIngestJob
  ├─ valida (magic %PDF-, 5MB, MIME)                  ├─ embedTexts(pending)  ← OpenAI 3-small
  ├─ unpdf extractText (por página)                   │   └─ setEmbedding por chunk
  ├─ pdfToPageChunks (1200/120)                       ├─ status='processed'
  ├─ ¿scan? meaningfulText<200 → needs_ocr (sin OCR)  ├─ getConcatenatedText
  ├─ storePdf → Vercel Blob (solo cuentas)            ├─ course-infer  (best-effort)
  ├─ replaceChunksText (TEXTO, sin embedding)         ├─ graph-gen     (best-effort)
  └─ jobs.enqueue('ingest')                           └─ schedule-gen  (best-effort)
        │                                                   ▲
        └─ triggerIngestionWorker() → drainQueue() ─────────┘  (INLINE, awaited)
                                                            (Vercel Cron /api/cron/process = backstop)

CHAT (request → SSE)
────────────────────
chat.service.prepareMessages
  ├─ RetrievalService.retrieve(syllabusId)  ó  retrieveForUser(userId)
  │     ├─ embedText(pregunta)
  │     ├─ chunk.repo.search → ANN coseno, over-fetch K=24
  │     ├─ gate de relevancia (dist > 0.9 → sin contexto)
  │     ├─ rerankChunks (vector + léxico 0.35) → top 8
  │     └─ contextBlock [Fragmento N] + citations (máx 5)
  ├─ + bloque AGENDA/CRONOGRAMA (hoy + próximos eventos)
  ├─ system = GROUNDED_SYSTEM_PROMPT (mentor) | general
  └─ chatStream → SSE → guardrails out → save + metering
```

---

## 3. Componente por componente

### 3.1 Ingesta — Fase 1 (síncrona, en el request) · `document.service.ts`
- **Fuentes:** PDF (`processUpload`), enlace (`processLink`, fetch + `htmlToText`), texto pegado
  (`processText`). Unifican el mismo pipeline chunks/jobs/worker.
- **Validación PDF:** MIME (`:66`), tamaño 5MB (`:72`), **magic bytes `%PDF-`** real (`:83`,
  anti-spoof), hash sha256 para idempotencia (`:87`).
- **Parseo + chunking:** `pdfToPageChunks` con `unpdf`, **por página** (`chunking.ts:74-93`).
- **Detección de escaneo:** `meaningfulTextLength < 200` → estado `needs_ocr`, **OCR deshabilitado
  a propósito** (`document.service.ts:107`, `:19-22`). Los escaneos quedan fuera del índice.
- **Persistencia:** `replaceChunksText` guarda **solo texto** (sin embedding) (`chunk.repo.ts:31`);
  el embedding lo pone el worker. Blob solo para cuentas; invitados efímeros 24h.
- **Encola** `jobs('ingest')` y dispara el worker **inline** (`:114`).

### 3.2 Ingesta — Fase 2 (worker async) · `ingestion.service.ts`
- **Embeddings:** `listPendingEmbeddings` (embedding IS NULL) → `embedTexts` → `setEmbedding`
  (`:35-41`). **Idempotente:** re-correr solo re-embebe lo pendiente.
- **Orden:** embeddings → `processed` → course-infer → graph-gen → schedule-gen. Embeddings son
  **bloqueantes** (si fallan, no sigue, `:49`); el resto es **best-effort** (un fallo no rompe la
  subida) (`:66-90`).
- **Cola** (`job.repo.ts`): claim **atómico** `FOR UPDATE SKIP LOCKED` (`:43`, dos workers no chocan),
  rescate de jobs `processing` colgados >10min (`:38`), **reintentos con backoff exponencial**
  `2^attempts` min hasta `max_attempts` (`:66-83`).
- **Ejecución:** se **drena inline** en el request de subida (`worker-trigger.ts`) porque Vercel
  congela la función tras responder; Vercel Cron `/api/cron/process` es el respaldo. `drainQueue`
  procesa hasta **5 jobs** por corrida (`ingestion.service.ts:100`).

### 3.3 Almacenamiento / índice · `schema.sql`
- **Neon Postgres + pgvector** (`EXTENSION vector`, `schema.sql:7`).
- `chunks.embedding vector(1536)` — comentario fija el modelo: `text-embedding-3-small`
  (`schema.sql:98`).
- **Índice ANN:** HNSW `vector_cosine_ops` (operador `<=>`) (`schema.sql:113-114`) + btree por
  `syllabus_id` (`:111`).
- **Locators de cita:** `page_start/end` (PDF) y `char_start/end` (link/texto) (`:108-109`).
- **Un solo índice, una sola dimensión (1536).** No hay índice léxico (`tsvector`) ni de metadata.

### 3.4 Embeddings · `llm/embeddings.ts`
- `text-embedding-3-small`, **1536d**, batch **96** (`:11-13`).
- Reordena `resp.data` por `.index` antes de guardar — evita desalinear vector↔chunk (BUG-002, `:39`).
- **Un solo provider (OpenAI), hardcodeado.** Mismo modelo para ingest y query (correcto: mismo
  espacio). No hay capa de selección de modelo de embedding.

### 3.5 Recuperación · `retrieval.service.ts` + `chunk.repo.ts`
- **Dos alcances:** `retrieve(syllabusId)` (un curso) y `retrieveForUser(userId)` (todos los cursos
  del usuario, chat sin enlazar) (`:136-150`).
- **SQL:** `embedding <=> $q AS distance … ORDER BY distance ASC LIMIT K` con JOIN a
  `syllabus_uploads` para metadata de cita (`chunk.repo.ts:113-151`).
- **Over-fetch:** `CANDIDATE_K = TOP_K*3 = 24` candidatos, luego rerank a **TOP_K=8** (`:16-20`).
- **Gate de relevancia:** si el chunk **más cercano** supera `MAX_DISTANCE=0.9` → **sin contexto**
  (pregunta off-topic) (`:39`, `:98-99`). Configurable con `RAG_MAX_DISTANCE`.
- **Rerank híbrido (¡ya existe!) pero ingenuo:** `rerankChunks` = `vectorSim(1-dist/2) + 0.35 *
  overlapLéxico` (`:71-92`). El léxico es **fracción de términos de la query presentes en el chunk**,
  calculado **en JS** sobre los 24 candidatos — **no** es BM25/`tsvector`, y el recall está acotado
  a lo que el vector ya trajo en el top-24.
- **Salida:** `contextBlock` con `[Fragmento N]`, citas (máx **5**, quote **500** chars) (`:111-133`).

### 3.6 Generación (chat) · `chat.service.ts`
- `prepareMessages` arma: contexto recuperado (si hay) + **bloque AGENDA/CRONOGRAMA** siempre
  (hoy + próximos eventos de todos los cursos, `:37-56`, `:103-104`) + historial últimos 6 turnos.
- **System prompt:** `GROUNDED_SYSTEM_PROMPT` (persona **mentor**, cita `[Fragmento N]`, no inventa
  datos del sílabo) cuando hay contexto; si no, prompt general (`retrieval.service.ts:47-55`).
- **Modelo:** `selectModel` por tier/preferido (`:145-149`); `chatCompletion`/`chatStream` (SSE).
- **Robustez:** guardrails in/out, título en 1er mensaje, **persistencia de respuesta parcial** si
  el stream falla (BUG-004, `:343-379`), metering `recordUsage` + `estimateCost`.

### 3.7 Otros generadores RAG · `graph-gen.ts`, `schedule-gen.ts`, `study-gen.ts`, `course-infer.ts`
- Mismo patrón: **una llamada OpenAI structured-output** sobre `getConcatenatedText` (texto
  **completo concatenado**, ordenado por `chunk_index`).
- **NO usan el vector store.** Es decir: el retriever (lo que la gente llama "el RAG") alimenta
  **solo el chat**. Graph/schedule/study son extracción sobre texto plano (con truncado, p.ej.
  study a 24k, ver `bugreport.md` §3.B).

---

## 4. Lo que está bien (no tocar)

- Arquitectura **en capas limpia** (route→service→repo→db) y portada de Python a TS sin dependencias
  nativas.
- **Ingesta en 2 fases** + **cola durable** con claim atómico, backoff y rescate de colgados.
- **Idempotencia** (hash de fuente, re-embed solo pendientes).
- **Gate de relevancia** explícito (evita "grounding sobre ruido") con override por env.
- **Rerank híbrido** ya presente (base sobre la cual mejorar, no construir de cero).
- **Citas con locators** (página / offset) y **multi-scope** (un curso / todos).
- Detección de escaneo, guardrails, metering, streaming con recuperación ante fallo.

---

## 5. Brechas y riesgos (lo que limita la calidad)

| # | Brecha | Evidencia | Impacto |
|---|---|---|---|
| R1 | **Mono-modelo / mono-provider de embeddings**, dimensión 1536 fijada por el índice | `embeddings.ts:11`, `schema.sql:98` | Sin flexibilidad; cambiar de modelo = re-embeber todo |
| R2 | **Léxico ingenuo en memoria**, no BM25/`tsvector`; recall acotado al top-24 del vector | `retrieval.service.ts:60-92` | Pierde términos exactos/fórmulas fuera del top vector |
| R3 | **Sin reranker de modelo** (cross-encoder) | — | Orden final sub-óptimo en consultas difíciles |
| R4 | **Chunking fijo por caracteres**, no estructural (ignora encabezados/tablas/secciones) | `chunking.ts:21-35,74-93` | Tablas/fórmulas/listas se parten mal → contexto pobre |
| R5 | **Generadores no recuperan**: leen texto concatenado **truncado** | `study-gen.ts:275,342`, `ingestion.service.ts:53` | En cursos grandes se pierde material; ironía: hay vector y no se usa |
| R6 | **Umbral de distancia único y global** (0.9), calibrado a ojo, sensible al idioma | `retrieval.service.ts:30-39` | Frágil entre documentos/idiomas (el propio código nota inflación cross-language) |
| R7 | **Sin transformación de query** (HyDE, multi-query, expansión) | — | Preguntas mal redactadas recuperan mal |
| R8 | **Sin OCR**: escaneos quedan fuera del índice | `document.service.ts:107` | PDFs imagen no estudiables |
| R9 | **Worker drena inline en el request** de subida | `worker-trigger.ts`, `document.service.ts:114` | Latencia de subida atada a embeddings+graph+schedule (varias llamadas LLM) |
| R10 | **`searchByUser` escanea todos los chunks del usuario** | `chunk.repo.ts:133-151` | Con muchos cursos, candidatos diluidos (sin filtro por curso/tema) |
| R11 | **Sin versión/migración de embeddings** ni dedup de chunks | — | No hay camino seguro para cambiar de modelo |

---

## 6. Mapa: actual → visión multi-RAG (`bugreport.md` §8-9)

| Capa multi-RAG | ¿Existe hoy? | Qué hay / qué falta |
|---|---|---|
| **Router/Planner** | ❌ | Solo `selectModel` por tier; no hay planner de recuperación/targeting |
| **Orquestación (grafo)** | ⚠️ parcial | Hay **cola de jobs** (durable, retries), pero no grafo de agentes con gates |
| **Multi-índice** | ⚠️ 1 de 4 | Solo **dense** (pgvector). Falta léxico (`tsvector`), estructurado, banco de ítems |
| **Hybrid search** | ⚠️ proto | Rerank léxico **en memoria** (no índice); falta RRF real + reranker |
| **Agentes** | ⚠️ | Generadores monolíticos (graph/schedule/study); falta especializar + verifier |
| **Eval pipeline** | ❌ | Solo guardrails de chat; sin faithfulness/answer-correctness/dedup offline |
| **Multi-modelo** | ❌ | Embedding y chat hardcodeados; falta `AGENT_MODELS` por rol |

---

## 7. Recomendaciones rápidas (alto ROI, bajo riesgo)

1. **R2/R3 — Hybrid real:** añadir `chunks.ts tsvector` (GIN) + fusión **RRF** con el vector, y
   opcional reranker (Cohere/Voyage). Reutiliza el `rerankChunks` existente como fallback.
2. **R5 — Recuperación para generadores:** que graph/schedule/study seleccionen chunks por
   relevancia/tema en vez de concatenar+truncar (cierra la "ironía RAG").
3. **R1/R11 — Capa de modelo de embedding:** extraer `EMBEDDING_PROVIDER/MODEL` + columna versionada,
   para poder evaluar `gemini-embedding-001`@1536 sin migrar el índice (ver `bugreport.md` §9.2).
4. **R4 — Chunking estructural:** respetar encabezados/secciones y mantener tablas juntas.
5. **R9 — Desacoplar worker:** mantener el drain inline como respaldo pero permitir corrida puramente
   por Cron para subidas grandes (no atar latencia de subida a LLM de graph/schedule).
6. **R6 — Umbral adaptativo:** normalizar distancia por consulta/idioma en vez de un 0.9 global.

> Detalle de la arquitectura objetivo y modelos por agente: `bugreport.md` §8 (multi-RAG) y §9
> (multi-modelo).
