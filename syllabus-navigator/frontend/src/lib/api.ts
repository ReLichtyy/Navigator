export async function fetchGraph(syllabusId: string) {
  const res = await fetch(`http://localhost:8000/graph/${syllabusId}`);
  if (!res.ok) throw new Error("Failed to fetch graph");
  return res.json();
}

export async function querySyllabus(syllabusId: string, question: string) {
  const res = await fetch("http://localhost:8000/chat/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ syllabus_id: syllabusId, question }),
  });
  if (!res.ok) throw new Error("Failed to query syllabus");
  return res.json();
}
