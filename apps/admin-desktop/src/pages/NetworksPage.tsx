import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Node, Edge, Controls } from "reactflow";
import "reactflow/dist/style.css";
import axios from "axios";
import { QRCodeSVG } from "qrcode.react";

type Network = {
  id: string;
  name: string;
  devices: Array<{
    deviceId: string;
    x: number | null;
    y: number | null;
    device: {
      id: string;
      name: string;
      online: boolean;
      platform: string;
      model: string;
      appVersion: string;
    };
  }>;
};

export function NetworksPage(props: { baseUrl: string; serverOk: boolean }) {
  const api = useMemo(() => axios.create({ baseURL: props.baseUrl }), [props.baseUrl]);

  const [nets, setNets] = useState<Network[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = nets.find((n) => n.id === selectedId) ?? null;

  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null); // ms timestamp
  const [pairLeftSec, setPairLeftSec] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");

  const isNetView = !!selectedId; // ✅ если выбрана сеть — показываем меню сети вместо списка

  const load = async () => {
    if (!props.serverOk) return;
    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.get<Network[]>("/v1/networks");
      setNets(data);
      // не авто-выбираем сеть: пользователь сам откроет
    } catch (e: any) {
      setMsg("Ошибка загрузки сетей: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const createNet = async () => {
    const name = newName.trim() || "New Network";
    if (!props.serverOk) return;

    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.post("/v1/networks", { name });
      setNewName("");
      await load();
      // создаём сеть, но НЕ переходим автоматически
      setMsg(`Сеть создана ✅ (${data?.name ?? name})`);
    } catch (e: any) {
      setMsg("Ошибка создания сети: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const enterNetwork = (id: string) => {
    setSelectedId(id);
    setPairCode(null);
    setMsg("");
    setPairExpiresAt(null);
    setPairLeftSec(0);
  };

  const leaveNetwork = () => {
    setSelectedId(null);
    setPairCode(null);
    setMsg("");
    setPairExpiresAt(null);
    setPairLeftSec(0);
  };

  const startPairingInNet = async () => {
    if (!selectedId) return;
    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.post(`/v1/networks/${selectedId}/pairing/start`);

      const code = data.code as string;
      const expiresInSec = Number(data.expiresInSec ?? data.expiresIn ?? 60); // ✅ если сервер не прислал — 60 сек

      setPairCode(code);

      const expiresAt = Date.now() + Math.max(1, expiresInSec) * 1000;
      setPairExpiresAt(expiresAt);
      setPairLeftSec(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

      setMsg("Код создан ✅");
    } catch (e: any) {
      setMsg("Ошибка создания кода: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  // Graph build
  const { nodes, edges } = useMemo(() => {
    if (!selected) return { nodes: [] as Node[], edges: [] as Edge[] };

    const centerId = "net";
    const netNode: Node = {
      id: centerId,
      position: { x: 0, y: 0 },
      data: { label: `🕸️ ${selected.name}` },
      type: "default",
    };

    const devNodes: Node[] = selected.devices.map((nd, i) => ({
      id: nd.deviceId,
      position: {
        x: nd.x ?? Math.round(260 * Math.cos(i)),
        y: nd.y ?? Math.round(260 * Math.sin(i)),
      },
      data: {
        label: `${nd.device.online ? "🟢" : "⚪"} ${nd.device.name || nd.device.id.slice(0, 6)}`,
      },
      type: "default",
    }));

    const devEdges: Edge[] = selected.devices.map((nd) => ({
      id: `e-${centerId}-${nd.deviceId}`,
      source: centerId,
      target: nd.deviceId,
    }));

    return { nodes: [netNode, ...devNodes], edges: devEdges };
  }, [selected]);

  // save layout after drag stop
  const onNodeDragStop = async (_: any, node: Node) => {
    if (!selectedId) return;
    if (node.id === "net") return;

    const payload = nodes
      .filter((n) => n.id !== "net")
      .map((n) => ({ deviceId: n.id, x: n.position.x, y: n.position.y }));

    try {
      await api.patch(`/v1/networks/${selectedId}/layout`, { nodes: payload });
    } catch {
      // тихо
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.serverOk, props.baseUrl]);

  useEffect(() => {
  if (!pairExpiresAt || !pairCode || !selectedId || !props.serverOk) return;

  let refreshing = false;

  const tick = () => {
    const left = Math.max(0, Math.ceil((pairExpiresAt - Date.now()) / 1000));
    setPairLeftSec(left);

    // ✅ истёк — обновляем автоматически
    if (left <= 0 && !refreshing) {
      refreshing = true;
      // не блокируем UI общим busy — можно обновлять тихо
      api
        .post(`/v1/networks/${selectedId}/pairing/start`)
        .then(({ data }) => {
          const code = data.code as string;
          const expiresInSec = Number(data.expiresInSec ?? data.expiresIn ?? 60);

          setPairCode(code);

          const expiresAt = Date.now() + Math.max(1, expiresInSec) * 1000;
          setPairExpiresAt(expiresAt);
          setPairLeftSec(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
          setMsg("Код обновлён ✅");
        })
        .catch(() => {
          // если сервер временно недоступен — просто покажем сообщение и остановим автообновление
          setMsg("Не удалось обновить код ❌");
          setPairExpiresAt(null);
          setPairLeftSec(0);
        })
        .finally(() => {
          refreshing = false;
        });
    }
  };

  tick();
  const t = window.setInterval(tick, 250);

  return () => window.clearInterval(t);
}, [pairExpiresAt, pairCode, selectedId, props.serverOk, props.baseUrl]);

const serverInfo = useMemo(() => {
  try {
    const u = new URL(props.baseUrl);
    return {
      serverUrl: u.origin,
      serverHost: u.hostname,
      serverPort: u.port || (u.protocol === "https:" ? "443" : "80"),
    };
  } catch {
    return { serverUrl: props.baseUrl, serverHost: "", serverPort: "" };
  }
}, [props.baseUrl]);

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* LEFT PANEL (no scroll) */}
      <div className="bpCard" style={S.left}>
        {!isNetView ? (
          // ======= LIST MODE =======
          <>
            <div className="bpCardHeader">
              <div>
                <div className="bpTitle">Networks</div>
                <div className="bpMuted">Создай сеть и открой её — справа появится граф</div>
              </div>
              <button className="bpBtn ghost" onClick={load} disabled={!props.serverOk || busy} title="Обновить">
                ⟳
              </button>
            </div>

            <div className="bpCardBody" style={{ paddingTop: 10 }}>
              <div className="bpLabel">Имя сети</div>
              <div style={S.row}>
                <input
                  className="bpInp"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Например: Hall A"
                />
                <button className="bpBtn" onClick={createNet} disabled={!props.serverOk || busy}>
                  + Создать
                </button>
              </div>

              <div style={{ height: 12 }} />

              <div className="bpLabel">Список сетей</div>
              <div style={S.listNoScroll}>
                {nets.map((n) => (
                  <button key={n.id} className="bpNav" onClick={() => enterNetwork(n.id)}>
                    <span style={{ opacity: 0.9 }}>🕸️</span>
                    <span style={{ flex: 1, textAlign: "left" }}>{n.name}</span>
                    <span className="bpPill">{n.devices?.length ?? 0}</span>
                  </button>
                ))}
                {!nets.length ? <div className="bpMuted">Сетей нет</div> : null}
              </div>

              {msg ? <div className="bpToast" style={{ marginTop: 12 }}>{msg}</div> : null}
            </div>
          </>
        ) : (
          // ======= NETWORK MODE =======
          <>
            <div className="bpCardHeader">
              <div>
                <div className="bpTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.9 }}>🕸️</span>
                  <span>{selected?.name ?? "Network"}</span>
                </div>
                <div className="bpMuted">Управление сетью</div>
              </div>
              <button className="bpBtn ghost" onClick={leaveNetwork} title="Назад">
                ←
              </button>
            </div>

            <div className="bpCardBody" style={{ paddingTop: 10 }}>
              <div className="bpLabel">Добавить устройство</div>

              <button
                className="bpBtn"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={startPairingInNet}
                disabled={!props.serverOk || busy || !selectedId}
              >
                Создать код подключения
              </button>

              {pairCode ? (
                <div className="bpCodeBox" style={{ marginTop: 10, textAlign: "center" }}>
                  <QRCodeSVG
                    value={JSON.stringify({
                      type: "branchpro-pair",          
                      ...serverInfo,
                      networkId: selectedId,
                      code: pairCode,
                    })}
                    size={180}
                    bgColor="#0b0b0c"
                    fgColor="#ffffff"
                  />

                  <div className="bpCode" style={{ marginTop: 12 }}>
                    {pairCode}
                  </div>

                  <div className="bpMuted" style={{ marginTop: 6 }}>
                    {pairLeftSec > 0 ? (
                      <>Обновится через: <b>{pairLeftSec}</b> сек</>
                    ) : (
                      <>Обновляю код…</>
                    )}
                  </div>

                  <div className="bpMuted" style={{ marginTop: 6 }}>
                    Отсканируй QR на плеере
                  </div>

                </div>
              ) : null}

              <div style={{ height: 12 }} />

              <div className="bpLabel">Статус</div>
              <div className="bpStat">
                <span className={`bpDot ${props.serverOk ? "ok" : "bad"}`} />
                <span>{props.serverOk ? "Сервер доступен" : "Сервер недоступен"}</span>
              </div>

              {msg ? <div className="bpToast" style={{ marginTop: 12 }}>{msg}</div> : null}
            </div>
          </>
        )}
      </div>

      {/* RIGHT CANVAS (fills all space, no scroll) */}
      <div className="bpCard" style={S.right}>
        <div className="bpCardHeader" style={{ paddingBottom: 10 }}>
          <div>
            <div className="bpTitle">Граф</div>
            <div className="bpMuted">{selected ? "Перетаскивай устройства — позиция сохранится" : "Открой сеть слева"}</div>
          </div>
        </div>

        <div style={S.canvas}>
          {!selected ? (
            <div style={S.empty}>
              <div style={{ fontSize: 18, fontWeight: 900, opacity: 0.92 }}>Выбери сеть слева</div>
              <div className="bpMuted" style={{ marginTop: 6 }}>
                Нажми на сеть — слева появится меню сети, справа граф на весь экран
              </div>
            </div>
          ) : (
            <ReactFlow nodes={nodes} edges={edges} onNodeDragStop={onNodeDragStop} fitView>
              <Background gap={18} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}

/** Layout: no scroll panels, page fits the window */
const S: Record<string, any> = {
  page: {
    display: "grid",
    gridTemplateColumns: "380px 1fr",
    gap: 14,
    height: "100%",     
    width: "100%",      
    minWidth: 0,        
    minHeight: 0,       
    padding: 12,
    boxSizing: "border-box",
  },
  left: {
    minHeight: 0,
    overflow: "hidden",
  },
  right: {
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  row: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  // ✅ без скролла: если сетей будет много — позже добавим поиск/пагинацию
  listNoScroll: {
    display: "grid",
    gap: 8,
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  empty: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    padding: 18,
    textAlign: "center",
  },
};

const CSS = `
.bpCard{
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(18,18,20,0.78);
  box-shadow: 0 16px 40px rgba(0,0,0,0.35);
  backdrop-filter: blur(10px);
  display:flex;
  flex-direction:column;
  min-height:0;
}

.bpCardHeader{
  padding: 14px 14px 12px 14px;
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
}

.bpCardBody{
  padding: 14px;
  /* ✅ без скролла */
  overflow: hidden;
  min-height:0;
}

.bpTitle{
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.2px;
  color: #fff;
}

.bpMuted{
  opacity: 0.65;
  font-size: 12px;
  margin-top: 4px;
  color:#fff;
}

.bpLabel{
  opacity: 0.75;
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 6px;
  color:#fff;
}

.bpInp{
  flex:1;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #fff;
  padding: 0 12px;
  outline: none;
}
.bpInp:focus{
  border-color: rgba(125,211,252,0.35);
  box-shadow: 0 0 0 3px rgba(125,211,252,0.10);
}

.bpBtn{
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(125,211,252,0.35);
  background: rgba(125,211,252,0.16);
  color: #eaf7ff;
  font-weight: 900;
  padding: 0 12px;
  cursor: pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
}
.bpBtn:hover{ filter: brightness(1.05); }
.bpBtn:disabled{ opacity: 0.5; cursor: not-allowed; }

.bpBtn.ghost{
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.9);
  padding: 0 10px;
  width: 40px;
}

.bpNav{
  width:100%;
  display:flex;
  align-items:center;
  gap:10px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  color:#fff;
  cursor:pointer;
}
.bpNav:hover{ background: rgba(255,255,255,0.06); }

.bpPill{
  font-size: 11px;
  font-weight: 900;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.22);
  opacity: 0.9;
}

.bpCodeBox{
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.22);
  padding: 12px;
}
.bpCode{
  font-size: 24px;
  font-weight: 1000;
  letter-spacing: 1px;
  color:#fff;
}

.bpToast{
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.06);
  padding: 10px 12px;
  color:#fff;
}

.bpStat{
  display:flex;
  align-items:center;
  gap:8px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.04);
  color:#fff;
  font-weight: 800;
}

/* status dot */
.bpDot{
  width:10px; height:10px; border-radius:999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.12);
}
.bpDot.ok{ background: rgba(34,197,94,0.75); }
.bpDot.bad{ background: rgba(239,68,68,0.75); }

/* ReactFlow tweaks */
.react-flow__attribution{ display:none; }
.react-flow{
  background: radial-gradient(1200px 700px at 40% 25%, rgba(125,211,252,0.10), transparent 55%),
              radial-gradient(900px 600px at 70% 70%, rgba(167,139,250,0.08), transparent 60%),
              rgba(10,10,12,0.25);
}
.react-flow__controls{
  border-radius: 14px;
  overflow:hidden;
  border: 1px solid rgba(255,255,255,0.12);
}
.react-flow__controls-button{
  background: rgba(0,0,0,0.35);
  border: none;
  color:#fff;
}
.react-flow__controls-button:hover{
  background: rgba(255,255,255,0.08);
}
`;
