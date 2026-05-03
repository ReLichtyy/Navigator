type Citation = {
  chunk_id: string;
  quote: string;
};

type ChatResponse = {
  answer: string;
  citations: Citation[];
};

type Props = {
  data?: ChatResponse;
};

export default function ChatPanel({ data }: Props) {
  if (!data) return <div>Ask a question to your syllabus.</div>;

  return (
    <section>
      <h3>Answer</h3>
      <p>{data.answer}</p>
      <h4>Citations</h4>
      <ul>
        {data.citations.map((citation) => (
          <li key={citation.chunk_id}>
            <strong>{citation.chunk_id}</strong>: {citation.quote}
          </li>
        ))}
      </ul>
    </section>
  );
}
