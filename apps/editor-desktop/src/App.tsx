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
import { collectBundle, fromProject } from "./editor/file/projectIO";



const nodeTypes: NodeTypes = {
  questionNode: NodeQuestion,
  endingNode: NodeEnding
};

export default function App() {
  const isDirty = useEditorStore((s) => s.isDirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const markSaved = useEditorStore((s) => s.markSaved);
  const markDirty = useEditorStore((s) => s.markDirty);

  const isLoadingProject = useEditorStore((s) => s.isLoadingProject);
  const beginLoad = useEditorStore((s) => s.beginLoad);
  const endLoad = useEditorStore((s) => s.endLoad);


  const replaceAll = useEditorStore((s) => s.replaceAll);
  
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const setCurrentFilePath = useEditorStore((s) => s.setCurrentFilePath);

  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const setNodes = useEditorStore((s) => s.setNodes);
  const setEdges = useEditorStore((s) => s.setEdges);

  const saveAsToFile = useCallback(async () => {
    const bundle = await collectBundle(nodes, edges);
    const res = await window.branchpro.saveBundle({ ...bundle, filePath: null });
    if (res?.ok) {
      setCurrentFilePath(res.path);
      markSaved(); // ✅ сброс dirty + saved timestamp
    }
  }, [nodes, edges, setCurrentFilePath]);

  const saveToFile = useCallback(async () => {
    // ✅ новый проект — Save As
    if (!currentFilePath) {
      await saveAsToFile();
      return;
    }
    const bundle = await collectBundle(nodes, edges);
    const res = await window.branchpro.saveBundle({ ...bundle, filePath: currentFilePath });
    if (res?.ok) {
      setCurrentFilePath(res.path);
      markSaved(); // ✅ сброс dirty + saved timestamp
    }
  }, [nodes, edges, currentFilePath, setCurrentFilePath, saveAsToFile]);

  const loadFromFile = useCallback(async () => {
    const res = await window.branchpro.openBundle();
    if (!res?.ok) return;

    beginLoad();
    try {
      await window.branchpro.setMediaRoot(res.mediaRoot);
      setCurrentFilePath(res.path);

      const { nodes: n, edges: e } = fromProject(res.project);
      replaceAll(n, e);
      setTimeout(() => {
      endLoad();          // твой endLoad должен ставить isDirty=false
    }, 50);
    } finally {
      // ✅ даём ReactFlow “доприкоснуться” к графу 1 тик
      setTimeout(() => endLoad(), 0);
    }
  }, [beginLoad, endLoad, replaceAll, setCurrentFilePath]);


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
    const meaningful = changes.some((c: any) => {
      if (c.type === "add" || c.type === "remove") return true;

      // ✅ позиция считается изменением только при реальном перетаскивании
      if (c.type === "position") return !!c.dragging;

      // ❌ select/dimensions и т.п. — это служебное
      return false;
    });

    if (!isLoadingProject && meaningful) markDirty();
    setNodes(applyNodeChanges(changes, nodes));
  },
  [nodes, setNodes, markDirty, isLoadingProject]
);


  const onEdgesChange = useCallback(
  (changes: EdgeChange[]) => {
    const meaningful = changes.some((c: any) => c.type === "add" || c.type === "remove");

    if (!isLoadingProject && meaningful) markDirty();
    setEdges(applyEdgeChanges(changes, edges));
  },
  [edges, setEdges, markDirty, isLoadingProject]
);


  const onConnect = useCallback(
  (c: Connection) => {
    if (!isLoadingProject) markDirty();
    setEdges(addEdge(c, edges));
  },
  [edges, setEdges, markDirty, isLoadingProject]
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

      const ctrl = e.ctrlKey || e.metaKey;
      const code = e.code;

      if (ctrl && code === "KeyZ" && !e.shiftKey) {
          e.preventDefault();
        undo();
      } else if (ctrl && (code === "KeyY" || (code === "KeyZ" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (code === "Delete") {
        e.preventDefault();
        requestDelete();
     } else if (ctrl && code === "KeyN") {
        e.preventDefault();
        addQuestion();
      } else if (ctrl && e.code === "KeyS") {
        e.preventDefault();
        saveToFile();
      }
    };


    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, requestDelete, addQuestion, saveToFile]);

  useEffect(() => {
  const off = window.branchpro.onMenuAction?.((action: string) => {
    if (action === "open") loadFromFile();
    if (action === "save") saveToFile();
    if (action === "saveAs") saveAsToFile();
  });

  return () => {
    if (typeof off === "function") off();
  };
}, [loadFromFile, saveToFile, saveAsToFile]);
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

      setSelection([...ids],[]);
      setNodes(nodes.map((n) => ({ ...n, selected: ids.has(n.id) })));
    },
    [nodes, setNodes, setSelection]
  );

  // Shift + Right Click drag selection
  const onWrapperPointerDown = useCallback((e: React.PointerEvent) => {
  // Shift + ПКМ
  if (!(e.shiftKey && e.button === 2)) return;

  e.preventDefault();
  e.stopPropagation();

  // ✅ захватываем указатель
  (e.currentTarget as any).setPointerCapture?.(e.pointerId);

  // ✅ на время выделения отключаем выделение текста в документе
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.userSelect = "none";

  isSelectingRef.current = true;
  setBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });

  const onMove = (ev: PointerEvent) => {
    if (!isSelectingRef.current) return;
    ev.preventDefault();
    setBox((b) => (b ? { ...b, x2: ev.clientX, y2: ev.clientY } : b));
  };

  const onUp = (ev: PointerEvent) => {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;

    // финализируем выделение
    selectNodesInBox(e.clientX, e.clientY, ev.clientX, ev.clientY);
    setBox(null);

    // ✅ возвращаем выделение текста обратно
    document.body.style.userSelect = prevUserSelect;

    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp, { passive: false });
}, [selectNodesInBox]);


  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh", overflow: "hidden" }}>
      <div style={{ background: "#0b0b0b", overflow: "hidden" }}>
        <TopBar />



        <div
          ref={wrapperRef}
          onPointerDown={onWrapperPointerDown}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            height: "calc(100vh - 52px)",
            overflow: "hidden",
            position: "relative",
            userSelect: "none" // ✅ чтобы текст не выделялся на канвасе
          }}

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
            deleteKeyCode={null}
            onSelectionChange={({ nodes, edges }) =>
              setSelection(
                nodes.map((n) => n.id),
                edges.map((e) => e.id)
              )
}

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
            flowRef={rfRef}
            wrapperRef={wrapperRef}
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

  const isDirty = useEditorStore((s) => s.isDirty);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!lastSavedAt) return;

    setShowSaved(true);
    const t = window.setTimeout(() => setShowSaved(false), 1200);
    return () => window.clearTimeout(t);
  }, [lastSavedAt]);


  

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
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {currentFilePath ? basename(currentFilePath) : "Новый проект"}
        {isDirty ? <span style={{ marginLeft: 8, color: "#fbbf24" }}>●</span> : null}
      </div>

      {/* короткий “Saved” эффект */}
      {showSaved ? <div style={{ fontSize: 12, opacity: 0.85 }}>✅ Сохранено</div> : null}
    </div>

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
  flowRef: React.MutableRefObject<any>;
  wrapperRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const W = 240;
  const H = 160;
  const PAD = 14;

  const [vp, setVp] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

  const [camPulse, setCamPulse] = useState(0);
  const lastVpRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  const draggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  // ✅ обновляем viewport + wrapper size
  useEffect(() => {
    let raf = 0;
    
    const tick = () => {
      const inst = props.flowRef.current;
      if (inst?.getViewport) {
        const v = inst.getViewport();
        setVp((cur) => (cur.x === v.x && cur.y === v.y && cur.zoom === v.zoom ? cur : v));

        const last = lastVpRef.current;
        if (!last || last.x !== v.x || last.y !== v.y || last.zoom !== v.zoom) {
          lastVpRef.current = v;
          setCamPulse(1);
          if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
          pulseTimerRef.current = window.setTimeout(() => setCamPulse(0), 40);
        }
      }

      const el = props.wrapperRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setWrapSize((cur) => (cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    };
  }, [props.flowRef, props.wrapperRef]);

  // ✅ ВАЖНО: bounds считаем по node.position (НЕ positionAbsolute)
  const model = useMemo(() => {
    const ns = props.nodes ?? [];
    const es = props.edges ?? [];

    const items = ns.map((n: any) => {
      const pos = n.position ?? { x: 0, y: 0 }; // ✅ стабильные world coords
      const w = n.width ?? 300;
      const h = n.height ?? 140;
      return { id: n.id, x: pos.x, y: pos.y, w, h, data: n.data, selected: !!n.selected };
    });

    if (items.length === 0) {
      return { nodeRects: [], edgeLines: [], minX: 0, minY: 0, scale: 1 };
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const it of items) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w);
      maxY = Math.max(maxY, it.y + it.h);
    }

    const extra = 140;
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

    const nodeRects = items.map((it) => {
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

    const edgeLines = (es ?? [])
      .map((e: any) => {
        const a = centerById.get(e.source);
        const b = centerById.get(e.target);
        if (!a || !b) return null;
        return { id: e.id ?? `${e.source}->${e.target}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      })
      .filter(Boolean) as { id: string; x1: number; y1: number; x2: number; y2: number }[];

    return { nodeRects, edgeLines, minX, minY, scale };
  }, [props.nodes, props.edges]);

  const kindFill = (kind: string) => (kind === "ending" ? "rgba(74, 222, 128, 0.26)" : "rgba(125, 211, 252, 0.22)");
  const kindStroke = (kind: string) => (kind === "ending" ? "rgba(74, 222, 128, 0.55)" : "rgba(125, 211, 252, 0.55)");

  // ✅ world <-> minimap
  const miniToWorld = (mx: number, my: number) => ({
    x: (mx - PAD) / model.scale + model.minX,
    y: (my - PAD) / model.scale + model.minY
  });

  // ✅ центрировать камеру на точку
  const centerCameraTo = (worldX: number, worldY: number, duration = 90) => {
    const inst = props.flowRef.current;
    const wrap = props.wrapperRef.current;
    if (!inst?.setViewport || !inst?.getViewport || !wrap) return;

    const { zoom } = inst.getViewport();
    const wr = wrap.getBoundingClientRect();
    const nextX = -worldX * zoom + wr.width / 2;
    const nextY = -worldY * zoom + wr.height / 2;
    inst.setViewport({ x: nextX, y: nextY, zoom }, { duration });
  };

  // ✅ zoom относительно world-точки (под курсором)
  const zoomAtWorldPoint = (worldX: number, worldY: number, nextZoom: number, duration = 120) => {
    const inst = props.flowRef.current;
    const wrap = props.wrapperRef.current;
    if (!inst?.setViewport || !inst?.getViewport || !wrap) return;

    const cur = inst.getViewport();
    const z = clamp(nextZoom, 0.15, 2.5);

    // хотим: worldX/worldY оставались под тем же экранным курсором.
    // возьмём центр экрана как якорь для “приятности”
    const wr = wrap.getBoundingClientRect();
    const cx = wr.width / 2;
    const cy = wr.height / 2;

    // сделаем так, чтобы выбранная world-точка стала центром (чуть мягче UX)
    const nextX = -worldX * z + cx;
    const nextY = -worldY * z + cy;

    inst.setViewport({ x: nextX, y: nextY, zoom: z }, { duration });
  };


  const cameraRect = useMemo(() => {
    const { x, y, zoom } = vp;
    const vw = wrapSize.w;
    const vh = wrapSize.h;

    const left = (0 - x) / zoom;
    const top = (0 - y) / zoom;
    const right = (vw - x) / zoom;
    const bottom = (vh - y) / zoom;

    const mx = PAD + (left - model.minX) * model.scale;
    const my = PAD + (top - model.minY) * model.scale;
    const mw = (right - left) * model.scale;
    const mh = (bottom - top) * model.scale;


    const minX = PAD;
    const minY = PAD;
    const maxX = W - PAD;
    const maxY = H - PAD;

    const x2 = clamp(mx, minX, maxX);
    const y2 = clamp(my, minY, maxY);
    const w2 = clamp(mw, 0, maxX - x2);
    const h2 = clamp(mh, 0, maxY - y2);



    return { x: x2, y: y2, w: w2, h: h2 };
  }, [vp, wrapSize, model.minX, model.minY, model.scale]);

  const camOpacity = useMemo(() => 0.35 + camPulse * 0.55, [camPulse]);

  // ✅ Click (центр)
  const onMiniClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current) return;
    if (!svgRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);

    const w = miniToWorld(mx, my);
    centerCameraTo(w.x, w.y, 220);
  };

  // ✅ Double click = zoom-in to point
  const onMiniDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);

    const w = miniToWorld(mx, my);
    zoomAtWorldPoint(w.x, w.y, vp.zoom * 1.25, 160);
  };

  // ✅ Drag to pan
  const onMiniPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    draggingRef.current = true;
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);

    const w = miniToWorld(mx, my);
    centerCameraTo(w.x, w.y, 60);
  };

  const onMiniPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current || !svgRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);

    const w = miniToWorld(mx, my);
    centerCameraTo(w.x, w.y, 0); // мгновенно, чтобы не “накапливалась” анимация
  };

  const onMiniPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = false;
  };

  // ✅ Wheel zoom
  const onMiniWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);
    const w = miniToWorld(mx, my);

    const dir = Math.sign(e.deltaY); // + вниз (zoom out), - вверх (zoom in)
    const factor = dir > 0 ? 1 / 1.12 : 1.12;

    zoomAtWorldPoint(w.x, w.y, vp.zoom * factor, 80);
  };

  // zoom buttons
  const zoomIn = () => zoomAtWorldPoint(0, 0, vp.zoom * 1.15, 120);
  const zoomOut = () => zoomAtWorldPoint(0, 0, vp.zoom / 1.15, 120);

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

  const zoomBtn: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    fontSize: 14,
    lineHeight: "14px"
  };

  return (
    <div
      style={panelStyle}
      onPointerDown={(e) => e.stopPropagation()} // ✅ чтобы Shift+ПКМ выделение не стартовало на миникарте
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
        <svg
          ref={svgRef}
          width={W}
          height={H}
          style={{ display: "block", cursor: draggingRef.current ? "grabbing" : "grab" }}
          onClick={onMiniClick}
          onDoubleClick={onMiniDoubleClick}
          onPointerDown={onMiniPointerDown}
          onPointerMove={onMiniPointerMove}
          onPointerUp={onMiniPointerUp}
          onPointerCancel={onMiniPointerUp}
          onWheel={onMiniWheel}
        >
          {/* edges */}
          {model.edgeLines.map((l) => (
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
          {model.nodeRects.map((r: any) => (
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

          {/* camera rectangle (clamped) */}
          <rect
            x={cameraRect.x}
            y={cameraRect.y}
            width={cameraRect.w}
            height={cameraRect.h}
            rx={6}
            ry={6}
            fill={`rgba(255,255,255,${0.04 * camOpacity})`}
            stroke={`rgba(255,255,255,${camOpacity})`}
            strokeWidth={1.2}
            strokeDasharray="6 4"
            pointerEvents="none"
            style={{ transition: "opacity 220ms ease, stroke 220ms ease, fill 220ms ease" }}
          />
        </svg>
      ) : null}
    </div>
  );
}


function basename(p: string) {
  return String(p).split(/[\\/]/).pop() ?? p;
}
