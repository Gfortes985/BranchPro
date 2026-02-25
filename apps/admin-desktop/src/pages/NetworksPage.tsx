import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  NodeProps,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import axios from "axios";
import { QRCodeSVG } from "qrcode.react";
import { Handle, Position } from "reactflow";
import { io, Socket } from "socket.io-client";


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

function NetworkNode({ data }: any) {
  return (
    <div style={nodeStyles.wrap}>
      <div style={nodeStyles.icon}>{data.icon}</div>
      <div style={nodeStyles.label}>{data.label}</div>
    </div>
  );
}

const nodeStyles: any = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 18px",
    borderRadius: 18,
    background: "rgba(20,20,24,0.75)",
    border: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(12px)",
    color: "#fff",
    fontWeight: 700,
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  },
  icon: {
    opacity: 0.9,
    fontSize: 16,
  },
  label: {
    fontSize: 14,
  },
};

function EmojiNode({ data }: NodeProps<any>) {
  const size = data.kind === "net" ? 44 : 36;

  return (
    <div className={`emoNode ${data.kind === "net" ? "net" : "dev"}`}>
      {/* скрытые точки для ReactFlow (чтобы линии работали) */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />

      <div className="emoIcon" style={{ fontSize: size }}>{data.icon}</div>
      <div className="emoLabel">{data.label}</div>
      {data.sub ? <div className="emoSub">{data.sub}</div> : null}
    </div>
  );
}

function defaultPos(i: number, n: number) {
  // раскладка по кольцам: 10 узлов на кольцо, радиус растёт
  const perRing = 10;
  const ring = Math.floor(i / perRing);
  const idx = i % perRing;

  const countOnRing = Math.min(perRing, n - ring * perRing);
  const angle = (2 * Math.PI * idx) / Math.max(1, countOnRing);

  const r = 220 + ring * 160; // радиус колец
  return {
    x: Math.round(r * Math.cos(angle)),
    y: Math.round(r * Math.sin(angle)),
  };
}

export function NetworksPage(props: { baseUrl: string; serverOk: boolean }) {
  const api = useMemo(() => axios.create({ baseURL: props.baseUrl }), [props.baseUrl]);

  const [deployMap, setDeployMap] = useState<Record<string, any>>({});

  const [nets, setNets] = useState<Network[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = nets.find((n) => n.id === selectedId) ?? null;
  const selectedSig = useMemo(() => {
    if (!selected) return "";
    return selected.devices
      .map((d) => `${d.deviceId}:${d.x ?? "n"},${d.y ?? "n"}:${d.device.online ? 1 : 0}:${d.device.name ?? ""}`)
      .join("|");
  }, [selected]);

  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [pairLeftSec, setPairLeftSec] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const nodeTypes = useMemo(() => ({ emoji: EmojiNode }), []);

  const isNetView = !!selectedId;

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [adminSocket, setAdminSocket] = useState<Socket | null>(null);

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
    adminSocket?.emit("SUB_NET", { networkId: id });
    setPairCode(null);
    setMsg("");
    setPairExpiresAt(null);
    setPairLeftSec(0);
  };

  const leaveNetwork = () => {
    if (selectedId) adminSocket?.emit("UNSUB_NET", { networkId: selectedId });
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
  useEffect(() => {
  if (!selected) {
    setNodes([]);
    setEdges([]);
    return;
  }

  const centerId = "net";

  const netNode: Node = {
    id: centerId,
    position: { x: 0, y: 0 },
    data: { kind: "net", icon: "🌍", label: selected.name },
    type: "emoji",
    draggable: false,
    selectable: false,
  };

  const devNodes: Node[] = selected.devices.map((nd, i) => {
    const p =
      nd.x != null && nd.y != null
        ? { x: nd.x, y: nd.y }
        : defaultPos(i, selected.devices.length);

    return {
      id: nd.deviceId,
      position: p,
      data: {
        kind: "dev",
        icon: "📱",
        label: nd.device.name || nd.device.id.slice(0, 6),
        sub: nd.device.online ? "online" : "offline",
      },
      type: "emoji",
      draggable: true,
      selectable: true,
    };
  });

  

  const devEdges: Edge[] = selected.devices.map((nd) => ({
    id: `e-${centerId}-${nd.deviceId}`,
    source: centerId,
    target: nd.deviceId,
    type: "straight",
    style: { stroke: "rgba(255,255,255,0.22)", strokeWidth: 2 },
  }));

  // ✅ не перетираем позиции, которые пользователь уже перетаскивал в текущей сессии
  setNodes((prev) => {
    const prevPos = new Map(prev.map((n: any) => [n.id, n.position]));
    return [netNode, ...devNodes].map((n) => {
      if (n.id !== "net" && prevPos.has(n.id)) {
        return { ...n, position: prevPos.get(n.id) };
      }
      return n;
    });
  });

  setEdges(devEdges);
}, [selectedId, selectedSig]); // ✅ вот ключ: следим за изменениями устройств/online/координат // этого достаточно

    useEffect(() => {
      if (!props.baseUrl) return;

      const s = io(`${props.baseUrl}/admin`, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
      });

      setAdminSocket(s);

      s.on("connect", () => {
        // можно лог
      });

      // если сервер говорит "сеть изменилась" — просто reload
      s.on("NET_CHANGED", (e: any) => {
        if (!selectedId) return;
        if (e?.networkId === selectedId) load();
      });

      // (опционально) можно слушать device online/offline
      s.on("DEVICE_ONLINE", () => {
        if (selectedId) load();
      });
      s.on("DEVICE_OFFLINE", () => {
        if (selectedId) load();
      });

      // deploy stream
      s.on("DEPLOY_PROGRESS", (p: any) => {
        const deviceId = String(p.deviceId ?? "");
        if (!deviceId) return;
        setDeployMap((m) => ({ ...m, [deviceId]: p }));
      });

      s.on("DEPLOY_RESULT", (p: any) => {
        const deviceId = String(p.deviceId ?? "");
        if (!deviceId) return;
        setDeployMap((m) => ({ ...m, [deviceId]: p }));
      });

      return () => {
        s.disconnect();
        setAdminSocket(null);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.baseUrl]);

    useEffect(() => {
      if (!props.serverOk || !selectedId) return;
      const t = window.setInterval(() => load(), 2000);
      return () => window.clearInterval(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.serverOk, selectedId, props.baseUrl]);

    useEffect(() => {
      if (!adminSocket) return;
      if (!selectedId) return;
      adminSocket.emit("SUB_NET", { networkId: selectedId });
      return () => {
        adminSocket.emit("UNSUB_NET", { networkId: selectedId });
      };
    }, [adminSocket, selectedId]);

  // save layout after drag stop
  const onNodeDragStop = async (_: any, node: Node) => {
    if (!selectedId) return;
    if (node.id === "net") return;

    let payload: Array<{ deviceId: string; x: number; y: number }> = [];

    setNodes((nds) => {
      const next = nds.map((n) => (n.id === node.id ? { ...n, position: node.position } : n));
      payload = next
        .filter((n) => n.id !== "net")
        .map((n) => ({ deviceId: n.id, x: n.position.x, y: n.position.y }));
      return next;
    });

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
              <div style={{ height: 12 }} />

              <div className="bpLabel">Устройства</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(selected?.devices ?? []).map((d) => {
                  const prog = deployMap[d.device.id || d.deviceId];

                  return (
                    <div key={d.deviceId} className="bpStat" style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`bpDot ${d.device.online ? "ok" : "bad"}`} />
                          <span style={{ fontWeight: 900 }}>
                            {d.device.name || d.device.id.slice(0, 6)}
                          </span>
                        </div>
                        <span className="bpMuted" style={{ marginTop: 0 }}>
                          {d.device.platform} {d.device.model}
                        </span>
                      </div>

                      {/* 👇 ВОТ СЮДА вставляется deploy статус */}
                      {prog?.t === "DEPLOY_PROGRESS" ? (
                        <div className="bpMuted" style={{ marginTop: 6 }}>
                          deploy: {prog.stage} · {prog.progress}%
                        </div>
                      ) : null}

                      {prog?.t === "DEPLOY_RESULT" ? (
                        <div
                          className="bpMuted"
                          style={{
                            marginTop: 6,
                            color: prog.ok ? "#4ade80" : "#f87171",
                          }}
                        >
                          {prog.ok ? "Deploy завершён ✅" : `Ошибка deploy ❌`}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!selected?.devices?.length ? <div className="bpMuted">Устройств нет</div> : null}
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
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodesDraggable={true}
            >
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
.emoNode{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  color:#fff;
  text-align:center;
  user-select:none;
  pointer-events:auto;
}

.emoIcon{
  filter: drop-shadow(0 10px 18px rgba(0,0,0,0.55));
  line-height: 1;
}

.emoLabel{
  font-weight: 900;
  font-size: 14px;
  opacity: 0.92;
  text-shadow: 0 8px 16px rgba(0,0,0,0.45);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.emoSub{
  font-size: 11px;
  opacity: 0.6;
  text-shadow: 0 8px 16px rgba(0,0,0,0.35);
}

/* make selection look clean */
.react-flow__node.selected .emoIcon{
  filter: drop-shadow(0 0 14px rgba(125,211,252,0.35)) drop-shadow(0 10px 18px rgba(0,0,0,0.55));
}
`;
