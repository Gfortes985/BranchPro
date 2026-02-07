import "reactflow/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes
} from "reactflow";

import NodeQuestion from "./editor/canvas/NodeQuestion";
import NodeEnding from "./editor/canvas/NodeEnding";
import Inspector from "./editor/inspector/Inspector";
import ConfirmDelete from "./editor/dialogs/ConfirmDelete";
import { useEditorStore } from "./editor/store/editorStore";

const nodeTypes: NodeTypes = {
  questionNode: NodeQuestion,
  endingNode: NodeEnding
};

export default function App() {
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const setNodes = useEditorStore((s) => s.setNodes);
  const setEdges = useEditorStore((s) => s.setEdges);

  const addQuestion = useEditorStore((s) => s.addQuestion);
  const addEnding = useEditorStore((s) => (s as any).addEnding); // если TS ругается — поправим типы стора
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const requestDelete = useEditorStore((s) => s.requestDelete);

  const confirmOpen = useEditorStore((s) => s.confirmDeleteOpen);
  const confirmCount = useEditorStore((s) => s.confirmDeleteCount);
  const confirmDelete = useEditorStore((s) => s.confirmDelete);
  const cancelDelete = useEditorStore((s) => s.cancelDelete);

  const setSelection = useEditorStore((s) => s.setSelection);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rfRef = useRef<any>(null);

  const [box, setBox] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);
  const isSelectingRef = useRef(false);

  const [miniOpen, setMiniOpen] = useState(true);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(applyNodeChanges(changes, nodes));
    },
    [nodes, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(applyEdgeChanges(changes, edges));
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges(addEdge(c, edges));
    },
    [edges, setEdges]
  );

  // hotkeys: undo/redo/delete/new question
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || (el as any).isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((ctrl && key === "y") || (ctrl && e.shiftKey && key === "z")) {
        e.preventDefault();
        redo();
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        requestDelete();
      } else if (ctrl && key === "n") {
        e.preventDefault();
        addQuestion();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, requestDelete, addQuestion]);

  // selection box helpers
  const pickRect = (a: number, b: number, c: number, d: number) => ({
    left: Math.min(a, c),
    top: Math.min(b, d),
    right: Math.max(a, c),
    bottom: Math.max(b, d)
  });

  const selectNodesInBox = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const inst = rfRef.current;
      const el = wrapperRef.current;
      if (!inst || !el) return;

      const r = el.getBoundingClientRect();
      const p1 = inst.project({ x: x1 - r.left, y: y1 - r.top });
      const p2 = inst.project({ x: x2 - r.left, y: y2 - r.top });
      const rect = pickRect(p1.x, p1.y, p2.x, p2.y);

      const ids = new Set<string>();
      for (const n of nodes) {
        const pos = (n as any).positionAbsolute ?? n.position;
        const w = (n as any).width ?? 300;
        const h = (n as any).height ?? 140;

        const nl = pos.x;
        const nt = pos.y;
        const nr = pos.x + w;
        const nb = pos.y + h;

        const intersects = !(nr < rect.left || nl > rect.right || nb < rect.top || nt > rect.bottom);
        if (intersects) ids.add(n.id);
      }

      setSelection([...ids]);
      setNodes(nodes.map((n) => ({ ...n, selected: ids.has(n.id) })));
    },
    [nodes, setNodes, setSelection]
  );

  // Shift + Right Click drag selection
  const onWrapperPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!(e.shiftKey && e.button === 2)) return;

      e.preventDefault();
      e.stopPropagation();

      isSelectingRef.current = true;
      setBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });

      const onMove = (ev: PointerEvent) => {
        if (!isSelectingRef.current) return;
        setBox((b) => (b ? { ...b, x2: ev.clientX, y2: ev.clientY } : b));
      };

      const onUp = (ev: PointerEvent) => {
        if (!isSelectingRef.current) return;
        isSelectingRef.current = false;

        selectNodesInBox(e.clientX, e.clientY, ev.clientX, ev.clientY);
        setBox(null);

        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [selectNodesInBox]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh", overflow: "hidden" }}>
      <div style={{ background: "#0b0b0b", overflow: "hidden" }}>
        <TopBar />

        <div
          ref={wrapperRef}
          onPointerDown={onWrapperPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          style={{ height: "calc(100vh - 52px)", overflow: "hidden", position: "relative" }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={(inst) => (rfRef.current = inst)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            selectionOnDrag={false}
            onSelectionChange={({ nodes }) => setSelection(nodes.map((n) => n.id))}
          >
            <Background />
            <Controls />
          </ReactFlow>

          {/* ✅ MiniMap overlay */}
          <BranchMiniMap
            open={miniOpen}
            onToggle={() => setMiniOpen((v) => !v)}
            nodes={nodes}
            edges={edges}
          />

          {/* ✅ selection rectangle */}
          {box
            ? (() => {
                const rect = pickRect(box.x1, box.y1, box.x2, box.y2);
                const wr = wrapperRef.current?.getBoundingClientRect();
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: rect.left - (wr?.left ?? 0),
                      top: rect.top - (wr?.top ?? 0),
                      width: rect.right - rect.left,
                      height: rect.bottom - rect.top,
                      border: "1px solid rgba(125, 211, 252, 0.9)",
                      background: "rgba(125, 211, 252, 0.12)",
                      borderRadius: 6,
                      pointerEvents: "none"
                    }}
                  />
                );
              })()
            : null}
        </div>

        <ConfirmDelete open={confirmOpen} count={confirmCount} onConfirm={confirmDelete} onCancel={cancelDelete} />
      </div>

      <div style={{ borderLeft: "1px solid #1f1f1f", background: "#0f0f0f", overflow: "auto" }}>
        <Inspector />
      </div>
    </div>
  );
}

function TopBar() {
  const addQuestion = useEditorStore((s) => s.addQuestion);
  const addEnding = useEditorStore((s) => (s as any).addEnding);
  const requestDelete = useEditorStore((s) => s.requestDelete);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 10,
        borderBottom: "1px solid #1f1f1f",
        background: "#0f0f0f",
        color: "#fff",
        overflow: "hidden"
      }}
    >
      <button style={tbBtn} onClick={addQuestion}>➕ Вопрос (Ctrl+N)</button>
      <button style={tbBtn} onClick={addEnding}>🏁 Концовка</button>
      <button style={tbBtn} onClick={requestDelete}>🗑️ Удалить (Del)</button>
      <div style={{ width: 10 }} />
      <button style={tbBtn} onClick={undo}>↩️ Undo</button>
      <button style={tbBtn} onClick={redo}>↪️ Redo</button>
      <div style={{ marginLeft: "auto", opacity: 0.75, fontSize: 12 }}>BranchPro Editor</div>
    </div>
  );
}

const tbBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#151515",
  color: "#fff",
  cursor: "pointer"
};

/* ---------------- MiniMap Overlay ---------------- */

function BranchMiniMap(props: {
  open: boolean;
  onToggle: () => void;
  nodes: any[];
  edges: any[];
}) {
  const W = 240;
  const H = 160;
  const PAD = 14;

  const { nodeRects, edgeLines } = useMemo(() => {
    const ns = props.nodes ?? [];
    const es = props.edges ?? [];

    const items = ns.map((n: any) => {
      const pos = n.positionAbsolute ?? n.position ?? { x: 0, y: 0 };
      const w = n.width ?? 300;
      const h = n.height ?? 140;
      return { id: n.id, x: pos.x, y: pos.y, w, h, data: n.data, selected: !!n.selected };
    });

    if (items.length === 0) return { nodeRects: [], edgeLines: [] };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w);
      maxY = Math.max(maxY, it.y + it.h);
    }

    const extra = 80;
    minX -= extra;
    minY -= extra;
    maxX += extra;
    maxY += extra;

    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);

    const mapPoint = (p: { x: number; y: number }) => ({
      x: PAD + (p.x - minX) * scale,
      y: PAD + (p.y - minY) * scale
    });

    const rects = items.map((it) => {
      const p = mapPoint({ x: it.x, y: it.y });
      return {
        id: it.id,
        x: p.x,
        y: p.y,
        w: Math.max(6, it.w * scale),
        h: Math.max(5, it.h * scale),
        kind: it.data?.kind ?? "question",
        selected: it.selected
      };
    });

    const centerById = new Map<string, { x: number; y: number }>();
    for (const it of items) {
      centerById.set(it.id, mapPoint({ x: it.x + it.w / 2, y: it.y + it.h / 2 }));
    }

    const lines = es
      .map((e: any) => {
        const a = centerById.get(e.source);
        const b = centerById.get(e.target);
        if (!a || !b) return null;
        return { id: e.id ?? `${e.source}->${e.target}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      })
      .filter(Boolean) as { id: string; x1: number; y1: number; x2: number; y2: number }[];

    return { nodeRects: rects, edgeLines: lines };
  }, [props.nodes, props.edges]);

  const kindFill = (kind: string) => {
    if (kind === "ending") return "rgba(74, 222, 128, 0.26)"; // зелёный
    if (kind === "system") return "rgba(250, 204, 21, 0.26)"; // жёлтый
    return "rgba(125, 211, 252, 0.22)"; // question
  };

  const kindStroke = (kind: string) => {
    if (kind === "ending") return "rgba(74, 222, 128, 0.55)";
    if (kind === "system") return "rgba(250, 204, 21, 0.55)";
    return "rgba(125, 211, 252, 0.55)";
  };

  const panelStyle: React.CSSProperties = {
    position: "absolute",
    right: 12,
    bottom: 12,
    zIndex: 30,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12, 12, 14, 0.78)",
    boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    overflow: "hidden",
    userSelect: "none",
    pointerEvents: "auto"
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderBottom: props.open ? "1px solid rgba(255,255,255,0.08)" : "none"
  };

  const toggleBtn: React.CSSProperties = {
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12
  };

  const badge: React.CSSProperties = {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 11,
    opacity: 0.85
  };

  return (
    <div
      style={panelStyle}
      onPointerDown={(e) => e.stopPropagation()} // ✅ чтобы Shift+ПКМ рамка не стартовала на миникарте
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={headerStyle}>
        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.92 }}>MiniMap</div>
        {props.open ? <div style={badge}>{props.nodes.length} nodes</div> : null}

        <button style={toggleBtn} onClick={props.onToggle}>
          {props.open ? "Свернуть" : "Развернуть"}
        </button>
      </div>

      {props.open ? (
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* edges */}
          {edgeLines.map((l) => (
            <line
              key={l.id}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="rgba(255,255,255,0.20)"
              strokeWidth={1}
            />
          ))}

          {/* nodes */}
          {nodeRects.map((r) => (
            <rect
              key={r.id}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={6}
              ry={6}
              fill={r.selected ? "rgba(125,211,252,0.35)" : kindFill(r.kind)}
              stroke={r.selected ? "rgba(125,211,252,0.95)" : kindStroke(r.kind)}
              strokeWidth={1}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
}
