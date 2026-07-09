# Pendientes — planes de implementación

> Sustituye a `NEXT_STEPS.md` (borrado 2026-07-02; log histórico en git history).
> Solo contiene lo que FALTA + un resumen corto de lo cerrado reciente. Referencia
> estable de estructura: `CLAUDE.md`.
> Descartados a propósito (selección del usuario 2026-07-02): SQL crudo de
> user/preferences|feedback|cron/cleanup → repos; B4 pre-calentar quiz bank; cron a */5.

---

## Ops / infra (checklist corto)

- [ ] **Railway — EXPORTAR DATOS antes de apagar.** FastAPI viejo sigue desplegado en
      Railway CON datos que importan (código ya borrado, recuperable de git history).
      Acción: dump DB/Chroma (uploads/syllabi no migrados a Neon) → luego apagar el
      servicio. Sin esto NO apagar nada.
- [ ] **Vercel**: verificar `BLOB_READ_WRITE_TOKEN` seteado (Settings → Environment
      Variables) — sin él los PDFs de cuenta no persisten (degrada con warning).
- [ ] **Vercel**: quitar envs de Bluesmind (gateway muerto) del dashboard — código ya
      limpio, solo faltan las envs.

---

## Notificaciones (Fase 7 del modal Configuración — pendiente implementar)

> Pseudo-proceso acordado 2026-07-08, prefs (`emailReminders/pushReminders/hour/
> weeklySummary`) y UI de toggles aún no existen.

1. **Prefs**: `profile.notifications = { emailReminders: bool, pushReminders: bool,
   hour: "HH:00", weeklySummary: bool }` (extender `UserProfileSchema` + toggles/hora
   en la sección Notificaciones del modal).
2. **Disparo**: cron Vercel `GET /api/cron/notify` (gateado `CRON_SECRET`, como
   `cron/cleanup`) cada hora → usuarios con `hour` = hora actual (TZ por decidir).
3. **Contenido**: digest con lo existente — SRS vencidas (`planner#getTodaySession`),
   eventos próximos (`schedule_events`), racha en riesgo (`study/stats`).
4. **Canales**: email vía Resend (candidato natural en Vercel, requiere API key +
   dominio verificado) primero; push web (service worker + VAPID/`web-push`) después.
5. **Registro**: tabla `notification_log (user_id, kind, sent_at)` — evita duplicados,
   habilita "último recordatorio" en UI.

---

## Cerrado reciente (resumen — detalle completo en git history / commits 2026-07-08)

- ✅ **Modal de Configuración** (diseño `Configuracion.dc.html`): 6 secciones — Perfil,
  Cuenta, Preferencias de estudio, Notificaciones (placeholder, ver arriba), Apariencia,
  Plan y facturación. UI + persistencia (`user_preferences.profile` JSONB), Study Engine
  conectado a preferencias (difficulty/questionCount/sessionLen/spaced/mixSubjects/
  cardFormat), Cuenta vía Clerk (sesiones, borrar cuenta), tema dark/light/system, Plan
  informativo sin Stripe.
- ✅ **Limpieza**: `/settings` vieja → redirect+flag; rutas legacy `(auth)/login`,
  `(auth)/signup` borradas; Bluesmind (gateway muerto) removido del código;
  `deepseek-reasoner` grader sin uso eliminado; `/api/db/migrate` borrada; `knip`
  revisado (sin huérfanos nuevos accionables).
- ✅ **Mapa mental — Sistema A: jerarquía real 3+ niveles, 4 layouts, cross-links**
  (2026-07-08). `topics` gana `parent_topic_id/level/color/sort_order` (árbol
  presentacional, separado del DAG de prerrequisitos en `topic_dependencies`);
  `syllabus_uploads.layout`; tabla nueva `topic_cross_links`. `graph-gen.ts` reescrito:
  prompt nuevo codifica las 5 reglas (jerarquía mínima 3 niveles, keywords ≤4 palabras +
  `detail` separado, LLM elige 1 de 4 layouts, crossLinks etiquetados, weight por rama
  proporcional a cobertura real), `validateTree` + `validateNoCycles` refactorizado.
  `graph.repo.ts#replaceGraph` reescrito a batch inserts (patrón `chunk.repo.ts`), color
  asignado server-side (nunca output del LLM). Contrato API extendido (`GraphResponseAPI`
  gana `layout/crossLinks/nodes[].{level,parent_id,detail,color}`), `graph-edit.ts` gana
  `applyTreeEdits` (recursion-aware: cascade-delete, add-child en cualquier nivel, reorder
  sibling-scoped) — el editor viejo `applyBranchEdits` queda intacto para grafos legacy.
  Cliente: `src/components/estudio/mind-map/` (build-tree + 4 algoritmos de layout:
  radial=subdivisión angular recursiva real, tree_horizontal/vertical=tidy-tree, 
  columns_report=reusa patrón de `cross-galaxy.tsx`) + `rich-mind-map-canvas.tsx` (nuevo,
  canvas+editor). `GraphCanvas.tsx` es el switch point: `layout!==null` → canvas nuevo,
  `layout===null` (grafo legacy sin reprocesar) → canvas viejo sin cambios. **Sistema B
  (`/mapa`, `mind-map-canvas.tsx`, `mind-mode-options.ts`) NO se tocó** — cero diffs,
  confirmado. Sin backfill forzado: grafos existentes migran al reprocesar ("Reintentar
  generación"/"Regenerar desde cero"). Migración corrida contra Neon (86 OK, 0 errores).
  Typecheck + lint + 314 tests (incl. 24 nuevos de `applyTreeEdits`) en verde.
  Plan completo: `~/.claude/plans/ethereal-swimming-quilt.md`.
- ✅ **Mapa mental v2 — consolidación: botar Galaxy + Sistema B, `/mapa` jerárquico,
  navegación** (2026-07-08). **Galaxy borrada**: `cross-galaxy/cross-roadmap/
  cross-course-view/cross-graph.service/api graph cross` + `fetchCrossGraph`/`CrossGraph*API`
  + `listUserTopics`/`listUserEdges`. **Sistema B botado completo**: `mindmapAgent` fuera de
  `orchestrateStudySet` (3 agentes vs 4 = **ahorro de 1 LLM/generación de study-set**),
  borrados `mind-map-canvas`/`mind-blocks-view`/`mind-mode-options`/`agents/mindmap` +
  `MindView` (conservado `ResumenView`); `Mindmap`/`MindMode`/`pickMindMode`/campo `mindmap`
  fuera de `study-gen`/`study.service`/rutas study/`api.ts` (`STUDY_SCHEMA_VERSION` 5→6
  invalida cache); `combine-study` sin `fuseMindmaps` (conservado `combineStudySets`);
  `GraphCanvas` ahora SIEMPRE `RichMindMapCanvas` (`layout ?? "radial"` cubre grafos legacy —
  se eliminó la rama dual-canvas + `applyBranchEdits`/`rootIds`/`toMindmap`). **`/mapa`
  reescrito** = home jerárquico Sistema A: selector curso→doc→`RichMindMapCanvas` editable
  (`fetchGraph`/`updateGraph`/`reprocessGraph` + poll), deep-link `?course=`, `SelectionAsk`;
  `/estudio` modo "mind" rutea a `/mapa`. **Navegación** en `rich-mind-map-canvas`:
  colapsar/expandir subárboles (`pruneCollapsed` en `build-tree`), click-para-enfocar
  (centrar+zoom+dim), buscar/saltar a nodo (con auto-expand de ancestros), opciones de vista
  (profundidad 1/2/3/Todo, toggle cross-links, toggle pesos). Sin minimapa. Typecheck + lint +
  `next build` verde; 296 tests pasan (2 fallos pre-existentes ajenos = refactor i18n en
  `settings-modal`/`app-sidebar`). **PENDIENTE (usuario, después): descargar mapa como
  imagen** — plan en fase 5 del plan file (`html-to-image` vs export SVG manual).

---

## Nuevos planes

> (vacío — siguiente implementación se agrega acá)
