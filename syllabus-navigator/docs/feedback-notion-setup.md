# Setup y plan inicial — Feedback global conectado a Notion

> Estado: **en ejecución**  
> Fecha: **2026-07-21**  
> Alcance de este documento: preparar la integración y dividirla en tareas. La implementación
> se ampliará y ejecutará tarea por tarea.

El detalle operativo, orden acordado y matriz TDD viven en
[`feedback-notion-tasks.md`](./feedback-notion-tasks.md).

## 1. Objetivo

Agregar un botón morado de **Feedback** visible en todas las páginas de la aplicación para los
usuarios autenticados. El botón abrirá un modal y cada envío terminará registrado en una base de
datos específica de Notion con estos campos:

| Campo en Notion     | Tipo      | Origen                                                 |
| ------------------- | --------- | ------------------------------------------------------ |
| `ID`                | Title     | UUID generado por el servidor                          |
| `Nombre de Persona` | Rich text | Cuenta autenticada de Clerk, resuelta por el servidor  |
| `Fecha`             | Date      | Fecha/hora generada por el servidor                    |
| `Categoria`         | Select    | Selección obligatoria del usuario                      |
| `Descripcion`       | Rich text | Texto obligatorio del usuario, máximo 2.000 caracteres |

El nombre se mostrará en el modal como identidad de la cuenta activa, pero no será editable ni se
aceptará desde el navegador como dato confiable.

## 2. Estado actual verificado

- Ya existe `POST /api/feedback`, pero corresponde únicamente a los votos positivo/negativo de
  respuestas del chat. Exige `message_id` y `rating`, y escribe en la tabla `feedback` de Neon.
- El nuevo formulario es feedback de producto y no debe reutilizar ese contrato. Se propone
  `POST /api/product-feedback` y una tabla independiente `product_feedback`.
- `UserContext` ya expone `displayName` y `avatarUrl`. El nombre se deriva de Clerk con esta
  prioridad: nombre completo, primer nombre y correo principal.
- `getAuthedUser()` entrega el UUID estable de Neon y el rol, pero no el nombre. El backend del
  nuevo flujo deberá resolver también el perfil de la cuenta autenticada; nunca confiará en un
  nombre enviado por el cliente.
- No existe un header compartido entre Chat, Knowledge, Estudio y Mapa. El punto global es
  `app/layout.tsx`, dentro de `ClientProviders`, donde el componente puede acceder a `UserContext`.
- Ya existen los primitives `Dialog`, `Button`, `Select`, `Label` y `Textarea` en
  `src/components/ui`; deben reutilizarse.
- La paleta compartida de cursos ya contiene el morado `#c084fc`. Se usará como base visual sin
  cambiar el acento verde global de Navigator.

## 3. Decisiones iniciales de arquitectura

### 3.1 Separar los dos tipos de feedback

Se conservará sin cambios el flujo actual:

```text
Voto sobre una respuesta del chat
  -> POST /api/feedback
  -> tabla feedback
```

El flujo nuevo será:

```text
Botón global de Feedback
  -> modal de producto
  -> submitProductFeedback() en src/lib/api.ts
  -> POST /api/product-feedback
  -> validación + identidad de sesión
  -> product-feedback.service.ts
  -> product-feedback.repo.ts (Neon, fuente de verdad)
  -> notion-feedback.ts (sincronización externa)
  -> fila/página en el data source de Notion
```

Esta separación evita romper los botones de pulgar del chat y mantiene contratos con propósitos
distintos.

### 3.2 El servidor es dueño de la identidad y los metadatos

El navegador enviará solamente los datos editables y una clave técnica de idempotencia:

```json
{
  "category": "Sugerencia",
  "description": "Sería útil poder filtrar el calendario por curso.",
  "clientRequestId": "6ac99542-a52e-40d0-ab67-29a4b16db6db"
}
```

`clientRequestId` se generará una vez por envío lógico y se conservará si el usuario reintenta. No
se mostrará en el modal ni se copiará a Notion.

El servidor agregará:

- `id`: UUID estable.
- `personName`: nombre de la cuenta autenticada, resuelto con Clerk `currentUser()` como
  `fullName -> firstName -> primaryEmail`; fallback al perfil local y, en último caso, `Usuario`.
- `createdAt`: instante del servidor en ISO 8601.
- `userId`: UUID interno de Neon.

El esquema Zod será estricto para validar `clientRequestId` como UUID y rechazar `id`,
`personName`, `createdAt` u otros campos inyectados por el cliente.

### 3.3 Neon será la fuente de verdad y Notion una proyección

Crear directamente en Notion puede perder o duplicar feedback si hay un timeout. Notion no
documenta una clave de idempotencia para `POST /v1/pages`. Por eso se propone:

1. Crear primero un registro local con UUID y estado `pending`.
2. Intentar la sincronización inmediata con Notion.
3. Guardar `notion_page_id` y marcar `synced` cuando termine.
4. Ante un error recuperable, conservar el registro y programar un reintento mediante el sistema
   de `jobs` existente.
5. Antes de repetir una creación con resultado ambiguo, consultar Notion por el campo `ID`.

Tabla propuesta:

```sql
CREATE TABLE product_feedback (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_name        TEXT NOT NULL,
  category           TEXT NOT NULL,
  description        TEXT NOT NULL,
  notion_page_id     TEXT,
  notion_sync_status TEXT NOT NULL DEFAULT 'pending',
  notion_last_error  TEXT,
  synced_at          TIMESTAMPTZ,
  client_request_id  UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_feedback_request_uidx
  ON product_feedback (user_id, client_request_id);
```

La versión final añadirá checks para las categorías permitidas, longitud de descripción y estados
de sincronización. El nombre se conserva como snapshot histórico del momento del envío.

### 3.4 Comportamiento del botón y modal

- Montaje global: componente cliente dentro de `ClientProviders`, hermano del contenido de la
  aplicación.
- Visibilidad: solo con `status === "authenticated"`; oculto en sign-in, sign-up y callback SSO.
- Escritorio: esquina superior derecha, posición fija y `z-index` compatible con los dialogs.
- Móvil: botón compacto o solo icono, desplazado bajo el header para no tapar “Nuevo chat”.
- Color: gradiente morado basado en `#c084fc` y `#a855f7`, con borde/sombra suave del mismo tono.
- Modal:
  - nombre y avatar de la sesión en una fila de solo lectura;
  - categoría obligatoria;
  - descripción obligatoria con contador `0/2000`;
  - estados enviando, enviado y error;
  - conservar el texto si falla el envío;
  - limpiar y cerrar únicamente después de confirmar recepción.

Catálogo inicial propuesto para la propiedad `Categoria` (la UI sí mostrará “Categoría”):

1. `Error`
2. `Sugerencia`
3. `Usabilidad`
4. `Contenido`
5. `Otro`

Las opciones definitivas deben existir con exactamente los mismos nombres en el Select de Notion.

### 3.5 Seguridad y privacidad

- Aplicar un límite dedicado por usuario y una cola global que respete los límites de Notion; el
  rate limit general de la app no es suficiente para proteger una integración externa compartida.
- Mantener token y `data_source_id` exclusivamente en servidor y responder errores genéricos al
  navegador.
- No registrar nombre, descripción, token ni payload de Notion. Los logs usarán solo el UUID local,
  estado de sync y código de error sanitizado.
- Definir la política de retención antes de producción. Recomendación inicial: al eliminar una
  cuenta, archivar o anonimizar también sus páginas de feedback en Notion antes de borrar el enlace
  local; el `ON DELETE CASCADE` por sí solo no elimina la copia externa.
- No capturar correo, ruta visitada, contenido académico ni otros metadatos fuera de los cinco
  campos solicitados.

## 4. Setup requerido en Notion

Una página normal de Notion no admite estas cinco propiedades. Dentro de la página de destino debe
existir una **base de datos/data source**.

### 4.1 Crear o preparar el data source

Crear estas propiedades con nombres y tipos exactos:

| Nombre exacto       | Tipo en Notion | Configuración                      |
| ------------------- | -------------- | ---------------------------------- |
| `ID`                | Title          | Columna principal obligatoria      |
| `Nombre de Persona` | Text           | Rich text, no People               |
| `Fecha`             | Date           | Fecha y hora del envío             |
| `Categoria`         | Select         | Crear las cinco opciones acordadas |
| `Descripcion`       | Text           | Rich text                          |

`Nombre de Persona` no debe ser tipo People porque los usuarios de Navigator no necesariamente
son miembros del workspace de Notion.

### 4.2 Crear la conexión interna

1. Un owner del workspace crea una conexión interna en Notion.
2. Otorga `Insert content` para crear los registros.
3. Otorga `Read content` para verificar el esquema y reconciliar un ID antes de un reintento.
4. En la base de datos de feedback, usar **Add connections** y compartirla con esa conexión. Una
   conexión nueva no recibe acceso automáticamente.
5. Guardar el access token directamente en `.env.local` y en los secretos de Vercel. No pegarlo
   en documentación, commits, logs ni mensajes.

### 4.3 Obtener el identificador correcto

La API vigente crea páginas bajo un `data_source_id`, no bajo el antiguo `database_id`. El ID se
obtiene desde **Manage data sources**. Si la base tiene varios data sources, se debe seleccionar
explícitamente el que contiene las cinco propiedades anteriores.

### 4.4 Variables de entorno

Agregar nombres sin valores reales a `.env.example`:

```env
# Notion — feedback global (solo servidor)
NOTION_ACCESS_TOKEN=
NOTION_FEEDBACK_DATA_SOURCE_ID=
```

Configurar los valores reales en:

- `frontend/.env.local` para desarrollo;
- Vercel Project Settings -> Environment Variables para producción y previews autorizados.

Nunca usar el prefijo `NEXT_PUBLIC_`. La versión de API `2026-03-11` se fijará en código para que
una actualización requiera una revisión consciente de compatibilidad.

### 4.5 Dependencia propuesta

Usar el SDK oficial `@notionhq/client` v5.12.0 o superior y crear el cliente únicamente en un
módulo server-only. El SDK deberá inicializarse de forma diferida para que un entorno sin variables
produzca un error controlado al usar la integración, no un fallo durante el import o el build.

Referencias oficiales:

- [Crear una página](https://developers.notion.com/reference/post-page)
- [Trabajar con databases y data sources](https://developers.notion.com/guides/data-apis/working-with-databases)
- [SDK oficial de JavaScript](https://github.com/makenotion/notion-sdk-js)
- [Upgrade a la API 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
- [Autorización de conexiones internas](https://developers.notion.com/guides/get-started/internal-connections)
- [Límites de requests](https://developers.notion.com/reference/request-limits)

## 5. Plan inicial por tareas

Cada tarea tendrá un plan de implementación más detallado antes de comenzar sus cambios.

### Task 0 — Preconfigurar y activar Notion al final

**Resultado:** integración preparada sin secretos; el data source y las variables reales se
activan únicamente después del UI y la verificación offline.

- Crear/verificar las cinco propiedades y opciones de categoría.
- Crear la conexión interna y compartir el data source.
- Obtener `NOTION_FEEDBACK_DATA_SOURCE_ID`.
- Configurar los dos secretos fuera de Git.
- Añadir solo los nombres vacíos a `.env.example`.
- Ejecutar una prueba server-side de acceso/esquema sin escribir datos de prueba permanentes.

### Task 1 — Modelo local, validación y contrato HTTP

**Resultado:** el backend acepta feedback autenticado y lo persiste en Neon.

- Añadir `product_feedback` a `src/lib/schema.sql`.
- Añadir `ProductFeedbackSchema` estricto en `api.schemas.ts`.
- Crear `product-feedback.repo.ts` para todo el SQL.
- Crear `product-feedback.service.ts` para identidad, reglas y orquestación.
- Crear el handler delgado `app/api/product-feedback/route.ts`.
- Aplicar auth y un rate limit específico para proteger Notion.
- Añadir el DTO y `submitProductFeedback()` a `src/lib/api.ts`.

Contrato esperado:

```text
POST /api/product-feedback
201 -> persistido y sincronizado
202 -> persistido; sincronización pendiente/reintentable
400 -> entrada inválida
401 -> sin sesión
429 -> demasiados envíos
500/503 -> fallo interno no recuperable; la integración sin configurar devuelve 202 pending
```

### Task 2 — Adaptador de Notion e idempotencia

**Resultado:** cada registro local termina reflejado una sola vez en Notion.

- Instalar y encapsular `@notionhq/client`.
- Crear el mapper de las cinco propiedades.
- Validar configuración y esquema con errores operables.
- Implementar sync inmediato y actualización de estado local.
- Extender `cron/process` para drenar jobs de feedback con el backoff/deduplicación que ya soporta
  el repositorio de `jobs`.
- Consultar por `ID` antes de recrear tras un timeout ambiguo.
- No registrar token, nombre ni descripción en logs.

### Task 3 — Modal y cliente

**Resultado:** formulario accesible que muestra correctamente la identidad de sesión.

- Crear `src/components/feedback/product-feedback-modal.tsx` con primitives existentes.
- Mostrar `displayName` y `avatarUrl` como datos de solo lectura.
- Añadir Select de categoría y Textarea con máximo/contador.
- Generar un `clientRequestId` por envío lógico y mantenerlo durante los reintentos.
- Manejar validación, doble clic, loading, éxito y reintento.
- Mostrar mensajes con `sonner` sin perder el contenido ante error.
- Añadir traducciones si el alcance debe respetar la preferencia ES/EN.

### Task 4 — Botón global morado y responsive

**Resultado:** acceso consistente desde todas las páginas de la app.

- Crear `product-feedback-launcher.tsx`.
- Montarlo una sola vez en el layout/proveedor global.
- Ocultarlo para usuarios anónimos y pantallas de autenticación.
- Aplicar el tratamiento morado sin cambiar los tokens verdes globales.
- Verificar escritorio y móvil en Chat, Knowledge, Estudio y Mapa.
- Resolver específicamente la colisión móvil con “Nuevo chat”.

### Task 5 — Pruebas, observabilidad y despliegue

**Resultado:** flujo verificable antes de publicar.

- Tests de Zod: categorías, vacíos, longitud y body estricto.
- Tests de route: 401, 400, 429, 201 y 202.
- Tests de servicio/adaptador con Notion mockeado, incluida idempotencia.
- Verificación manual accesible: teclado, focus, escape, lectores de pantalla y responsive.
- Ejecutar `npm test`, lint y build.
- Ejecutar `npm run db:migrate` en el entorno correspondiente.
- Configurar secretos en Vercel y hacer un envío real controlado.
- Confirmar en Notion los cinco valores y que no haya duplicados.
- Verificar la política elegida de retención/eliminación de datos personales en Notion.

## 6. Criterios de aceptación del feature completo

- Un usuario autenticado ve el botón morado en todas las páginas funcionales.
- Las pantallas de acceso y un usuario sin sesión no muestran el botón.
- El modal muestra el nombre/avatar de la sesión y no permite editar ni enviar el nombre.
- Categoría y descripción son obligatorias; la descripción no supera 2.000 caracteres.
- El servidor genera ID y fecha y vuelve a resolver la identidad autenticada.
- Cada envío queda guardado en Neon aun si Notion tiene una interrupción temporal.
- Cada envío termina en el data source correcto con las cinco propiedades solicitadas.
- Reintentos o dobles clics no crean duplicados lógicos.
- Los votos positivo/negativo del chat continúan funcionando sin cambios.
- Los secretos nunca llegan al bundle del navegador, respuestas HTTP ni logs.
- La eliminación de cuenta no deja datos personales en Notion fuera de la política de retención
  acordada.

## 7. Datos reservados para la activación final

La implementación offline no depende de estos datos. Al terminar el UI y la preconfiguración, el
owner del workspace deberá preparar, sin publicar secretos:

1. URL de la base de datos/página de feedback o su `data_source_id`.
2. Confirmación de que la conexión interna fue añadida al data source.
3. Token configurado directamente en `frontend/.env.local` y Vercel.
4. Confirmación del catálogo de categorías; si no hay cambios, se usarán `Error`,
   `Sugerencia`, `Usabilidad`, `Contenido` y `Otro`.

Con esos datos se ejecutarán **Task 0B/5B**: validación del esquema real, migración y smoke test.
