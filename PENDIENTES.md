# Pendientes — planes de implementación

> Sustituye a `NEXT_STEPS.md` (borrado 2026-07-02; todo su log histórico está en git history).
> Solo contiene lo que FALTA. Referencia estable de estructura: `CLAUDE.md`.
> Descartados a propósito (selección del usuario 2026-07-02): SQL crudo de
> user/preferences|feedback|cron/cleanup → repos; B4 pre-calentar quiz bank; cron a */5.

---

## Ops / infra (checklist corto)

- [ ] **Railway — EXPORTAR DATOS antes de apagar.** Confirmado (2026-07-02): el FastAPI viejo
      sigue desplegado en Railway CON datos que importan. El código fuente ya no está en el
      repo (borrado 2026-06-23; recuperable de git history). Acción: dump de su DB/Chroma
      (o al menos los uploads/syllabi que no existan ya en Neon) → luego apagar el servicio
      para dejar de pagar. Sin esto NO apagar nada.
- [ ] **Vercel**: verificar que `BLOB_READ_WRITE_TOKEN` está seteado (sin él los PDFs de
      cuenta no se persisten; degrada con warning en logs). CLI de Vercel no instalada en
      esta máquina — revisar en dashboard (Settings → Environment Variables).

---

## Modal de Configuración (diseño `Configuracion.dc.html`, proyecto Claude Design)

> Se abre desde el botón de perfil del sidebar (el dropdown que hoy solo tiene
> "Cerrar sesión") y desde el bloque de perfil del drawer móvil. Es un **modal**
> (no página): sidebar interno con 6 secciones — Perfil, Cuenta, Preferencias de
> estudio, Notificaciones, Apariencia, Plan y facturación. En el diseño solo
> Perfil y Preferencias de estudio tienen contenido; el resto son placeholders.

### Fase 1 — UI + persistencia (2026-07-08, en curso)

- [x] **DB**: `user_preferences.profile JSONB DEFAULT '{}'` (idempotente en `schema.sql`).
      ⚠️ Falta correr `npm run db:migrate` — esta máquina no tiene `.env.local`/`DATABASE_URL`;
      correrlo donde sí esté (o desde Vercel/Neon console). Sin la columna, GET/PATCH de
      preferencias fallan con "column does not exist".
      Guarda: fullName, displayName, career, school, level,
      tone, detail y `study{difficulty, cardFormat, questionCount, sessionLen, spaced,
      mixSubjects}`. `language` sigue en su columna propia (es/en).
- [x] **API**: `UpdatePreferencesSchema` gana `profile` (zod acotado, enums cerrados);
      GET/PATCH `/api/user/preferences` leen/escriben la columna (reemplazo completo del
      objeto, no merge — el cliente siempre manda el profile entero).
- [x] **Adapter** (`src/lib/api.ts`): `UserProfileAPI` + `profile` en `UserPreferencesAPI`.
- [x] **UI**: `src/components/settings/settings-modal.tsx` — Dialog 940px fiel al diseño;
      en `<md` el sidebar interno se vuelve chips horizontales y el modal ocupa la pantalla.
      Footer sticky con estado sucio ("Cambios sin guardar") + Guardar; toast vía sonner.
- [x] **Anclaje**: item "Configuración" en el dropdown del perfil (`app-sidebar.tsx`) y
      botón de engranaje en el bloque de perfil del drawer móvil (`mobile-nav.tsx`).

### Decisiones de producto (usuario, 2026-07-08)

- **Cuenta**: UI propia fiel al diseño + API de Clerk. **Sin contraseña** (login es
  Google/OAuth): solo correo y sesiones activas.
- **Plan y facturación**: solo informativo, 2 planes — Gratis (con límites) y Pro **$7**
  (más almacenamiento de cursos, etc.). **Ningún pago se aplica** (sin Stripe).
- **Apariencia**: solo tema dark/light/system (sin acento ni densidad).
- **Notificaciones**: queda PENDIENTE — solo se documenta el pseudo-proceso (fase 7).

### Fase 2 — Perfil: consumir lo guardado ✅ (2026-07-08)

- [x] **Chat**: `chat.service#buildStudentDirectives` inyecta `profile.tone`/`detail` +
      `career`/`level`/`displayName`/`school` como bloque "PERFIL DEL ESTUDIANTE" en el
      system prompt. Prefs leídas vía `lib/server/utils/user-prefs.ts#getUserPrefs` (cache
      120s, misma key que la ruta `/api/user/preferences`; PATCH la invalida).
- [x] **Idioma**: `language` per-user → `StudyGenOptions.language` en `study.service`
      (getStudySet/getCourseStudySet/quiz-stage y web-search) vía `getUserPrefs`.
- [x] **Avatar**: `blob.ts#storeAvatar` (png/jpg/webp) + rutas `POST/DELETE /api/user/avatar`
      (límite 2MB, resize a 256px webp en cliente). URL en `users.image`
      (`user.repo#getUserImage/setUserImage`); GET de preferencias devuelve `avatarUrl`.
      `UserContext` expone `avatarUrl` (custom → foto de Clerk → null) y `setAvatarUrl`;
      se muestra en modal, sidebar y drawer.

### Fase 3 — Preferencias de estudio: conectar al Study Engine ✅ (2026-07-08)

> `study.service#getStudyPrefs` mapea las etiquetas ES del perfil a los enums del engine.

- [x] `profile.study.difficulty` → default del `?difficulty` (el query param explícito
      sigue ganando; "Adaptativa" = sin default, difficulty automática). Ojo: solo un
      `?difficulty` EXPLÍCITO marca el set como custom — la pref moldea el set por defecto
      cacheado (aplica al próximo refresh, no retroactivo).
- [x] `questionCount` (5/10/15) → tamaño de etapa del quiz (`QuizStage.size`, buffer
      escalado). El cliente `quiz-view` usa `stageSize` dinámico (fallback 15).
- [x] `sessionLen` (15/25/45) → presupuesto de items en `planner#getTodaySession`.
- [x] `spaced` OFF → la sesión de hoy omite la pata SRS (solo orden por plan);
      `mixSubjects` ON → intercala items del bank de otros cursos procesados.
- [x] `cardFormat` → `StudyGenOptions.cardFormat` → hint al agente flashcard (`agents/flashcard`).

### Fase 4 — Cuenta (UI propia + API de Clerk; sin contraseña) ✅ (2026-07-08)

> `src/components/settings/account-section.tsx` (tipo de sesión inferido del hook de Clerk,
> sin dep directa en `@clerk/types`).

- [x] **Correo**: email primario de `useUser()` + badge "Conectado con Google"
      (`externalAccounts`). Cambio de correo NO (lo gobierna Google OAuth).
- [x] **Sesiones activas**: `user.getSessions()` → dispositivo/navegador + última actividad,
      marca "Esta sesión"; "Cerrar" por sesión (`session.revoke()`) y "Cerrar todas las demás".
- [x] **Zona de peligro — eliminar cuenta**: confirm de doble paso (escribir "ELIMINAR") →
      `DELETE /api/user` (`user.repo#deleteUser`: borra chats + syllabus_uploads explícitos
      —FK TEXT sin cascade— y el row de users; el resto cascadea; devuelve blobs a limpiar)
      y DESPUÉS `user.delete()` de Clerk. Neon primero: un fallo de Clerk deja el row re-vinculable.

### Fase 5 — Apariencia (solo tema) ✅ (2026-07-08)

> Helper `src/lib/ui/theme.ts` (applyTheme/syncThemeClass/storedTheme/watchSystemTheme).

- [x] Tokens light: ya existían en `:root` de `globals.css`. Se quitó la `class="dark"`
      fija del `<html>`; el script anti-FOUC decide la clase.
- [x] Selector dark/light/system (3 cards con swatch) en la sección Apariencia; aplica en
      vivo y persiste la columna `theme` en el footer "Guardar".
- [x] Anti-FOUC: script inline en `layout.tsx` lee `localStorage("nav-theme")` antes de
      hidratar; `UserContext` sincroniza desde la pref del server al cargar + listener de
      `prefers-color-scheme` para "system".
- [~] Hex hardcodeado: **el propio `settings-modal` queda dark-only documentado** (usa hex
      fijos); el resto de la app usa tokens y cambia bien. Sign-in/bienvenida/mind-map
      pendientes de repaso si se quiere modo claro pulido en esas superficies.

### Fase 6 — Plan y facturación (informativo, sin pagos) ✅ (2026-07-08)

> `src/components/settings/billing-section.tsx`.

- [x] Dos cards **Gratis** ($0) y **Pro — $7/mes**. NOTA: `rbac.ts` solo define el enum de
      roles y `rate-limit.ts` no distingue free/pro (auth = 100 req/min; un único modelo
      tier "free" en `llm/config.ts`). Como no hay límites por tier en el código, las
      features se describen de forma cualitativa — **no se inventaron cifras**.
- [x] Badge "Tu plan actual" según el rol (`admin`/`pro` → Pro; resto → Gratis).
- [x] Uso del período desde `/api/usage` (solicitudes, tokens, costo estimado).
- [x] Botón "Mejorar a Pro" deshabilitado con "Próximamente". Sin Stripe.

### Fase 7 — Notificaciones (PENDIENTE — no implementar; pseudo-proceso acordado)

> Se deja documentado el proceso completo para cuando se decida activarla.

1. **Prefs**: `profile.notifications = { emailReminders: bool, pushReminders: bool,
   hour: "HH:00", weeklySummary: bool }` (extender `UserProfileSchema` + UI de toggles
   + selector de hora en la sección del modal).
2. **Disparo**: cron de Vercel `GET /api/cron/notify` (gateado por `CRON_SECRET`, como
   `cron/cleanup`) corriendo cada hora → selecciona usuarios con `hour` = hora actual
   (guardar TZ del usuario o asumir una).
3. **Contenido**: por usuario, armar el digest con lo que ya existe — tarjetas SRS
   vencidas (`planner#getTodaySession`), eventos próximos del cronograma
   (`schedule_events`) y racha en riesgo (`study/stats`).
4. **Canales**: email vía proveedor por decidir (Resend es el candidato natural en
   Vercel; requiere API key + dominio verificado). Push web: service worker + VAPID
   (`web-push`) — segunda etapa, el email va primero.
5. **Registro**: tabla `notification_log (user_id, kind, sent_at)` para no duplicar
   envíos y poder mostrar "último recordatorio" en la UI.

### Fase 8 — Limpieza (cosas que ya no se necesitan)

> Clerk es el ÚNICO servicio de auth (NextAuth se eliminó). Plan de Clerk: verificar en
> dashboard.clerk.com → Billing (se asume Free ~10k MAU; todo lo que usa la fase 4 —
> sesiones, revoke, delete, Google OAuth — está en el plan gratis). Verificar también si
> las claves de prod son `pk_live_` o siguen `pk_test_`.

- [x] **Página `/settings` vieja**: retirada → redirige a `/` y deja un flag
      (`lib/ui/settings-intent.ts`, sessionStorage) que `app-sidebar` consume al montar para
      abrir el modal. (2026-07-08)
- [x] **Rutas legacy `(auth)/login` y `(auth)/signup`** + su `layout.tsx`: borradas (nada
      enlazaba a `/login`/`/signup`); se quitó la excepción del array de rutas en
      `app-sidebar.tsx`. (2026-07-08)
- [x] **Bluesmind (gateway muerto 2026-07-01)**: quitado el provider (`AgentProvider`,
      cliente + rama en `agents/_base.ts`); envs fuera de `.env.example` (y añadido
      `DEEPSEEK_API_KEY` que faltaba); `gateway-generate.ts` → **`rag-generate.ts`**
      (`gatewayJson`→`ragJson`, `RAG_GATEWAY_MODEL`→`RAG_MODEL`). Falta quitar las envs en
      **Vercel** (dashboard). (2026-07-08)
- [x] **`deepseek-reasoner` grader sin uso**: rol `grader` eliminado de `agent-models.ts`. (2026-07-08)
- [x] **`/api/db/migrate`**: ruta borrada (el migrate es por `npm run db:migrate`). (2026-07-08)
- [x] **`npm run knip`**: revisado. Único hallazgo de código nuevo (dep `@clerk/types` no
      listada) resuelto infiriendo el tipo. `ui/label.tsx` + `ui/select.tsx` quedan
      huérfanos al retirar `/settings` vieja pero se **conservan** (primitivos del design
      system, reutilizables); resto del reporte es pre-existente. (2026-07-08)
- [ ] **Railway** (ya listado en Ops): tras exportar datos, apagar el servicio viejo.
