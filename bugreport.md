# Bug Report — Syllabus Navigator

> Registro acumulativo de bugs/errores encontrados en funcionalidades y módulos.
> Cada entrada: **severidad · ubicación · qué · por qué puede ser dañino · fix sugerido**.
> Añade al final; no borres entradas resueltas, márcalas `✅ RESUELTO`.

Severidad: 🔴 alta · 🟠 media · 🟡 baja.

---

## BUG-001 — 🟠 Los generadores RAG se rompen con modelos GPT-5 / o-series

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

## BUG-002 — 🟡 `embedTexts` asume que la respuesta de OpenAI viene en orden

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

## BUG-003 — 🟡 Costo/metering cae a 0 con un `DEFAULT_LLM_MODEL` fuera del catálogo

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

## BUG-004 — 🟡 Fallo a mitad del stream deja turno de usuario huérfano y pierde la respuesta parcial

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

## BUG-005 — 🟡 `getAllHistory` carga TODO el historial en cada turno solo para saber si es el primero

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

<!-- Próximas entradas: añade BUG-00N con el mismo formato. -->
