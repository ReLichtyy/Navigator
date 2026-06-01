# Plan Maestro de Integración: Syllabus Navigator (Frontend-New <-> Backend)

## 📌 Resumen Ejecutivo
Este documento define la hoja de ruta para integrar `frontend` con el backend en producción (`https://syllabus-backend-production.up.railway.app`). La estrategia prioriza un **Adapter Layer Mínimo** para centralizar la comunicación, el uso de **Context API** para la gestión de estado, y la ejecución de pruebas locales primero mediante un **Smoke Test End-to-End**. No se modificará el frontend antiguo ni se alterará el diseño visual del nuevo. El desarrollo se dividirá en 6 Sprints iterativos.

## 🔬 Diagnóstico del Estado Actual
- **Backend:** Desplegado en Railway, exponiendo endpoints REST (`/upload/syllabus`, `/graph/{syllabusId}`, `/chat/query`). Requiere CORS configurado para `localhost:3000` y espera el header `X-User-Id` en ciertas rutas.
- **Frontend-New:** Estructura base creada, componentes visuales listos, pero sin conexión real a datos.
- **Brecha Principal:** Falta la capa de conexión HTTP (fetch), el manejo del estado global (Context) para compartir el `syllabusId` y los datos del grafo/chat entre componentes, y la inyección de la URL del entorno.

## 🎯 Decisiones Elegidas
1.  **Estrategia:** Adapter layer mínimo (`src/lib/api.ts`).
2.  **Prioridad:** End-to-end mínimo (Validar Upload -> Graph -> Chat rápidamente).
3.  **Estado:** Context API (`SyllabusContext.tsx`).
4.  **User Identity:** `userId` fijo temporal (ej. `test-user-123`) dentro del adapter.
5.  **Validación:** Smoke test manual guiado por flujo.
6.  **Despliegue:** Validación Local (`localhost:3000`) apuntando a Railway primero.

---

## 🏃‍♂️ Plan por Sprints

### Sprint 0: Preparación y Entorno
-   **Objetivo:** Asegurar que el entorno local puede comunicarse teóricamente con producción sin modificar código de la aplicación.
-   **Alcance:** Variables de entorno y configuración de CORS en backend (revisión manual).
-   **Archivos a tocar:** `syllabus-navigator/frontend/.env.local` (Nuevo)
-   **Dependencias Previas:** Backend corriendo en Railway.
-   **Tareas Manuales del Usuario:**
    1.  Verificar que la variable `CORS_ALLOW_ORIGINS` en Railway incluye `http://localhost:3000`.
    2.  Crear el archivo `.env.local` (el agente lo hará, pero el usuario debe verificar).
-   **Tareas del Agente Coder:** Crear el archivo `.env.local` con `NEXT_PUBLIC_API_URL=https://syllabus-backend-production.up.railway.app`.
-   **Criterios de Validación:** `.env.local` existe y tiene la URL correcta.
-   **Riesgos:** CORS mal configurado en backend (Bloquearía todos los siguientes sprints).
-   **Definition of Done:** Frontend tiene la variable de entorno lista para ser leída.

### Sprint 1: Adapter Layer y Contrato API
-   **Objetivo:** Crear el único punto de contacto entre el frontend y el backend.
-   **Alcance:** Implementación de `api.ts` con tipado básico y las tres funciones core.
-   **Archivos a tocar:** `syllabus-navigator/frontend/src/lib/api.ts`
-   **Dependencias Previas:** Sprint 0 completado.
-   **Tareas Manuales del Usuario:** Ninguna.
-   **Tareas del Agente Coder:** Implementar `uploadSyllabus`, `fetchGraph`, y `querySyllabus` usando `fetch`, inyectando `NEXT_PUBLIC_API_URL` y el header `X-User-Id: test-user-123`.
-   **Criterios de Validación:** Funciones exportadas correctamente y manejando errores de red (try/catch básico).
-   **Riesgos:** Errores tipográficos en las rutas o headers.
-   **Definition of Done:** `api.ts` contiene las tres funciones que respetan el contrato del backend.

### Sprint 2: Context API y Estado Global
-   **Objetivo:** Proveer un estado unificado para toda la app, evitando pasar props manualmente.
-   **Alcance:** Crear `SyllabusContext` que almacene `syllabusId`, `graphData`, y funciones para actualizarlos.
-   **Archivos a tocar:** `syllabus-navigator/frontend/src/context/SyllabusContext.tsx`, `syllabus-navigator/frontend/src/app/layout.tsx` (para inyectar el Provider).
-   **Dependencias Previas:** Sprint 1.
-   **Tareas Manuales del Usuario:** Ninguna.
-   **Tareas del Agente Coder:** Implementar el Contexto con `useState` e inyectarlo en la raíz de la app.
-   **Criterios de Validación:** La app compila sin errores y los componentes hijos pueden consumir el contexto usando un hook (ej. `useSyllabus`).
-   **Riesgos:** Re-renders excesivos si el contexto crece demasiado (aceptable por ahora para la prueba).
-   **Definition of Done:** Provider envuelve la aplicación y exporta el estado necesario.

### Sprint 3: Integración Flujo Upload
-   **Objetivo:** Conectar el componente de subida de archivos real a la API.
-   **Alcance:** Modificar `FileUpload.tsx` para usar `api.uploadSyllabus` y guardar el `syllabusId` devuelto en el Contexto.
-   **Archivos a tocar:** `syllabus-navigator/frontend/src/components/FileUpload.tsx`
-   **Dependencias Previas:** Sprint 1 y 2.
-   **Tareas Manuales del Usuario:** Subir un archivo PDF válido desde la UI local.
-   **Tareas del Agente Coder:** Cablear el botón de submit para llamar a la API, manejar estado de carga, y actualizar el Contexto tras el éxito.
-   **Criterios de Validación:** Tras subir, la red muestra un 200 OK y el Contexto recibe el `syllabusId`.
-   **Riesgos:** El backend podría rechazar el formato del `FormData` si no coincide exactamente con lo esperado (`file`).
-   **Definition of Done:** El usuario puede subir un PDF y recibir confirmación.

### Sprint 4: Integración Flujo Graph
-   **Objetivo:** Visualizar el grafo usando los datos reales del backend.
-   **Alcance:** Modificar `GraphCanvas.tsx` para escuchar cambios en el `syllabusId` del Contexto y llamar a `api.fetchGraph`.
-   **Archivos a tocar:** `syllabus-navigator/frontend/src/components/GraphCanvas.tsx`
-   **Dependencias Previas:** Sprint 1, 2 y 3.
-   **Tareas Manuales del Usuario:** Verificar que tras subir el archivo (o forzar un ID), el grafo renderiza nodos.
-   **Tareas del Agente Coder:** Implementar `useEffect` que detecte el `syllabusId`, llame a la API, formatee los datos si es necesario para la librería de visualización, y los renderice.
-   **Criterios de Validación:** Nodos visibles en pantalla provenientes del JSON del backend.
-   **Riesgos:** Desajuste entre el formato JSON del backend y lo que espera la librería de dibujo de grafos.
-   **Definition of Done:** Grafo renderizado con datos reales del backend.

### Sprint 5: Integración Flujo Chat y Validación End-to-End
-   **Objetivo:** Cerrar el ciclo permitiendo consultas al RAG y realizar la prueba final.
-   **Alcance:** Modificar `chat-thread.tsx` o similar para usar `api.querySyllabus`.
-   **Archivos a tocar:** Componentes de chat en `frontend`.
-   **Dependencias Previas:** Todos los anteriores.
-   **Tareas Manuales del Usuario:** Realizar el Smoke Test completo (Ver checklist final).
-   **Tareas del Agente Coder:** Conectar el input del chat a la API, enviando el `syllabusId` del contexto, y mostrar la respuesta.
-   **Criterios de Validación:** El chat muestra la respuesta real del backend.
-   **Riesgos:** Tiempos de espera largos (timeouts) si el LLM tarda en responder.
-   **Definition of Done:** El usuario puede tener una conversación sobre el syllabus subido.

---

## 🤖 Prompts para el Agente Implementador

*Nota: Pega estos prompts uno a uno en conversaciones futuras con el agente encargado de escribir código para asegurar enfoque.*

**Para Sprint 0:**
> "Estamos en el Sprint 0 de integración. Crea el archivo `syllabus-navigator/frontend/.env.local` y define la variable `NEXT_PUBLIC_API_URL=https://syllabus-backend-production.up.railway.app`. No toques nada más."

**Para Sprint 1:**
> "Estamos en el Sprint 1. Crea o modifica el archivo `syllabus-navigator/frontend/src/lib/api.ts`. Implementa un 'Adapter Layer' con 3 funciones asíncronas usando `fetch`: `uploadSyllabus(file: File)`, `fetchGraph(syllabusId: string)`, y `querySyllabus(syllabusId: string, question: string)`. 
> Reglas: 
> 1. Usa `process.env.NEXT_PUBLIC_API_URL` como base. 
> 2. Todas deben enviar el header `X-User-Id: test-user-123`. 
> 3. `uploadSyllabus` debe enviar un `FormData` con el campo `file`. 
> 4. Maneja errores básicos y retorna la data en JSON."

**Para Sprint 2:**
> "Estamos en el Sprint 2. Crea o modifica un Context API en `syllabus-navigator/frontend/src/context/SyllabusContext.tsx`. Necesita guardar: `syllabusId` (string nulo por defecto), `graphData` (any), y funciones para setearlos. Envuelve la aplicación en `syllabus-navigator/frontend/src/app/layout.tsx` con este Provider."

**Para Sprint 3:**
> "Estamos en el Sprint 3. Modifica `syllabus-navigator/frontend/src/components/FileUpload.tsx`. Conéctalo con `api.uploadSyllabus` que creamos en `src/lib/api.ts`. Cuando el usuario seleccione un archivo y envíe, haz la llamada, maneja el estado de carga/error en la UI existente, y si es exitoso, guarda el `syllabusId` devuelto en el `SyllabusContext`."

**Para Sprint 4:**
> "Estamos en el Sprint 4. Modifica `syllabus-navigator/frontend/src/components/GraphCanvas.tsx`. Consigue el `syllabusId` del `SyllabusContext`. Añada un `useEffect` que reaccione cuando `syllabusId` exista: llama a `api.fetchGraph(syllabusId)` y guarda el resultado en el contexto o en estado local para renderizar los nodos. Adapta mínimamente los datos de respuesta al formato visual si es necesario."

**Para Sprint 5:**
> "Estamos en el Sprint 5. Modifica los componentes del chat (probablemente `chat-composer.tsx` y `chat-thread.tsx`). Conecta el envío del mensaje a `api.querySyllabus(syllabusId, question)`, usando el `syllabusId` del Contexto. Maneja el estado de carga (ej. 'Escribiendo...') y agrega la respuesta a la lista de mensajes de la UI. No alteres el diseño visual."

---

## ✅ Checklist de Validación End-to-End (Smoke Test)

**A ejecutar por el usuario tras el Sprint 5:**

- [ ] Levantar frontend local (`npm run dev` en `frontend`).
- [ ] Abrir `localhost:3000` en el navegador. Abrir DevTools (Network y Console).
- [ ] **Flujo Upload:** Seleccionar un PDF válido y presionar subir.
    - *Espera:* Request 200 OK hacia Railway. No hay errores de CORS. La UI indica éxito.
- [ ] **Flujo Graph:** Verificar que automáticamente tras la subida (o tras una carga), el área del grafo muestra nodos.
    - *Espera:* Request GET 200 OK hacia Railway devolviendo JSON. Nodos visibles en UI.
- [ ] **Flujo Chat:** Escribir una pregunta relacionada al PDF en el chat y enviar.
    - *Espera:* Request POST 200 OK hacia Railway. El chat muestra un indicador de carga y luego la respuesta del LLM.
