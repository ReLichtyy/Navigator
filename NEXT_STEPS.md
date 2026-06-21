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

## 5. Preguntas abiertas
- ¿Confirmamos "todo en Next.js" o conservamos FastAPI?
- ¿El FastAPI sigue desplegado en Railway con datos que haya que migrar, o ya está apagado?
- ¿Blob store preferido para los PDFs (Vercel Blob vs S3)?
