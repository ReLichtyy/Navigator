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
3. ⏳ Interacciones del grafo en `GraphCanvas` (UI) — único pendiente de P1.

### P2 — Robustez
6. Validar tamaño/tipo real del PDF, manejo de errores de procesamiento en la UI.
7. Job/cola para procesamiento asíncrono (la tabla `jobs` ya existe) si los PDFs son grandes.
8. Tests de las rutas nuevas.

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
4. **Dos implementaciones de rate-limit en conflicto.** `lib/rate-limit.ts` (la que realmente se
   resuelve y usa Upstash) vs `lib/rate-limit/index.ts` (huérfana, tiers distintos, dice estar
   "integrada en middleware" pero no lo está). Frágil: borrar el `.ts` cambiaría el comportamiento
   en silencio. *Fix:* eliminar la huérfana.
5. **`deleteDocument` no filtra por `userId`** (`document.repo.ts`). Hoy mitigado porque la ruta
   verifica ownership antes, pero falta defensa en profundidad. *Fix:* añadir `AND user_id = ...`.
6. **Rate limit efectivamente off sin Upstash.** `rate-limit.ts` devuelve `success: true` cuando no
   hay Redis. En Vercel sin Upstash no hay límite real (salvo el de 3 chats por invitado). A saber.
7. **Fuga de detalles de error al cliente.** P. ej. `usage/route.ts` devuelve `details: err.message`
   en el 500. *Fix:* no exponer mensajes internos en producción.

### 🟡 Menores
8. `recordUsage` es `void` (fire-and-forget) pero se le hace `await` en `chat.service.ts` (inocuo).
9. `MessageRequestSchema.activeModel` se valida pero no se usa.
10. Cada login de invitado inserta una fila nueva en `users` (crecimiento; mitigado por el cron 24h).

---

## 5. Preguntas abiertas
- ¿Confirmamos "todo en Next.js" o conservamos FastAPI?
- ¿El FastAPI sigue desplegado en Railway con datos que haya que migrar, o ya está apagado?
- ¿Blob store preferido para los PDFs (Vercel Blob vs S3)?
