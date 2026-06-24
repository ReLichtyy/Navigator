# Bug Report — Syllabus Navigator

> Registro acumulativo de bugs/errores encontrados en funcionalidades y módulos.
> Cada entrada: **severidad · ubicación · qué · por qué puede ser dañino · fix sugerido**.
> Añade al final; no borres entradas resueltas, márcalas `✅ RESUELTO`.

Severidad: 🔴 alta · 🟠 media · 🟡 baja.

---

## BUG-001 — 🟠 Los generadores RAG se rompen con modelos GPT-5 / o-series ✅ RESUELTO (2026-06-24)

> **Fix aplicado:** `isNextGenModel(model)` exportado desde `lib/llm/config.ts` (sin deps).
> `graph-gen`, `schedule-gen`, `study-gen` **y el nuevo `course-infer`** ahora incluyen
> `temperature` solo cuando el modelo no es next-gen (`...(isNextGenModel(DEFAULT_MODEL) ? {} :
> { temperature })`). `providers/openai.ts` reusa el mismo helper (antes lo tenía privado).
> Nota: `course-infer.ts:106` era una **nueva instancia de la misma relación inestable**
> introducida en el commit "rag backend" — el mismo footgun se había propagado a la capa de
> inferencia de cursos.

- **Ubicación:** `frontend/src/lib/server/rag/graph-gen.ts:103`,
  `schedule-gen.ts:118`, `study-gen.ts:320`.
- **Qué:** Las tres funciones llaman a `client.chat.completions.create({ model: DEFAULT_MODEL,
  temperature: 0 | 0.2, ... })` **directamente**, sin pasar por el `buildParams()` del provider
  (`lib/llm/providers/openai.ts`). Los modelos GPT-5 / o-series **rechazan** `temperature` distinto
  del default (1) y exigen `max_completion_tokens` en vez de `max_tokens` (ver el comentario en
  `openai.ts:23-31` y el log 4.quater de `NEXT_STEPS.md`). El path de chat ya está protegido por
  `buildParams`; estos tres no.
- **Por qué puede ser dañino:** Ahora que `DEFAULT_LLM_MODEL` es **configurable** (flag introducido
  en S3 #4 → `lib/config/flags.ts`), poner un modelo `gpt-5*`/`o*` hace que **toda la ingesta falle
  con 400** de OpenAI: no se genera grafo, ni cronograma, ni study set. El upload queda en `error`,
  el grafo en `failed`. Peor: el **chat sí funcionaría** (usa `buildParams`), así que el síntoma
  aparece desacoplado de la causa y es difícil de diagnosticar. Es un footgun directo del flag nuevo.
- **Fix sugerido:** Exportar `isNextGenModel(model)` desde `lib/llm/config.ts` (sin deps, evita ciclo)
  y en los tres generadores incluir `temperature` solo cuando el modelo no es next-gen:
  `...(isNextGenModel(DEFAULT_MODEL) ? {} : { temperature: 0 })`. Reusar el mismo helper en
  `openai.ts` (hoy lo tiene privado).

---

## BUG-002 — 🟡 `embedTexts` asume que la respuesta de OpenAI viene en orden ✅ RESUELTO (2026-06-24)

> **Fix aplicado:** `embeddings.ts` ahora ordena por `index` antes de extraer:
> `resp.data.slice().sort((a,b)=>a.index-b.index)` y recorre ese arreglo. Cada embedding
> queda asociado a su chunk correcto aunque OpenAI devuelva el batch desordenado.

- **Ubicación:** `frontend/src/lib/llm/embeddings.ts:36`.
- **Qué:** `for (const d of resp.data) out.push(d.embedding)` confía en que `resp.data` está en el
  mismo orden que el `input`. La API de embeddings devuelve un campo `index` precisamente porque el
  orden no está garantizado contractualmente; el código lo ignora.
- **Por qué puede ser dañino:** Si OpenAI devuelve los items fuera de orden (o si en el futuro se
  paraleliza el batch), cada embedding se asocia al **chunk equivocado**. El retrieval seguiría
  "funcionando" sin error, pero devolvería **citas y contexto incorrectos** → respuestas mal
  fundamentadas que parecen válidas. Es un bug silencioso de correctitud de datos, el más difícil de
  detectar porque no lanza excepción.
- **Fix sugerido:** Ordenar por `index` antes de extraer:
  `resp.data.slice().sort((a,b)=>a.index-b.index).forEach(d=>out.push(d.embedding))`.

---

## BUG-003 — 🟡 Costo/metering cae a 0 con un `DEFAULT_LLM_MODEL` fuera del catálogo ✅ RESUELTO (2026-06-24)

> **Fix aplicado:** `estimateCost` ahora emite un `console.warn` (una vez por id desconocido,
> deduplicado con un `Set`) cuando el modelo no está en `MODELS`, antes de devolver 0. Así un
> `DEFAULT_LLM_MODEL` mal configurado aparece en logs en vez de subfacturar en silencio.

- **Ubicación:** `frontend/src/lib/llm/config.ts` (`estimateCost`, `MODELS`) + flag
  `DEFAULT_LLM_MODEL` (`lib/config/flags.ts`).
- **Qué:** `estimateCost(modelId, ...)` hace `MODELS.find(m => m.id === modelId)` y si no está,
  `return 0`. Como `DEFAULT_MODEL` ahora viene del env, se puede setear un id que no esté en `MODELS`.
- **Por qué puede ser dañino:** El metering (`usage_records`) registraría **costo 0** para todas las
  llamadas con ese modelo → el reporte de uso/facturación subestima silenciosamente el gasto real.
  Además `getAvailableModels` podría no listar el modelo en la UI aunque sí se use por default.
  Riesgo de negocio (facturación), no de crash, y por eso pasa desapercibido.
- **Fix sugerido:** Al resolver el flag, advertir (`logWarn`) si `DEFAULT_LLM_MODEL` no está en
  `MODELS`; o añadir un fallback de pricing por defecto y/o registrar `estimated_cost_usd = null`
  en vez de 0 cuando el modelo es desconocido para distinguir "gratis" de "sin tarifa".

---

## BUG-004 — 🟡 Fallo a mitad del stream deja turno de usuario huérfano y pierde la respuesta parcial ✅ RESUELTO (2026-06-24)

> **Fix aplicado:** el `catch` de `processMessageStream` ahora, si `fullContent` no está vacío,
> persiste la respuesta parcial (marcada `_(respuesta interrumpida)_`) y siempre registra
> `recordUsage({…, success:false, errorType})`. Las operaciones de bookkeeping van envueltas en
> su propio try/catch para no lanzar dentro del catch. El historial ya no queda con un turno
> `user` huérfano y los fallos entran al metering.

- **Ubicación:** `frontend/src/lib/server/services/chat.service.ts:213-349`
  (`processMessageStream`), catch en `:340-344`.
- **Qué:** El mensaje del usuario se persiste **antes** de llamar al LLM (`saveMessage(chatId,"user",…)`
  en `:233`). Si el stream lanza a mitad (timeout/red/cuota de OpenAI), el catch solo loguea, emite
  `data: {error}` y cierra: **no guarda** la respuesta del asistente (ni siquiera la parcial ya
  emitida) y **no registra** `recordUsage` con `success:false`.
- **Por qué puede ser dañino:** (1) El historial queda **inconsistente**: un turno `user` sin su
  respuesta `ai`. Al recargar, el usuario vio texto en pantalla que ya no existe → parece pérdida de
  datos. (2) En el siguiente turno ese `user` colgado entra al contexto/historial y puede confundir
  al modelo. (3) Los fallos no entran al metering (`usage_records`), así que la tasa de error real es
  invisible en los reportes. El path no-stream (`processMessage`) no tiene este problema porque guarda
  el `ai` tras completar.
- **Fix sugerido:** En el catch, si `fullContent` no está vacío, persistir la respuesta parcial
  (marcada como truncada) y registrar `recordUsage({…, success:false, error_type})`. Opcionalmente,
  guardar el mensaje de usuario solo tras el primer chunk exitoso, o borrar el turno `user` colgado si
  el stream falla sin contenido.

## BUG-005 — 🟡 `getAllHistory` carga TODO el historial en cada turno solo para saber si es el primero ✅ RESUELTO (2026-06-24)

> **Fix aplicado:** nuevo `ChatRepository.hasMessages(chatId)` con
> `SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id=$1)`. Ambos paths (`processMessage` y
> `processMessageStream`) usan `const isFirstMessage = !(await hasMessages(chatId))` (medido
> antes del insert del turno `user`, igual que antes) en vez de traer todo el historial.

- **Ubicación:** `frontend/src/lib/server/services/chat.service.ts:130` y `:230`
  (`const allHistory = await ChatRepository.getAllHistory(chatId)` → usado solo como
  `allHistory.length === 0`).
- **Qué:** Para decidir si generar título (solo en el primer mensaje) se trae la lista **completa** de
  mensajes del chat, cuando basta un `COUNT(*)` o un `EXISTS`.
- **Por qué puede ser dañino:** En chats largos esto transfiere y deserializa cientos de filas en cada
  mensaje — desperdicio de ancho de banda hacia Neon, memoria y latencia añadida al turno (y costo de
  cómputo serverless). Escala mal: cuanto más se usa un chat, más caro es cada turno. No es un crash,
  pero degrada el path más caliente de la app.
- **Fix sugerido:** Reemplazar por `ChatRepository.hasMessages(chatId)` / `countMessages` con
  `SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id = $1)` o `COUNT(*)`. (Nota: hoy `saveMessage`
  del usuario corre antes, así que el "primer turno" debe medirse antes de ese insert — ya se hace.)

## BUG-006 — 🔴 Schema drift: la BD viva no tiene las columnas/tablas del commit "rag backend" ✅ RESUELTO (2026-06-24)

- **Ubicación:** `src/lib/schema.sql` (commit `390aeee5` "rag backend") vs. la BD Neon en runtime.
  Repos afectados al consultar columnas inexistentes: `document.repo#listUploads`,
  `chunk.repo#search`/`searchByUser`, `course.repo` (tabla `user_courses`).
- **Qué (causa raíz de los 3 síntomas reportados):** el commit "rag backend" añadió columnas y
  una tabla nuevas (`syllabus_uploads.source_url|source_type|course_id|infer_status|
  inferred_course|infer_confidence`, `chunks.char_start|char_end`, tabla `user_courses`,
  `course_suggestions`) pero **no se corrió `npm run db:migrate`** tras el pull. Probe en la BD
  viva confirmó: Clerk (`clerk_id`,`image`) sí migrado, pero **TODO lo de "rag backend" faltaba**.
  Cada query que selecciona esas columnas lanza `column ... does not exist` → 500.
- **Por qué es dañino — mapeo exacto a lo que se ve en pantalla:**
  1. `GET /api/upload/list` selecciona `source_type, source_url, course_id, infer_status` →
     500 → la página Cursos muestra **"Failed to load documents."** (el screenshot).
  2. `GET/POST /api/courses` usa la tabla `user_courses` → 500. El GET está envuelto en
     `.catch(()=>({courses:[]}))` en `knowledge/page.tsx`, así que aunque el POST crease el curso
     **nunca aparece** → "si quiero añadir un curso no se agrega".
  3. Chat: `chunk.repo#search*` hace `JOIN syllabus_uploads` y selecciona `su.source_url,
     su.source_type` → 500 antes de empezar el stream → **el chat no da respuesta**.
  Es exactamente el ⚠️ que advierte `CLAUDE.md`: "existing DBs need `npm run db:migrate` re-run
  after a pull that touches the schema." La "relación inestable" es el **acoplamiento repos↔schema
  desplegado fuera de sincronía**: el código se mergeó sin aplicar la migración.
- **Fix aplicado:** corrido `npm run db:migrate` contra la BD viva. Probe posterior confirma todas
  las columnas/tablas presentes. Los 3 síntomas dependían de esto.
- **Prevención sugerida (no aplicada):** correr migrate como paso de deploy (o un check de salud
  que verifique columnas clave) para que el schema nunca quede atrás del código de nuevo.

---

## BUG-007 — 🟠 `scripts/migrate.mjs` parte los bloques `DO $$ … $$` y se saltaba FK/CHECK ✅ RESUELTO (2026-06-24)

- **Ubicación:** `frontend/scripts/migrate.mjs` (split de sentencias).
- **Qué:** el runner partía el DDL por `;` (tras quitar comentarios `--`). Postgres usa bloques
  PL/pgSQL `DO $$ BEGIN … EXCEPTION … END $$;` que **contienen sus propios `;`**, así que el
  split los **destrozaba** en fragmentos inválidos. En el primer `db:migrate` esto produjo
  `6 errores` (`unterminated dollar-quoted string`, `syntax error at or near "EXCEPTION"`) y
  **omitió silenciosamente** dos sentencias importantes: el FK
  `syllabus_uploads_course_fk (… REFERENCES user_courses(id) ON DELETE SET NULL)` y el CHECK
  `syllabus_uploads_infer_status_chk`.
- **Por qué es dañino:** sin el FK `ON DELETE SET NULL`, borrar un curso (`CourseRepository.
  deleteByIdAndUser`) **no pone en NULL** el `course_id` de sus documentos → quedan apuntando a un
  curso inexistente (`course_id` huérfano) → otra "relación inestable". Sin el CHECK, `infer_status`
  admite valores fuera del dominio. La migración además reportaba "completada con errores" sin que
  fuera obvio qué quedó sin aplicar.
- **Fix aplicado:** `splitStatements()` ahora recorre el texto y solo corta en `;` cuando la
  profundidad de comillas-dólar (`$$`) es cero, tratando cada bloque `DO $$ … $$` como una sola
  sentencia. Re-corrido `db:migrate`: **61 OK, 0 errores**; probe confirma que el FK y el CHECK
  ahora existen.

<!-- Próximas entradas: añade BUG-00N con el mismo formato. -->
