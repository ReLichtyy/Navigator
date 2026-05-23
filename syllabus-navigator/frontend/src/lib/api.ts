/**
 * Capa base de comunicación con el Backend FastAPI.
 *
 * URL base → variable de entorno NEXT_PUBLIC_API_URL
 * Fallback  → http://localhost:8000 (desarrollo local)
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** ID de usuario por defecto para desarrollo. */
export const DEFAULT_USER_ID = "dev-user-1";

/** Genera los headers estándar; añade Content-Type solo para JSON. */
function getHeaders(userId?: string, isJson: boolean = true): HeadersInit {
  const headers: Record<string, string> = {
    "X-User-Id": userId || DEFAULT_USER_ID,
  };
  if (isJson) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

/** GET /graph/{syllabusId} */
export async function fetchGraph(syllabusId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}`, {
    method: "GET",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to fetch graph. Status: ${res.status}`);
  return res.json();
}

/** POST /chat/query */
export async function querySyllabus(syllabusId: string, question: string, userId?: string) {
  const res = await fetch(`${API_BASE}/chat/query`, {
    method: "POST",
    headers: getHeaders(userId, true),
    body: JSON.stringify({ syllabus_id: syllabusId, question }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** POST /upload/syllabus */
export async function uploadSyllabus(file: File, userId?: string) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload/syllabus`, {
    method: "POST",
    headers: getHeaders(userId, false), // Sin Content-Type: el browser pone el boundary
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** POST /graph/{syllabusId}/reprocess */
export async function reprocessGraph(syllabusId: string, userId?: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}/reprocess`, {
    method: "POST",
    headers: getHeaders(userId, false),
  });
  if (!res.ok) throw new Error(`Failed to reprocess graph. Status: ${res.status}`);
  return res.json();
}

