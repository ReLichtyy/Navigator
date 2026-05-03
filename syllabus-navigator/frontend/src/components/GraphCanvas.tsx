type Node = { id: string; label: string };
type Edge = { source: string; target: string };

type Props = {
  nodes: Node[];
  edges: Edge[];
};

export default function GraphCanvas({ nodes, edges }: Props) {
  return (
    <section>
      <h3>Knowledge Graph</h3>
      <p>Nodes: {nodes.length}</p>
      <p>Edges: {edges.length}</p>
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>{node.label}</li>
        ))}
      </ul>
    </section>
  );
}
