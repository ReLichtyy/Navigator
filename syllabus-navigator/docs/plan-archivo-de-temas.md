# Plan — Lógica del "Archivo de temas" (Knowledge)

> Estado del plan: **propuesto** (2026-07-16). La sección ya existe como lista de solo lectura;
> este documento define cómo convertirla en un hub interactivo por tema.

## 1. Estado actual (integración verificada 2026-07-16)

Cadena completa, funcionando:

```
TopicsArchive (src/components/knowledge/topics-archive.tsx)
  → fetchTopicsArchive()            src/lib/api.ts  (GET /api/topics)
    → app/api/topics/route.ts       requireAuth → agrupa filas por curso
      → GraphRepository.listUserTopicsByCourse   (graph.repo.ts)
        → SELECT DISTINCT ... FROM topics
          JOIN syllabus_uploads (del usuario)
          LEFT JOIN courses
          WHERE t.level = 1          ← solo temas-título (ramas principales)
          ORDER BY curso, label
```

Puntos verificados:

- `topics.level` se persiste tal cual lo emite `graph-gen` (nivel 1 = ramas principales del
  mapa, es decir los "títulos"); filas antiguas tienen `DEFAULT 1`, así que ningún documento
  desaparece del archivo.
- `DISTINCT` deduplica labels idénticos dentro de un mismo curso (varios docs con el mismo tema).
- Usuario anónimo/guest → 401 → el componente lo captura y la sección se oculta (igual que
  cuando no hay temas).
- Los chips con curso enlazan a `/estudio?course=<id>`; los de "Sin curso" son spans inertes.

Limitaciones actuales (lo que este plan resuelve):

1. **Solo lectura a nivel curso**: el chip lleva al área de estudio del curso, no del tema.
2. **Sin señal de dominio**: no se ve qué temas están flojos (existe `topic_mastery` y no se usa).
3. **Sin refresco**: se consulta una vez al montar; un documento nuevo no aparece hasta recargar.
4. **Fuera de la búsqueda**: el buscador de la página filtra cursos/documentos, no temas.
5. **"Sin curso" muerto**: sus chips no llevan a ningún sitio.

## 2. Objetivo

Que cada tema-título sea accionable: verlo en el mapa, estudiarlo directamente, y leer de un
vistazo el nivel de dominio. El archivo pasa de "índice" a "panel de control por tema".

## 3. Fases

### Fase 1 — Enriquecer los datos (backend)

**Archivos**: `graph.repo.ts`, `app/api/topics/route.ts`, `src/lib/api.ts` (tipos).

- Ampliar `listUserTopicsByCourse` para devolver por tema: `topic_id`, `syllabus_id`,
  `weight_percent`, y el dominio (`confidence`, `attempts`) con
  `LEFT JOIN topic_mastery ON topic_key`. **Clave**: reutilizar el normalizador `topicKey()`
  de `mastery.repo.ts` (el mismo que usan study/exam) para que el join no falle por
  mayúsculas/acentos — normalizar el label del topic en SQL o hacer el match en el servicio.
- Deduplicación mejorada: colapsar labels casi idénticos entre documentos del mismo curso
  (comparar por `topicKey(label)`, no por label crudo).
- Nueva forma de respuesta:
  ```ts
  { courses: [{ course_id, course_name, course_color,
      topics: [{ id, label, syllabus_id, weight, mastery: { confidence, attempts } | null }] }] }
  ```
- Cache L1 (120s, clave por usuario) e invalidación al guardar un grafo
  (`GraphRepository.saveGraph`) — mismo patrón que `user-prefs`.

### Fase 2 — Acciones por tema (frontend + deep-links)

**Archivos**: `topics-archive.tsx`, `app/estudio/page.tsx`, `app/mapa/page.tsx` (si aplica).

- Chip → menú contextual (DropdownMenu de `components/ui`):
  - **Estudiar este tema** → `/estudio?course=<id>&topic=<label>`. La API de estudio ya
    acepta `?topic=` (`study/[syllabusId]` y `study/course/[courseId]`); falta que la página
    `/estudio` lea el param `topic` (hoy solo lee `course` y `mode`) y lo pase al fetch.
  - **Ver en el mapa** → `/mapa?course=<id>&focus=<topicId>` (el canvas ya soporta centrar
    nodos; añadir lectura del param).
  - **Preguntar en el chat** → abrir chat del curso/documento con el tema pre-cargado en el
    composer (vía `findOrCreateChatForDoc` + query param).
- "Sin curso": habilitar "Estudiar" usando el `syllabus_id` del tema
  (`/estudio?course=<syllabus_id>` ya funciona como fallback por documento).

### Fase 3 — Dominio visual (mastery)

**Archivos**: `topics-archive.tsx`.

- Pintar cada chip según `confidence`: sin datos = neutro; <0.4 = ámbar; ≥0.7 = verde acento.
- Tooltip con `attempts`/`correct` ("3/5 correctas · dominio 60%").
- Contador en la cabecera del grupo: "12 temas · 4 por reforzar".

### Fase 4 — Refresco y búsqueda

**Archivos**: `app/knowledge/page.tsx`, `topics-archive.tsx`.

- Exponer un `refreshKey`/callback desde la página: cuando el polling de `fetchUploads` detecta
  un `graph_status` que pasa a `ready`, re-disparar el fetch del archivo (prop `reloadToken`).
- Conectar el buscador existente: pasar `searchQuery` como prop y filtrar chips por label
  (además del filtro actual de cursos/documentos). Grupo sin coincidencias → oculto.

### Fase 5 — Fuente alternativa: mapa de curso (opcional, evaluar al llegar)

Cuando un curso tiene mapa regenerado a nivel curso (`course_graphs`), sus ramas de nivel 1
pueden ser mejores "títulos" que la unión de los grafos por documento. Opción: preferir
`course_graphs.source` si existe, con fallback a la consulta actual. Decidir con datos reales
(¿difieren mucho ambas listas?).

## 4. Orden y tamaño estimado

| Fase | Alcance | Archivos tocados |
|---|---|---|
| 1 | SQL + route + tipos | 3 |
| 2 | Menú por chip + params en /estudio (y /mapa) | 3-4 |
| 3 | Solo presentación | 1 |
| 4 | Prop drilling + filtro | 2 |
| 5 | Evaluar; posible cambio de fuente | 1-2 |

Las fases 1→2 son el núcleo (tema accionable); 3 y 4 son incrementales e independientes entre sí.

## 5. Riesgos

- **Mismatch de claves de dominio**: `topic_mastery.topic_key` se genera desde los labels de
  los ítems de estudio, no desde los nodos del grafo; si los labels difieren, el join devuelve
  null y el chip queda neutro (degradación aceptable, pero medir cobertura real en Fase 1).
- **Cardinalidad**: usuarios con muchos documentos → muchos temas nivel 1 por curso; el cap de
  7 ramas por documento en `graph-gen` lo acota (~7 × docs), pero conviene `LIMIT` defensivo
  o colapso por `topicKey` desde la Fase 1.
- **`?topic=` en /estudio**: el set generado por tema no debe pisar el cache del set por
  defecto del curso (el status endpoint solo reporta el set default) — revisar claves de cache
  de `study.service` al implementar Fase 2.
