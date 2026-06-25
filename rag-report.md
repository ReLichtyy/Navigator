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

---

## 8. Próximos cambios — Plan de ejecución (Study Engine multi-RAG)

> Hoja de ruta viva para llevar el Área de Estudio + RAG a "clase mundial". Norte = arquitectura
> multi-RAG de `bugreport.md` §8-9. Se construye en **5 pasos**, cada uno desplegable por sí solo,
> en orden de la causa más citada por el usuario ("se repite") hacia el motor adaptativo completo.
> Fecha de inicio: 2026-06-25.

### 8.0 Decisiones fijadas (mandan en todos los pasos)

| Decisión | Elegido | Razón |
|---|---|---|
| Embeddings | Mantener OpenAI `text-embedding-3-small` 1536d | Cero migración; el índice ya está cableado |
| Modelos por agente | **Mixto**: calidad `case/inquisitor/verifier/grader`; económico `router/synth/flashcard` | Caro donde el riesgo importa, barato en volumen |
| Verifier | Familia **distinta** al generador (inquisitor=GPT → verifier=Claude) | Diversidad atrapa errores que la redundancia no |
| Orquestación | **Runner de grafo propio en TS** (no LangGraph) | Repo abandonó LangChain; fricción serverless |
| Dónde corre lo pesado | **Worker async** (`jobs` + `cron/process`), no en el request | Generación multi-agente es pesada |
| Banco `study_items.user_id` | **NULL** (compartido por scope) por ahora | Evita violación FK con invitados (no están en `users`) |

### 8.1 Arquitectura objetivo (5 capas)

```
REQUEST → encola job, devuelve banco cacheado, UI hace polling/stream progreso
   WORKER (jobs + cron/process):
   CAPA 1 ROUTER (híbrido)  → reglas calculan targets+priority por tema;
       priority = w1·pesoExamen + w2·(1-mastery) + w3·urgenciaCronograma + w4·lapsoSRS
       LLM barato mapea instrucción libre → temas  ⇒  StudyPlan
   CAPA 2 ORQUESTACIÓN (runner grafo TS, ~150 LOC, 0 deps)
       por target: retrieve → [synth|inquisitor|case|flashcard] → verify
                 → pass→dedupe→persist(study_items) ; fail(≤2)→regenerate ; fail>2→drop+log
   CAPA 3 MULTI-ÍNDICE   dense pgvector ✅ + léxico tsvector ➕ + estructurado ✅ + banco ítems ➕ ; fusión RRF
   CAPA 3.5 EVAL GATES   faithfulness, answer-correctness, distractor-quality, difficulty-cal, novelty/dedup, coverage
   CAPA 4 AGENTES        synth/inquisitor/case/flashcard (núcleo) + verifier/grader/planner (cierran el bucle)
```
Entrada de primera clase del Router = **estado del alumno** (mastery EMA, SRS vencidas, cercanía de
evaluación). Es lo que hoy se escribe y nunca se lee.

### 8.2 Mapeo a las capas que YA existen

```
app/api/study/[id]/route.ts          handler fino: encola job, devuelve banco   (+ ruta polling ➕)
lib/server/services/study.service.ts orquesta plan→worker→banco
lib/server/rag/                       NÚCLEO del cambio:
  ├─ study-gen.ts        → se PARTE en agents/* (deja de ser mega-llamada)
  ├─ orchestrator/       ➕ router.ts (C1) + runner.ts (C2) + state.ts
  ├─ agents/             ➕ synth/inquisitor/case/flashcard/verifier/grader/planner
  ├─ retrieval/          ➕ hybrid.ts (RRF dense+léxico)  (C3)
  └─ eval/               ➕ gates.ts  (C3.5)
lib/server/repositories/  study-items.repo ➕ ; chunk.repo (+léxico) ; study-stats/mastery → LEER ; job.repo (reusar)
lib/db.ts + schema.sql    study_items ➕ ; chunks.ts tsvector ➕
lib/llm/agent-models.ts   ➕ mapa rol→modelo (embeddings intacto)
estudio/page.tsx          separar modos reales (repaso/simulacro) + barra de progreso
```
Los agentes/grafo son **subcarpetas nuevas dentro de `lib/server/rag/`**, no una capa nueva. Dos
repos que hoy solo escriben (`study-stats`, `mastery`) empiezan a **leerse** — eso cierra el bucle.

### 8.3 Pasos de implementación

#### ✅ Paso 1 — Banco de ítems + dedupe + caché versionada (HECHO 2026-06-25)
Ataca la causa #1: *"se repite"*. Sin tocar embeddings. UI recibe `StudySet` igual.

| Archivo | Cambio |
|---|---|
| `schema.sql` | tabla `study_items` (banco + `embedding vector(1536)` + HNSW); cols `content_fingerprint`+`schema_version` en `study_sets`/`course_study_sets` |
| `study-items.repo.ts` (nuevo) | `insertDeduped` (dedupe coseno `<0.08` ⇔ sim>0.92), `listDedupeTexts` (seen), `listRecent` |
| `chunk.repo.ts` | `contentFingerprint` / `...ByCourse` (señal barata: `count + max(created_at)`) |
| `study.repo.ts` | caché **versionada**: devuelve set solo si `fingerprint`+`schema_version` coinciden |
| `study-gen.ts` | `temperature 0.2→0.7`; `excludeSeen` → directiva "ALREADY COVERED, no repitas"; `STUDY_SCHEMA_VERSION=2` |
| `study.service.ts` | cierra bucle: seen del banco → genera (excludeSeen) → embebe+dedupe→banco → arma set desde banco creciente |

Mecanismo anti-repetición (3 barreras): temp alta (diversidad) + `excludeSeen` (no regenera visto) +
dedupe por embedding (mata casi-idénticos). Editar/re-subir PDF cambia fingerprint → invalida caché.
**Pendiente activar:** `npm run db:migrate` (idempotente). Tests: 29 verdes, typecheck limpio.

#### ✅ Paso 2 — Multi-índice híbrido + recuperación por tema (HECHO 2026-06-25)
Ataca *"superficial / pierde material / `slice(0,24k)`"*. Cierra la "ironía RAG" en los generadores.

| Archivo | Cambio |
|---|---|
| `schema.sql` | `ALTER chunks ADD COLUMN ts tsvector GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED` + índice GIN `idx_chunks_ts` |
| `chunk.repo.ts` | `searchLexical` (ts_rank, trae `distance` real para reusar gate/rerank) + `searchByCourse` / `searchLexicalByCourse` (dense+léxico scoped a curso) |
| `rag/retrieval/hybrid.ts` (nuevo) | `rrfFuse` (RRF `Σ1/(k+rank)`, k=60, dedupe por id, puro) + `buildContextByTopics` (recupera top-K híbrido **por tema**, secciones con encabezado, cap 24k, fallback null) |
| `study.service.ts` | doc: recupera material por **labels del grafo** (+ focus topic al frente) vía `buildContextByTopics`, fallback a concatenado; course: recupera el focus topic across-curso, fallback concatenado |

Mecanismo: por cada tema → dense (`<=>`) **y** léxico (`tsvector`) → RRF → top-K; unión deduplicada
cubre todo el temario en vez de `slice(0,24k)`. El léxico rescata términos/fórmulas exactas que el
embedding pierde. **Pendiente activar:** `npm run db:migrate` (la columna `ts` se llena sola al crearse).

**No incluido en este paso (deliberado):**
- **Chat sigue igual** (`retrieval.service.ts` intacto): ya tiene rerank híbrido en memoria; migrarlo a
  tsvector+RRF es cambio aparte (R2/R3 para chat) y rompería sus mocks de test. Pendiente.
- **Course sin focus topic** sigue usando concatenado: no hay grafo de temas a nivel curso
  (multi-syllabus). Cubrir cuando exista targeting de curso (§8.5).
- **Reranker cross-encoder** (Cohere/Voyage) sobre top-N tras RRF: opcional, no hecho.

#### ✅ Paso 3 — Agentes separados + verifier (HECHO 2026-06-25)
Sube calidad y Bloom alto. Reemplaza la mega-llamada de `study-gen.ts`.

| Archivo | Cambio |
|---|---|
| `lib/llm/agent-models.ts` (nuevo) | `AgentRole` → `{provider,model,fallback}`, override por env (`MODEL_ROUTER…`), defaults OpenAI (corre con solo `OPENAI_API_KEY`); ids con `/` → OpenRouter (Claude/Gemini) |
| `rag/agents/_base.ts` (nuevo) | `runAgent`: OpenAI→json_schema strict; OpenRouter→texto+parse; valida zod; reintenta con fallback 1 vez |
| `rag/agents/flashcard.ts` | concepto→def + cloze |
| `rag/agents/inquisitor.ts` | quiz tipo examen, distractores plausibles (preset calidad) |
| `rag/agents/synth.ts` | summary + mindmap + studyGuide (faithful) |
| `rag/agents/verifier.ts` | valida respuesta correcta + distractores (familia distinta vía `MODEL_VERIFIER`) |

Cada agente: rol único, entrada anclada a evidencia, salida tipada+validada. Falla suave (`[]`/null).

#### ✅ Paso 4 — Orquestador (grafo) + eval gates (HECHO 2026-06-25)
| Archivo | Cambio |
|---|---|
| `rag/orchestrator/state.ts` (nuevo) | tipos `StudyPlan`, `TopicTarget` |
| `rag/orchestrator/runner.ts` (nuevo) | `orchestrateStudySet`: agentes en paralelo → gate verify → ensambla `StudySet` (mismo contrato que `generateStudySet`) |
| `rag/eval/gates.ts` (nuevo) | `verifyQuiz`: corre verifier por pregunta, descarta refutadas, `log` (sin caps silenciosos); fallo de infra no encoge el quiz |

Grafo: `evidence → ┬ flashcard ┬ inquisitor ┬ synth → verifyQuiz → assemble`. **Nota:** corre **inline**
en el request (igual que antes `generateStudySet`); mover al worker `jobs` + ruta `study/job/[jobId]`
de progreso queda pendiente (infra, no bloquea funcionalidad).

#### ✅ Paso 5 — Router adaptativo + Planner (HECHO 2026-06-25)
Ataca *"no es productiva"*. **Lee** mastery/SRS/cronograma (antes solo se escribían).

| Archivo | Cambio |
|---|---|
| `rag/orchestrator/router.ts` (nuevo) | `buildStudyPlan` lee `MasteryRepository` + `srsPressure` + `ScheduleRepository`; `scoreTargets` (puro): `priority = .3·peso + .3·(1−mastery) + .25·urgencia + .15·srs`; degrada a orden por peso si falla (guest/sin señales) |
| `rag/orchestrator/planner.ts` (nuevo) | `getTodaySession`: vencidas (`due_at<=now`) + ítems del banco ordenados por prioridad de tema |
| `study-stats.repo.ts` | ➕ `srsPressure`, `listDue` (ahora se **lee** el SRS) |
| `study.service.ts` | usa el Router para ordenar temas (débil/urgente/pesado primero) antes de recuperar |
| `app/api/study/session/route.ts` (nuevo) | `GET ?syllabusId=` → sesión adaptativa (usuarios reales) |

Tests: `scoreTargets` + `rrfFuse` (`tests/study-engine.test.ts`, 5 verdes). **UI pendiente:** wiring de
`estudio/page.tsx` a `/api/study/session` y separación real *Repaso*/*Simulacro* (no tocado para no
chocar con edición en curso del usuario).

### 8.4 Contratos clave (clavados en diseño)

- **`StudyPlan`**: `{ scope, targets[], agents[], budget, difficulty, retrieval, excludeSeen[] }`.
  `priority = .3·pesoExamen + .3·(1-mastery) + .25·urgencia + .15·lapsoSRS` (normalizado 0..1;
  `urgencia = clamp(1 - díasAlExamen/14, 0, 1)`). Tema nunca visto → mastery=0 → prioridad alta.
- **Clave de caché**: `(scope_kind, scope_id, difficulty, topic_key, contentFingerprint, schemaVersion)`.
- **Dedupe**: cosine sim `>0.92` (distancia `<0.08`) vs banco del mismo `(scope, type)` → descarta.
- **Bucle verify**: 2 reintentos máx; `fail>2` → drop + log; `coverage` re-encola temas faltantes 1 vez.
- **Progreso UI**: polling (no SSE) — el worker ya es async; menos código.

### 8.5 Abiertos (decidir al llegar a cada paso)

- Cupo de ítems por sesión: ¿fijo (~20) o adaptativo según tiempo del alumno? (cronograma no da "tiempo libre").
- Dedupe/banco: ¿per-user o compartido por curso? (hoy compartido por scope, NULL user_id).
- Course scope hereda bug: genera con `weightedTopics: []` — falta pesos a nivel curso (multi-syllabus).
- Verifier/grader: configurable por env desde el inicio (`MODEL_VERIFIER`); falta poblar `MODELS`
  (catálogo/pricing) con los ids OpenRouter para que `estimateCost` no registre $0.
- `grader` (recuerdo libre) y `case` (worked examples) definidos en el preset pero **sin agente aún**
  (no hay artefacto de respuesta abierta ni `cases` en el `StudySet`/UI).

### 8.6 Pendiente (infra / UI — no bloquea funcionalidad)

- **Mover orquestación al worker async** (`jobs` + `cron/process`) + ruta `study/job/[jobId]` de
  progreso. Hoy corre inline en el request (igual que antes); en Vercel la generación multi-agente
  puede acercarse al timeout en cursos grandes.
- **UI**: cablear `estudio/page.tsx` a `GET /api/study/session` (sesión adaptativa) y separar de
  verdad *Repaso* (vencidas) vs *Simulacro* (cronometrado + informe). Backend listo; falta consumo.
- **Chat híbrido**: migrar `retrieval.service.ts` a tsvector+RRF (hoy rerank léxico en memoria).
- **Poblar `MODELS`** con ids/precios OpenRouter del preset calidad (Claude/Gemini) para metering.
- **Reranker** cross-encoder (Cohere/Voyage) tras RRF, opcional.
