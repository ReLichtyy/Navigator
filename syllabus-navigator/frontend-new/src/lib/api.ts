/**
 * Capa de integración para conectar el nuevo Frontend con el Backend existente.
 * 
 * =========================================================================
 * 📌 CONFIGURACIÓN DE URL DEL BACKEND:
 * La URL base se obtiene de `process.env.NEXT_PUBLIC_API_URL`.
 * 
 * - Desarrollo local: Usa "http://localhost:8000" por defecto si la variable no está configurada.
 * - Despliegue en producción (ej. Vercel / Railway):
 *   Configura la variable `NEXT_PUBLIC_API_URL` con la URL HTTPS pública de tu backend:
 *   👉 https://syllabus-backend-production.up.railway.app
 * =========================================================================
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * 📌 VALOR DE USER ID TEMPORAL PARA PRUEBAS:
 * Si deseas cambiar el ID de usuario de pruebas, edítalo aquí.
 * El backend requiere este header para la seguridad de la base de datos y la 
 * persistencia del RAG/Historial.
 */
export const DEFAULT_USER_ID = "dev-user-1";

/**
 * Genera los headers estándar para la comunicación con la API.
 */
function getHeaders(userId?: string, isJson: boolean = true): HeadersInit {
  const headers: Record<string, string> = {
    "X-User-Id": userId || DEFAULT_USER_ID,
  };
  if (isJson) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

/**
 * 1. fetchGraph(syllabusId) -> GET /graph/{syllabusId}
 * Obtiene los nodos y aristas del Grafo de Conocimiento junto con su estado actual (processing/ready/failed).
 */
export async function fetchGraph(syllabusId: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}`, {
    method: "GET",
    headers: {
      "X-User-Id": DEFAULT_USER_ID
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch graph. Status: ${res.status}`);
  }
  return res.json();
}

/**
 * 2. querySyllabus(syllabusId, question, userId) -> POST /chat/query
 * Realiza una consulta al motor de RAG sobre el syllabus activo.
 */
export async function querySyllabus(syllabusId: string, question: string, userId?: string) {
  const res = await fetch(`${API_BASE}/chat/query`, {
    method: "POST",
    headers: getHeaders(userId, true),
    body: JSON.stringify({
      syllabus_id: syllabusId,
      question: question,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "Chat query failed");
  }
  return res.json();
}

/**
 * 3. uploadSyllabus(file, userId) -> POST /upload/syllabus
 * Sube un archivo PDF para procesar, indexar en Chroma y generar el grafo en background.
 */
export async function uploadSyllabus(file: File, userId?: string) {
  const form = new FormData();
  form.append("file", file);
  
  const res = await fetch(`${API_BASE}/upload/syllabus`, {
    method: "POST",
    headers: getHeaders(userId, false), // Sin Content-Type para que el navegador configure el boundary
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "File upload failed");
  }
  return res.json();
}

/**
 * 4. reprocessGraph(syllabusId) -> POST /graph/{syllabusId}/reprocess
 * Vuelve a gatillar la extracción del grafo desde los fragmentos de ChromaDB de forma atómica.
 */
export async function reprocessGraph(syllabusId: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}/reprocess`, {
    method: "POST",
    headers: {
      "X-User-Id": DEFAULT_USER_ID
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to reprocess graph. Status: ${res.status}`);
  }
  return res.json();
}
