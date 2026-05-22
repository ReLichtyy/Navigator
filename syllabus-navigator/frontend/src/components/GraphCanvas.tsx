"use client";

import { useMemo, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSyllabus } from '@/context/SyllabusContext';

type GraphNode = { id: string; label: string; weight_percent?: number };
type GraphEdge = { source: string; target: string };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphStatus?: string;
  graphError?: string | null;
  onReprocess?: () => void;
};


// Custom Node for premium glassmorphism card rendering
function CustomTopicNode({ data }: { data: any }) {
  const { label, weight, typeOfHighlight } = data;
  
  let labelPrefix = "";
  let accentClass = "text-muted-foreground";
  if (typeOfHighlight === 'prereq') {
    labelPrefix = "📚 Prerequisite";
    accentClass = "text-purple-400";
  } else if (typeOfHighlight === 'successor') {
    labelPrefix = "🚀 Next Topic";
    accentClass = "text-teal-400";
  } else if (typeOfHighlight === 'active') {
    labelPrefix = "🎯 Active Node";
    accentClass = "text-blue-400 font-bold";
  }

  return (
    <div className="relative w-full h-full flex flex-col justify-between items-center text-left">
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'rgba(255, 255, 255, 0.4)', width: '8px', height: '8px', border: '1px solid #090d16' }}
      />
      
      <div className="w-full flex flex-col justify-center">
        {labelPrefix && (
          <span className={`text-[9px] uppercase tracking-wider mb-1 font-bold ${accentClass}`}>
            {labelPrefix}
          </span>
        )}
        <div className="text-[13px] font-semibold text-slate-100 line-clamp-2 leading-snug">
          {label}
        </div>
        {weight !== undefined && weight > 0 && (
          <div className="text-[9px] mt-2 text-slate-400 font-medium bg-white/5 py-0.5 px-2 rounded-full inline-block w-fit">
            Weight: {weight}%
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'rgba(255, 255, 255, 0.4)', width: '8px', height: '8px', border: '1px solid #090d16' }}
      />
    </div>
  );
}

const nodeTypes = {
  customTopicNode: CustomTopicNode,
};

export default function GraphCanvas({ nodes, edges, graphStatus, graphError, onReprocess }: Props) {
  const { queryTopicInChat } = useSyllabus();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  if (graphStatus === 'processing' || graphStatus === 'pending') {
    return (
      <div className="w-full h-[600px] border border-slate-800/80 rounded-2xl overflow-hidden bg-[#090d16] flex flex-col items-center justify-center p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent)] pointer-events-none" />
        
        {/* Premium Glassmorphic Spinner */}
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin" />
          <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-b-purple-500 animate-pulse" />
        </div>

        <h3 className="text-lg font-bold text-slate-100 mb-2 tracking-wide uppercase">Generating Conceptual Map</h3>
        <p className="text-sm text-slate-400 text-center max-w-md mb-8 leading-relaxed">
          Our AI is reading your syllabus chunks, identifying topics, extracting dependencies, and checking for cycles to build an interactive learning path. This may take a few seconds...
        </p>

        {/* Skeleton nodes animating/pulsing */}
        <div className="w-full max-w-lg flex flex-col gap-4 opacity-40 animate-pulse">
          <div className="flex justify-between items-center">
            <div className="h-12 w-32 bg-slate-800 rounded-xl border border-slate-700/50" />
            <div className="h-0.5 w-16 bg-slate-800" />
            <div className="h-12 w-32 bg-slate-800 rounded-xl border border-slate-700/50" />
          </div>
          <div className="flex justify-center">
            <div className="h-12 w-32 bg-slate-800 rounded-xl border border-slate-700/50" />
          </div>
          <div className="flex justify-between items-center">
            <div className="h-12 w-32 bg-slate-800 rounded-xl border border-slate-700/50" />
            <div className="h-0.5 w-16 bg-slate-800" />
            <div className="h-12 w-32 bg-slate-800 rounded-xl border border-slate-700/50" />
          </div>
        </div>
      </div>
    );
  }

  if (graphStatus === 'failed') {
    return (
      <div className="w-full h-[600px] border border-red-900/50 rounded-2xl overflow-hidden bg-[#0a0709] flex flex-col items-center justify-center p-8 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.06),transparent)] pointer-events-none" />

        {/* Premium Error Icon */}
        <div className="w-16 h-16 rounded-full bg-red-950/50 border border-red-500/30 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-red-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h3 className="text-lg font-bold text-red-200 mb-2 tracking-wide uppercase">Graph Generation Failed</h3>
        <p className="text-sm text-slate-400 text-center max-w-md mb-4 leading-relaxed">
          We encountered an issue while generating the hierarchical roadmap. This usually occurs due to rate limits or formatting mismatches.
        </p>

        {graphError && (
          <div className="w-full max-w-lg p-3 bg-red-950/20 border border-red-900/30 rounded-xl mb-6">
            <p className="text-xs text-red-300 font-mono text-center break-all line-clamp-3">
              {graphError}
            </p>
          </div>
        )}

        {onReprocess && (
          <button
            onClick={onReprocess}
            className="relative inline-flex items-center justify-center p-0.5 mb-2 me-2 overflow-hidden text-xs font-semibold rounded-full group bg-gradient-to-br from-red-500 to-purple-600 group-hover:from-red-500 group-hover:to-purple-600 text-white hover:text-white dark:text-white focus:ring-4 focus:outline-none focus:ring-red-800"
          >
            <span className="relative px-6 py-2 transition-all ease-in duration-75 bg-[#0a0709] rounded-full group-hover:bg-opacity-0">
              🔄 Retry Graph Generation
            </span>
          </button>
        )}
      </div>
    );
  }

  const activeNode = selectedNode || hoveredNode;


  // 1. Calculate Intelligent Topological Hierarchical Layout
  const computedLayout = useMemo(() => {
    const adjList: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};
    
    nodes.forEach(n => {
      adjList[n.id] = [];
      inDegree[n.id] = 0;
    });
    
    edges.forEach(e => {
      if (adjList[e.source]) {
        adjList[e.source].push(e.target);
      }
      if (inDegree[e.target] !== undefined) {
        inDegree[e.target]++;
      }
    });

    const levels: Record<string, number> = {};
    const queue: string[] = [];
    
    // Base layer: Nodes with 0 incoming dependencies
    nodes.forEach(n => {
      if (inDegree[n.id] === 0) {
        levels[n.id] = 0;
        queue.push(n.id);
      }
    });

    // Fallback if all nodes are cyclic or complex
    if (queue.length === 0 && nodes.length > 0) {
      levels[nodes[0].id] = 0;
      queue.push(nodes[0].id);
    }

    // Assign level using BFS/DFS sequence mapping
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currLevel = levels[curr] || 0;
      
      adjList[curr].forEach(next => {
        const nextLevel = Math.max(levels[next] || 0, currLevel + 1);
        levels[next] = nextLevel;
        if (!queue.includes(next) && nextLevel < nodes.length) {
          queue.push(next);
        }
      });
    }

    // Default missing nodes
    nodes.forEach(n => {
      if (levels[n.id] === undefined) {
        levels[n.id] = 0;
      }
    });

    // Group nodes by level to position evenly
    const nodesByLevel: Record<number, string[]> = {};
    nodes.forEach(n => {
      const lvl = levels[n.id];
      if (!nodesByLevel[lvl]) {
        nodesByLevel[lvl] = [];
      }
      nodesByLevel[lvl].push(n.id);
    });

    const positions: Record<string, { x: number; y: number }> = {};
    const columnWidth = 320;
    const rowHeight = 140;

    Object.entries(nodesByLevel).forEach(([lvlStr, nodeIds]) => {
      const lvl = parseInt(lvlStr);
      const numNodes = nodeIds.length;
      const totalHeight = (numNodes - 1) * rowHeight;
      const startY = -totalHeight / 2;

      nodeIds.forEach((id, idx) => {
        positions[id] = {
          x: lvl * columnWidth + 80,
          y: startY + idx * rowHeight + 220,
        };
      });
    });

    return positions;
  }, [nodes, edges]);

  // 2. Interactive Path Highlight Engine
  const highlightedElements = useMemo(() => {
    if (!activeNode) return null;

    const prerequisites = new Set<string>();
    const successors = new Set<string>();
    
    // Trace prerequisites (incoming paths recursively)
    const tracePrereqs = (nodeId: string) => {
      edges.forEach(e => {
        if (e.target === nodeId && !prerequisites.has(e.source)) {
          prerequisites.add(e.source);
          tracePrereqs(e.source);
        }
      });
    };

    // Trace successors (outgoing paths recursively)
    const traceSuccessors = (nodeId: string) => {
      edges.forEach(e => {
        if (e.source === nodeId && !successors.has(e.target)) {
          successors.add(e.target);
          traceSuccessors(e.target);
        }
      });
    };

    tracePrereqs(activeNode);
    traceSuccessors(activeNode);

    const highlightedNodes = new Set([activeNode, ...prerequisites, ...successors]);
    const highlightedEdges = new Set<string>();

    edges.forEach(e => {
      const id = `e-${e.source}-${e.target}`;
      const isPrereqEdge = (prerequisites.has(e.source) && prerequisites.has(e.target)) || (e.target === activeNode && prerequisites.has(e.source));
      const isSuccEdge = (successors.has(e.source) && successors.has(e.target)) || (e.source === activeNode && successors.has(e.target));
      if (isPrereqEdge || isSuccEdge) {
        highlightedEdges.add(id);
      }
    });

    return {
      nodes: highlightedNodes,
      edges: highlightedEdges,
      active: activeNode,
      prereqs: prerequisites,
      successors: successors,
    };
  }, [activeNode, edges]);

  // 3. React Flow node format mapping
  const rfNodes = useMemo(() => {
    return nodes.map((node) => {
      const pos = computedLayout[node.id] || { x: 0, y: 0 };
      
      let isHighlighted = true;
      let typeOfHighlight: 'none' | 'active' | 'prereq' | 'successor' = 'none';

      if (highlightedElements) {
        if (highlightedElements.nodes.has(node.id)) {
          isHighlighted = true;
          if (highlightedElements.active === node.id) {
            typeOfHighlight = 'active';
          } else if (highlightedElements.prereqs.has(node.id)) {
            typeOfHighlight = 'prereq';
          } else {
            typeOfHighlight = 'successor';
          }
        } else {
          isHighlighted = false;
        }
      }

      // Glassmorphism styling configuration
      let bg = 'rgba(15, 23, 42, 0.65)';
      let border = '1px solid rgba(255, 255, 255, 0.08)';
      let boxShadow = '0 8px 32px 0 rgba(0, 0, 0, 0.37)';
      let scale = 1;
      let opacity = 1;

      if (highlightedElements) {
        if (!isHighlighted) {
          opacity = 0.15;
          bg = 'rgba(15, 23, 42, 0.2)';
          boxShadow = 'none';
        } else {
          scale = 1.05;
          if (typeOfHighlight === 'active') {
            bg = 'rgba(30, 64, 175, 0.5)';
            border = '2px solid rgb(59, 130, 246)';
            boxShadow = '0 0 25px rgba(59, 130, 246, 0.6)';
          } else if (typeOfHighlight === 'prereq') {
            bg = 'rgba(88, 28, 135, 0.4)';
            border = '1px solid rgb(168, 85, 247)';
            boxShadow = '0 0 15px rgba(168, 85, 247, 0.35)';
          } else if (typeOfHighlight === 'successor') {
            bg = 'rgba(13, 148, 136, 0.3)';
            border = '1px solid rgb(45, 212, 191)';
            boxShadow = '0 0 15px rgba(45, 212, 191, 0.35)';
          }
        }
      }

      return {
        id: node.id,
        position: pos,
        data: { 
          label: node.label,
          weight: node.weight_percent,
          typeOfHighlight,
        },
        type: 'customTopicNode',
        style: {
          background: bg,
          border: border,
          borderRadius: '12px',
          padding: '12px 16px',
          boxShadow: boxShadow,
          width: 230,
          height: 100,
          opacity: opacity,
          transform: `scale(${scale})`,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: typeOfHighlight === 'active' ? 10 : 1,
        },
      };
    });
  }, [nodes, computedLayout, highlightedElements]);

  // 4. React Flow edge format mapping
  const rfEdges = useMemo(() => {
    return edges.map((edge) => {
      const id = `e-${edge.source}-${edge.target}`;
      
      let strokeColor = 'rgba(255, 255, 255, 0.12)';
      let strokeWidth = 1.5;
      let animated = false;

      if (highlightedElements) {
        if (highlightedElements.edges.has(id)) {
          animated = true;
          strokeWidth = 2.5;
          if (highlightedElements.prereqs.has(edge.source)) {
            strokeColor = 'rgb(192, 132, 252)'; // Soft purple
          } else {
            strokeColor = 'rgb(45, 212, 191)'; // Soft cyan
          }
        } else {
          strokeColor = 'rgba(255, 255, 255, 0.02)';
          strokeWidth = 1.0;
        }
      }

      return {
        id: id,
        source: edge.source,
        target: edge.target,
        animated: animated,
        style: { 
          stroke: strokeColor, 
          strokeWidth: strokeWidth,
          transition: 'all 0.3s ease',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
        },
      };
    });
  }, [edges, highlightedElements]);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-950/40">
        <p className="text-slate-400 text-sm">
          No graph data available yet. Please upload and process a syllabus PDF to see the interactive knowledge path.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-[600px] border border-slate-800/80 rounded-2xl overflow-hidden bg-[#090d16] relative group">
      {/* Dynamic Overlay Info Panel */}
      <div className="absolute top-4 left-4 z-10 bg-slate-950/85 backdrop-blur-md px-4 py-3 rounded-xl border border-slate-800/60 shadow-xl max-w-sm pointer-events-none transition-all duration-300">
        <h4 className="text-xs font-bold text-slate-200 tracking-wide uppercase mb-1">Interactive Roadmap</h4>
        <p className="text-[10px] text-slate-400 leading-normal">
          • <strong>Hover or Click</strong> nodes to trace dependency paths.<br/>
          • <span className="text-purple-400 font-semibold">Purple nodes</span> indicate prerequisites.<br/>
          • <span className="text-teal-400 font-semibold">Teal nodes</span> show advanced successor topics.<br/>
          • <strong>Double Click</strong> a topic to study it in the AI Chat.
        </p>
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNode(node.id === selectedNode ? null : node.id)}
        onNodeMouseEnter={(_, node) => setHoveredNode(node.id)}
        onNodeMouseLeave={() => setHoveredNode(null)}
        onNodeDoubleClick={(_, node) => {
          if (node.data && node.data.label) {
            queryTopicInChat(node.data.label as string);
          }
        }}
        fitView
        attributionPosition="bottom-right"
      >
        <Controls className="bg-slate-900 border border-slate-800 text-slate-300 fill-slate-300 [&_button]:border-slate-800 [&_button]:bg-slate-950 hover:[&_button]:bg-slate-900 transition-colors rounded-lg shadow-xl" />
        <MiniMap 
          zoomable 
          pannable 
          nodeColor={(n) => {
            if (n.data?.typeOfHighlight === 'active') return '#3b82f6';
            if (n.data?.typeOfHighlight === 'prereq') return '#8b5cf6';
            if (n.data?.typeOfHighlight === 'successor') return '#14b8a6';
            return '#1e293b';
          }}
          maskColor="rgba(9, 13, 22, 0.75)"
          className="bg-slate-950 border border-slate-800 rounded-lg shadow-xl"
        />
        <Background color="#1e293b" gap={18} size={1} />
      </ReactFlow>
    </div>
  );
}