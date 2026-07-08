# Seguridad Aplicada — Syllabus Navigator

> Documento de revisión (2026-07-07). Resume qué se endureció en esta pasada, qué ya existía,
> qué sigue siendo visible desde DevTools (y por qué), y qué queda pendiente.

---

## 1. Cabeceras HTTP (lo que ve el navegador en cada respuesta)

**Archivo: `frontend/next.config.js`** — todo nuevo en esta pasada.

| Cabecera | Valor | Qué evita |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'` + orígenes de Clerk/Turnstile/Vercel Blob; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` | XSS con scripts externos, clickjacking, inyección de `<base>`/`<object>`, envío de formularios a otros dominios |
| `X-Frame-Options: DENY` | — | Clickjacking en navegadores viejos (redundante con `frame-ancestors`) |
| `X-Content-Type-Options: nosniff` | — | MIME-sniffing (ejecutar como script algo servido como texto) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Fugar URLs internas (con IDs de chats/sílabos) a sitios externos |
| `Permissions-Policy` | cámara, micrófono, geolocalización, pagos y USB deshabilitados | Abuso de APIs del navegador |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (solo producción) | Downgrade a HTTP |
| `X-DNS-Prefetch-Control: off` | — | Fugas por prefetch de DNS |
| `X-Powered-By` | **eliminada** (`poweredByHeader: false`) | Delatar framework/versión |

Solo para `/api/*`:

| Cabecera | Qué evita |
|---|---|
| `Cache-Control: no-store, max-age=0` | Que respuestas con datos por-usuario queden en caché del navegador/proxy |
| `X-Robots-Tag: noindex, nofollow` | Indexación de endpoints |

Notas sobre la CSP:
- `'unsafe-inline'` en `script-src` se mantiene porque Next.js 14 inyecta scripts inline sin pipeline de nonces. Es el punto más flojo de la CSP; ver "Pendientes".
- `'unsafe-eval'` y `ws:` solo se agregan en desarrollo (webpack HMR).
- `connect-src` permite `*.blob.vercel-storage.com` porque la subida de archivos grandes va directo del navegador a Vercel Blob.

## 2. Lo que se ve al inspeccionar peticiones (DevTools)

### Corregido en esta pasada

- **`/api/health` era público y verboso**: exponía mensajes de error crudos de la BD, lista de
  tablas requeridas/faltantes, adaptador de caché, uptime y `NODE_ENV`. Ahora un visitante
  anónimo solo ve `{ status, timestamp }`. El detalle completo requiere
  `Authorization: Bearer <CRON_SECRET>` (para monitores propios).
  Archivo: `frontend/app/api/health/route.ts`.
- **`/api/upload/blob` devolvía `err.message` crudo** al fallar (podía filtrar detalles del SDK
  o de configuración). Ahora: errores controlados (`ApiErrorResponse`) conservan su mensaje;
  cualquier otro error devuelve un texto genérico. El detalle real solo va al logger del servidor.
- **`X-Powered-By` eliminada** y respuestas de API con `no-store` (ver §1).

### Ya estaba bien (verificado, sin cambios)

- Todas las rutas de API devuelven **errores genéricos** en el catch-all 500 ("Failed to …");
  el mensaje real solo se registra server-side (`logError`). Los mensajes que sí llegan al
  cliente son los de `ApiErrorResponse` (validación/negocio, controlados).
- **Sin CORS abierto**: no se emite `Access-Control-Allow-Origin`; la API es same-origin.
- **CSRF**: la sesión Clerk usa cookies `SameSite=Lax` y los POST exigen cuerpo JSON
  (`request.json()`); un form cross-site no puede reproducirlo.
- El `x-trace-id` del middleware viaja solo en los **request headers internos**, no en la respuesta.
- `/api/db/migrate` deshabilitado (404 fijo).
- Secretos: nada server-side llega al bundle del cliente; los únicos `NEXT_PUBLIC_*` son la
  publishable key de Clerk (pública por diseño). Webpack además bloquea módulos de Node en cliente.

### Sigue visible a propósito (no es fuga)

- El evento SSE final del chat incluye `provider` y `model`: la UI lo muestra y el usuario elige
  su modelo en Settings; no es información sensible de infraestructura.
- `/api/usage` muestra costos estimados **del propio usuario** (feature de metering).
- Los UUIDs de chats/sílabos en URLs: cada ruta verifica pertenencia (`userId`) antes de responder;
  conocer un UUID ajeno devuelve 404.

## 3. Restricciones del chat

**Guardrails de entrada** (`frontend/src/lib/guardrails/input.ts`) — corren antes de llegar al LLM:

- Mensaje vacío → rechazado.
- Longitud máxima 4 000 caracteres (también validada por zod en la ruta).
- **Nuevo:** caracteres de control crudos (excepto `\n`, `\r`, `\t`) → rechazados
  (vector de instrucciones invisibles).
- **Nuevo:** patrones de prompt-injection ampliados a **español** ("ignora las instrucciones
  anteriores", "olvida tus instrucciones", "actúa como si no tuvieras restricciones", "eres DAN")
  y patrones de **extracción del system prompt** en ES/EN ("muestra tu prompt del sistema",
  "reveal your system prompt", `<|im_start|>`).
  - Calibrado para no bloquear preguntas legítimas ("muestra las instrucciones del laboratorio 3"
    pasa; hay test que lo cubre).

**Guardrails de salida** (`output.ts`, ya existían): strip de HTML, tope de 8 000 caracteres,
detección de que el LLM devuelva JSON de error/stack traces en vez de respuesta.

**Otras defensas del flujo de chat (ya existían, verificadas):**

- Autenticación obligatoria (Clerk) en toda la API; 401 si no hay sesión.
- **Ownership**: el chat se busca por `(chatId, userId)`; no se puede escribir en chats ajenos.
- **Rate limit por usuario**: 100 req/min autenticado, 10 guest, 5 anónimo (Upstash; fallback
  en memoria si no está configurado — degrada a limitar por instancia, nunca a "permitir todo").
- Validación zod de cada body (`api.schemas.ts`).
- Historial acotado (6 turnos) y agenda acotada (40 eventos) al construir el prompt.

## 4. Fetch de recursos externos (SSRF)

- **Nuevo — `fetchUrlText` (`src/lib/server/rag/chunking.ts`)**: al ingerir un enlace
  (`/api/upload/link`) ahora se valida **cada salto**:
  - Solo `http:`/`https:`; sin credenciales embebidas (`user:pass@`).
  - Bloqueados: `localhost`, `*.local`, `*.internal`, loopback, rangos privados IPv4
    (10/8, 172.16/12, 192.168/16, 169.254/16 **— metadata de nube —**, 100.64/10, 0/8)
    e IPv6 (::1, fc00::/7, fe80::/10, mapeos v4).
  - Redirecciones seguidas **manualmente** (máx. 5) re-validando cada destino
    (antes: `redirect: "follow"` sin ningún filtro → se podía sondear servicios internos).
  - Limitación conocida: la validación es por hostname; DNS-rebinding puro no se cubre
    (requeriría un cliente HTTP con pinning de resolución, no disponible en serverless fetch).
- **Ya existía:** `/api/upload/from-blob` solo acepta URLs de `*.blob.vercel-storage.com`
  (nunca URLs arbitrarias), con re-verificación de tamaño y magic bytes.

## 5. Subidas de archivos (ya existía, verificado)

- Tipo resuelto por **magic bytes** reales (`%PDF-`, `PK\x03\x04`), no por MIME declarado;
  conflicto MIME/extensión → rechazo.
- Límites: 4 MB multipart / 25 MB vía Blob; texto indexado acotado a 200 k caracteres.
- Token de subida directa a Blob: solo usuarios autenticados no-guest, tipos permitidos
  explícitos, tope de tamaño y sufijo aleatorio en el nombre.
- Guests: archivos efímeros (24 h) y sin almacenamiento en Blob.

## 6. Preferencias de usuario

- **Nuevo — `PATCH /api/user/preferences` validado con zod** (`UpdatePreferencesSchema`):
  `defaultProvider` ∈ {openai, deepseek, openrouter}, `theme` ∈ {dark, light, system},
  `language` ∈ {es, en}, `defaultModel` acotado a 64 chars con charset seguro.
  Antes se guardaba `String(body[key])` sin validar (cadenas arbitrarias a la BD).

## 7. Cron / operaciones (ya existía, verificado)

- `/api/cron/process` y `/api/cron/cleanup`: **fail closed** — sin `CRON_SECRET` configurado
  devuelven 500 y no ejecutan; con secret, exigen `Authorization: Bearer`.
- Migraciones solo por terminal (`npm run db:migrate`); el endpoint HTTP está muerto.

## 8. Tests

Nuevo `frontend/tests/security.test.ts` (8 tests, en la suite normal — 300/300 en verde):
guardrails (preguntas benignas ES/EN pasan; inyecciones ES/EN, caracteres de control y
overflow se bloquean) y guard SSRF (públicas pasan; file://, localhost, rangos privados,
metadata 169.254.169.254, credenciales embebidas se rechazan).

Verificación: `tsc --noEmit` limpio, ESLint limpio, `npm run build` de producción OK.

## 9. Pendientes recomendados (no aplicados)

1. **CSP con nonces** para eliminar `'unsafe-inline'` de `script-src` (requiere middleware que
   genere nonce por request y `next-safe`/manual wiring; invasivo, hacerlo con calma).
2. Verificar la CSP en producción real con Clerk en dominio propio (si se pasa de
   `*.clerk.accounts.dev` a `clerk.<dominio>`, añadir ese origen).
3. Configurar **Upstash** en producción para rate limit distribuido (el fallback en memoria es
   por instancia).
4. Los guardrails por regex son una primera línea, no un control fuerte: un atacante siempre
   puede parafrasear. La defensa real es que el system prompt no contiene secretos y el LLM no
   tiene herramientas destructivas.
5. Rotar `CRON_SECRET` si alguna vez se compartió por canales inseguros.
6. Opcional: mover el detalle de `/api/health` a rol admin además del bearer.
