# Syllabus Navigator — Diagnóstico, Fixes y Despliegue

> Documento de **estado cambiante**. La referencia estable (estructura, dónde vive cada cosa)
> está en `CLAUDE.md`. Actualiza este archivo conforme avances.
> Última revisión: 2026-06-21.

---

## 1. Diagnóstico: el proyecto está en un "pivot a medias"

La lógica RAG **real** vive en Python (`backend/`, FastAPI + Chroma), pero la app que se
despliega es el **Next.js full-stack** (`frontend/`), que **ya no llama** a ese backend
(`src/lib/api.ts` → `"/api"` interno). Resultado: la UI existe, pero el núcleo del producto
(RAG sobre el sílabo + grafo) **no funciona** en el camino vivo.

| Función | Estado en el Next.js "vivo" | Evidencia |
|---|---|---|
| **Upload** | 🟥 Stub. No parsea el PDF, no hace chunks ni embeddings; guarda un registro con hash aleatorio. | `lib/server/services/document.service.ts:17-21` |
| **Chat** | 🟧 LLM plano con historial. **Sin retrieval**; `citations` siempre `[]`. | `lib/server/services/chat.service.ts` |
| **Grafo** | 🟥 La UI llama `GET /api/graph/{id}` pero **esa ruta no existe** → 404. | `api.ts#fetchGraph` + no hay `app/api/graph/` |
| **Vectores** | 🟥 No hay tabla de chunks/embeddings ni `pgvector` en el schema. Retrieval imposible hoy. | `src/lib/schema.sql` |
| **Auth / chats / UI / metering** | 🟩 Funciona. NextAuth, Neon, streaming SSE, usage, guardrails, rate limit. | — |
| **Grafo (schema)** | 🟩 Existen `topics` y `topic_dependencies`; falta poblarlos y servirlos. | `src/lib/schema.sql:90-111` |

**Conclusión:** la "cáscara" (auth, chat, UI, infra) está sólida; falta cablear el **RAG real**
y el **grafo** dentro de Next.js (o reconectar el FastAPI).

---

## 2. Decisión de arquitectura  *(CONFIRMADA — 2026-06-21)*

**Todo dentro de Next.js (Vercel). FastAPI se descarta como servicio; queda solo como referencia
de port.** Se revisó `backend/app/services/graph_gen.py` (la única razón posible para conservar
Python): son ~70 líneas estándar (OpenAI structured output + validación de ciclos por DFS),
trivial de portar. Toda la lógica Python (`chunking`, `ingestor`, `rag_engine`, `graph_gen`)
son llamadas al SDK de `openai` —que ya está en el front— + un vector store. Chroma era el único
atadero a Python y **Neon soporta `pgvector`**, así que desaparece.

| Criterio | Todo en Next.js ✅ | Next.js + FastAPI |
|---|---|---|
| Deploys a mantener | 1 (Vercel) | 2 (Vercel + Railway/Render) |
| Costo aprox. | Vercel + Neon + Upstash free ≈ $0 | + servidor Python 24/7 (~$5-7/mes) + volumen Chroma |
| Infra | Baja | Media (CORS, 2 entornos, secretos duplicados) |
| Esfuerzo de código | Portar RAG a TS (bajo, ver arriba) | Reusar Python, cablear proxy + deploy |

### Modelo de datos: una tubería, dos dueños

No hay dos sistemas. **El mismo pipeline** corre para todos; cuenta vs invitado son solo dos
columnas del registro (`expires_at`, `file_url`):

| | Cuenta (logueado) | Invitado (sin cuenta) |
|---|---|---|
| Dueño (`user_id`) | id real del usuario | id de sesión anónimo (cookie) |
| PDF original | Vercel Blob → `file_url` (persistente) | **no se guarda** el archivo crudo |
| Chunks/embeddings | en Neon, indefinidamente | en Neon, con `expires_at = now + 24h` |
| Limpieza | solo si el usuario borra | `cron/cleanup` los borra al expirar |

> ⚠️ Vercel es serverless y sin estado: no existe "sesión en memoria" del servidor entre
> peticiones. Para que el invitado pueda chatear sobre su PDF, los embeddings **sí** se guardan
> en Neon; lo efímero se logra con `expires_at` + el cron de limpieza, no con memoria de proceso.

**Upgrade invitado→cuenta** (ruta `auth/upgrade` ya existe): al registrarse, se "adoptan" sus
uploads efímeros con `UPDATE syllabus_uploads SET user_id = <real>, expires_at = NULL` → se
vuelven permanentes. Sin migración extra.

### Flujo compuesto (end-to-end)

```
                        ┌─────────── ¿logueado? ───────────┐
            CUENTA                                      INVITADO
   dueño = user_id real                       dueño = session_id anónimo (cookie)
   PDF → Vercel Blob (file_url)               PDF → NO se guarda
   expires_at = NULL (permanente)             expires_at = now + 24h (efímero)
                        └──────────────┬──────────────────┘
                                       ▼
         POST /api/upload  → crea syllabus_uploads(status='pending')
                          → encola job(type='ingest') → responde YA
                                       ▼
         WORKER (async, tabla jobs)  [mismo pipeline para ambos]
            extraer texto → chunks (overlap) → embeddings → tabla chunks(pgvector)
            status='processed'
            → graph_gen: topics + dependencies (sin ciclos) → graph_status='ready'
                                       ▼
         CHAT  POST /api/chat/[id]/messages
            si chat.syllabus_id:  embeber pregunta → similitud (embedding <-> q)
            → inyectar chunks como contexto → respuesta aterrizada + citations reales
                                       ▼
         LIMPIEZA  cron/cleanup → borra uploads con expires_at < now (chunks en cascada)
```

Decisiones cerradas: TTL invitado = **24 h**; procesamiento = **async vía tabla `jobs`**.

---

## 3. Fixes priorizados (para hacerlo funcional)

### P0 — RAG funcional end-to-end  *(✅ IMPLEMENTADO — 2026-06-21)*

Ajuste de diseño clave: como el worker corre **después** de responder el upload y el PDF de
invitado **no** se guarda, el **parseo + chunking se hace síncrono en el request** (rápido, sin
red) y el worker async solo hace lo caro (embeddings + grafo) leyendo el texto desde Neon. Así el
PDF crudo nunca se persiste para invitados; solo el texto derivado (que es lo que el RAG necesita).

1. ✅ **Schema** — `src/lib/schema.sql`: `CREATE EXTENSION vector`; tabla `chunks(... embedding
   vector(1536) ...)` + índice HNSW (`vector_cosine_ops`); `syllabus_uploads` +`file_url`/`expires_at`
   (con `ALTER ... ADD COLUMN IF NOT EXISTS` para despliegues existentes).
2. ✅ **Upload (fase 1, sync)** — `document.service.ts`: hash sha256 real → `pdfToPageChunks`
   (`unpdf`) → cuenta sube a Vercel Blob (`file_url`), invitado `expires_at=now+24h` →
   `createUpload(status='pending')` → `replaceChunksText` (texto sin embedding) → `enqueue('ingest')`.
   La ruta `upload/route.ts` ya **permite invitados** y dispara el worker (`triggerIngestionWorker`).
3. ✅ **Worker (fase 2, async)** — `ingestion.service.ts` (`runIngestJob`/`drainQueue`):
   embeddings batch (`text-embedding-3-small`) → `setEmbedding` → `status='processed'` → grafo
   (`rag/graph-gen.ts`, structured output + validación de ciclos) → `topics`/`topic_dependencies`
   → `graph_status='ready'`. Cola con claim atómico (`job.repo.ts`, `FOR UPDATE SKIP LOCKED`).
   Disparo: fire-and-forget `POST /api/cron/process` + cron de respaldo (fallback inline en dev).
4. ✅ **Retrieval en el chat** — `retrieval.service.ts` (port de `rag_engine.py`) cableado en
   `chat.service.ts` (`prepareMessages`, ambas rutas stream y no-stream): si `chat.syllabus_id`,
   embeber pregunta → `embedding <=> $q LIMIT 8` (`chunk.repo.search`) → inyectar contexto +
   prompt aterrizado → `citations` reales en el evento final del SSE y guardadas en `messages.citations`.
5. ✅ **Limpieza** — `cron/cleanup` borra `syllabus_uploads` con `expires_at < now` (chunks/topics
   en cascada).

> **Pendiente operativo:** crear el Blob store en Vercel y setear `BLOB_READ_WRITE_TOKEN` (sin él,
> el upload de cuentas funciona pero no guarda el PDF original — degrada con warning). `CRON_SECRET`
> es necesario para el disparo del worker en prod. El cron `/api/cron/process` está como **diario**
> en `vercel.json` (límite del plan Hobby); en Pro subirlo a `*/5 * * * *` o `0 * * * *`.

### P1 — Grafo
1. ✅ **`app/api/graph/[syllabusId]/route.ts` (GET)** — `GraphService.getGraph` (capa nueva en
   `lib/server/services/graph.service.ts`) verifica ownership vía `findByIdAndUser`, lee
   `GraphRepository.getGraph` y mapea a `GraphResponseAPI` (`topics→nodes`,
   `prerequisite/target→source/target`); `graph_status`/`graph_error` de `syllabus_uploads`.
2. ✅ **`app/api/graph/[syllabusId]/reprocess` (POST)** — `GraphService.reprocess` pone
   `graph_status='pending'` → re-encola `job('ingest')` → la ruta dispara `triggerIngestionWorker()`.
   Auth vía `requireAuth`; 404 si no es del usuario. Verificado runtime: 401 sin auth, 404 inexistente.
   Invitados permitidos (middleware no bloquea `/api/graph`). Typecheck OK.
   ✅ **Happy-path verificado (2026-06-21):** upload PDF de prueba → worker → `GET /api/graph`
   = 10 nodos / 12 edges; `POST .../reprocess` → pending → ready de nuevo (10/12).
3. ✅ **Interacciones del grafo en `GraphCanvas` (UI)** — implementadas: layout topológico por
   niveles (BFS), hover/click resaltan ruta de prerequisitos (morado) y sucesores (teal),
   doble-click manda el tema al chat (`queryTopicInChat`), MiniMap + Controls, estados
   pending/processing/failed con spinner y botón de reprocesar. P1 completo.

### P2 — Robustez
6. ✅ **Validar tamaño/tipo real del PDF + manejo de errores de procesamiento en la UI** *(2026-06-21)*.
   - **Tipo real (no MIME del cliente):** `document.service.ts` ahora verifica la firma mágica
     `%PDF-` en los bytes (`hasPdfMagic`, busca en los primeros 1KB) → 400 "This file is not a valid
     PDF". Añadido rechazo de archivo vacío (`file.size === 0`). El límite de 5MB ya existía.
   - **Cliente:** `knowledge/page.tsx#handleFileChange` pre-valida tipo/empty/5MB con toast antes de
     subir (evita el round-trip).
   - **Errores en la UI:** `listUploads` (repo) ahora devuelve `error_message`/`graph_error`;
     `SyllabusUploadAPI` los expone. Nuevo helper `getDocStatus` muestra estados ricos
     (Ready / Processing… / Building graph… / **Failed** / **Graph failed**) con tooltip del error real
     y botón **Retry** (`handleReprocessRow` → `reprocessGraph`) para filas en error/grafo-fallido.
   Typecheck OK.
7. ✅ **Job/cola async con reintentos + backoff** *(2026-06-21)*. La cola base (claim atómico
   `FOR UPDATE SKIP LOCKED`, recuperación de jobs stale a 10min) ya existía del P0 #3. Añadido lo
   que faltaba para PDFs grandes / fallos transitorios (rate-limit/timeout de OpenAI):
   - **Schema** (`schema.sql`): `jobs` + `attempts`, `max_attempts` (def 3), `scheduled_at` (con
     `ALTER ... ADD COLUMN IF NOT EXISTS` para deploys existentes) + índice `jobs_claim_idx`.
   - **`claimNext`** incrementa `attempts` al reclamar y solo toma pendientes con `scheduled_at <= now()`
     (así el backoff se respeta); orden `priority DESC, scheduled_at ASC, created_at ASC`.
   - **`fail`** re-encola a `'pending'` con backoff exponencial (`2^attempts` min) mientras
     `attempts < max_attempts`; al agotarse → `'failed'`. Flag `permanent=true` para errores
     irrecuperables (payload inválido) que no deben reintentar. Devuelve `{ retried }`.
   - **`drainQueue`** distingue `retried` de `failed` en contadores y logging.
   Typecheck OK; 28 tests verde.
8. ✅ **Tests de las rutas nuevas** (2026-06-21). Vitest (`npm test`, config `vitest.config.ts`,
   alias `@→src`). 16 tests en `frontend/tests/`: `graph.route` (GET/reprocess: 401/404/200,
   ownership scoped, re-enqueue + worker), `upload-id.route` (DELETE/PATCH: 401/404/400/200,
   `deleteDocument` scoped por `userId`), `usage.route` (401/200 + no fuga de error en 500),
   `chat.route` (DELETE IDOR scopeado por `user_id` + límite de 3 chats de invitado: 403/200/
   no-cap-para-no-invitados), `upload.route` (POST: 401/400 sin file/201 + worker + propagación de
   `ApiErrorResponse` del service). **28 tests, 5 archivos, todos verdes.** Mocks a nivel auth +
   repos/`sql` (sin DB real). Typecheck OK.
9. ✅ **Tests del route SSE `chat/[chatId]/messages`** (POST) *(2026-06-21)*. `messages.route.test.ts`
   (4 tests): 401 sin auth, 400 body inválido (falta `question`), 404 chat ajeno (service lanza
   `ApiErrorResponse`), 200 con `Content-Type: text/event-stream` + parseo del stream `data: {...}`
   → evento final con `title`/`citations`/`provider`/`model` y wiring `(chatId, userId, role, question)`.
   **Total ahora: 32 tests, 6 archivos, todos verdes.** Typecheck OK.
10. ✅ **CI GitHub Actions** *(2026-06-21)*. `.github/workflows/ci.yml`: en push a `main` y en cada PR
    corre `npm ci` → `tsc --noEmit` → `npm test` (Node 20, cache npm, working-dir
    `syllabus-navigator/frontend`). No requiere secrets (los 32 tests mockean auth/DB). El lockfile
    `package-lock.json` está trackeado, así que `npm ci` reproduce el árbol exacto.
11. ✅ **Más cobertura de tests** *(2026-06-21)*. `chat-detail.route.test.ts` (8): GET 401/404/200
    (chat+messages+count); PATCH 401/404/400-sin-campos/200 title/200 active_model. `auth.route.test.ts`
    (6): signup 429 rate-limit, 400 falta campos / email inválido / pass corta, 409 duplicado, 201
    crea user + prefs (email normalizado a lowercase). **Total: 46 tests, 8 archivos, todos verdes.**
    Typecheck OK.
12. ✅ **Prep deploy** *(2026-06-21)*. Auditado cron auth (Vercel inyecta `Bearer CRON_SECRET`),
    worker-trigger y build config. Acciones: (a) `.env.example` + `BLOB_READ_WRITE_TOKEN` y nota de
    que `CRON_SECRET` también arma el worker; (b) **`DEPLOY_CHECKLIST.md`** nuevo (pre-flight
    accionable: Neon/pgvector, Vercel root-dir, env vars req/opt, crons Hobby vs Pro, smoke test);
    (c) **`npm run build` verde** — 21 rutas + 4 páginas (si sale `PageNotFoundError /_document`,
    limpiar `.next`: cache vieja). Falta solo lo que requiere tu acceso a Vercel/Neon (crear
    proyectos, setear secrets, deploy real).

---

## 4. Plan de despliegue (Vercel + Neon + Upstash)

1. **GitHub:** el repo ya existe (`origin → ReLichtyy/Navigator`). Mantener `main` limpio.
2. **Neon:** crear proyecto Postgres, habilitar `pgvector`, copiar `DATABASE_URL` (pooled) y
   `DATABASE_URL_DIRECT`. Ejecutar `npm run db:migrate`.
3. **Upstash (opcional):** crear Redis, copiar `UPSTASH_REDIS_REST_URL` / `_TOKEN`. Sin esto,
   cache y rate-limit usan memoria (se reinician en cold start).
4. **Vercel:** New Project → repo. **Root Directory = `syllabus-navigator/frontend`**.
   Framework Next.js autodetectado. Build = `vercel-build`.
5. **Env vars en Vercel:** `AUTH_SECRET`, `NEXTAUTH_URL` (la URL de Vercel), `DATABASE_URL`,
   `DATABASE_URL_DIRECT`, `OPENAI_API_KEY`, `CRON_SECRET` (worker + cleanup), y opcionales
   (`OPENROUTER_API_KEY`, Upstash, `BLOB_READ_WRITE_TOKEN` para persistir PDFs de cuentas).
   Crear el Vercel Blob store (Storage → Blob) genera `BLOB_READ_WRITE_TOKEN`.
6. **Deploy** → URL pública. Verificar `GET /api/health`.
7. **Crear el primer usuario** (signup en la UI) y probar el smoke test.

> El FastAPI **no** se despliega en este camino. (Los docs antiguos
> `docs/vercel-deployment-plan.md` e `integracion_plan.md` describen la arquitectura de 2
> servicios — quedan como histórico.)

### Smoke test  *(✅ pasado en local 2026-06-21; repetir post-deploy)*
- [x] Signup / login (sesión invitado) funciona.
- [x] Subir un PDF → status `processed` (no error).
- [x] Chat sobre el PDF → respuesta aterrizada con `citations` reales (chunk del PDF).
- [x] Ver el grafo → 10 nodos / 12 edges (no 404).

---

## 4.bis Hallazgos de auditoría del frontend (2026-06-21)

Revisión de `lib/server/*`, `lib/auth/*`, `lib/llm/*`, `lib/cache/*`, `lib/guardrails/*`,
rate-limit, metering y rutas `app/api/*`. Lo verificado en código:

### 🔴 Bugs / seguridad — ✅ ARREGLADOS (2026-06-21, typecheck OK)
1. ✅ **IDOR — borrado de mensajes ajenos.** `app/api/chat/[chatId]/route.ts` (DELETE) ejecutaba
   `DELETE FROM messages WHERE chat_id = ${chatId}` **sin verificar dueño**.
   *Resuelto:* ahora solo se borra el chat scopeado por `user_id` (`RETURNING id` → 404 si no es
   suyo); los mensajes caen por `ON DELETE CASCADE`. Se eliminó el `DELETE FROM messages` suelto.
2. ✅ **Los invitados no podían crear chats.** `chat.repo.ts` → `countChats` usaba
   `WHERE user_id = ${userId}::uuid` contra una columna **TEXT** → `operator does not exist: text = uuid`.
   *Resuelto:* se quitó el `::uuid` (comparación TEXT = TEXT, como el resto de queries de chats).
3. ✅ **Cron destructivo público si faltaba `CRON_SECRET`.** `cron/cleanup` solo validaba
   `if (cronSecret && ...)`.
   *Resuelto:* ahora **falla cerrado** (500) si `CRON_SECRET` no está seteada, y se agregó la
   variable a `frontend/.env.example`.

### 🟠 Calidad / riesgo
4. ✅ **Dos implementaciones de rate-limit en conflicto.** La huérfana `lib/rate-limit/index.ts` ya
   no existe; queda solo `lib/rate-limit.ts` (Upstash). Resuelto.
5. ✅ **`deleteDocument` no filtra por `userId`** (`document.repo.ts`). *Resuelto (2026-06-21):*
   `deleteDocument(docId, userId)` ahora hace `AND user_id = ${userId}` (defensa en profundidad);
   la ruta `upload/[id]` pasa el `userId`.
6. ✅ **Rate limit efectivamente off sin Upstash** *(2026-06-21)*. Antes `rate-limit.ts` devolvía
   `success: true` (allow-all) sin Redis y también ante error de Redis. *Resuelto:* añadido fallback
   `inMemoryLimit` (sliding window de 60s en memoria de proceso) que ahora se usa en ambos casos
   (Redis ausente / llamada fallida) en vez de allow-all. Mismos límites por tier (anon 5 / guest 10 /
   auth 100 rpm). Limpieza oportunista del Map (>5000 claves) para no crecer sin límite.
   ⚠️ Best-effort: en Vercel es por-instancia y se reinicia en cold start → no frena un flood
   distribuido, pero sí un burst contra una instancia caliente. Upstash sigue siendo lo recomendado
   en prod. Typecheck OK.
7. ✅ **Fuga de detalles de error al cliente.** *Resuelto (2026-06-21):* `usage/route.ts` y
   `user/preferences/route.ts` ya no devuelven `details: err.message` en el 500 (el error sigue en
   `logError` server-side). `health` mantiene `detail` a propósito (endpoint de diagnóstico ops).

### 🟡 Menores
8. ✅ **`await` innecesario sobre `recordUsage`** *(2026-06-21)*. `recordUsage` es `void`
   (fire-and-forget, maneja sus errores con `.catch`). Quitado el `await` en los dos sitios de
   `chat.service.ts` (rutas stream y no-stream). Sin cambio de comportamiento; refleja la intención
   fire-and-forget. Typecheck OK.
9. ✅ `MessageRequestSchema.activeModel` se validaba pero no se usaba. *Resuelto (2026-06-21):*
   campo eliminado del schema; el modelo se toma de `chat.active_model` server-side (zod descarta
   claves extra, así que clientes que aún lo manden no rompen).
10. ✅ **Cada login de invitado insertaba una fila nueva en `users`** *(2026-06-21)*. *Resuelto:*
    identidad de invitado **estable y reutilizable**:
    - **Cliente** (`auth-modal.tsx`): genera/persiste `navigator_guest_id` en `localStorage` y lo manda
      como credencial `guestId`. Si ya hay sesión (`guest`/`authenticated`) no vuelve a crear identidad
      (cierra el modal). Degrada bien si `localStorage` no está (modo privado).
    - **Server** (`auth.ts`): si llega un `guestId` UUID válido, busca el guest existente
      (`guest-<id>@navigator.local`) y lo **reutiliza** (verifica ownership con `bcrypt.compare`) en
      vez de insertar. INSERT con `ON CONFLICT (email) DO NOTHING` + relectura ante carrera; prefs con
      `ON CONFLICT (user_id) DO NOTHING`.
    Efecto: clicks repetidos / pérdida de cookie / múltiples pestañas en la ventana de 24h ya no
    multiplican filas. El cron 24h sigue limpiando guests viejos (al reaparecer se re-crea con el mismo
    id). Typecheck OK; 46 tests verde.
11. ✅ **Badge de estado nunca se ponía verde + tipos mentían.** *Resuelto (2026-06-21):* la página
    `knowledge` comparaba `doc.status === "ready"`, pero el worker setea `'processed'` → el badge
    quedaba en "pulse" infinito. Causa raíz: `SyllabusUploadAPI` declaraba uniones equivocadas
    (`status`/`graph_status` mezclados). Corregido a los valores reales: `status` =
    `pending|processed|error`; `graph_status` = `pending|processing|ready|failed`. Typecheck OK.

---

## 4.ter Mejoras de funcionalidad + config (2026-06-22)

Verificado primero el estado real: typecheck OK, 50 tests verde, `npm run build` OK (24 rutas),
DB Neon viva (pgvector ON, 14 tablas, datos reales: 13 chunks / 2 uploads / 3 users),
`/api/health` ok (DB+LLM+cache), auth gating ok (401). El núcleo **funciona**.

Cambios aplicados:
1. ✅ **Gate de relevancia en RAG** (`retrieval.service.ts`). `ChunkRepository.search` ya devolvía
   `distance` pero se ignoraba → preguntas off-topic inyectaban igual el top-8 (ruido →
   alucinación). Ahora: si el chunk más cercano supera `MAX_DISTANCE` → **sin contexto**; los chunks
   borderline de la cola también se descartan. Umbral **0.9** tuneado contra datos reales (sílabo en
   español): on-topic ~0.65-0.84, off-topic ~0.94+ (`What is the capital of France?` = 0.967,
   `best pizza recipe` = 0.942). Override `RAG_MAX_DISTANCE`. Tests nuevos: `retrieval.service.test.ts` (4).
2. ✅ **No-context cableado** (`chat.service.ts`). `NO_CONTEXT_MESSAGE` estaba definido pero sin usar:
   en chat con sílabo y sin contexto relevante, el modelo respondía de conocimiento general pese al
   prompt "usa solo el contexto". Ahora se le instruye declinar con el mensaje fijo (sin citations).
3. ✅ **Config `DATABASE_URL_DIRECT`** apuntaba al host `-pooler` (igual que el pooled). Corregido al
   endpoint directo (sin `-pooler`); verificado reachable. `.env.example` aclara pooler vs directo y
   documenta `RAG_MAX_DISTANCE`. (Nota: `migrate.mjs` usa `DATABASE_URL`, y el driver HTTP de Neon
   tolera el pooler, así que el bug era cosmético — corregido por corrección.)

**Total tests: 50, 9 archivos, todos verdes.** Typecheck OK.

> **Pendiente operativo (requiere tu acceso):** crear Vercel Blob store → `BLOB_READ_WRITE_TOKEN`
> (sin él los PDFs de cuenta no se persisten, degrada con warning) y el deploy real a Vercel/Neon prod.

## 4.quater Schedule-aware chat + GPT-5.5 fix (2026-06-22)

Objetivo del usuario: el chat debe responder en cualquier momento sobre **quizes/exámenes de la
semana** y **qué temas se ven por semana** según el cronograma del knowledge base, a través de
**varios cursos**; arreglar GPT-5.5; mind map editable + recomendaciones dinámicas; expandir la app.

Hecho este turno:
1. ✅ **GPT-5.5 arreglado** (`lib/llm/providers/openai.ts`). Causa real (verificada contra la API):
   los modelos GPT-5 / o-series rechazan `max_tokens` (requieren `max_completion_tokens`) y solo
   aceptan `temperature` por defecto (1). Nuevo `buildParams()` arma los params por familia de modelo
   (`isNextGenModel` = `^(gpt-5|o[134])`), aplicado a chat y stream. Test: `openai.provider.test.ts` (3).
   Verificado: `gpt-5.5-2026-04-23` responde OK.
2. ✅ **Extracción de cronograma** (`rag/schedule-gen.ts`, structured output). Corre en el worker
   (`ingestion.service`, best-effort tras el grafo) → tabla nueva `schedule_events`
   (`schema.sql`: type/title/date ISO opcional/week_label/weight, `user_id` denormalizado para agenda
   multi-curso). Repo `schedule.repo.ts`. Verificado: extrajo 8 eventos del sílabo real (temas
   "Semana 3", sin inventar fechas).
3. ✅ **Chat consciente del cronograma** (`chat.service.ts`). `prepareMessages` ahora recibe `userId` e
   inyecta `Hoy es <fecha>` + **agenda de TODOS los cursos del usuario** (no solo el sílabo ligado al
   chat) en el system prompt → responde "qué temas/quizes esta semana" en cualquier chat. E2E
   verificado con gpt-5.5: lista correcta de temas de la semana + curso.
4. ✅ **API `GET /api/schedule`** (`schedule.service.ts` + route) — agenda del usuario, o
   `?syllabusId=` para el cronograma de un curso. Adaptadores `fetchAgenda`/`fetchSchedule` en `api.ts`.
5. ✅ **RAG no-context** ya no bloquea preguntas de agenda (se responde desde la agenda inyectada).

**Total tests: 53, 10 archivos, verdes.** Typecheck OK. `npm run build` OK (25 rutas).

### ✅ Las 4 features pedidas — IMPLEMENTADAS (2026-06-22)
1. ✅ **Retrieval de contenido multi-curso.** `chunk.repo#searchByUser` (join chunks→uploads por
   `user_id`) + `RetrievalService.retrieveForUser`. En `chat.service`: chat **sin** sílabo ligado ahora
   recupera contenido de TODOS los cursos del usuario; las citations llevan `source_name` (qué curso).
2. ✅ **Vista Agenda** (`app/agenda/page.tsx` + nav en `app-sidebar`). Panel "Esta semana"
   (evaluaciones próximas + temas) y agenda completa agrupada por curso. Consume `/api/schedule` +
   `/api/recommendations`.
3. ✅ **Recomendaciones dinámicas** (`recommendation.service.ts` + `/api/recommendations`). Cruza
   `schedule_events` con el grafo de prereqs (`graph.repo#listUserTopicsWithPrereqs`): evaluaciones
   próximas (días restantes) + "Repasa primero: A, B" (prereqs del tema que hace match con el título)
   + temas de la semana (rango lunes-domingo). SQL verificado en vivo.
4. ✅ **Mind map editable** (`GraphCanvas` → `EditableGraph` con `useNodesState/useEdgesState`):
   add/rename/delete nodos, conectar aristas (drag handle), guardar. Backend: `PATCH /api/graph/[id]`
   → `GraphService.updateGraph` (ownership + validación de ciclos + `replaceGraph`), schema
   `GraphUpdateSchema`, adapter `updateGraph`. Activado en el modal de preview de Knowledge. 5 tests
   PATCH (401/404/400-body/400-ciclo/200).

**Total tests: 58, 10 archivos, verdes.** Typecheck OK. `npm run build` OK (27 rutas + /agenda).

### Notas / siguientes
- Resolución de fechas "Semana N": pendiente decidir (term-start por curso vs semana relativa). Hoy
  el chat razona por week_label cuando no hay fecha ISO.
- Editable map: persiste topología, no posiciones (el layout se recalcula). Tras guardar, ids nuevos.
- Falta tests UI (agenda/GraphCanvas edit) y de `searchByUser`/recommendation.service (cubiertos por
  typecheck + verificación SQL en vivo).

## 4.quinquies Build de ventanas desde el diseño "Navigator" (2026-06-22)

Tickets completos en **`TICKETS.md`** (raíz). Estándar: shadcn/ui + tokens semánticos de Tailwind
(nada de hex hardcodeado del mockup → funciona en light/dark). Implementado este turno:

1. ✅ **Study OS — backend.** `study_sets` (schema.sql, cascada por upload) + `rag/study-gen.ts`
   (structured output → flashcards/quiz/summary/mindmap, con `normalizeStudySet` pura y testeable) +
   `study.repo.ts` (get/upsert cache) + `StudyService.getStudySet` (ownership vía `findByIdAndUser`,
   genera desde `ChunkRepository.getConcatenatedText`, 409 si no hay material) +
   `GET /api/study/[syllabusId]` (`?refresh=1` regenera) + adapters `fetchStudySet`/tipos en `api.ts`.
2. ✅ **Ventana "Área de Estudio"** (`app/estudio/page.tsx` + `src/components/estudio/*`): course
   picker (cursos `processed`), grid de 6 modos, y sub-vistas **Flashcards/Repaso** (flip, teclado
   ←/→/espacio), **Quiz/Simulacro** (MCQ con score/explicación/resultados), **Mapa mental** y
   **Resumen** (Regenerar = refresh). Deep-link `?course=&mode=`. Gating anon/guest.
3. ✅ **Sidebar**: nuevo item `Área de Estudio` (`/estudio`, `GraduationCap`).
4. 🟧 **Agenda**: añadido `MonthCalendar` (grid mensual lunes-inicio, dots por curso, navegación de
   mes, lista "Fechas detectadas") sobre los `schedule_events` con fecha ISO. Helpers puros
   `bucketEventsByDate`/`courseColorIndex`.

**Tests: 74 (16 nuevos: study route 6, study-gen 6, calendar 4), 13 archivos, verdes.** Typecheck OK.
`npm run build` OK (`/estudio` + `/api/study/[syllabusId]` presentes).

> **Pendiente operativo:** correr `npm run db:migrate` para crear `study_sets` en Neon (idempotente,
> `CREATE TABLE IF NOT EXISTS`) antes de usar el Área de Estudio en vivo. Sin la tabla, el route da 500.
> **Diferido a propósito (ver TICKETS.md B2):** widget de racha/XP (no hay modelo de progreso real;
> mostrar un número falso es peor que omitirlo). Falta tests de render UI de `/estudio` (sub-vistas
> cubiertas por typecheck + build; lógica pura por unit tests).

## 4.sexies Diseño "Navigator" — gaps cerrados + DB live (2026-06-23)

Hallazgo: el diseño nuevo (6 pantallas) ya estaba **implementado y commiteado** (commits
`design`), typecheck OK + 162 tests verde. El bloqueo real era **operativo**: la DB Neon viva
no tenía 3 tablas (`date_notes`, `study_sets`, `flashcard_reviews`) → Agenda-notas, Área de
Estudio y Modo repaso daban 500 en prod. Corrido `npm run db:migrate` (idempotente, 42 OK);
round-trip de `date_notes` (insert/read/delete) verificado contra Neon real.

Tres deltas vs los mockups, decididos con el usuario e implementados este turno:
1. ✅ **Notas en Agenda — marcador + expansión inline.** `date_notes.repo#listDates` +
   `GET /api/notes?dates=1` + adapter `listNoteDates`. El grid marca con ícono los días con
   notas (`MonthCalendar` props `noteDates`/`selectedDate` + slot `dayPanel`). El editor de
   notas dejó de ser un `Sheet` lateral: ahora es **`DayNotesPanel` inline** que se expande
   dentro de la tarjeta del calendario (sin layout nuevo). Marcadores se sincronizan al
   crear/borrar (`onCountChange`). `day-notes-sheet.tsx` eliminado.
2. ✅ **Chat — tarjeta contextual "Crear simulacro".** `ChatThread` carga la evaluación más
   próxima (`fetchRecommendations` + `fetchAgenda`, fail-silent) y, si la última respuesta del
   asistente menciona una evaluación (`ASSESSMENT_RE`), muestra una tarjeta con link a
   `/estudio?course=<id>&mode=simulacro` del curso correcto.
3. ✅ **`/mapa` editable.** Pasó de `MindView` (read-only, study-set) al **`GraphCanvas`
   editable** (xyflow) sobre el grafo de topics: add/rename/delete/conectar/guardar
   (`PATCH /api/graph/[id]`) + reprocesar. Decisión del usuario: editable > matchear el mockup
   estático.

Tests nuevos: `notes.route` (?dates=1: 200/401), `date-notes.repo` (listDates scoped),
`ui-compliance` (mapa usa GraphCanvas editable). **Total: 165 tests, 21 archivos, verde.**
Typecheck OK. `npm run build` OK (21 rutas + 5 páginas).

## 4.septies Chat tools + Estudio (dificultad/tema) + flashcards + mapa fluido (2026-06-23)

Objetivo del usuario: herramientas en el chat; en Área de Estudio escoger **dificultad** y
opcionalmente un **tema** (con recomendaciones del cronograma); rehacer las **tarjetas
dinámicas** (poco intuitivas); **mapa mental más fluido** + **seleccionar texto → preguntar al
chat**. Implementado:

1. ✅ **Estudio — dificultad + tema.** `study-gen.ts` ahora acepta `StudyGenOptions
   {difficulty: facil|medio|dificil, topic?}` → `buildDirectives()` (pura, testeada) inyecta el
   nivel y un bloque FOCUS al prompt. `StudyService.getStudySet` pasa los opts y **solo cachea el
   set canónico** (medio, curso completo); todo set custom (dificultad≠medio o con tema) se genera
   fresco y NO clobbea el cache. Route `GET /api/study/[id]` parsea `?difficulty=&topic=`
   (difficulty inválida se ignora). `fetchStudySet(id, {refresh,difficulty,topic})` (firma cambió
   de boolean a objeto; único caller actualizado: `/estudio`).
2. ✅ **Estudio UI.** Panel de config en el menú: pills Fácil/Medio/Difícil + selector "Tema
   (opcional)" que despliega chips de **temas del cronograma** (`fetchSchedule(courseId)` event
   titles + labels del mind map, deduped). Cambiar dificultad/tema regenera el set. Reset a
   medio/sin-tema al cambiar de curso.
3. ✅ **Flashcards rediseñadas** (`flashcards-view.tsx`). Flujo claro: ver concepto → "Mostrar
   respuesta" (flip 3D real con `[transform-style:preserve-3d]`/`backface`) → auto-evaluar
   "No la sé / La sé" (graba review). Botones de grade solo tras voltear. Barra de progreso,
   pantalla de **resumen de sesión** (sabidas / para repasar + reiniciar). Teclado: espacio
   voltear, ←/→ navegar, 1/2 calificar.
4. ✅ **Mapa mental — selección→chat + fluidez.** Nuevo `SelectionAsk` (wrapper) muestra botón
   flotante "Preguntar al chat" sobre cualquier texto seleccionado dentro del mapa → setea
   `pendingQuery` y navega a `/` (ChatContext lo envía al montar). Labels de nodo marcados
   `nodrag select-text` para poder seleccionarlos sin arrastrar. ReactFlow read-only: `panOnScroll`,
   `fitViewOptions` con duración, `zoomOnDoubleClick=false` (doble-click sigue = estudiar tema).
5. ✅ **Chat tools** (`chat-composer.tsx`). Botón ✨ con menú de acciones rápidas que mandan
   prompts listos: "¿Qué tengo esta semana?", "Resume el curso", "Quiz rápido", "Temas y su peso".

Tests nuevos: `study.route` (difficulty+topic passthrough, difficulty inválida), `study-gen`
(buildDirectives: default/hard/focus/blank). **Total: 171 tests, 21 archivos, verde.** Typecheck
OK. `npm run build` OK.

## 4.octies Estudio: dificultad dinámica + tema semanal + rename de cursos (2026-06-23)

Feedback del usuario sobre 4.septies: la dificultad "no es dinámica" (no cambiaba); el tema
opcional debe dar **3 opciones de la semana actual** del curso elegido + opción **General**,
elegante e inline; y poder **renombrar cursos** sin cambiar la referencia (id).

1. ✅ **Dificultad dinámica — causa raíz.** Cada click de dificultad llamaba `loadSet` →
   `setSet(null)` → el panel de config (con las pills) se desmontaba a un spinner de pantalla
   completa, y `medio` volvía instantáneo desde cache → parecía "no cambia". *Fix:* dificultad y
   tema son ahora **selecciones instantáneas** (solo estado, sin regenerar). El set se regenera
   **al lanzar un modo** (`launchMode`) solo si `loadedKey !== paramKey(difficulty, topic)`. Así la
   selección es inmediata/visible y la generación con la dificultad elegida ocurre al entrar al modo.
2. ✅ **Tema = General + 3 de la semana** (`src/lib/ui/week-topics.ts`, puro+testeado).
   `pickWeekTopics(events, {today,weekStart,weekEnd}, 3)` prioriza eventos del curso dentro de la
   semana actual → próximos más cercanos → resto, dedup por título. La UI muestra chips inline
   `General` + 3 temas (componente `TopicChip` elegante; General = todo el curso). Datos:
   `fetchSchedule(courseId)` + `fetchRecommendations()` (rango de semana). 5 tests nuevos.
3. ✅ **Rename de cursos** en el course-picker de `/estudio`: doble-click o lápiz → input inline
   con guardar/cancelar. Usa `renameDocument(id, name)` (PATCH `/upload/[id]`) que cambia
   `original_filename` pero **no el id** → la referencia no cambia. Estado local de `courses` se
   actualiza in-place.

**Total: 176 tests, 22 archivos, verde.** Typecheck OK. `npm run build` OK.

## 5. Preguntas abiertas
- ✅ *(2026-06-23)* **Todo en Next.js, confirmado.** FastAPI `backend/` se **borra del todo**
  (git rm) en el Sprint LIMPIEZA — queda en el historial git si se necesita. Mismo trato para los `docs/`
  del plan de 2 servicios.
- ¿El FastAPI sigue desplegado en Railway con datos que haya que migrar, o ya está apagado?
  *(verificar antes de borrar; si hay datos vivos, exportarlos primero)*
- ¿Blob store preferido para los PDFs (Vercel Blob vs S3)?

---

## 6. Sprints (quirúrgicos) — estado a 2026-06-23

> Re-diagnóstico (2026-06-23): typecheck limpio, **184 tests verde** (23 archivos),
> `npm run build` OK (27 rutas + 6 páginas). El núcleo RAG/grafo/estudio/agenda **funciona**.
> `CLAUDE.md` se actualizó este turno para reflejar la realidad (rutas graph/schedule/study/notes,
> chunks+pgvector, páginas agenda/estudio/mapa, dirs `rag/`+`storage/`, vars nuevas). Lo que queda
> es **operativo** (deploy) y **deuda técnica** (sin tooling de formato/lint, FastAPI muerto, gaps
> de tests). Cada sprint abajo es de alcance cerrado: archivos concretos + criterio de aceptación.

### Sprint OPS — Deploy a producción  *(BLOQUEADO: requiere tu acceso Vercel/Neon)*
Alcance: poner la app viva. Todo el código ya está listo (`DEPLOY_CHECKLIST.md` tiene el detalle).
- [ ] Neon prod: crear proyecto, `CREATE EXTENSION vector`, copiar `DATABASE_URL` (pooled) +
      `DATABASE_URL_DIRECT` (directo, **sin** `-pooler`). Correr `npm run db:migrate`.
- [ ] Vercel: New Project, **Root Directory = `syllabus-navigator/frontend`**, build `vercel-build`.
- [ ] Env vars req: `AUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `DATABASE_URL_DIRECT`,
      `OPENAI_API_KEY`, `CRON_SECRET`. Opc: `BLOB_READ_WRITE_TOKEN` (Storage→Blob), Upstash,
      `OPENROUTER_API_KEY`, Google OAuth.
- [ ] Smoke test post-deploy (mismo checklist del §3): `/api/health` 200 → signup → upload→processed
      → chat con citations reales → grafo 10/12 (no 404).
- **Aceptación:** los 4 ítems del smoke test pasan en la URL pública.

### Sprint LIMPIEZA — Higiene: formato + código muerto  *(autónomo, sin tu acceso)*
Hoy **no hay tooling de formato ni lint** (sin prettier, eslint, knip en `package.json`) → estilo
inconsistente y no se detecta código no usado. Alcance cerrado:
- [ ] Añadir **Prettier** (`.prettierrc` + `npm run format` / `format:check`) y correr `--write` una
      vez sobre `src/`+`app/` (commit de formato **separado** del resto para diffs limpios).
- [ ] Añadir **ESLint** con `eslint-config-next` (`npm run lint`); arreglar errores reales, no warnings de estilo (eso lo cubre Prettier).
- [ ] Añadir **`knip`** (o `ts-prune`) como dev-dep → listar exports/archivos no usados. Borrar los
      confirmados muertos. Ya detectado a mano: `CLAUDE.md` citaba `ChatPanel`/`FileUpload`
      (ya no existen — doc corregido); verificar que no queden más huérfanos.
- [ ] **FastAPI `backend/` (354K, 0 llamadas desde el front): BORRAR** *(decidido 2026-06-23)*.
      `git rm -r syllabus-navigator/backend` + `docs/*.md` del plan de 2 servicios + `scripts/bulk_ingest.py`
      (tooling del backend) + el servicio `backend` de `docker/docker-compose.yml`. Antes de borrar:
      verificar que el FastAPI de Railway no tenga datos vivos que migrar (pregunta abierta §5).
      Después: purgar referencias muertas en `CLAUDE.md`/`README.md` (la sección "dos backends").
- [ ] (Opc) Wire los nuevos scripts en CI (`.github/workflows/ci.yml`): `lint` + `format:check`.
- **Aceptación:** `format:check` limpio, `lint` sin errores, `knip` con 0 huérfanos (o documentados),
      **typecheck + 184 tests siguen verdes**, `npm run build` OK. Sin cambios de comportamiento.

### Sprint COBERTURA — Cerrar gaps de tests  *(autónomo)*
Notas del §4.quater/quinquies marcan paths sin cobertura. Alcance:
- [ ] Unit: `chunk.repo#searchByUser` (scoping por `user_id`), `recommendation.service`
      (cruce schedule×prereqs, rango de semana).
- [ ] Render UI: sub-vistas de `/estudio` (flashcards flip, quiz score), `/agenda` (calendario +
      notas inline), edición de `GraphCanvas`/`EditableGraph` (add/rename/connect/save).
- **Aceptación:** tests nuevos verdes, total > 184; typecheck OK.

### Sprint WORKER — Cadencia del worker + resolución de fechas  *(mixto)*
- [ ] `vercel.json`: los crons están **diarios** (`0 0 * * *`, límite Hobby). El worker real se
      dispara fire-and-forget en cada upload (`triggerIngestionWorker`), así que el cron es solo
      respaldo — **documentar esto** y, si subes a Vercel Pro, poner `cron/process` en `*/5 * * * *`.
- [ ] "Semana N" → fecha: hoy el chat razona por `week_label` cuando no hay fecha ISO. Decidir
      modelo (term-start por curso vs semana relativa) y, si se elige term-start, añadir columna
      `courses.term_start` + resolver en `recommendation.service`. **Requiere tu decisión de producto.**
- **Aceptación:** comportamiento del worker documentado; (si se aborda) fechas "Semana N" resuelven a
      fecha real en agenda/recomendaciones.
