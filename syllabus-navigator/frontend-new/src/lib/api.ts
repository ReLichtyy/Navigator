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

// ============================================================================
// Chat thread management
// ============================================================================

/**
 * List all chat threads for the active user.
 * GET /chat/list
 */
export async function listChats(userId?: string) {
  const res = await fetch(`${API_BASE}/chat/list`, {
    method: "GET",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to list chats. Status: ${res.status}`);
  return res.json() as Promise<{ chats: ChatOutAPI[] }>;
}

/**
 * Create a new empty chat thread.
 * POST /chat/new
 */
export async function newChat(userId?: string) {
  const res = await fetch(`${API_BASE}/chat/new`, {
    method: "POST",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to create chat. Status: ${res.status}`);
  return res.json() as Promise<ChatOutAPI>;
}

/**
 * Delete a chat thread (and all its messages via cascade).
 * DELETE /chat/{chatId}
 */
export async function deleteChat(chatId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/chat/${chatId}`, {
    method: "DELETE",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to delete chat. Status: ${res.status}`);
}

/**
 * Rename a chat thread title.
 * PATCH /chat/{chatId}
 */
export async function renameChat(chatId: string, title: string, userId?: string) {
  const res = await fetch(`${API_BASE}/chat/${chatId}`, {
    method: "PATCH",
    headers: getHeaders(userId, true),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename chat. Status: ${res.status}`);
  return res.json() as Promise<ChatOutAPI>;
}

/**
 * Fetch a single chat with all its messages.
 * GET /chat/{chatId}
 */
export async function getChatDetail(chatId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/chat/${chatId}`, {
    method: "GET",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to load chat. Status: ${res.status}`);
  return res.json() as Promise<ChatDetailAPI>;
}

// ============================================================================
// API shape types (matching backend Pydantic schemas)
// ============================================================================

export interface ChatOutAPI {
  id: string;
  title: string;
  active_model: string;
  created_at: string; // ISO timestamp
  message_count: number;
}

export interface MessageOutAPI {
  id: string;
  role: "user" | "ai";
  content: string;
  created_at: string;
}

export interface ChatDetailAPI extends ChatOutAPI {
  messages: MessageOutAPI[];
}

// ============================================================================
// RAG / Knowledge
// ============================================================================

/**
 * 1. fetchGraph(syllabusId) -> GET /graph/{syllabusId}
 * Obtiene los nodos y aristas del Grafo de Conocimiento junto con su estado actual.
 */
export async function fetchGraph(syllabusId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}`, {
    method: "GET",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch graph. Status: ${res.status}`);
  }
  return res.json();
}

/**
 * 2. querySyllabus(syllabusId, question, chatId, userId) -> POST /chat/query
 * Realiza una consulta al motor de RAG y persiste los mensajes en el hilo de chat.
 * Returns the answer, citations, and (on the first message) the auto-generated title.
 */
export async function querySyllabus(
  syllabusId: string,
  question: string,
  chatId: string,
  userId?: string,
) {
  const res = await fetch(`${API_BASE}/chat/query`, {
    method: "POST",
    headers: getHeaders(userId, true),
    body: JSON.stringify({
      syllabus_id: syllabusId,
      question,
      chat_id: chatId,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "Chat query failed");
  }
  return res.json() as Promise<{ chat_id: string; answer: string; citations: any[]; title: string }>;
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
export async function reprocessGraph(syllabusId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}/reprocess`, {
    method: "POST",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) {
    throw new Error(`Failed to reprocess graph. Status: ${res.status}`);
  }
  return res.json();
}
