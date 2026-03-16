import { useMemo, useState } from "react";
import type { Node } from "reactflow";
import type { NodeData } from "../types";

type Props = {
  open: boolean;
  nodes: Node<NodeData>[];
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
};

export default function NodeSearchDialog(props: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "question" | "ending">("all");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.nodes
      .filter((n) => {
        const kind = (n.data as any)?.kind as "question" | "ending" | undefined;
        if (typeFilter !== "all" && kind !== typeFilter) return false;
        const title = String((n.data as any)?.title ?? "").toLowerCase();
        if (!q) return true;
        return title.includes(q) || n.id.toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [props.nodes, query, typeFilter]);

  if (!props.open) return null;

  return (
    <div style={ovl} onClick={props.onClose}>
      <div style={dlg} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Поиск и фильтр нод</div>
          <button style={btn} onClick={props.onClose}>Закрыть</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 8, marginTop: 10 }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по заголовку или id..."
            style={inp}
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={inp as any}>
            <option value="all">Все типы</option>
            <option value="question">Только вопросы</option>
            <option value="ending">Только концовки</option>
          </select>
        </div>

        <div style={{ marginTop: 10, maxHeight: 420, overflow: "auto", display: "grid", gap: 8 }}>
          {items.length === 0 ? (
            <div style={{ fontSize: 13, opacity: 0.7 }}>Ничего не найдено.</div>
          ) : (
            items.map((n) => {
              const kind = (n.data as any)?.kind ?? "?";
              const title = String((n.data as any)?.title ?? "Без названия");
              return (
                <button
                  key={n.id}
                  style={rowBtn}
                  onClick={() => {
                    props.onFocusNode(n.id);
                    props.onClose();
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{kind} · {n.id}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const ovl: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "grid",
  placeItems: "center",
  zIndex: 1100
};

const dlg: React.CSSProperties = {
  width: "min(760px, calc(100vw - 32px))",
  maxHeight: "min(560px, calc(100vh - 32px))",
  background: "#0f0f0f",
  border: "1px solid #2a2a2a",
  borderRadius: 12,
  color: "#fff",
  padding: 12
};

const inp: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "#fff"
};

const btn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#151515",
  color: "#fff",
  cursor: "pointer"
};

const rowBtn: React.CSSProperties = {
  textAlign: "left",
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  background: "#111",
  color: "#fff",
  padding: "10px",
  cursor: "pointer"
};
