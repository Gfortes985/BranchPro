import React, { useEffect, useMemo, useState } from "react";

type GateState =
  | { kind: "loading"; message?: string }
  | { kind: "login"; error?: string }
  | { kind: "noLicense"; plan?: string; isValid?: boolean; validUntil?: string | null }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function LicenseGate(props: { children: React.ReactNode }) {
    function prettyErr(e: any) {
    const s = String(e?.message || e || "");
    return s.replace(/^Error invoking remote method 'auth:login':\s*/i, "");
    }

  const [st, setSt] = useState<GateState>({ kind: "loading", message: "Проверка лицензии…" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const auth = (window as any).branchproAuth;

  const appName = "BranchPro Editor";
  const subtitle = "Вход по лицензии Pro или Enterprise";

  const buyUrl = "https://your-domain.com"; // <- поменяй на страницу покупки/кабинета

  const formatUntil = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  async function check() {
  if (!auth) {
    setSt({
      kind: "error",
      message:
        "branchproAuth не найден. Проверь preload.cjs и что он подключён в BrowserWindow (webPreferences.preload).",
    });
    return;
  }

  setSt({ kind: "loading", message: "Проверяем лицензию…" });

  // ✅ форсим запрос, если доступно
  const r = auth.refreshHard
    ? await auth.refreshHard()
    : auth.refresh
      ? await auth.refresh()
      : await auth.status();

  if (r?.ok && r?.entitled) {
    setSt({ kind: "ok" });
    return;
  }

  if (r?.error === "NO_TOKEN" || r?.error === "UNAUTHENTICATED") {
    setSt({ kind: "login" });
    return;
  }

  if (r?.ok && !r?.entitled) {
    setSt({
      kind: "noLicense",
      plan: r?.entitlements?.plan,
      isValid: r?.entitlements?.isValid,
      validUntil: r?.entitlements?.validUntil ?? null,
    });
    return;
  }

  setSt({ kind: "error", message: r?.error || "STATUS_FAILED" });
}


  useEffect(() => {
    // сначала показываем логин, затем пытаемся проверить токен (если был сохранён в safeStorage)
    setSt({ kind: "login" });
    check();

    const id = setInterval(() => {
      auth?.refresh?.().catch?.(() => {});
    }, 10 * 60 * 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ OK → показываем приложение
  if (st.kind === "ok") return <>{props.children}</>;

  // UI helpers
  const shell = (
    <div style={styles.shell}>
      <div style={styles.bgGlowA} />
      <div style={styles.bgGlowB} />

      <div style={styles.card}>
        <Header title={appName} subtitle={subtitle} />

        {st.kind === "loading" ? (
          <LoadingLine text={st.message || "Загрузка…"} />
        ) : st.kind === "error" ? (
          <>
            <Message
              kind="danger"
              title="Ошибка"
              text={st.message}
            />
            <div style={styles.row}>
              <button style={styles.btnPrimary} onClick={check}>Повторить</button>
            </div>
          </>
        ) : st.kind === "noLicense" ? (
          <>
            <Message
              kind="warning"
              title="Нужна лицензия"
              text={
                <>
                  <div>Текущий план: <b>{st.plan || "unknown"}</b></div>
                  <div style={{ opacity: 0.8, marginTop: 6 }}>
                    isValid: <b>{String(st.isValid)}</b>
                    {st.validUntil ? (
                      <>
                        {" • "}до: <b>{formatUntil(st.validUntil)}</b>
                      </>
                    ) : null}
                  </div>
                </>
              }
            />

            <div style={styles.row}>
              <button style={styles.btnPrimary} onClick={() => window.open(buyUrl, "_blank")}>
                Открыть кабинет
              </button>

              <button
                style={styles.btnGhost}
                onClick={async () => {
                  await auth?.logout?.();
                  setSt({ kind: "login" });
                }}
              >
                Выйти
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <button style={styles.btnLink} onClick={check}>Повторить проверку</button>
            </div>
          </>
        ) : (
          // login
          <>
            <div style={{ marginTop: 10 }} />

            <div style={styles.form}>
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />

              <label style={{ ...styles.label, marginTop: 10 }}>Пароль</label>
              <input
                style={styles.input}
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />

              {st.kind === "login" && st.error ? (
                <div style={{ marginTop: 10 }}>
                  <Message kind="danger" title="Не удалось войти" text={st.error} compact />
                </div>
              ) : null}

              <div style={{ ...styles.row, marginTop: 14 }}>
                <button
                  style={{
                    ...styles.btnPrimary,
                    opacity: busy || !email || !password ? 0.6 : 1,
                    cursor: busy || !email || !password ? "not-allowed" : "pointer",
                  }}
                  disabled={busy || !email || !password}
                  onClick={async () => {
                    if (!auth) {
                      setSt({
                        kind: "error",
                        message: "branchproAuth не найден. Проверь preload.cjs.",
                      });
                      return;
                    }

                    setBusy(true);
                    try {
                      setSt({ kind: "loading", message: "Входим в аккаунт…" });
                      const r = await auth.login(email.trim(), password);
                      if (r?.entitled) setSt({ kind: "ok" });
                      else
                        setSt({
                          kind: "noLicense",
                          plan: r?.entitlements?.plan,
                          isValid: r?.entitlements?.isValid,
                          validUntil: r?.entitlements?.validUntil ?? null,
                        });
                    } catch (e: any) {
                         setSt({ kind: "login", error: prettyErr(e) });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Входим…" : "Войти"}
                </button>

                <button style={styles.btnGhost} onClick={check} disabled={busy}>
                  Проверить токен
                </button>
              </div>

              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                <button style={styles.btnLink} onClick={() => window.open(buyUrl, "_blank")}>
                  Купить / обновить лицензию
                </button>

                <span style={styles.hint}>Безопасное хранение токена (Windows DPAPI)</span>
              </div>
            </div>
          </>
        )}

        <Footer />
      </div>
    </div>
  );

  return shell;
}

/* ---------------- UI components ---------------- */

function Header(props: { title: string; subtitle: string }) {
  return (
    <div>
      <div style={styles.brandRow}>
        <div style={styles.logoDot} />
        <div>
          <div style={styles.h1}>{props.title}</div>
          <div style={styles.sub}>{props.subtitle}</div>
        </div>
      </div>
      <div style={styles.hr} />
    </div>
  );
}

function Footer() {
  return (
    <div style={styles.footer}>
      <span style={{ opacity: 0.65 }}>© {new Date().getFullYear()} BranchPro</span>
      <span style={{ opacity: 0.55 }}>Protected mode</span>
    </div>
  );
}

function LoadingLine(props: { text: string }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={styles.loadingText}>{props.text}</div>
      <div style={styles.progressOuter}>
        <div style={styles.progressInner} />
      </div>
    </div>
  );
}

function Message(props: {
  kind: "danger" | "warning";
  title: string;
  text: React.ReactNode;
  compact?: boolean;
}) {
  const boxStyle = useMemo(() => {
    const base = {
      padding: props.compact ? "10px 12px" : "12px 14px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)",
    } as React.CSSProperties;

    if (props.kind === "danger") {
      return {
        ...base,
        border: "1px solid rgba(255, 107, 107, 0.25)",
        background: "rgba(255, 107, 107, 0.08)",
      };
    }

    return {
      ...base,
      border: "1px solid rgba(251, 191, 36, 0.22)",
      background: "rgba(251, 191, 36, 0.08)",
    };
  }, [props.kind, props.compact]);

  return (
    <div style={boxStyle}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{props.title}</div>
      <div style={{ opacity: 0.9, lineHeight: 1.35 }}>{props.text}</div>
    </div>
  );
}

/* ---------------- styles ---------------- */

const styles: Record<string, React.CSSProperties> = {
  shell: {
    height: "100vh",
    width: "100vw",
    background: "#0b0b0b",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    position: "relative",
    overflow: "hidden",
  },

  bgGlowA: {
    position: "absolute",
    width: 720,
    height: 720,
    left: -260,
    top: -260,
    background: "radial-gradient(circle, rgba(125,211,252,0.20), transparent 60%)",
    filter: "blur(2px)",
    pointerEvents: "none",
  },
  bgGlowB: {
    position: "absolute",
    width: 720,
    height: 720,
    right: -260,
    bottom: -260,
    background: "radial-gradient(circle, rgba(74,222,128,0.14), transparent 60%)",
    filter: "blur(2px)",
    pointerEvents: "none",
  },

  card: {
    width: 520,
    maxWidth: "92vw",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(15,15,15,0.92)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
    padding: 18,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    position: "relative",
    zIndex: 5,
  },

  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  logoDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    background: "rgba(125,211,252,0.95)",
    boxShadow: "0 0 0 6px rgba(125,211,252,0.12)",
  },

  h1: { fontSize: 20, fontWeight: 900, letterSpacing: 0.2 },
  sub: { fontSize: 12.5, opacity: 0.72, marginTop: 2 },

  hr: {
    height: 1,
    background: "rgba(255,255,255,0.08)",
    marginTop: 14,
    marginBottom: 12,
  },

  form: { marginTop: 6 },

  label: { fontSize: 12, opacity: 0.78, marginBottom: 6, display: "block" },

  input: {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(10,10,10,0.60)",
  color: "#fff",
  outline: "none",
  fontSize: 14,
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.35)",
},


  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  btnPrimary: {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(125,211,252,0.20)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },

  btnGhost: {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },

  btnLink: {
    border: "none",
    background: "transparent",
    color: "rgba(125,211,252,0.95)",
    cursor: "pointer",
    padding: 0,
    fontSize: 12.5,
  },

  hint: { fontSize: 11.5, opacity: 0.55 },

  loadingText: { fontSize: 13, opacity: 0.8, marginBottom: 10 },
  progressOuter: {
    height: 10,
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressInner: {
    height: "100%",
    width: "55%",
    borderRadius: 999,
    background: "rgba(125,211,252,0.55)",
    animation: "bp-loading 1.1s ease-in-out infinite alternate",
  },

  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11.5,
  },
};

// 👇 маленькая анимация прогресса (через style tag)
const styleId = "bp-auth-gate-style";
if (typeof document !== "undefined" && !document.getElementById(styleId)) {
  const s = document.createElement("style");
  s.id = styleId;
  s.textContent = `
    @keyframes bp-loading {
      from { transform: translateX(-20%); }
      to   { transform: translateX(65%); }
    }
    input:focus {
      border-color: rgba(125, 211, 252, 0.35) !important;
      box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.10) !important;
    }
    button:hover { filter: brightness(1.06); }
    button:active { transform: translateY(1px); }
  `;
  document.head.appendChild(s);
}
