import type { ValidationIssue } from "../validation/validateProject";

export default function ValidationReport(props: {
  open: boolean;
  issues: ValidationIssue[];
  onClose: () => void;
}) {
  if (!props.open) return null;

  const errors = props.issues.filter((i) => i.level === "error");
  const warnings = props.issues.filter((i) => i.level === "warning");

  return (
    <div style={overlay} onClick={props.onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Проверка проекта</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
              Ошибки: {errors.length} · Предупреждения: {warnings.length}
            </div>
          </div>

          <button style={closeBtn} onClick={props.onClose}>Закрыть</button>
        </div>

        {props.issues.length === 0 ? (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid #1f3b2a", background: "#0d1a12", color: "#7ee2a8" }}>
            ✅ Всё хорошо: критичных проблем не найдено.
          </div>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gap: 8, maxHeight: "50vh", overflow: "auto", paddingRight: 4 }}>
            {props.issues.map((issue, idx) => (
              <div
                key={`${issue.code}-${idx}`}
                style={{
                  borderRadius: 10,
                  border: issue.level === "error" ? "1px solid #5f1d1d" : "1px solid #4f3a13",
                  background: issue.level === "error" ? "#251010" : "#231b0f",
                  padding: 10
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800 }}>
                  {issue.level === "error" ? "❌ Ошибка" : "⚠️ Предупреждение"}
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>{issue.code}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 13 }}>{issue.message}</div>
                {issue.nodeId ? <div style={{ marginTop: 4, opacity: 0.7, fontSize: 12 }}>nodeId: {issue.nodeId}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 80,
  display: "grid",
  placeItems: "center"
};

const card: React.CSSProperties = {
  width: 640,
  maxWidth: "calc(100vw - 40px)",
  borderRadius: 14,
  border: "1px solid #2a2a2a",
  background: "#101010",
  color: "#fff",
  padding: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)"
};

const closeBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #2a2a2a",
  background: "#161616",
  color: "#fff",
  cursor: "pointer"
};
