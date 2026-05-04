"use client";

import { useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type GraphNode = { id: string; label: string };
type GraphEdge = { source: string; target: string };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export default function GraphCanvas({ nodes: initialNodes, edges: initialEdges }: Props) {
  // Translate backend nodes to React Flow format
  const rfNodes = useMemo(() => {
    return initialNodes.map((node, index) => ({
      id: node.id,
      // Create a simple grid layout
      position: { x: (index % 4) * 250, y: Math.floor(index / 4) * 150 },
      data: { label: node.label },
      style: {
        background: '#ffffff',
        border: '2px solid #333',
        borderRadius: '8px',
        padding: '10px',
        fontWeight: 'bold',
        textAlign: 'center' as const,
        width: 200,
      },
    }));
  }, [initialNodes]);

  // Translate backend edges to React Flow format
  const rfEdges = useMemo(() => {
    return initialEdges.map((edge) => ({
      id: `e-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      animated: true,
      style: { stroke: '#555', strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#555',
      },
    }));
  }, [initialEdges]);

  if (initialNodes.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed #ccc', borderRadius: '8px' }}>
        <p>No graph data available yet. Process a syllabus to see the knowledge graph.</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '600px', border: '1px solid #eaeaea', borderRadius: '12px', overflow: 'hidden' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        attributionPosition="bottom-right"
      >
        <Controls />
        <MiniMap zoomable pannable nodeColor={(n) => '#e2e8f0'} />
        <Background color="#ccc" gap={16} />
      </ReactFlow>
    </div>
  );
}