import { Handle, Position, type NodeProps } from "reactflow";
import { useEditorStore } from "../store/editorStore";
import type { NodeData, MediaRef } from "../types";

export default function NodeEnding({ id, data, selected }: NodeProps<NodeData>) {
  const patchNode = useEditorStore((s) => s.patchNode);

  const title = (data as any).title ?? "Концовка";
  const resultText = (data as any).resultText ?? "";

  const mediaList: MediaRef[] = ((data as any).mediaList ?? []) as MediaRef[];
  const mediaIndexRaw = ((data as any).mediaIndex ?? 0) as number;
  const mediaIndex = clamp(mediaIndexRaw, 0, Math.max(0, mediaList.length - 1));
  const current = mediaList.length ? mediaList[mediaIndex] : null;

  const goto = (delta: number) => {
    if (mediaList.length <= 1) return;
    const next = (mediaIndex + delta + mediaList.length) % mediaList.length;
    patchNode(id, { mediaIndex: next } as any);
  };

  return (
    <div
      style={{
        width: 340,
        borderRadius: 14,
        border: selected ? "2px solid rgba(74,222,128,0.95)" : "1px solid #2a2a2a",
        background: "#121212",
        color: "#eaeaea",
        padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
      }}
    >
      {/* только вход */}
      <Handle type="target" position={Position.Left} style={handleStyle} />

      <div style={{ fontSize: 12, opacity: 0.7 }}>ENDING</div>
      <div style={{ fontSize: 16, fontWeight: 900, marginTop: 6 }}>{title}</div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Решение</div>
      <div
        style={{
          marginTop: 8,
          border: "1px solid #2a2a2a",
          background: "#111",
          borderRadius: 12,
          padding: 10,
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: 1.35,
          opacity: 0.95
        }}
      >
        {resultText || "—"}
      </div>

      {/* вложения + листалка */}
      {current ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              position: "relative",
              border: "1px solid #2a2a2a",
              background: "#0f0f0f",
              borderRadius: 12,
              overflow: "hidden"
            }}
          >
            {current.type === "image" ? (
              <img
                src={window.branchpro.mediaUrl(current.path)}
                alt="media"
                style={{ display: "block", width: "100%", maxHeight: 190, objectFit: "cover" }}
                loading="lazy"
                draggable={false}
              />
            ) : (
              <video
                src={window.branchpro.mediaUrl(current.path)}
                style={{ display: "block", width: "100%", maxHeight: 210 }}
                controls
                preload="metadata"
              />
            )}

            {mediaList.length > 1 ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goto(-1);
                  }}
                  style={navBtnLeft}
                  title="Предыдущее"
                >
                  ◀
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    goto(+1);
                  }}
                  style={navBtnRight}
                  title="Следующее"
                >
                  ▶
                </button>
              </>
            ) : null}

            <div style={counterBadge}>
              {mediaIndex + 1}/{mediaList.length}
            </div>
          </div>

          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
            📎 {current.type}: {basename(current.path)}
          </div>
        </div>
      ) : null}
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

const handleStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  background: "rgba(74,222,128,0.95)",
  border: "2px solid #0b0b0b"
};

const navBtnBase: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 32,
  height: 32,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.35)",
  color: "#fff",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)"
};

const navBtnLeft: React.CSSProperties = { ...navBtnBase, left: 8 };
const navBtnRight: React.CSSProperties = { ...navBtnBase, right: 8 };

const counterBadge: React.CSSProperties = {
  position: "absolute",
  left: 8,
  bottom: 8,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.35)",
  color: "#fff",
  fontSize: 12,
  opacity: 0.9
};
