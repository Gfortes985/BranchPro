import { Handle, Position, type NodeProps } from "reactflow";
import { useEditorStore } from "../store/editorStore";
import type { NodeData, Answer, MediaRef } from "../types";

export default function NodeQuestion({ id, data, selected }: NodeProps<NodeData>) {
  const patchNode = useEditorStore((s) => s.patchNode);

  const title = (data as any).title ?? "Вопрос";
  const answers: Answer[] = ((data as any).answers ?? []) as Answer[];

  const mediaList: MediaRef[] = ((data as any).mediaList ?? []) as MediaRef[];
  const mediaIndexRaw = ((data as any).mediaIndex ?? 0) as number;
  const mediaIndex = clamp(mediaIndexRaw, 0, Math.max(0, mediaList.length - 1));
  const current = mediaList.length ? mediaList[mediaIndex] : null;
  const isEntry = Boolean((data as any).isEntry);
  const setEntryNode = useEditorStore((s) => (s as any).setEntryNode);



  const goto = (delta: number) => {
    if (mediaList.length <= 1) return;
    const next = (mediaIndex + delta + mediaList.length) % mediaList.length;
    patchNode(id, { mediaIndex: next } as any);
  };

  return (
    <div
      style={{
        width: 320,
        maxWidth: 320,
        overflow: "hidden", // ✅ защита от “разъезда” контента
        boxSizing: "border-box",
        borderRadius: 14,
        border: isEntry ? "2px solid #FF5E00" : selected ? "2px solid #7dd3fc" : "1px solid #2a2a2a",
        background: "#121212",
        color: "#eaeaea",
        padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)"     

      }}
    >
      {/* вход */}
      <Handle type="target" position={Position.Left} style={handleStyle} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>QUESTION</div>
      {isEntry ? (
        <div style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#22c55e" }}>
        START
      </div>
      ) : null}
      </div>


      {/* заголовок тоже на всякий случай с переносами */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          marginTop: 6,
          overflowWrap: "anywhere",
          wordBreak: "break-word"
        }}
      >
        {title}
      </div>

      {/* ответы */}
      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Ответы</div>

      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
        {answers.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>Нет ответов</div>
        ) : (
          answers.map((a) => (
            <div
              key={a.id}
              style={{
                position: "relative",
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                padding: "8px 10px",
                background: "#111",
                maxWidth: "100%",
                overflow: "visible" // ✅ не даём внутренностям растягивать блок
              }}
              title="Потяни за точку справа чтобы соединить"
            >
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.92,
                  paddingRight: 22,
                  maxWidth: "100%",
                  overflowWrap: "anywhere", // ✅ ломает длинные строки без пробелов
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap" // ✅ если будут переносы — покажет
                }}
              >
                {a.text || "—"}
              </div>

              {/* выход для конкретного ответа */}
              <Handle type="source" position={Position.Right} id={`ans:${a.id}`} style={handleStyle} />
            </div>
          ))
        )}
      </div>

      {/* вложения */}
      {current ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              position: "relative",
              border: "1px solid #2a2a2a",
              background: "#0f0f0f",
              borderRadius: 12,
              overflow: "hidden",
              maxWidth: "100%"
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

          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              opacity: 0.75,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={current.path}
          >
            📎 {current.type}: {basename(current.path)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Helpers */
function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function basename(p: string) {
  return String(p).split(/[\\/]/).pop() ?? p;
}

/** Styles */
const handleStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  background: "#7dd3fc",
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
