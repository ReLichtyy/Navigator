# Plan expandido por tasks — Feedback global + Notion

> Fuente: [`feedback-notion-setup.md`](./feedback-notion-setup.md)  
> Estado: **en ejecución**  
> Rama de trabajo: `codex/feedback-notion`  
> Restricción acordada: las variables reales, la migración de Neon y el smoke test contra Notion
> se realizan al final, después de terminar el UI y la preconfiguración.

## 1. Secuencia de ejecución acordada

El orden práctico no será 0 → 5 de forma rígida porque la conexión real queda para el cierre:

1. **Task 0A — Preconfiguración sin secretos.** Contratos, nombres de variables y cliente diferido.
2. **Task 1 — Backend local.** Validación, tabla, repositorio, servicio y endpoint.
3. **Task 3 — Modal.** Formulario completo conectado al adapter interno.
4. **Task 4 — Launcher global.** Botón morado y comportamiento responsive.
5. **Task 2 — Sync preconfigurado.** Mapper, transporte, jobs e idempotencia sin llamadas reales.
6. **Task 5A — Verificación offline.** Tests, cobertura, lint, build y QA visual local.
7. **Task 0B/5B — Activación final.** Variables, migración, verificación de esquema y smoke test real.

Ningún import deberá fallar cuando falten `NOTION_ACCESS_TOKEN` o
`NOTION_FEEDBACK_DATA_SOURCE_ID`. En ese estado el feedback se guarda localmente como `pending` y
el UI recibe una confirmación de recepción, no un falso estado `synced`.

La activación también puede usar `NOTION_FEEDBACK_DATABASE_ID` en lugar del data source ID. Cuando
la database tiene una sola fuente, se descubre automáticamente; si tiene varias, se exige
`NOTION_FEEDBACK_DATA_SOURCE_NAME` para evitar escribir en la fuente equivocada.

## 2. User journeys convertidos en garantías

### Journey A — Acceso global

Como estudiante autenticado, quiero abrir Feedback desde cualquier área para comunicar un problema
sin abandonar mi contexto actual.

Garantías:

- El launcher se monta una sola vez y aparece en Chat, Knowledge, Estudio y Mapa.
- No aparece en sign-in, sign-up, callback SSO ni cuando la sesión es anónima/loading.
- En móvil no tapa la acción “Nuevo chat”.

### Journey B — Identidad correcta

Como estudiante, quiero reconocer la cuenta que enviará el feedback sin tener que escribir mi
nombre.

Garantías:

- El modal muestra `displayName` y avatar del `UserContext` como solo lectura.
- El request no contiene `personName`, `userId`, `createdAt` ni el ID final.
- El servidor vuelve a resolver el nombre desde la sesión actual y genera ID/fecha.

### Journey C — Envío seguro

Como estudiante, quiero saber que mi feedback fue recibido aunque Notion tenga una interrupción.

Garantías:

- Categoría y descripción se validan en cliente y servidor.
- Neon recibe el registro antes de intentar Notion.
- Un mismo `clientRequestId` no crea dos registros lógicos.
- Sin variables de Notion, la respuesta es `202 pending` y el contenido no se pierde.

### Journey D — Sincronización final

Como responsable del producto, quiero una fila por feedback en el data source correcto de Notion.

Garantías:

- El mapper genera exactamente `ID`, `Nombre de Persona`, `Fecha`, `Categoria` y `Descripcion`.
- Un sync exitoso guarda `notion_page_id`, `synced_at` y estado `synced`.
- Los reintentos consultan el `ID` antes de recrear un resultado ambiguo.

## 3. Task 0 — Preconfiguración y activación

### Task 0A — Ahora, sin valores reales

Archivos previstos:

- `frontend/.env.example`
- `frontend/src/lib/server/integrations/notion-feedback.ts`
- `frontend/package.json` y `package-lock.json`

Pasos:

1. Añadir a `.env.example` solo los nombres vacíos de las dos variables server-only.
2. Instalar el SDK oficial con una versión compatible con la API fijada en código.
3. Crear un getter diferido del cliente; nunca leer/validar secretos al importar el módulo.
4. Exponer `isNotionFeedbackConfigured()` para decidir entre sync inmediato y estado `pending`.
5. Crear errores tipados/sanitizados que no incluyan token ni payload.

Pruebas:

- Configuración ausente → `configured: false`, sin excepción de import/build.
- Configuración completa → construcción del transporte con versión API explícita.
- Solo una variable presente → estado no configurado y error operativo sanitizado al intentar sync.

Definición de terminado:

- Tests offline verdes.
- Build sin variables reales.
- `.env.local` permanece intacto.

### Task 0B — Al final, activación real

Responsabilidad compartida con el owner de Notion:

1. Crear/confirmar el data source; la aplicación prepara automáticamente sus cinco propiedades.
2. Añadir la conexión interna con `Insert content` y `Read content`.
3. Configurar valores reales en `.env.local` y Vercel sin compartirlos en chat/Git.
4. Ejecutar la preparación y verificación segura del esquema.
5. Aplicar la migración Neon.
6. Ejecutar un envío controlado y comprobar la fila en Notion.

Task 0B no se considera terminada con un token pegado en consola o documentación.

## 4. Task 1 — Modelo local, validación y endpoint

Archivos previstos:

- `frontend/src/lib/schema.sql`
- `frontend/src/lib/server/validators/api.schemas.ts`
- `frontend/src/lib/server/repositories/product-feedback.repo.ts`
- `frontend/src/lib/server/services/product-feedback.service.ts`
- `frontend/src/lib/server/utils/auth-helpers.ts` o helper de identidad dedicado
- `frontend/src/lib/rate-limit.ts`
- `frontend/app/api/product-feedback/route.ts`
- `frontend/src/lib/api.ts`
- `frontend/tests/product-feedback*.test.ts`

Contrato de entrada estricto:

```ts
{
  category: "Error" | "Sugerencia" | "Usabilidad" | "Contenido" | "Otro";
  description: string; // trim, 1..2000
  clientRequestId: string; // UUID
}
```

Contrato de salida:

```ts
{
  feedback: {
    id: string;
    createdAt: string;
    syncStatus: "pending" | "synced";
  }
}
```

Pasos:

1. Añadir tabla idempotente con checks de categoría, descripción y estado.
2. Crear índice único `(user_id, client_request_id)` e índice para drenar estados pendientes.
3. Escribir repositorio con `createOrGet`, `findById`, `markSynced` y `markPending`.
4. Resolver la identidad actual desde Clerk en servidor; fallback local solo si Clerk no aporta nombre.
5. Añadir rate limit dedicado por usuario antes de cualquier escritura.
6. Crear servicio con dependencias inyectables para poder mockear repo/sync.
7. Mantener la route delgada: auth → rate limit → Zod → service → response.
8. Añadir DTO y `submitProductFeedback()` al único adapter cliente.

Casos RED/GREEN:

- 401 sin sesión.
- 400 para categoría desconocida, descripción vacía/larga, UUID inválido o keys extra.
- 429 antes de persistir.
- 202 cuando queda `pending`.
- 201 cuando el sync devuelve `synced`.
- Repetir `(user, clientRequestId)` devuelve el mismo ID.
- El nombre/id/fecha del navegador son rechazados y nunca llegan al repositorio.

Definición de terminado:

- SQL solo en repositorio.
- Ningún secreto o descripción en logs.
- Tests de schema, route, service y repo verdes.
- No se ejecuta todavía `npm run db:migrate`.

## 5. Task 2 — Adaptador de Notion, jobs e idempotencia externa

Archivos previstos:

- `frontend/src/lib/server/integrations/notion-feedback.ts`
- `frontend/src/lib/server/services/product-feedback.service.ts`
- `frontend/src/lib/server/repositories/product-feedback.repo.ts`
- `frontend/src/lib/server/repositories/job.repo.ts` solo si falta una operación genérica
- `frontend/app/api/cron/process/route.ts`
- tests del mapper, sync y worker

Pasos:

1. Definir `NotionFeedbackPayload` independiente del SDK.
2. Crear un mapper puro de dominio → cinco propiedades Notion.
3. Crear `findByExternalId(id)` para reconciliación read-only.
4. Crear `createFeedbackPage(payload)` y devolver únicamente el page ID.
5. Clasificar errores: configuración, validación/permisos y transitorios.
6. En el servicio, intentar sync inmediato solo cuando la configuración esté completa.
7. Si falta configuración o el error es transitorio, conservar `pending` y encolar
   `product-feedback-sync` con `dedupeKey = feedbackId`.
8. Extender el cron para drenar esta clase de job sin bloquear ingest/study.
9. Antes de recrear después de un timeout ambiguo, buscar por `ID`; si existe, marcar `synced`.
10. En fallo permanente, guardar únicamente un código sanitizado y detener el retry al alcanzar
    `max_attempts`.

Casos RED/GREEN:

- Mapper exacto y límite de 2.000 caracteres.
- Configuración ausente no ejecuta llamadas de red.
- `429/529` respeta `Retry-After` mediante SDK/job.
- Timeout ambiguo + página existente no crea duplicado.
- Job duplicado devuelve el job pendiente existente.
- Sync exitoso actualiza estado una sola vez.

Definición de terminado:

- Cero llamadas reales durante tests.
- Todos los requests externos salen exclusivamente del módulo server-only.
- La ausencia de variables produce `pending`, no 500 durante build/render.

## 6. Task 3 — Modal y adapter cliente

Archivos previstos:

- `frontend/src/components/feedback/product-feedback-modal.tsx`
- `frontend/src/lib/ui/product-feedback.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/messages/es.json`
- `frontend/src/messages/en.json`
- tests de lógica de formulario/compliance

Estado local mínimo:

```ts
category;
description;
clientRequestId;
submitting;
fieldErrors;
```

Pasos:

1. Extraer catálogo, límite y validación de formulario a helper puro compartido con tests.
2. Construir `Dialog` controlado usando primitives existentes.
3. Mostrar avatar/iniciales y `displayName` en una tarjeta de solo lectura.
4. Asociar `Label`/IDs al Select y Textarea; errores con `role="alert"`.
5. Mostrar contador accesible `n/2000` y bloquear submit inválido/doble submit.
6. Generar `clientRequestId` al primer intento y conservarlo si el request falla.
7. En 201/202: toast de recepción, reset y cierre.
8. En error: conservar campos e ID de reintento; devolver foco al campo correspondiente.
9. Añadir textos ES/EN al catálogo existente.

Definición de terminado:

- Nombre visible, nunca editable ni incluido en el payload.
- Navegable con teclado y focus restaurado al launcher al cerrar.
- No hay fetch directo desde el componente.
- Estados pending/synced comparten un mensaje de recepción honesto.

## 7. Task 4 — Launcher global morado y responsive

Archivos previstos:

- `frontend/src/components/feedback/product-feedback-launcher.tsx`
- `frontend/src/components/ClientProviders.tsx`
- opcionalmente helper puro de visibilidad/placement
- tests de visibilidad y compliance

Pasos:

1. Consumir `usePathname()` y `useUser()` en un componente cliente pequeño.
2. Retornar `null` para sesión loading/anonymous y rutas de auth.
3. Montar el launcher una sola vez dentro de `UserProvider`.
4. Usar `Button` con icono y gradiente `#c084fc → #a855f7`; no cambiar `--accent`.
5. Escritorio: pill `Feedback` en esquina superior derecha.
6. Móvil: botón compacto bajo el header/safe-area para no cubrir “Nuevo chat”.
7. Ajustar `z-index` por debajo del `Dialog` y por encima del contenido normal.
8. Verificar contraste, focus ring, `aria-label` y target táctil mínimo.

Definición de terminado:

- Un solo launcher en el DOM.
- Sin colisión en 360 px de ancho.
- No modifica layout/scroll de las páginas.

## 8. Task 5 — Evidencia, QA y cierre

### Task 5A — Offline antes de variables

1. Ejecutar tests focalizados en cada ciclo RED/GREEN.
2. Ejecutar suite completa, lint, format check y build sin variables Notion.
3. Ejecutar coverage de los módulos nuevos y mantener al menos 80%.
4. Revisar el diff con reviewers TypeScript y React.
5. Hacer QA visual de escritorio/móvil en las cuatro áreas.
6. Crear `docs/testing/feedback-notion.tdd.md` con evidencia real.

### Task 5B — Con variables al final

1. Verificar el esquema real del data source.
2. Ejecutar `npm run db:migrate` en el entorno elegido.
3. Enviar un feedback de prueba autenticado.
4. Confirmar los cinco campos, estado local `synced` y ausencia de duplicados.
5. Probar temporalmente un fallo de integración controlado y comprobar el estado `pending`/retry.
6. Configurar las mismas variables en Vercel y repetir un smoke test de producción.

## 9. Matriz TDD de seguimiento

| Task | Garantía                             | Test objetivo                              | RED       | GREEN     |
| ---- | ------------------------------------ | ------------------------------------------ | --------- | --------- |
| 0A   | Build/import funciona sin variables  | `product-feedback-notion.test.ts`          | pendiente | pendiente |
| 1    | Body estricto y endpoint autenticado | `product-feedback.route.test.ts`           | pendiente | pendiente |
| 1    | Idempotencia local por request ID    | `product-feedback.repo.test.ts`            | pendiente | pendiente |
| 1    | Orquestación local-first             | `product-feedback.service.test.ts`         | pendiente | pendiente |
| 2    | Mapper exacto y sync reconciliado    | `product-feedback-notion.test.ts`          | pendiente | pendiente |
| 2    | Retry deduplicado                    | `product-feedback-worker.test.ts`          | pendiente | pendiente |
| 3    | Validación/estado del formulario     | `product-feedback-ui.test.ts`              | pendiente | pendiente |
| 4    | Visibilidad y montaje global         | `product-feedback-ui.test.ts` + compliance | pendiente | pendiente |
| 5    | No regresiones                       | suite/lint/build/coverage                  | pendiente | pendiente |

Esta tabla se actualizará con comandos y resultados reales; no se marcará GREEN por inspección
visual solamente.

## 10. Fuera de alcance de esta implementación

- Cambiar el contrato de votos positivo/negativo del chat.
- Enviar contenido académico, URL actual o historial de navegación a Notion.
- Exponer un panel administrativo de feedback dentro de Navigator.
- Pegar o versionar secretos.
- Ejecutar migraciones o llamadas reales antes de Task 0B/5B.
