const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function devUserHeaders(userId: string): HeadersInit {
  return { "X-User-Id": userId };
}

export async function fetchGraph(syllabusId: string) {
  const res = await fetch(`${API_BASE}/graph/${syllabusId}`);
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export async function querySyllabus(syllabusId: string, question: string, userId: string) {
  const res = await fetch(`${API_BASE}/chat/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...devUserHeaders(userId) },
    body: JSON.stringify({ syllabus_id: syllabusId, question }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadSyllabus(file: File, userId: string) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/upload/syllabus`, {
    method: "POST",
    headers: devUserHeaders(userId),
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
