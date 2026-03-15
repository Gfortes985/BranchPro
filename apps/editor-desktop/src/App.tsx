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
import ValidationReport from "./editor/dialogs/ValidationReport";
import PreviewPlayMode from "./editor/dialogs/PreviewPlayMode";
import { useEditorStore } from "./editor/store/editorStore";
import { collectBundle, fromProject } from "./editor/file/projectIO";
import { validateProject, type ValidationIssue } from "./editor/validation/validateProject";
import type { Edge, Node } from "reactflow";
import { nanoid } from "nanoid";
import { LicenseGate } from "./auth/LicenseGate";





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
      markSaved(); 
    }
  }, [nodes, edges, setCurrentFilePath]);

  const saveToFile = useCallback(async () => {
    if (!currentFilePath) {
      await saveAsToFile();
      return;
    }
    const bundle = await collectBundle(nodes, edges);
    const res = await window.branchpro.saveBundle({ ...bundle, filePath: currentFilePath });
    if (res?.ok) {
      setCurrentFilePath(res.path);
      markSaved(); 
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
      endLoad();        
    }, 50);
    } finally {
      setTimeout(() => endLoad(), 0);
    }
  }, [beginLoad, endLoad, replaceAll, setCurrentFilePath]);


  const addQuestion = useEditorStore((s) => s.addQuestion);
  const addEnding = useEditorStore((s) => (s as any).addEnding);
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

  type CopyBuf = {
  nodes: Node<any>[];
  edges: Edge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  pasteCount: number;
  };

  const copyRef = useRef<CopyBuf | null>(null);

  const getViewportCenterWorld = () => {
    const inst = rfRef.current;
    const el = wrapperRef.current;
    if (!inst || !el) return { x: 0, y: 0 };

    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;

    return inst.project({ x: cx, y: cy });
  };

  const computeBounds = (ns: Node<any>[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) {
      const p = n.position ?? { x: 0, y: 0 };
      const w = (n as any).width ?? 300;
      const h = (n as any).height ?? 140;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + h);
    }
    if (!ns.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
  };

  const copySelection = useCallback(() => {
    const sel = new Set(useEditorStore.getState().selectedNodeIds);
    if (sel.size === 0) return;

    const pickedNodes = nodes.filter((n) => sel.has(n.id));
    if (pickedNodes.length === 0) return;

    const pickedEdges = edges.filter((e) => sel.has(e.source) && sel.has(e.target));

    copyRef.current = {
      nodes: structuredClone(pickedNodes),
      edges: structuredClone(pickedEdges),
      bounds: computeBounds(pickedNodes),
      pasteCount: 0
    };
  }, [nodes, edges]);

  const pasteSelection = useCallback(() => {
    const buf = copyRef.current;
    if (!buf || buf.nodes.length === 0) return;

    const center = getViewportCenterWorld();
    const { minX, minY, maxX, maxY } = buf.bounds;

    const srcCenterX = (minX + maxX) / 2;
    const srcCenterY = (minY + maxY) / 2;

    const nudge = 26 * (buf.pasteCount + 1);

    const dx = center.x - srcCenterX + nudge;
    const dy = center.y - srcCenterY + nudge;

    const idMap = new Map<string, string>();
    for (const n of buf.nodes) idMap.set(n.id, nanoid());

    const newNodes: Node<any>[] = buf.nodes.map((n) => {
      const newId = idMap.get(n.id)!;

      const nextData =
        n.type === "questionNode" && (n.data as any)?.kind === "question"
          ? { ...(n.data as any), isEntry: false }
          : n.data;

      return {
        ...n,
        id: newId,
        data: nextData,
        position: {
          x: (n.position?.x ?? 0) + dx,
          y: (n.position?.y ?? 0) + dy
        },
        selected: true
      };
    });


  const newEdges: Edge[] = buf.edges.map((e) => ({
    ...e,
    id: nanoid(),
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));

  // снимаем выделение со старых
  const clearedNodes = nodes.map((n) => ({ ...n, selected: false }));

  markDirty();
  setNodes([...clearedNodes, ...newNodes]);
  setEdges([...edges, ...newEdges]);

  // обновим selection store
  setSelection(newNodes.map((n) => n.id), []);

  buf.pasteCount += 1;
}, [nodes, edges, setNodes, setEdges, markDirty, setSelection]);



  const [box, setBox] = useState<null | { x1: number; y1: number; x2: number; y2: number }>(null);
  const isSelectingRef = useRef(false);

  const [miniOpen, setMiniOpen] = useState(true);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const runValidation = useCallback(() => {
    const issues = validateProject(nodes as any, edges);
    setValidationIssues(issues);
    setValidationOpen(true);
  }, [nodes, edges]);

  const onNodesChange = useCallback(
  (changes: NodeChange[]) => {
    const meaningful = changes.some((c: any) => {
      if (c.type === "add" || c.type === "remove") return true;

      if (c.type === "position") return !!c.dragging;

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
    const source = c.source ?? "";
    const target = c.target ?? "";
    if (!source || !target) return;

    if (source === target) return;

    const sourceHandle = c.sourceHandle ?? "";
    const exists = edges.some(
      (e) => e.source === source && (e.sourceHandle ?? "") === sourceHandle
    );
    if (exists) return;

    if (!isLoadingProject) markDirty();
    setEdges(addEdge(c, edges));
  },
  [edges, setEdges, markDirty, isLoadingProject]
);


const isValidConnection = useCallback(
  (c: Connection) => {
    const source = c.source ?? "";
    const target = c.target ?? "";
    const sourceHandle = c.sourceHandle ?? "";

    if (!source || !target) return false;


    if (source === target) return false;

    const alreadyUsed = edges.some(
      (e) => e.source === source && (e.sourceHandle ?? "") === sourceHandle
    );

    return !alreadyUsed;
  },
  [edges]
);



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
      } else if (ctrl && code === "KeyC") {
        e.preventDefault();
        copySelection();
        return;
      } else if (ctrl && code === "KeyV") {
        e.preventDefault();
        pasteSelection();
        return;
      }
    };


    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, requestDelete, addQuestion, saveToFile, copySelection, pasteSelection]);


  useEffect(() => {
  const off = window.branchpro.onMenuAction?.(async (action: string, token?: string) => {
    try {
      if (action === "open") {
        await loadFromFile();
        return;
      }

      if (action === "save") {
        await saveToFile();
        if (token) window.branchpro.reportSaveResult(token, true, currentFilePath ?? null);
        return;
      }

      if (action === "saveAs") {
        await saveAsToFile();
        if (token) window.branchpro.reportSaveResult(token, true, currentFilePath ?? null);
        return;
      }
    } catch (e) {
      if (token) window.branchpro.reportSaveResult(token, false, null);
    }
  });

  return () => { if (typeof off === "function") off(); };
}, [loadFromFile, saveToFile, saveAsToFile, currentFilePath]);

  useEffect(() => {
  const openByPath = async (filePath: string) => {
    console.log("[openByPath] file =", filePath);
    const res = await window.branchpro.openBundleAtPath(filePath);
    if (!res?.ok) return;

    await window.branchpro.setMediaRoot(res.mediaRoot);
    setCurrentFilePath(res.path);

    const { nodes: n, edges: e } = fromProject(res.project);
    replaceAll(n, e);
  };

  const off = window.branchpro.onOpenFile?.((filePath: string) => {
    openByPath(filePath);
  });

  (async () => {
    const pending = await window.branchpro.getPendingOpenFile?.();
    if (pending) await openByPath(pending);
  })();

  return () => { if (typeof off === "function") off(); };
}, [replaceAll, setCurrentFilePath]);


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

  const onWrapperPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 2) return;


    e.preventDefault();
    e.stopPropagation();

    (e.currentTarget as any).setPointerCapture?.(e.pointerId);

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

      selectNodesInBox(e.clientX, e.clientY, ev.clientX, ev.clientY);
      setBox(null);

      document.body.style.userSelect = prevUserSelect;

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });
  }, [selectNodesInBox]);


    return (
    <LicenseGate>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh", overflow: "hidden" }}>
        <div style={{ background: "#0b0b0b", overflow: "visible" }}>
          <TopBar onValidate={runValidation} onPreview={() => setPreviewOpen(true)} />

          <div
            ref={wrapperRef}
            onPointerDown={onWrapperPointerDown}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              height: "calc(100vh - 52px)",
              overflow: "hidden",
              position: "relative",
              userSelect: "none"
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onInit={(inst) => (rfRef.current = inst)}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              isValidConnection={isValidConnection}
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

            <BranchMiniMap
              open={miniOpen}
              onToggle={() => setMiniOpen((v) => !v)}
              nodes={nodes}
              edges={edges}
              flowRef={rfRef}
              wrapperRef={wrapperRef}
            />

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
          <ValidationReport open={validationOpen} issues={validationIssues} onClose={() => setValidationOpen(false)} />
          <PreviewPlayMode open={previewOpen} nodes={nodes as any} edges={edges} onClose={() => setPreviewOpen(false)} />
        </div>

        <div style={{ borderLeft: "1px solid #1f1f1f", background: "#0f0f0f", overflow: "auto" }}>
          <Inspector />
        </div>
      </div>
    </LicenseGate>
  );

}

function TopBar(props: { onValidate: () => void; onPreview: () => void }) {
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
        overflow: "visible"
      }}
    >
      <button style={tbBtn} onClick={addQuestion}>➕ Вопрос (Ctrl+N)</button>
      <button style={tbBtn} onClick={addEnding}>🏁 Концовка</button>
      <button style={tbBtn} onClick={requestDelete}>🗑️ Удалить (Del)</button>
      <button style={tbBtn} onClick={props.onValidate}>🧪 Проверить проект</button>
      <button style={tbBtn} onClick={props.onPreview}>▶️ Превью</button>
      

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

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <AccountMenu />
      </div>

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


  const model = useMemo(() => {
    const ns = props.nodes ?? [];
    const es = props.edges ?? [];

    const items = ns.map((n: any) => {
      const pos = n.position ?? { x: 0, y: 0 };
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


  const miniToWorld = (mx: number, my: number) => ({
    x: (mx - PAD) / model.scale + model.minX,
    y: (my - PAD) / model.scale + model.minY
  });


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


  const zoomAtWorldPoint = (worldX: number, worldY: number, nextZoom: number, duration = 120) => {
    const inst = props.flowRef.current;
    const wrap = props.wrapperRef.current;
    if (!inst?.setViewport || !inst?.getViewport || !wrap) return;

    const cur = inst.getViewport();
    const z = clamp(nextZoom, 0.15, 2.5);


    const wr = wrap.getBoundingClientRect();
    const cx = wr.width / 2;
    const cy = wr.height / 2;


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
    centerCameraTo(w.x, w.y, 0); 
  };

  const onMiniPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = false;
  };


  const onMiniWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const r = svgRef.current.getBoundingClientRect();
    const mx = clamp(e.clientX - r.left, 0, W);
    const my = clamp(e.clientY - r.top, 0, H);
    const w = miniToWorld(mx, my);

    const dir = Math.sign(e.deltaY); 
    const factor = dir > 0 ? 1 / 1.12 : 1.12;

    zoomAtWorldPoint(w.x, w.y, vp.zoom * factor, 80);
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
      onPointerDown={(e) => e.stopPropagation()} 
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


function AccountMenu() {
  

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<null | {
    user?: { id?: number; email?: string; name?: string } | null;
    entitlements?: {
      plan?: string;
      isValid?: boolean;
      isLifetime?: boolean;
      validUntil?: string | null;
    } | null;
    entitled?: boolean;
  }>(null);

  const auth: any = (window as any).branchproAuth;

  const cabinetUrl = "http://81.30.105.141/dashboard"; // <- поставь кабинет/лицензии

  const initials = (nameOrEmail?: string) => {
    const s = (nameOrEmail || "").trim();
    if (!s) return "U";
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    // email
    if (s.includes("@")) return s[0].toUpperCase();
    return s.slice(0, 2).toUpperCase();
  };

  const planLabel = (p?: string) => {
    if (p === "enterprise") return "Enterprise";
    if (p === "pro") return "Pro";
    return "Free";
  };

  const planTone = (p?: string) => {
    if (p === "enterprise") return { bg: "rgba(74,222,128,0.12)", br: "rgba(74,222,128,0.25)", fg: "rgba(74,222,128,0.95)" };
    if (p === "pro") return { bg: "rgba(125,211,252,0.12)", br: "rgba(125,211,252,0.25)", fg: "rgba(125,211,252,0.95)" };
    return { bg: "rgba(255,255,255,0.06)", br: "rgba(255,255,255,0.14)", fg: "rgba(255,255,255,0.75)" };
  };

  const untilLabel = (iso?: string | null, lifetime?: boolean) => {
    if (lifetime) return "Lifetime";
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString();
  };

  const load = async () => {
    if (!auth?.status) return;
    const s = await auth.status();
    setData({
      user: s?.user ?? null,
      entitlements: s?.entitlements ?? null,
      entitled: !!s?.entitled
    });
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  // initial load + refresh each minute
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await load();
      } catch {
        // ignore
      }
    })();

    const id = window.setInterval(() => {
      if (!alive) return;
      load().catch(() => {});
    }, 60_000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // click-outside close
  useEffect(() => {
  if (!open) return;

  const onDownCapture = (e: PointerEvent) => {
    const root = rootRef.current;
    const t = e.target as Node | null;
    if (!root || !t) return;

    // если клик внутри нашей кнопки/меню — НЕ закрываем
    if (root.contains(t)) return;

    setOpen(false);
  };

  // 👇 capture=true важно, чтобы мы отрабатывали раньше ReactFlow
  window.addEventListener("pointerdown", onDownCapture, true);
  return () => window.removeEventListener("pointerdown", onDownCapture, true);
}, [open]);



  const userEmail = data?.user?.email || "";
  const userName = data?.user?.name || "";
  const plan = data?.entitlements?.plan || "free";
  const isValid = data?.entitlements?.isValid ?? false;
  const isLifetime = data?.entitlements?.isLifetime ?? false;
  const validUntil = data?.entitlements?.validUntil ?? null;

  const badge = planTone(plan);
  const badgeText = planLabel(plan);
  const until = untilLabel(validUntil, isLifetime);

  const avatarText = initials(userName || userEmail);

  const stop = (e: any) => {
    e.stopPropagation();
  };

  const copyText = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        style={acc.btn}
        onClick={async (e) => {
        e.stopPropagation();
        setOpen((v) => !v);
        try { await load(); } catch {}
        }}

        title={userEmail || "Account"}
      >
        <div style={acc.avatar}>{avatarText}</div>

        <div style={{ display: "grid", lineHeight: 1.1 }}>
          <div style={acc.title}>
            {userName || userEmail || "Аккаунт"}
          </div>
          <div style={acc.sub}>
            {userEmail ? userEmail : "не авторизован"}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ ...acc.badge, background: badge.bg, borderColor: badge.br, color: badge.fg }}>
          {badgeText}
        </div>

        <div style={acc.chev}>▾</div>
      </button>

      {open ? (
        <div style={acc.menu} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <div style={acc.menuHead}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ ...acc.avatar, width: 36, height: 36, fontSize: 12 }}>{avatarText}</div>

              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 900, fontSize: 13 }}>
                  {userName || "BranchPro Account"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.78 }}>
                  {userEmail || "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ ...acc.pill, background: badge.bg, borderColor: badge.br, color: badge.fg }}>
                {badgeText}
              </div>

              <div
                style={{
                  ...acc.pill,
                  background: isValid ? "rgba(74,222,128,0.10)" : "rgba(251,191,36,0.10)",
                  borderColor: isValid ? "rgba(74,222,128,0.22)" : "rgba(251,191,36,0.22)",
                  color: isValid ? "rgba(74,222,128,0.95)" : "rgba(251,191,36,0.95)"
                }}
              >
                {isValid ? "Активна" : "Неактивна"}
              </div>

              {until ? (
                <div style={acc.pillMuted}>
                  до: <b style={{ opacity: 0.95 }}>{until}</b>
                </div>
              ) : null}
            </div>
          </div>

          <div style={acc.sep} />

          <button
            className="bp-acc-item"
            style={acc.item}
            onClick={() => {
              setOpen(false);
              window.open(cabinetUrl, "_blank");
            }}
          >
            <span style={acc.ico}>🌐</span>
            Открыть кабинет
            <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: 11 }}>Licenses</span>
          </button>

          <button
            className="bp-acc-item"
            style={acc.item}
            onClick={async () => {
              if (!userEmail) return;
              await copyText(userEmail);
            }}
          >
            <span style={acc.ico}>📋</span>
            Скопировать email
          </button>

          <button
            className="bp-acc-item"
            style={acc.item}
            onClick={async () => {
              setBusy(true);
              try {
                await auth?.refresh?.();
                await load();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <span style={acc.ico}>🔄</span>
            {busy ? "Обновляем…" : "Обновить статус"}
          </button>

          <div style={acc.sep} />

          <button
            style={{ ...acc.item, color: "rgba(255,107,107,0.95)" }}
            onClick={async () => {
              setBusy(true);
              try {
                await auth?.logout?.();
              } finally {
                setBusy(false);
                setOpen(false);
                // после выхода — Gate покажет логин
                window.location.reload();
              }
            }}
            disabled={busy}
          >
            <span style={acc.ico}>🚪</span>
            Выйти
          </button>

          <div style={acc.menuFoot}>
            <span style={{ opacity: 0.65 }}>Protected mode</span>
            <span style={{ opacity: 0.55 }}>DPAPI token storage</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const acc: Record<string, React.CSSProperties> = {
  btn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    maxWidth: 520,
    minWidth: 260,
    boxSizing: "border-box",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 11,
    background: "rgba(125,211,252,0.14)",
    border: "1px solid rgba(125,211,252,0.22)",
    color: "rgba(125,211,252,0.95)",
    flex: "0 0 auto",
  },
  title: {
    fontSize: 12.5,
    fontWeight: 900,
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sub: {
    fontSize: 11.5,
    opacity: 0.72,
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    fontSize: 11,
    fontWeight: 900,
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    flex: "0 0 auto",
  },
  chev: { opacity: 0.65, fontSize: 12, paddingLeft: 2 },

  menu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 10px)",
    width: 360,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(15,15,15,0.98)",
    boxShadow: "0 22px 70px rgba(0,0,0,0.65)",
    overflow: "hidden",
    zIndex: 9999,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  },
  menuHead: { padding: 12 },
  sep: { height: 1, background: "rgba(255,255,255,0.08)" },
  item: {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12.8,
    display: "flex",
    alignItems: "center",
    gap: 10,
    boxSizing: "border-box",
  },
  ico: { width: 18, textAlign: "center", opacity: 0.95 },
  pill: {
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 11.2,
    fontWeight: 900,
  },
  pillMuted: {
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    fontSize: 11.2,
    opacity: 0.8,
  },
  menuFoot: {
    padding: "10px 12px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11.2,
  },
};

// hover/active эффекты (один раз)
const accStyleId = "bp-account-menu-style";
if (typeof document !== "undefined" && !document.getElementById(accStyleId)) {
  const s = document.createElement("style");
  s.id = accStyleId;
  s.textContent = `
    .bp-acc-item:hover { background: rgba(255,255,255,0.05); }
    .bp-acc-item:active { transform: translateY(1px); }
  `;
  document.head.appendChild(s);
}



function basename(p: string) {
  return String(p).split(/[\\/]/).pop() ?? p;
}
