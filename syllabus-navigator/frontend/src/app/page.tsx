"use client";

import { useEffect, useState } from "react";
import ChatPanel from "../components/ChatPanel";
import FileUpload from "../components/FileUpload";
import GraphCanvas from "../components/GraphCanvas";
import { useChat } from "../hooks/useChat";
import { fetchGraph } from "../lib/api";

export default function HomePage() {
  const [syllabusId, setSyllabusId] = useState("");
  const [userId, setUserId] = useState("dev-user-1");
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const { loading, data, ask } = useChat(syllabusId || "placeholder", userId);

  useEffect(() => {
    if (!syllabusId) return;
    fetchGraph(syllabusId).then(setGraph).catch(() => setGraph(null));
  }, [syllabusId]);

  return (
    <main style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Syllabus Navigator</h1>
      <label>
        Usuario dev (header X-User-Id):{" "}
        <input value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 240 }} />
      </label>
      <FileUpload onUploaded={setSyllabusId} userId={userId} />
      <button onClick={() => ask("Cuales son los temas principales?")} disabled={!syllabusId || loading}>
        Ask Demo Question
      </button>
      <ChatPanel data={data} />
      {graph && <GraphCanvas nodes={graph.nodes} edges={graph.edges} />}
    </main>
  );
}
