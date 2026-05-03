import { useState } from "react";

type Props = {
  onUploaded: (syllabusId: string) => void;
};

export default function FileUpload({ onUploaded }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleUpload(file: File) {
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("http://localhost:8000/upload/syllabus", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      onUploaded(data.syllabus_id);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".pdf,.doc,.docx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
      {loading && <p>Uploading...</p>}
    </div>
  );
}
