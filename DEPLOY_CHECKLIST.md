# Deploy Checklist — Syllabus Navigator (Vercel + Neon)

> Pre-flight accionable. Marca conforme avanzas. Plan narrativo completo en `NEXT_STEPS.md` §4.
> Root Directory en Vercel = **`syllabus-navigator/frontend`**.

## 0. Pre-deploy (local, ya verificado)
- [x] `tsc --noEmit` limpio
- [x] `npm test` → 189 tests verdes (24 archivos)
- [x] CI `.github/workflows/ci.yml` correrá `tsc` + tests en push/PR
- [x] `npm run build` (production build) pasa — 21 rutas + 4 páginas (limpia `.next` si ves
      `PageNotFoundError /_document`: es cache vieja, no un bug)

## 1. Neon (Postgres)
- [ ] Crear proyecto Postgres
- [ ] Habilitar `pgvector` (el schema hace `CREATE EXTENSION vector`; requiere permiso)
- [ ] Copiar **`DATABASE_URL`** (pooled) y **`DATABASE_URL_DIRECT`** (direct)
- [ ] `npm run db:migrate` (aplica `src/lib/schema.sql`) — usar `DATABASE_URL_DIRECT`

## 2. Vercel — Proyecto
- [ ] New Project → repo `ReLichtyy/Navigator`
- [ ] **Root Directory = `syllabus-navigator/frontend`**
- [ ] Framework: Next.js (autodetect). Build = `vercel-build` (`next build`)

## 3. Vercel — Env Vars
Requeridas:
- [ ] `AUTH_SECRET` — `npx auth secret` (o `openssl rand -hex 32`)
- [ ] `NEXTAUTH_URL` — la URL pública de Vercel (ej. `https://navigator.vercel.app`)
- [ ] `DATABASE_URL` — Neon pooled
- [ ] `DATABASE_URL_DIRECT` — Neon direct
- [ ] `OPENAI_API_KEY`
- [ ] `CRON_SECRET` — `openssl rand -hex 32`. **Crítico**: sin él los cron fallan cerrado (500)
      y el worker de upload no se auto-dispara. Vercel lo inyecta como
      `Authorization: Bearer <CRON_SECRET>` en los cron.

Opcionales:
- [ ] `OPENROUTER_API_KEY` — modelos fallback/extendidos
- [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — sin esto cache/rate-limit
      caen a memoria (se reinician en cold start; rate-limit efectivamente off)
- [ ] `BLOB_READ_WRITE_TOKEN` — Storage → Blob en Vercel lo genera. Sin él, uploads de
      cuenta funcionan pero **no** guardan el PDF original (degrada con warning)

## 4. Crons (`vercel.json`)
Ambos en **diario** (`0 0 * * *`) por límite del plan **Hobby**:
- [ ] `/api/cron/cleanup` — borra uploads de invitado expirados
- [ ] `/api/cron/process` — red de seguridad para jobs atascados
- [ ] **Si plan Pro:** subir `/api/cron/process` a `*/5 * * * *` o `0 * * * *` (latencia worker)

> El camino feliz NO depende del cron: el upload dispara el worker fire-and-forget vía
> `triggerIngestionWorker` (necesita `CRON_SECRET` + URL base). El cron es solo backstop.

## 5. Deploy + smoke test (post-deploy)
- [ ] Deploy → URL pública
- [ ] `GET /api/health` responde OK
- [ ] Signup / login funciona
- [ ] Subir PDF → status `processed` (no `error`)
- [ ] Chat sobre el PDF → respuesta con `citations` reales
- [ ] `GET /api/graph/{id}` → nodos/edges (no 404)
- [ ] Borrar upload → desaparece; reprocess grafo → pending → ready

## Notas
- FastAPI **no** se despliega (solo referencia). Docs antiguos en `docs/` son histórico.
- `middleware.ts` deja públicos `/`, `/login`, `/signup`, `/api/auth`, `/api/health`, `/api/cron`.
