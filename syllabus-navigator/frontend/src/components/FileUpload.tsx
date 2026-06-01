import { useState } from "react";
import { uploadSyllabus } from "../lib/api";
import { useSyllabus } from "../context/SyllabusContext";

type Props = {
  onUploaded?: (syllabusId: string) => void;
  userId?: string;
};

export default function FileUpload({ onUploaded, userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setActiveSyllabusId } = useSyllabus();

  async function handleUpload(file: File) {
    setLoading(true);
    setError(null);
    try {
      const data = await uploadSyllabus(file, userId);
      setActiveSyllabusId(data.syllabus_id);
      if (onUploaded) {
        onUploaded(data.syllabus_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {loading && <p>Uploading...</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
