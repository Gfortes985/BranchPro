import { useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "reactflow";
import type { NodeData } from "../types";

export default function PreviewPlayMode(props: {
  open: boolean;
  nodes: Node<NodeData>[];
  edges: Edge[];
  onClose: () => void;
}) {
  const questionNodes = useMemo(
    () => props.nodes.filter((n) => (n.data as any)?.kind === "question"),
    [props.nodes]
  );

  const defaultStartId = useMemo(() => {
    const entry = questionNodes.find((n) => Boolean((n.data as any)?.isEntry));
    if (entry) return entry.id;

    const incoming = new Set(props.edges.map((e) => e.target));
    const rootQuestion = questionNodes.find((n) => !incoming.has(n.id));
    if (rootQuestion) return rootQuestion.id;

    return questionNodes[0]?.id ?? null;
  }, [questionNodes, props.edges]);

  const [startId, setStartId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (!props.open) return;
    setStartId(defaultStartId);
    setCurrentId(defaultStartId);
    setHistory(defaultStartId ? [defaultStartId] : []);
  }, [props.open, defaultStartId]);

  const byId = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes]);
  const current = currentId ? byId.get(currentId) ?? null : null;

  const jump = (nextId: string | null) => {
    if (!nextId) return;
    setCurrentId(nextId);
    setHistory((h) => [...h, nextId]);
  };

  const stepBack = () => {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const next = h.slice(0, -1);
      setCurrentId(next[next.length - 1] ?? null);
      return next;
    });
  };

  const restart = () => {
    setCurrentId(startId);
    setHistory(startId ? [startId] : []);
  };

  if (!props.open) return null;

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>▶️ Превью прохождения</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button style={btn} onClick={stepBack} disabled={history.length <= 1}>Назад</button>
            <button style={btn} onClick={restart}>Сначала</button>
            <button style={btn} onClick={props.onClose}>Закрыть</button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Старт:</div>
          <select
            value={startId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setStartId(id);
              setCurrentId(id);
              setHistory(id ? [id] : []);
            }}
            style={select}
          >
            {questionNodes.map((q) => (
              <option key={q.id} value={q.id}>
                {(q.data as any)?.title ?? q.id}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, opacity: 0.65 }}>Шагов: {Math.max(0, history.length - 1)}</div>
        </div>

        <div style={{ marginTop: 14 }}>
          {!current ? (
            <div style={empty}>Нет нод для превью. Добавь хотя бы один вопрос.</div>
          ) : (current.data as any)?.kind === "question" ? (
            <QuestionView node={current as any} edges={props.edges} onSelect={jump} />
          ) : (
            <EndingView node={current as any} onRestart={restart} />
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionView(props: { node: Node<NodeData>; edges: Edge[]; onSelect: (id: string | null) => void }) {
  const data = props.node.data as any;
  const answers = (data?.answers ?? []) as Array<{ id: string; text: string }>;

  return (
    <div style={cardQuestion}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>QUESTION</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>{data?.title ?? "Вопрос"}</div>

      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {answers.map((a) => {
          const edge = props.edges.find(
            (e) => e.source === props.node.id && (e.sourceHandle ?? "") === `ans:${a.id}`
          );
          const targetId = edge?.target ?? null;

          return (
            <button
              key={a.id}
              style={{ ...answerBtn, opacity: targetId ? 1 : 0.55 }}
              disabled={!targetId}
              onClick={() => props.onSelect(targetId)}
              title={targetId ? "Перейти" : "У ответа нет перехода"}
            >
              {a.text || "(без текста)"}
            </button>
          );
        })}
      </div>

      <MediaPreview mediaList={(data?.mediaList ?? []) as any[]} mediaIndex={Number(data?.mediaIndex ?? 0)} />
    </div>
  );
}

function EndingView(props: { node: Node<NodeData>; onRestart: () => void }) {
  const data = props.node.data as any;

  return (
    <div style={cardEnding}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>ENDING</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 6 }}>{data?.title ?? "Концовка"}</div>
      <div style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>{data?.resultText || "—"}</div>

      <MediaPreview mediaList={(data?.mediaList ?? []) as any[]} mediaIndex={Number(data?.mediaIndex ?? 0)} />

      <button style={{ ...btn, marginTop: 16 }} onClick={props.onRestart}>🔁 Пройти заново</button>
    </div>
  );
}

function MediaPreview(props: { mediaList: Array<{ type: "image" | "video"; path: string }>; mediaIndex: number }) {
  const mediaList = props.mediaList ?? [];
  const initial = clamp(props.mediaIndex, 0, Math.max(0, mediaList.length - 1));
  const [index, setIndex] = useState(initial);

  useEffect(() => {
    setIndex(initial);
  }, [initial, mediaList.length]);

  if (!mediaList.length) return null;

  const current = mediaList[index];
  if (!current) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>Вложения</div>
      <div style={mediaWrap}>
        {current.type === "image" ? (
          <img
            src={window.branchpro.mediaUrl(current.path)}
            alt="preview-media"
            style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "cover" }}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <video
            src={window.branchpro.mediaUrl(current.path)}
            style={{ display: "block", width: "100%", maxHeight: 240 }}
            controls
            preload="metadata"
          />
        )}

        {mediaList.length > 1 ? (
          <>
            <button style={{ ...navBtn, left: 8 }} onClick={() => setIndex((v) => (v - 1 + mediaList.length) % mediaList.length)}>
              ◀
            </button>
            <button style={{ ...navBtn, right: 8 }} onClick={() => setIndex((v) => (v + 1) % mediaList.length)}>
              ▶
            </button>
          </>
        ) : null}

        <div style={mediaBadge}>{index + 1}/{mediaList.length}</div>
      </div>

      <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={current.path}>
        📎 {current.type}: {basename(current.path)}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function basename(p: string) {
  return String(p).split(/[\\/]/).pop() ?? p;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  zIndex: 90,
  display: "grid",
  placeItems: "center"
};

const panel: React.CSSProperties = {
  width: 760,
  maxWidth: "calc(100vw - 40px)",
  maxHeight: "calc(100vh - 40px)",
  overflow: "auto",
  border: "1px solid #2a2a2a",
  background: "#101010",
  color: "#fff",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
};

const cardQuestion: React.CSSProperties = {
  border: "1px solid #26303a",
  background: "#12161a",
  borderRadius: 12,
  padding: 14
};

const cardEnding: React.CSSProperties = {
  border: "1px solid #2d3a2f",
  background: "#121a13",
  borderRadius: 12,
  padding: 14
};

const answerBtn: React.CSSProperties = {
  textAlign: "left",
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  background: "#161616",
  color: "#fff",
  padding: "10px 12px",
  cursor: "pointer"
};

const mediaWrap: React.CSSProperties = {
  position: "relative",
  border: "1px solid #2a2a2a",
  borderRadius: 12,
  background: "#0f0f0f",
  overflow: "hidden"
};

const navBtn: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 30,
  height: 30,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.35)",
  color: "#fff",
  cursor: "pointer",
  display: "grid",
  placeItems: "center"
};

const mediaBadge: React.CSSProperties = {
  position: "absolute",
  left: 8,
  bottom: 8,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.14)",
  fontSize: 12
};

const empty: React.CSSProperties = {
  border: "1px dashed #303030",
  borderRadius: 12,
  padding: 16,
  opacity: 0.8
};

const btn: React.CSSProperties = {
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  background: "#171717",
  color: "#fff",
  padding: "8px 10px",
  cursor: "pointer"
};

const select: React.CSSProperties = {
  ...btn,
  minWidth: 280
};
