export default function ConfirmDelete(props: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Подтверждение</div>
        <div style={{ marginTop: 10, opacity: 0.85 }}>
          Удалить выбранные элементы: <b>{props.count}</b>? Можно откатить (Ctrl+Z).
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={props.onCancel} style={btnSecondary}>Отмена</button>
          <button onClick={props.onConfirm} style={btnDanger}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "grid",
  placeItems: "center",
  zIndex: 1000
};

const modal: React.CSSProperties = {
  width: 440,
  maxWidth: "90vw",
  borderRadius: 16,
  border: "1px solid #2a2a2a",
  background: "#121212",
  color: "#fff",
  padding: 16,
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)"
};

const btnSecondary: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #2a2a2a",
  background: "#151515",
  color: "#fff",
  cursor: "pointer"
};

const btnDanger: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #3a1b1b",
  background: "#2a0f0f",
  color: "#fff",
  cursor: "pointer"
};
