import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { useEditorStore } from "../store/editorStore";
import type { NodeData, Answer, MediaRef } from "../types";

export default function Inspector() {
  const nodes = useEditorStore((s) => s.nodes);
  const selected = useEditorStore((s) => s.selectedNodeIds);
  const patchNode = useEditorStore((s) => s.patchNode);
  const requestDelete = useEditorStore((s) => s.requestDelete);
  const setEntryNode = useEditorStore((s) => (s as any).setEntryNode);


  const node = useMemo(() => {
    if (selected.length !== 1) return null;
    return nodes.find((n) => n.id === selected[0]) ?? null;
  }, [nodes, selected]);

  const data = node?.data as NodeData | undefined;

  if (!node || !data) {
    return (
      <div style={{ padding: 14, color: "#cfcfcf", opacity: 0.85 }}>
        <div style={{ fontWeight: 900 }}>Inspector</div>
        <div style={{ marginTop: 10 }}>Выдели 1 ноду, чтобы редактировать ✍️</div>
      </div>
    );
  }

  // общие поля для вложений (для обоих типов)
  const mediaList = (((data as any).mediaList ?? []) as MediaRef[]) ?? [];
  const mediaIndex = Math.max(0, Math.min(((data as any).mediaIndex ?? 0) as number, Math.max(0, mediaList.length - 1)));
  const current = mediaList[mediaIndex] ?? null;

  const setMedia = (list: MediaRef[], idx: number) => {
    patchNode(node.id, { mediaList: list, mediaIndex: idx } as any);
  };

  const addMediaByPath = (path: string, type?: "image" | "video") => {
    const resolvedType = type ?? inferMediaType(path) ?? "image";
    const next = [...mediaList, { type: resolvedType, path }];
    setMedia(next, next.length - 1);
  };

  const addMedia = async (type: "image" | "video") => {
    const p = await window.branchpro.pickMedia();
    if (!p) return;
    addMediaByPath(p, type);
  };

  const deleteCurrentMedia = () => {
    if (!mediaList.length) return;
    const next = mediaList.filter((_, i) => i !== mediaIndex);
    const nextIdx = Math.max(0, Math.min(mediaIndex, Math.max(0, next.length - 1)));
    setMedia(next, nextIdx);
  };

  return (
    <div style={{ padding: 14, color: "#fff" }}>
      <div style={{ fontWeight: 900, fontSize: 14 }}>Inspector</div>

      {/* QUESTION */}
      {(data as any).kind === "question" ? (
        <QuestionEditor
          nodeId={node.id}
          data={data as any}
          patchNode={patchNode}
          setEntryNode={setEntryNode}
        />

      ) : null}

      {/* ENDING */}
      {(data as any).kind === "ending" ? (
        <EndingEditor
          nodeId={node.id}
          data={data as any}
          patchNode={patchNode}
        />
      ) : null}

      {/* Вложения (общие) */}
      <div style={{ marginTop: 14, borderTop: "1px solid #1f1f1f", paddingTop: 14 }}>
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>Вложения</div>

        <MediaDropZone onPickFallback={() => addMedia("image")} onAddMedia={addMediaByPath} />

        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button style={btn} onClick={() => addMedia("image")}>🖼️ Добавить</button>
          <button style={btn} onClick={() => addMedia("video")}>🎬 Добавить</button>
          <button
            style={{ ...btn, opacity: mediaList.length ? 1 : 0.45, cursor: mediaList.length ? "pointer" : "not-allowed" }}
            disabled={!mediaList.length}
            onClick={deleteCurrentMedia}
            title={mediaList.length ? "Удалить текущее вложение" : "Вложений нет"}
          >
            ✖ Удалить
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
          {mediaList.length ? (
            <>
              Вложение {mediaIndex + 1}/{mediaList.length}: {current?.type} — {basename(current?.path)}
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ opacity: 0.7 }}>Перейти:</span>
                <input
                  type="number"
                  min={1}
                  max={mediaList.length}
                  value={mediaIndex + 1}
                  onChange={(e) => {
                    const v = Number(e.target.value || 1);
                    const idx = Math.max(0, Math.min(v - 1, mediaList.length - 1));
                    setMedia(mediaList, idx);
                  }}
                  style={{ ...inp, width: 90, marginTop: 0, padding: "6px 8px" }}
                />
              </div>

              {current ? <MediaMetaPreview media={current} /> : null}
            </>
          ) : (
            "Вложений нет"
          )}
        </div>
      </div>

      {/* Опасные действия */}
      <div style={{ marginTop: 14, borderTop: "1px solid #1f1f1f", paddingTop: 14 }}>
        <button style={btnDanger} onClick={requestDelete}>🗑️ Удалить ноду (Del)</button>
      </div>
    </div>
  );
}

function MediaDropZone(props: {
  onAddMedia: (path: string, type?: "image" | "video") => void;
  onPickFallback: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState<string>("");

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);

        const files = Array.from(e.dataTransfer.files ?? []);
        let added = 0;
        for (const file of files) {
          const path = (file as any).path as string | undefined;
          if (!path) continue;
          const type = inferMediaType(path, file.type);
          if (!type) continue;
          props.onAddMedia(path, type);
          added += 1;
        }

        if (added > 0) {
          setHint(`Добавлено вложений: ${added}`);
          return;
        }

        setHint("Не удалось прочитать путь файла в браузерном режиме. Используй кнопку Добавить.");
      }}
      style={{
        marginTop: 10,
        border: dragOver ? "1px solid #7dd3fc" : "1px dashed #2a2a2a",
        borderRadius: 12,
        padding: 10,
        fontSize: 12,
        opacity: 0.9,
        background: dragOver ? "rgba(125, 211, 252, 0.12)" : "#101010"
      }}
    >
      <div>Перетащи сюда image/video файл для быстрого добавления.</div>
      <button style={{ ...btnSmall, marginTop: 8, marginLeft: 0 }} onClick={props.onPickFallback}>Выбрать файл…</button>
      {hint ? <div style={{ marginTop: 8, opacity: 0.7 }}>{hint}</div> : null}
    </div>
  );
}

function MediaMetaPreview({ media }: { media: MediaRef }) {
  const [duration, setDuration] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setDuration(null);
    setLoadError(false);
  }, [media.path, media.type]);

  const src = window.branchpro.mediaUrl(media.path);

  return (
    <div style={{ marginTop: 10, border: "1px solid #222", borderRadius: 10, padding: 10, background: "#121212" }}>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Превью вложения</div>
      {media.type === "image" ? (
        <img
          src={src}
          alt={basename(media.path)}
          onError={() => setLoadError(true)}
          style={{ marginTop: 8, width: "100%", borderRadius: 8, maxHeight: 160, objectFit: "cover", background: "#0f0f0f" }}
        />
      ) : (
        <video
          src={src}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration || null)}
          onError={() => setLoadError(true)}
          style={{ marginTop: 8, width: "100%", borderRadius: 8, maxHeight: 180, background: "#0f0f0f" }}
        />
      )}

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        Тип: {media.type} · Файл: {basename(media.path)}
        {duration != null ? ` · Длительность: ${formatDuration(duration)}` : ""}
      </div>
      {loadError ? <div style={{ marginTop: 6, color: "#fca5a5", fontSize: 12 }}>⚠️ Не удалось загрузить вложение.</div> : null}
    </div>
  );
}

function QuestionEditor(props: { nodeId: string; data: any; patchNode: any; setEntryNode: any }) {
  const { nodeId, data, patchNode, setEntryNode } = props;
  const title = data.title ?? "";
  const answers: Answer[] = (data.answers ?? []) as Answer[];
  const isEntry = Boolean(data.isEntry);

  const setAnswers = (next: Answer[]) => patchNode(nodeId, { answers: next } as any);

  return (
    <>
      <label style={lbl}>Заголовок</label>
      <input value={title} onChange={(e) => patchNode(nodeId, { title: e.target.value } as any)} style={inp} />

      <div style={{ marginTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.9 }}>
        <input
          type="checkbox"
          checked={isEntry}
          onChange={(e) => {
            if (e.target.checked) setEntryNode(nodeId);
            else patchNode(nodeId, { isEntry: false } as any); 
          }}
        />
        Входной блок
        </label>

      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>
        Стартовая точка сценария
      </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>Ответы</div>
        <button
          style={btnSmall}
          onClick={() => setAnswers([...answers, { id: nanoid(), text: "Новый ответ" }])}
        >
          ➕ Добавить
        </button>
      </div>

      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
        {answers.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.6 }}>Нет ответов</div>
        ) : (
          answers.map((a, idx) => (
            <div
              key={a.id}
              style={{
                border: "1px solid #2a2a2a",
                borderRadius: 10,
                background: "#111",
                padding: 10
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.6 }}>#{idx + 1}</div>
                <button
                  style={btnDangerSmall}
                  onClick={() => setAnswers(answers.filter((x) => x.id !== a.id))}
                >
                  Удалить
                </button>
              </div>

              <input
                value={a.text}
                onChange={(e) => setAnswers(answers.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x)))}
                style={{ ...inp, marginTop: 8 }}
                placeholder="Текст ответа..."
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function EndingEditor(props: { nodeId: string; data: any; patchNode: any }) {
  const { nodeId, data, patchNode } = props;
  const title = data.title ?? "";
  const resultText = data.resultText ?? "";

  return (
    <>
      <label style={lbl}>Заголовок</label>
      <input value={title} onChange={(e) => patchNode(nodeId, { title: e.target.value } as any)} style={inp} />

      <label style={lbl}>Решение / итог</label>
      <textarea
        value={resultText}
        onChange={(e) => patchNode(nodeId, { resultText: e.target.value } as any)}
        style={{ ...inp, minHeight: 120, resize: "vertical" }}
        placeholder="Напиши текст концовки..."
      />
    </>
  );
}

function basename(p?: string | null) {
  if (!p) return "";
  return String(p).split(/[\\/]/).pop() ?? p;
}

function inferMediaType(path: string, mimeType?: string): "image" | "video" | null {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";

  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "m4v", "avi", "mkv"].includes(ext)) return "video";
  return null;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const lbl: React.CSSProperties = { display: "block", marginTop: 12, fontSize: 12, opacity: 0.8 };

const inp: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#111",
  color: "#fff"
};

const btn: React.CSSProperties = {
  flex: 1,
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#151515",
  color: "#fff",
  cursor: "pointer"
};

const btnSmall: React.CSSProperties = {
  marginLeft: "auto",
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#151515",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12
};

const btnDanger: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #3a1b1b",
  background: "#2a0f0f",
  color: "#fff",
  cursor: "pointer"
};

const btnDangerSmall: React.CSSProperties = {
  marginLeft: "auto",
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #3a1b1b",
  background: "#2a0f0f",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12
};
