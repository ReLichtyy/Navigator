# 🚀 Integración del Nuevo Frontend con tu Backend de Railway

Este frontend está completamente configurado y estructurado de forma limpia bajo la carpeta `frontend-new/`. Todas las llamadas del sistema han sido integradas en un cliente API único (`src/lib/api.ts`) que se conecta de manera directa a tu backend en producción de Railway:
👉 **`https://syllabus-backend-production.up.railway.app`**

---

## 📌 1. ¿Dónde cambiar la URL del Backend?

* **En desarrollo local:**
  Crea un archivo `.env` en la raíz de la carpeta `frontend-new/` (puedes copiar el `.env.example`) y define la variable:
  ```env
  NEXT_PUBLIC_API_URL=https://syllabus-backend-production.up.railway.app
  ```
  *(O cambia a `http://localhost:8000` si estás haciendo pruebas con el backend corriendo localmente).*

* **En producción (ej. Vercel):**
  Agrega la variable de entorno `NEXT_PUBLIC_API_URL` en la pestaña **Settings** > **Environment Variables** de tu panel de Vercel con el valor:
  `https://syllabus-backend-production.up.railway.app`

---

## 📌 2. ¿Cómo probar cada funcionalidad?

### A. Carga de Archivos (Upload)
1. Inicia el servidor de desarrollo (`npm run dev`) y ve al navegador.
2. Haz clic en el botón de adjuntar (ícono de clip en la barra de chat) y **sube un syllabus PDF**.
3. Esto invocará de forma interna a la función `uploadSyllabus(file, userId)` en `lib/api.ts` haciendo una petición `POST /upload/syllabus` con la cabecera `X-User-Id: dev-user-1`.
4. Sabrás que funciona cuando el archivo cambie de estado a "Listo" y devuelva el identificador del syllabus.

### B. Chat RAG (Preguntas y Respuestas)
1. Con el documento cargado correctamente, escribe una pregunta en el chat (ej. *"¿Cuál es la fecha del examen parcial?"*).
2. Esto gatillará la función `querySyllabus(syllabusId, question, userId)` haciendo un `POST /chat/query`.
3. Sabrás que funciona cuando la IA responda citando párrafos y números de páginas específicos del syllabus PDF.

### C. Visualizador de Grafo Conceptual (Graph)
1. Haz clic en el botón **"View Knowledge Graph"** en la esquina superior derecha.
2. Esto gatillará la función `fetchGraph(syllabusId)` realizando peticiones `GET /graph/{syllabusId}` de manera cíclica cada 3 segundos hasta que el backend complete la extracción y cambie el estado de `processing` a `ready`.
3. Sabrás que funciona cuando la pantalla del skeleton animado desaparezca y se renderice el mapa jerárquico conceptual e interactivo de React Flow.

---

## 📌 3. ¿Cómo verificar errores en la pestaña Network (Red)?

Si algo falla, puedes diagnosticarlo abriendo las herramientas de desarrollador del navegador (presiona **F12** o **Ctrl + Shift + I** y selecciona la pestaña **Network** o **Red**):

1. **Revisa las Peticiones en Rojo:** Busca peticiones fallidas (generalmente con códigos de estado `400`, `404`, `409` o `500`).
2. **Inspecciona las Cabeceras (Headers):**
   - Asegúrate de que las peticiones `/upload/syllabus` y `/chat/query` tengan la cabecera **`X-User-Id`** configurada exactamente con el mismo valor (ej. `dev-user-1`). Si son distintos o el header está ausente, el backend denegará la petición por motivos de seguridad de base de datos.
   - En peticiones POST `/chat/query`, comprueba que el `Content-Type` sea `application/json`.
3. **Inspecciona la Respuesta (Response):**
   - Haz clic en la petición fallida y selecciona la subpestaña **Response (Respuesta)** o **Preview**.
   - El backend de FastAPI enviará mensajes claros, como por ejemplo:
     - *"Only PDF files are supported..."* (si intentas subir otro formato).
     - *"Syllabus not found for this user"* (si hay desajuste en el `X-User-Id` o el ID de syllabus no existe).

---

## ❓ ¿Es necesario hacer un Git Pull?

**No, no es necesario hacer un `git pull` en tu máquina local.**

### ¿Por qué?
Porque yo he realizado y guardado todas estas modificaciones **directamente sobre los archivos físicos de tu computadora local** en tu espacio de trabajo. Los archivos nuevos en la carpeta `frontend-new/` ya están escritos y listos para ser usados de inmediato.

### ¿Qué debes hacer ahora?
Si quieres respaldar estos cambios en tu repositorio remoto de GitHub antes de desplegar en Vercel, ejecuta estos comandos en tu consola local:
```powershell
# 1. Añadir la nueva carpeta al control de versiones
git add syllabus-navigator/frontend-new/

# 2. Hacer commit de la nueva carpeta
git commit -m "feat: setup frontend-new clean deployment folder pointing to Railway"

# 3. Empujar los cambios a GitHub
git push
```
Una vez empujado a GitHub, si tienes configurado el despliegue automático en Vercel, este se disparará solo. Si vas a desplegar en otra máquina o servidor remoto por SSH, en *ese* servidor sí deberás ejecutar un `git pull` para descargar estos cambios que acabas de subir.
