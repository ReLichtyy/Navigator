# Reporte — Lógica de Generación de Material de Estudio (Área de Estudio)

> Diagnóstico técnico + hoja de ruta para llevar el "Área de Estudio" de un generador
> superficial y repetitivo a un **sistema de aprendizaje adaptativo de clase mundial**.
> Fecha: 2026-06-24.

---

## 1. Resumen ejecutivo

El módulo **funciona**, pero pedagógicamente es **plano y no adaptativo**. Tres problemas de raíz:

1. **Es extractivo, no generativo.** El prompt obliga a "*never invent facts… ground ONLY in the
   supplied material*". Resultado: solo **recuerdo/definiciones** (niveles bajos de Bloom). No
   genera problemas de aplicación, ejercicios resueltos, casos, ni preguntas de razonamiento
   nuevas. → *"poco profundo, no ayuda a aprender"*.
2. **El contenido se repite.** Una sola llamada con `temperature: 0.2` + caché por `id` sin versión
   + truncado a los primeros 24k caracteres ⇒ cada visita y cada "regenerar" produce **casi lo
   mismo**. → *"no se crean cosas nuevas, solo se repiten"*.
3. **El ciclo de aprendizaje está roto (datos que no se usan).** Se *registran* repetición espaciada
   (Leitner) y dominio por tema (EMA), pero **nunca se leen de vuelta** para decidir qué estudiar.
   La práctica no se adapta a lo que el alumno falla. → *"no es productiva"*.

Veredicto: hoy es un *generador de fichas estático*. Para ser de clase mundial debe convertirse en
un **bucle cerrado**: medir lo que el alumno sabe → generar material **nuevo y dirigido** a sus
vacíos → programar el repaso en el tiempo → re-medir.

---

## 2. Cómo funciona hoy (flujo real)

```
estudio/page.tsx  → fetchStudySet / fetchCourseStudySet
  → StudyService.getStudySet (study.service.ts)
      ├─ caché: StudyRepository.get(syllabusId)         ← devuelve set guardado tal cual
      ├─ ChunkRepository.getConcatenatedText(syllabusId) ← TODO el texto…
      └─ generateStudySet(text, {difficulty, topic, weightedTopics})  (study-gen.ts)
            └─ 1 llamada OpenAI json_schema → {flashcards, quiz, summary, mindmap, studyGuide}
                 input = text.slice(0, 24_000)   ← …pero truncado a 24k chars
  Práctica:
   FlashcardsView  → recordFlashcardReview → StudyStatsRepository (cajas Leitner, due_at)
   QuizView        → recordMastery        → MasteryRepository (confianza EMA por tema)
```

Una sola llamada produce **los 5 artefactos a la vez** (`study-gen.ts:334-353`), compartiendo un
único presupuesto de tokens y un único intento.

---

## 3. Diagnóstico de raíz (con referencias)

### A. Generación superficial — solo recuerdo, nunca creación

- **Prompt extractivo.** `study-gen.ts:193-198` — *"never invent facts, dates or topics"*. Correcto
  para evitar alucinaciones, pero mata toda la pedagogía generativa: no hay ejercicios nuevos,
  problemas aplicados, derivaciones paso a paso, ni preguntas tipo "aplica esto a un caso".
- **Todo en Bloom 1-2.** Flashcards = *concepto→definición* (`study-gen.ts:16-19, 89-100`); quiz =
  opción múltiple de identificación. No hay Aplicar/Analizar/Evaluar/Crear.
- **La dificultad es solo un adjetivo.** `DIFFICULTY_HINT` (`study-gen.ts:288-295`) inyecta texto,
  pero como sigue prohibido "inventar", "Difícil" no puede producir problemas genuinamente más
  difíciles; solo redacta distractores más sutiles sobre el mismo contenido. **No se valida** que
  el resultado sea realmente más difícil.
- **"Simulacro" es un quiz disfrazado.** `estudio/page.tsx:563-582` — los modos `quiz` y `simulacro`
  renderizan el **mismo** `set.quiz`. No es cronometrado, ni respeta el formato/peso de la próxima
  evaluación, pese a que la tarjeta lo promete ("examen con el formato de la próxima evaluación").
- **"Modo repaso" = "Tarjetas".** `estudio/page.tsx:543-562` — `flash` y `repaso` usan el mismo
  `set.flashcards` en el **mismo orden**. No hay nada de repetición espaciada en la sesión real.

### B. El contenido se repite (no se crea nada nuevo)

- **Baja diversidad por diseño.** `temperature: 0.2` (`study-gen.ts:337`) ⇒ salida casi
  determinista. Regenerar produce prácticamente las mismas tarjetas/preguntas.
- **Caché sin versión ni dimensiones.** `study.repo.ts` cachea por `syllabus_id` / `course_id`
  **únicamente** (`study.repo.ts:6-21, 24-39`). No incluye dificultad, tema, hash de contenido ni
  versión de esquema. El set por defecto se sirve **idéntico para siempre** hasta un `refresh`
  manual (`study.service.ts:40-43`).
- **`refresh` sobrescribe, no acumula.** `study.service.ts:65` hace `upsert` y reemplaza. No existe
  un **banco de ítems** que crezca; cada regeneración tira lo anterior y, por A+temp baja, regenera
  casi lo mismo. No hay deduplicación ni exclusión de "ítems ya vistos".
- **Truncado destructivo a 24k.** `study-gen.ts:275, 342` toma solo `slice(0, 24_000)`. En cursos
  grandes (y en *todo el curso*, que **concatena todos los PDFs** antes de truncar,
  `study.service.ts:93`) se pierde la mayor parte del material — siempre se estudia el mismo inicio.
- **Ironía RAG:** la app tiene pgvector + búsqueda por similitud (`chunk.repo#search`) y **no se usa
  aquí**. La selección de qué estudiar es "los primeros 24k chars", no recuperación por relevancia.

### C. El ciclo de aprendizaje está roto (telemetría que no retroalimenta)

- **SRS fantasma.** Se calculan cajas Leitner e `due_at` (`study-stats.repo.ts:11-48`) pero
  **nunca se consultan**: la sesión de repaso muestra todas las tarjetas en orden de array. El dato
  de "qué toca repasar hoy" se escribe y se ignora.
- **El dominio no dirige la generación.** `MasteryRepository` registra confianza EMA por tema
  (`mastery.repo.ts`) y `MasteryPanel` la *muestra*, pero el sesgo de generación usa **peso de
  examen del grafo**, no los vacíos del alumno (`study.service.ts:53-58`). Los temas que el alumno
  **falla** no reciben más ni mejores preguntas la próxima vez.
- **Sin práctica de producción.** Todo es reconocimiento (elegir opción / voltear tarjeta). No hay
  recuerdo libre, respuesta abierta calificada, ni "explícalo con tus palabras" (Feynman) — que es
  donde de verdad se aprende.
- **Sin acumulación temporal.** No hay "sesión de hoy", ni interleaving, ni repaso acumulativo entre
  sesiones, ni rampa hacia la fecha del examen (aunque el cronograma existe en `schedule_events`).

### D. Calidad y robustez

- **Sin verificación de la respuesta correcta.** El índice `answer` no se valida; si el modelo se
  equivoca, el alumno aprende mal. Solo se *clampa* el rango (`study-gen.ts:220`).
- **Llamada monolítica frágil.** Un solo JSON gigante: si una parte falla, fallan todas, y los 5
  artefactos compiten por el mismo presupuesto de tokens → calidad diluida.
- **Bug menor:** *todo el curso* genera con `weightedTopics: []` (`study.service.ts:101`) — pierde
  incluso el sesgo por peso de examen que sí tiene el modo por-PDF.
- **Sin deduplicación** entre regeneraciones ni entre alcance por-PDF y todo-el-curso.

---

## 4. Impacto

| Síntoma del usuario | Causa raíz |
|---|---|
| "Poco profundo, no ayuda a aprender" | §A: solo Bloom 1-2, extractivo, sin aplicación/producción |
| "No se crean cosas nuevas, se repiten" | §B: temp 0.2 + caché sin versión + `refresh` sobrescribe + truncado a 24k |
| "No es productiva" | §C: SRS y dominio se registran pero no retroalimentan; sin sesión adaptativa |

---

## 5. Hoja de ruta a clase mundial

Principio rector: **cerrar el bucle** medir → generar dirigido y nuevo → programar → re-medir.

### Fase 1 — Quick wins (días, bajo riesgo)

1. **Separar de verdad los modos.**
   - *Repaso* lee tarjetas **vencidas** (`due_at <= now()`), ordenadas por caja/lapso, e
     interleaving; no el array completo. (Leer lo que `study-stats.repo` ya escribe.)
   - *Simulacro*: cronometrado, sin feedback inmediato, informe final por tema + % global.
2. **Subir diversidad + anti-repetición.** `temperature` ~0.7 para ítems; pasar al prompt una
   **lista de "ítems ya vistos"** (fronts/preguntas previos) con instrucción de NO repetirlos.
3. **Arreglar caché y bug de pesos.** Clave de caché = `(scope, difficulty, topic, contentHash,
   schemaVersion)`; cachear también los sets *custom*; invalidar al subir/editar PDFs. Pasar
   `weightedTopics` en el modo todo-el-curso (`study.service.ts:101`).
4. **Verificar la respuesta del quiz.** Segundo paso barato (LLM o regla) que confirme que `answer`
   es correcta y que los distractores no son ambiguos; descartar la pregunta si no pasa.

### Fase 2 — Profundidad pedagógica (estructural)

5. **Generadores especializados (varias llamadas, no una).** Una por artefacto y por **tipo de
   ítem**, para subir calidad y permitir Bloom alto:
   - Problemas de **aplicación** con solución paso a paso (worked examples).
   - **Recuerdo libre** / respuesta abierta **calificada por rúbrica** con retroalimentación.
   - **Cloze** (completar), **comparar/contrastar**, **encontrar el error**, **"explícalo"** (Feynman).
6. **Selección por recuperación (RAG real).** En vez de `slice(0,24k)`, usar pgvector para traer los
   chunks más relevantes **por tema objetivo** → cubre todo el curso y permite enfoque profundo.
   Reutiliza `chunk.repo#search`.
7. **Banco de ítems persistente.** Tabla `study_items` (tipo, tema, dificultad, enunciado, solución,
   embedding, origen). `refresh` **agrega** ítems nuevos con **dedupe por similitud de embedding**;
   las sesiones se arman desde el banco creciente. Esto resuelve de raíz "no se crea nada nuevo".

### Fase 3 — Adaptación y motor de aprendizaje (clase mundial)

8. **Generación dirigida por desempeño.** El sesgo de generación combina **peso de examen** ×
   **vacío de dominio** (`mastery.repo`) × **cercanía de la evaluación** (cronograma). Los temas
   flojos reciben más ítems y más difíciles; los dominados, menos.
9. **Planificador de "sesión de hoy".** = tarjetas SRS vencidas + N ítems nuevos en los temas más
   débiles + 1 problema de aplicación, con **interleaving** y **rampa de dificultad** según
   precisión reciente y días al examen.
10. **Dificultad adaptativa real.** Calibrar la dificultad objetivo a partir de la precisión móvil
    del alumno (no un adjetivo fijo) y validar que "difícil" exige más pasos de razonamiento.
11. **Secuenciación por prerequisitos.** Usar `topic_dependencies` (ya en el grafo) para no evaluar
    un tema antes que sus prerequisitos; repaso acumulativo y cruce entre cursos.
12. **Metacognición y progreso.** Curvas de dominio en el tiempo, predicción de retención, "tu punto
    débil de la semana", y conexión con el chat ("pregúntame sobre lo que fallaste").

---

## 6. Cambios técnicos concretos (resumen)

| Área | Hoy | Propuesta |
|---|---|---|
| Prompt | "never invent" (extractivo) | Generar ítems **nuevos** anclados a evidencia recuperada (cita el chunk) |
| Llamada | 1 mega-JSON, temp 0.2 | N generadores por tipo, temp ~0.7, con exclusión de vistos |
| Selección | `slice(0, 24k)` | Recuperación pgvector por tema objetivo |
| Caché | clave = id | clave = (scope, dif, topic, contentHash, version); acumulativa |
| Persistencia | `study_sets.data` reemplazable | `study_items` (banco + embeddings + dedupe) |
| SRS | se escribe, no se lee | sesión de repaso = tarjetas vencidas + interleaving |
| Dominio | solo se muestra | dirige qué/cuánto/qué tan difícil generar |
| Simulacro/Repaso | duplican quiz/flash | modos propios (cronometrado / vencidas) |
| Verificación | solo clamp de índice | validar respuesta + calidad de distractores + dedupe |

---

## 7. Métricas de éxito sugeridas

- % de ítems **nuevos** por sesión (anti-repetición) → objetivo alto y sostenido.
- Cobertura del temario (chunks/temas tocados) vs. solo el inicio del documento.
- Mejora de dominio (EMA) por tema entre la 1ª y la N-ésima sesión.
- Retención a 7/30 días (aciertos en tarjetas vencidas re-mostradas).
- Correlación desempeño en simulacro ↔ evaluación real del cronograma.

---

## 8. Solución: Arquitectura **Multi-RAG** (Study Engine)

> Propuesta de bases para reconstruir la lógica como un sistema multi-agente con enrutamiento,
> orquestación por grafo, multi-índice y evaluación. Diseñado para el stack real: **TypeScript,
> Next.js serverless, Neon Postgres (+pgvector), OpenAI** — sin Python, sin servicio aparte.

### 8.0 Modelo mental (4 capas + estado del alumno)

```
                         ┌─────────────────────────────────────────────┐
  Petición + estado  →   │  CAPA 1 · ROUTER (enrutador / planner)        │
  (modo, scope,          │  decide: qué agentes, qué índices, qué        │
   dificultad, tema,     │  estrategia, qué temas objetivo → StudyPlan   │
   mastery, SRS,         └───────────────────────┬─────────────────────┘
   cronograma)                                   │ StudyPlan
                         ┌───────────────────────▼─────────────────────┐
                         │  CAPA 2 · ORQUESTACIÓN (grafo / state machine)│
                         │  nodos = agentes/pasos, aristas = transiciones│
                         │  con gates de verificación y bucles de retry  │
                         └───────┬───────────────┬───────────────┬──────┘
                                 │ retrieve()     │ generate()    │ verify()
                         ┌───────▼──────┐  ┌──────▼───────┐  ┌────▼────────┐
                         │ CAPA 3       │  │ CAPA 4       │  │ CAPA 3.5    │
                         │ MULTI-ÍNDICE │  │ AGENTES      │  │ EVALUACIÓN  │
                         │ dense+léxico │  │ síntesis,    │  │ quality     │
                         │ +estructura  │  │ inquisidor,  │  │ gates +     │
                         │ +banco ítems │  │ casos, fichas│  │ métricas    │
                         └──────────────┘  └──────────────┘  └─────────────┘
                                 ▲                                   │
                                 └──────── banco de ítems (dedupe) ◄─┘
```

El **estado del alumno** (mastery EMA, cajas SRS vencidas, cercanía de evaluación) es entrada de
primera clase del Router — eso es lo que hoy falta y rompe el bucle de aprendizaje.

---

### 8.1 Capa 1 — Router (enrutador / planner)

**Responsabilidad:** traducir *(modo, scope, dificultad, tema, estado del alumno, cronograma)* en un
**`StudyPlan`** explícito: qué temas objetivo, qué agentes invocar, cuántos ítems de cada tipo, qué
estrategia de recuperación, y qué dificultad real por tema.

```ts
interface StudyPlan {
  scope: { kind: "doc" | "course"; id: string }
  targets: { topic: string; weightExam: number; mastery: number; priority: number }[]
  agents: ("synth" | "inquisitor" | "case" | "flashcard")[]
  budget: { quiz: number; flashcards: number; cases: number }  // cuántos ítems nuevos
  difficulty: Difficulty | "adaptive"
  retrieval: "dense" | "lexical" | "hybrid"
  excludeSeen: string[]        // ids/hashes de ítems ya vistos (anti-repetición)
}
```

**Cálculo de prioridad por tema** (núcleo del enfoque adaptativo):
`priority = w1·weightExam + w2·(1 − mastery) + w3·urgenciaCronograma + w4·lapsoSRS`.

**Opciones:**
| Opción | Cómo | Pro | Contra |
|---|---|---|---|
| A. Reglas | Heurística TS pura sobre las señales | Barato, determinista, testeable | Menos flexible ante peticiones libres |
| B. LLM router | Un LLM decide el plan | Flexible, entiende instrucciones libres | Costo/latencia, no determinista |
| **C. Híbrido (recomendado)** | Reglas calculan `targets`/`priority`; LLM solo interpreta la **instrucción de enfoque** libre del usuario | Determinista donde importa, flexible donde aporta | Algo más de código |

→ **Recomendado C.** El modo y el scope ya son conocidos en la UI; el router se concentra en
*targeting* (qué temas y cuánto) y en mapear la instrucción de enfoque libre a temas.

---

### 8.2 Capa 2 — Orquestación (grafo / máquina de estados)

**Responsabilidad:** ejecutar el `StudyPlan` como un **grafo dirigido** con estado compartido,
*gates* de verificación y **bucles de regeneración** hasta aprobar calidad.

Grafo propuesto (por cada tema objetivo, en paralelo):
```
 plan → retrieve → ┬→ [synth]      ┐
                   ├→ [inquisitor] ┼→ verify ──pass──→ dedupe → persist(item bank)
                   ├→ [case]       ┤      │
                   └→ [flashcard]  ┘      └──fail (≤N veces)──→ regenerate
                                                  │
                                          fail>N → drop + log (sin caps silenciosos)
```

**Estado compartido** (`GraphState`): `plan`, `retrieved` (chunks+citas), `drafts` (ítems por
agente), `verdicts`, `accepted`, `rejected`, `seen`. Inmutable por nodo → resumible y testeable.

**Dónde corre:** la generación multi-agente es **pesada** → ejecutarla en el **worker async** que ya
existe (`jobs` + `cron/process`), no en el request. El request encola un job y devuelve lo cacheado;
el worker llena el **banco de ítems**. La UI hace *streaming/polling* del progreso.

**Opciones:**
| Opción | Cómo | Pro | Contra |
|---|---|---|---|
| **A. Runner propio (recomendado)** | Mini state-machine TS tipada en `lib/server/rag/orchestrator/` | Cero deps, encaja con el patrón ya portado de Python→TS, control total | Hay que escribir el runner (≈150 LOC) |
| B. Librería de grafos | p.ej. un LangGraph-JS | Menos código de runner | Dep pesada, fricción con serverless, el repo ya abandonó LangChain |

→ **Recomendado A:** patrón `nodes: Record<string, (s)=>Promise<Partial<state>>>` + `edges` +
reintentos. Determinista, unit-testeable (como ya lo son `normalizeStudySet`/`buildDirectives`).

---

### 8.3 Capa 3 — Multi-índice (estrategia de almacenamiento por tipo de dato)

**Responsabilidad:** elegir **cómo buscar** según el tipo de dato y necesidad. No todo es semántico.

| Índice | Dato / uso | Tecnología | Estado |
|---|---|---|---|
| **Dense (semántico)** | Conceptos, paráfrasis, "de qué trata" | pgvector `embedding<=>q` (`chunk.repo#search`) | ✅ existe |
| **Léxico / keyword** | Términos exactos, fórmulas, nombres, definiciones | Postgres `tsvector` + `ts_rank` (o BM25) | ➕ añadir |
| **Estructurado / metadata** | Temas, pesos de examen, prerequisitos, fechas | tablas `topics`, `topic_dependencies`, `schedule_events` | ✅ existe (sin usar aquí) |
| **Banco de ítems** | Ítems ya generados → dedupe + "no repetir" | tabla nueva `study_items` con embedding | ➕ añadir |

**Fusión híbrida (Hybrid Search):** correr dense **y** léxico y combinar con **Reciprocal Rank
Fusion (RRF)** → `score = Σ 1/(k+rank_i)`. Captura tanto significado como términos exactos (clave en
materias técnicas con fórmulas/símbolos que el embedding pierde).

**Selección por tema objetivo:** en lugar de `slice(0, 24k)`, recuperar los top-K chunks por
*cada* tema del `StudyPlan` → cobertura de todo el temario y profundidad dirigida.

**Opciones de almacenamiento de embeddings de ítems:** (A) misma columna `vector(1536)` en
`study_items` con índice HNSW — recomendado, mismo patrón que `chunks`; (B) índice externo — innecesario.

---

### 8.4 Capa 4 — Agentes especializados

Cada agente: **rol único, entrada anclada a evidencia recuperada (cita el chunk), salida tipada y
verificable**. Reemplaza la mega-llamada única por generadores enfocados (mejor calidad y Bloom alto).

| Agente | Rol | Entrada | Salida | Índice que usa |
|---|---|---|---|---|
| **Retriever** | Selecciona evidencia por tema | `StudyPlan.targets` | chunks + citas | Multi-índice (híbrido) |
| **Synthesizer** (sintetizador) | Resumen, guía de estudio, mapa mental | evidencia | `summary`, `studyGuide`, `mindmap` | dense + estructurado |
| **Inquisitor** (inquisidor) | Preguntas tipo examen + distractores plausibles | evidencia + dificultad | `quiz[]` con `topic` | híbrido |
| **Case agent** (casos) | Problemas de **aplicación** + solución paso a paso | evidencia + tema | `cases[]` (worked examples) | dense + estructurado |
| **Flashcard agent** (tarjetas) | Concepto→def + **cloze** | evidencia | `flashcards[]` | léxico + dense |
| **Verifier/Critic** ➕ | Valida respuesta correcta, calidad de distractores, fidelidad | drafts + evidencia | `verdict{pass, reasons}` | — (LLM-juez) |
| **Grader** ➕ | Califica **recuerdo libre** (respuesta abierta) por rúbrica | respuesta alumno + evidencia | nota + feedback | dense |
| **Planner** ➕ | Arma la "sesión de hoy" | estado alumno + banco | lista de ítems ordenada | banco + SRS + mastery |

Tus 4 agentes son el núcleo; los ➕ son los que **cierran el bucle** (verificación, producción y
adaptación) y son los que faltan hoy.

---

### 8.5 Pipeline de evaluación (quality gates)

Antes de persistir, cada ítem pasa **gates** (estilo RAGAS, pero offline en el worker):

| Métrica | Qué mide | Acción si falla |
|---|---|---|
| **Faithfulness / groundedness** | ¿El ítem se sostiene en la evidencia citada? | descartar (anti-alucinación) |
| **Answer correctness** | ¿El `answer` del quiz es realmente correcto? | regenerar o descartar |
| **Distractor quality** | ¿Distractores plausibles y no ambiguos? | regenerar |
| **Difficulty calibration** | ¿La dificultad real coincide con la pedida? | re-etiquetar / regenerar |
| **Novelty / dedup** | Similitud de embedding vs banco < umbral | descartar duplicado |
| **Coverage** | ¿Se cubrieron todos los `targets`? | re-encolar temas faltantes |

Sin caps silenciosos: lo descartado se **registra** (`log`) para no aparentar cobertura total.

---

### 8.6 Modelo de datos nuevo (mínimo)

```sql
-- Banco de ítems generados (sustituye el blob reemplazable study_sets.data)
CREATE TABLE study_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,                 -- dueño (o NULL si compartible por curso)
  scope_kind  text,                 -- 'doc' | 'course'
  scope_id    uuid,
  type        text,                 -- 'flashcard' | 'quiz' | 'case' | 'cloze' | 'recall'
  topic_key   text,                 -- normalizado (reusa mastery.topicKey)
  difficulty  text,
  payload     jsonb,                -- enunciado, opciones, solución, citas
  embedding   vector(1536),         -- para dedupe + recuperación
  source      text,                 -- agente que lo creó
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX ON study_items USING hnsw (embedding vector_cosine_ops);

-- Índice léxico sobre chunks (hybrid search)
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS ts tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;
CREATE INDEX IF NOT EXISTS chunks_ts_idx ON chunks USING gin (ts);
```

`flashcard_reviews` y `topic_mastery` ya existen → ahora **se leen** para alimentar Router y Planner.

---

### 8.7 Flujo extremo a extremo (ejemplo: "quiz difícil de todo el curso, enfoque derivadas")

1. **Router:** scope=course; reglas calculan `targets` por prioridad (peso examen × vacío de dominio
   × cronograma); LLM mapea "derivadas" a temas; `agents=[inquisitor]`, `difficulty=hard`,
   `retrieval=hybrid`, `excludeSeen=[…]`.
2. **Orquestación:** encola job; por cada tema → retrieve (híbrido RRF) → inquisitor genera →
   verifier valida respuesta/distractores → dedupe vs banco → persiste ítems nuevos.
3. **Sesión:** Planner arma el quiz con ítems nuevos + algunos vencidos (interleaving), dificultad
   adaptada a la precisión reciente.
4. **Re-medición:** outcomes → `topic_mastery` (EMA) → cambian las prioridades del próximo Router.

---

### 8.8 Decisiones recomendadas (resumen)

- Router: **híbrido** (reglas + LLM para instrucción libre).
- Orquestación: **runner de grafo propio en TS**, ejecutado en el **worker async** (`jobs`).
- Índice: **híbrido dense+léxico con RRF** + selección por tema; **banco de ítems** con embeddings.
- Agentes: tus 4 + **verifier, grader, planner** (los que cierran el bucle).
- Evaluación: **quality gates offline** con dedupe por similitud (resuelve "se repite").

### 8.9 Plan de implementación incremental

1. **Banco de ítems + dedupe** (`study_items`) y caché versionada → ataca "se repite". *(base)*
2. **Multi-índice híbrido** (tsvector + RRF) + recuperación por tema → ataca "superficial/24k".
3. **Agentes separados** (synth/inquisitor/case/flashcard) + **verifier** → calidad y Bloom alto.
4. **Runner de grafo** en el worker async → orquestación robusta con gates y reintentos.
5. **Router adaptativo + Planner** leyendo mastery/SRS → cierra el bucle ("no productiva").

> Cada paso es desplegable por sí solo y deja el sistema mejor que antes; el orden va de la causa más
> citada por el usuario ("se repite") hacia el motor adaptativo completo.

---

## 9. Asignación de modelos por agente (multi-model)

> Idea: **el mejor modelo para cada trabajo**, no un único modelo para todo. Vía **OpenRouter** para
> los agentes (chat) + provider directo para embeddings. Setup actual: chat OpenAI/OpenRouter
> (`llm/config.ts`, `llm/providers/`), embeddings OpenAI `text-embedding-3-small` 1536d
> (`llm/embeddings.ts`), índice HNSW `chunks.embedding vector(1536)`.

### 9.0 Restricciones que mandan (leer primero)

1. **Embeddings = espacio único, no mezclable.** Índice y consulta deben usar el **mismo** modelo.
   Cambiar de modelo ⇒ **re-embeber todo el corpus**. La dimensión está fijada por el índice (1536).
2. **Truco anti-migración:** `gemini-embedding-001` soporta **dimensión configurable** (768/1536/3072,
   truncado Matryoshka). Si eliges **1536**, conservas columna + índice HNSW sin tocar el schema —
   solo hay que re-embeber.
3. **OpenRouter no expone `/embeddings`.** Embeddings = API directa (OpenAI o Google/Vertex). Los
   **agentes** (todo lo que es chat) sí pueden ir por OpenRouter con un solo API key.
4. **Quirks de parámetros por familia** (ya contemplado en `isNextGenModel`): GPT-5/o-series rechazan
   `temperature` y usan `max_completion_tokens`; Gemini/Claude usan otros nombres. El adaptador de
   provider debe construir params por familia (extender `providers/openai.ts` + `openrouter.ts`).

### 9.1 Principios

- **Caro y fuerte para poco volumen y alto riesgo** (casos, verificación, calificación).
- **Barato y rápido para alto volumen** (tarjetas, router, embeddings).
- **Verificación cruzada de familia:** el verifier debe ser de **distinta** familia que el generador
  (si inquisidor = GPT, verifier = Claude/Gemini) — la diversidad atrapa errores que la redundancia no.
- **Multilingüe:** corpus en español → preferir modelos fuertes en ES (Gemini y Claude destacan).

### 9.2 Embeddings (elige UNO; aplica a ingest + query + dedupe de ítems)

| Opción | Modelo | Dim | Pro | Contra |
|---|---|---|---|---|
| **A. Mantener (recomendado para empezar)** | OpenAI `text-embedding-3-small` | 1536 | Ya cableado, barato, sin migración | Calidad/ES media |
| B. Subir calidad OpenAI | `text-embedding-3-large` | 3072 | Mejor recall | Migrar columna+índice, 2× costo |
| **C. Gemini (recomendado si re-embebes)** | `gemini-embedding-001` **a 1536d** | 1536 | Top multilingüe (ES), **sin migrar schema** (Matryoshka), API Google directa | Re-embeber todo, 2º provider/key |
| D. Especialista retrieval | Voyage `voyage-3` | 1024/2048 | Muy fuerte en retrieval | Otro provider, migración |

→ **Empieza con A**; cuando hagas hybrid search, evalúa **C a 1536** (mejor ES, cero cambio de índice).
**Nunca** mezclar: si pasas a C, re-embebes ingest **y** consultas.

### 9.3 Reranker (opcional, gran ROI en calidad de recuperación)

Tras fusionar dense+léxico (RRF), un **reranker** cross-encoder reordena el top-N → sube precisión.
Opciones: Cohere `rerank-3.5`, Voyage `rerank-2`. Bajo volumen (solo top-N) ⇒ costo marginal.

### 9.4 Matriz de modelos por agente

Dos presets: **Calidad** (máxima pedagogía) y **Económico** (costo bajo). Ids vía OpenRouter.

| Agente | Carga | Preset Calidad | Preset Económico | Por qué |
|---|---|---|---|---|
| **Router/Planner** | Alta, trivial | `google/gemini-2.5-flash-lite` | `openai/gpt-4o-mini` | Decisión ligera, rápida, barata |
| **Synthesizer** (resumen/guía/mapa) | Media, contexto largo | `google/gemini-2.5-flash` | `openai/gpt-4.1-mini` | Contexto enorme + resumen fiel barato |
| **Inquisitor** (quiz) | Media, exactitud | `openai/gpt-5.x` o `anthropic/claude-sonnet-4.x` | `google/gemini-2.5-flash` | Respuesta correcta importa; razona bien |
| **Case agent** (problemas/paso a paso) | Baja, razonamiento duro | `anthropic/claude-sonnet-4.x (thinking)` o `openai/o-series` | `google/gemini-2.5-pro` | Tarea más difícil = mejor razonador |
| **Flashcard agent** | Muy alta, simple | `google/gemini-2.5-flash-lite` | `openai/gpt-4o-mini` | Volumen alto, tarea sencilla |
| **Verifier/Critic** | Media, crítico | **familia distinta al generador** (p.ej. `anthropic/claude-sonnet-4.x`) | `google/gemini-2.5-flash` | Verificación cruzada de familia |
| **Grader** (recuerdo libre) | Baja, juicio | `anthropic/claude-sonnet-4.x` | `openai/gpt-4.1-mini` | Sigue rúbrica, feedback matizado |

> Nota: usa los ids exactos vigentes en OpenRouter al implementar (las familias evolucionan); el
> catálogo `MODELS` debe listar cada uno con su precio para que el metering (`estimateCost`) no
> registre $0. Mantener al menos un **fallback** por agente (p.ej. `gpt-4o-mini`).

### 9.5 Mecanismo de configuración (propuesto)

Un mapa **rol → modelo**, sobre-escribible por env (sin tocar código por-deploy), con fallback:

```ts
// lib/llm/agent-models.ts
export type AgentRole =
  | "router" | "synth" | "inquisitor" | "case" | "flashcard" | "verifier" | "grader"

interface RoleModel { provider: "openai" | "openrouter"; model: string; fallback?: string }

export const AGENT_MODELS: Record<AgentRole, RoleModel> = {
  router:     { provider: "openrouter", model: env("MODEL_ROUTER",     "openai/gpt-4o-mini") },
  synth:      { provider: "openrouter", model: env("MODEL_SYNTH",      "google/gemini-2.5-flash") },
  inquisitor: { provider: "openrouter", model: env("MODEL_INQUISITOR", "openai/gpt-5.x"), fallback: "google/gemini-2.5-flash" },
  case:       { provider: "openrouter", model: env("MODEL_CASE",       "anthropic/claude-sonnet-4.x"), fallback: "google/gemini-2.5-pro" },
  flashcard:  { provider: "openrouter", model: env("MODEL_FLASHCARD",  "google/gemini-2.5-flash-lite") },
  verifier:   { provider: "openrouter", model: env("MODEL_VERIFIER",   "anthropic/claude-sonnet-4.x") },
  grader:     { provider: "openrouter", model: env("MODEL_GRADER",     "anthropic/claude-sonnet-4.x") },
}
// Embeddings aparte (NO OpenRouter): EMBEDDING_PROVIDER + EMBEDDING_MODEL en llm/embeddings.ts
```

Los generadores (hoy con `DEFAULT_MODEL` hardcodeado en `study-gen.ts:335`) pasan a recibir el
modelo por **rol**: `chatCompletion(AGENT_MODELS.inquisitor, …)`. El `llm/router.ts` ya existente
gestiona provider/fallback.

### 9.6 Costo (regla práctica)

El gasto se concentra en los agentes de **alto volumen** (tarjetas) y **razonamiento** (casos).
Mitigación: alto volumen → modelo barato; razonamiento → modelo caro pero **pocos ítems por sesión**;
generación **offline en el worker** + **banco de ítems con dedupe** ⇒ no se regenera lo ya creado, así
que el costo por sesión tiende a bajar con el tiempo. Mantener `estimateCost`/`recordUsage` por rol
para ver el gasto por agente y ajustar el preset.

### 9.7 Decisión recomendada (resumen)

- **Embeddings:** A ahora (`text-embedding-3-small`); evaluar **C `gemini-embedding-001`@1536** al
  activar hybrid search (mejor ES, sin migrar índice, pero re-embeber).
- **Agentes:** preset **Calidad** para `case`/`inquisitor`/`verifier`/`grader`; **Económico** para
  `router`/`synth`/`flashcard`. Todo por OpenRouter con un `AGENT_MODELS` + env + fallback.
- **Verifier** siempre de **familia distinta** al generador.
- Opcional: **reranker** (Cohere/Voyage) tras RRF cuando se note ruido en la recuperación.

---

## 10. Estado actual del RAG (implementación real — línea base)

> Auditoría de cómo está construido HOY el pipeline RAG (ingesta → almacenamiento → recuperación →
> generación), con referencias a archivo:línea. Es la línea base sobre la que aplican §8-9. Todo
> vive en `syllabus-navigator/frontend`.

### 10.1 Resumen

RAG **clásico de un solo vector store**, bien estructurado y robusto en *plumbing* (ingesta en 2
fases, cola durable, citas, gate de relevancia). Pero **mono-modelo, mono-índice** y con piezas
**ingenuas** donde importa la calidad:

- **Embeddings:** un solo modelo OpenAI `text-embedding-3-small` (1536d), hardcodeado.
- **Índice:** un solo HNSW pgvector sobre `chunks`. No hay índice léxico/estructurado.
- **Recuperación (chat):** vector ANN + **rerank híbrido léxico, pero en memoria** (overlap de
  tokens en JS sobre 24 candidatos), no un BM25/`tsvector` real ni reranker de modelo.
- **Generación (graph/schedule/study):** **no usan recuperación** — leen el texto **concatenado
  completo** (y lo truncan). El RAG real (vector) alimenta **solo el chat**.
- **Chunking:** ventanas fijas de 1200 chars / 120 overlap, por página; no estructural.

Madurez: **plumbing 8/10, calidad de recuperación 5/10, multi-modelo/multi-índice 1/10.**

### 10.2 Arquitectura real (flujo extremo a extremo)

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

### 10.3 Componente por componente

**Ingesta Fase 1 (síncrona) · `document.service.ts`**
- Fuentes: PDF (`processUpload`), enlace (`processLink`, fetch + `htmlToText`), texto (`processText`).
- Validación: MIME (`:66`), 5MB (`:72`), **magic `%PDF-`** real anti-spoof (`:83`), hash sha256 (`:87`).
- Chunking por página `pdfToPageChunks` (`chunking.ts:74-93`).
- Escaneo: `meaningfulTextLength < 200` → `needs_ocr`, **OCR deshabilitado a propósito** (`:107,:19`).
- Persiste **solo texto** (`chunk.repo.ts:31`); encola `jobs('ingest')` + dispara worker inline (`:114`).

**Ingesta Fase 2 (worker) · `ingestion.service.ts`**
- Embeddings: pendientes (embedding IS NULL) → `embedTexts` → `setEmbedding` (`:35-41`). Idempotente.
- Orden: embeddings (bloqueante, `:49`) → `processed` → course-infer → graph → schedule (best-effort).
- Cola (`job.repo.ts`): claim **atómico** `FOR UPDATE SKIP LOCKED` (`:43`), rescate de colgados >10min,
  **backoff exponencial** `2^attempts` (`:66-83`). `drainQueue` hasta **5 jobs** (`:100`).
- Corre **inline** en el request (`worker-trigger.ts`, Vercel congela tras responder); Cron de respaldo.

**Almacenamiento / índice · `schema.sql`**
- Neon + pgvector (`:7`). `chunks.embedding vector(1536)` = `text-embedding-3-small` (`:98`).
- HNSW `vector_cosine_ops` (operador `<=>`) (`:113-114`) + btree `syllabus_id` (`:111`).
- Locators: `page_start/end` (PDF), `char_start/end` (link/texto). **Un índice, una dimensión.**

**Embeddings · `llm/embeddings.ts`** — `text-embedding-3-small`, 1536d, batch 96 (`:11-13`); reordena
por `.index` (BUG-002, `:39`). **Un solo provider hardcodeado.**

**Recuperación · `retrieval.service.ts` + `chunk.repo.ts`**
- Dos alcances: `retrieve(syllabusId)` y `retrieveForUser(userId)` (`:136-150`).
- SQL: `embedding <=> $q ORDER BY distance LIMIT K` + JOIN metadata cita (`chunk.repo.ts:113-151`).
- Over-fetch `K=24` → rerank → **TOP_K=8** (`:16-20`).
- Gate: si el más cercano > `MAX_DISTANCE=0.9` → sin contexto (`:39,:98-99`), override `RAG_MAX_DISTANCE`.
- **Rerank híbrido ingenuo:** `vectorSim(1-dist/2) + 0.35·overlapLéxico` en JS sobre 24 (`:71-92`) —
  **no** BM25/`tsvector`; recall acotado al top-24 del vector.
- Salida: `[Fragmento N]` + citas (máx 5, quote 500).

**Generación chat · `chat.service.ts`** — contexto + bloque AGENDA/CRONOGRAMA siempre (`:37-56,:103`) +
historial 6 turnos; `GROUNDED_SYSTEM_PROMPT` (mentor) | general; `selectModel`; SSE; guardrails;
persistencia de parcial si falla el stream (BUG-004); metering.

**Otros generadores · `graph-gen/schedule-gen/study-gen/course-infer`** — una llamada structured-output
sobre `getConcatenatedText` (texto completo, truncado). **NO usan el vector store**: el retriever
alimenta **solo el chat**.

### 10.4 Lo que está bien (no tocar)

Capas limpias (route→service→repo→db); ingesta 2 fases + cola durable (claim atómico, backoff, rescate);
idempotencia (hash + re-embed solo pendientes); gate de relevancia con override; **rerank híbrido ya
presente** (base, no de cero); citas con locators + multi-scope; detección de escaneo, guardrails,
metering, streaming con recuperación ante fallo.

### 10.5 Brechas y riesgos

| # | Brecha | Evidencia | Impacto |
|---|---|---|---|
| R1 | Mono-modelo/provider embeddings, dim 1536 fijada | `embeddings.ts:11`, `schema.sql:98` | Cambiar de modelo = re-embeber todo |
| R2 | Léxico ingenuo en memoria (no BM25/`tsvector`), recall acotado al top-24 | `retrieval.service.ts:60-92` | Pierde términos exactos/fórmulas fuera del top vector |
| R3 | Sin reranker de modelo (cross-encoder) | — | Orden final sub-óptimo en consultas difíciles |
| R4 | Chunking fijo por chars, no estructural | `chunking.ts:21-35,74-93` | Tablas/fórmulas/listas mal partidas → contexto pobre |
| R5 | Generadores no recuperan: texto concatenado **truncado** | `study-gen.ts:275,342`, `ingestion.service.ts:53` | En cursos grandes se pierde material |
| R6 | Umbral de distancia único global (0.9), sensible al idioma | `retrieval.service.ts:30-39` | Frágil entre docs/idiomas |
| R7 | Sin transformación de query (HyDE, multi-query) | — | Preguntas mal redactadas recuperan mal |
| R8 | Sin OCR: escaneos fuera del índice | `document.service.ts:107` | PDFs imagen no estudiables |
| R9 | Worker drena inline en el request de subida | `worker-trigger.ts`, `document.service.ts:114` | Latencia de subida atada a LLM de graph/schedule |
| R10 | `searchByUser` escanea todos los chunks del usuario | `chunk.repo.ts:133-151` | Con muchos cursos, candidatos diluidos |
| R11 | Sin versión/migración de embeddings ni dedup de chunks | — | No hay camino seguro para cambiar de modelo |

### 10.6 Mapa: actual → visión multi-RAG (§8-9)

| Capa multi-RAG | ¿Hoy? | Qué hay / qué falta |
|---|---|---|
| Router/Planner | ❌ | Solo `selectModel` por tier; sin planner de recuperación/targeting |
| Orquestación (grafo) | ⚠️ parcial | Hay **cola de jobs** durable, pero no grafo de agentes con gates |
| Multi-índice | ⚠️ 1 de 4 | Solo **dense** (pgvector). Falta léxico, estructurado, banco de ítems |
| Hybrid search | ⚠️ proto | Rerank léxico **en memoria**; falta RRF real + reranker |
| Agentes | ⚠️ | Generadores monolíticos; falta especializar + verifier |
| Eval pipeline | ❌ | Solo guardrails de chat; sin faithfulness/answer-correctness/dedup offline |
| Multi-modelo | ❌ | Embedding y chat hardcodeados; falta `AGENT_MODELS` por rol |

### 10.7 Recomendaciones rápidas (alto ROI, bajo riesgo)

1. **R2/R3 — Hybrid real:** `chunks.ts tsvector` (GIN) + fusión **RRF** con el vector; opcional
   reranker (Cohere/Voyage). Reutiliza `rerankChunks` como fallback.
2. **R5 — Recuperación para generadores:** graph/schedule/study seleccionan chunks por relevancia/tema
   en vez de concatenar+truncar (cierra la "ironía RAG").
3. **R1/R11 — Capa de modelo de embedding:** `EMBEDDING_PROVIDER/MODEL` + columna versionada → evaluar
   `gemini-embedding-001`@1536 sin migrar índice (§9.2).
4. **R4 — Chunking estructural:** respetar encabezados/secciones y mantener tablas juntas.
5. **R9 — Desacoplar worker:** permitir corrida puramente por Cron para subidas grandes.
6. **R6 — Umbral adaptativo:** normalizar distancia por consulta/idioma en vez del 0.9 global.
