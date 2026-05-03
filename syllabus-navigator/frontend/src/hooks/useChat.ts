import { useState } from "react";
import { querySyllabus } from "../lib/api";

export function useChat(syllabusId: string) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  async function ask(question: string) {
    setLoading(true);
    try {
      const response = await querySyllabus(syllabusId, question);
      setData(response);
    } finally {
      setLoading(false);
    }
  }

  return { loading, data, ask };
}
