import { useMemo, useState } from "react";
import axios from "axios";
import "./App.css";
import { NetworksPage } from "./pages/NetworksPage";


type Page = "dashboard" | "networks" | "devices" | "projects" | "settings" | "account";

type DeviceRow = {
  id: string;
  name: string;
  platform: string;
  model: string;
  appVersion: string;
  online: boolean;
  lastSeenAgeSec: number;
};

function normalizeUrl(u: string) {
  let s = (u || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s;
}

export default function App() {
  
  const [page, setPage] = useState<Page>("dashboard");

  const [serverUrl, setServerUrl] = useState(localStorage.getItem("bp_server_url") ?? "http://localhost:3000");
  const baseUrl = useMemo(() => normalizeUrl(serverUrl), [serverUrl]);

  const api = useMemo(() => axios.create({ baseURL: baseUrl }), [baseUrl]);

  const isNetworks = page === "networks";
  const sidebarCollapsed = isNetworks;

  // connection state
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  // devices state
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpires, setPairExpires] = useState<number | null>(null);

  const saveServerUrl = () => {
    const fixed = normalizeUrl(serverUrl);
    setServerUrl(fixed);
    localStorage.setItem("bp_server_url", fixed);
    setToast("✅ Server URL сохранён");
    setServerOk(null);
  };

  const checkServer = async () => {
    setBusy(true);
    setToast("");
    try {
      const r = await api.get("/v1/health");
      setServerOk(!!r.data?.ok || r.status === 200);
    } catch (e: any) {
      setServerOk(false);
      setToast("❌ Сервер недоступен: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const loadDevices = async () => {
    setBusy(true);
    setToast("");
    try {
      const { data } = await api.get<DeviceRow[]>("/v1/devices");
      setDevices(data);
    } catch (e: any) {
      setToast("Ошибка загрузки устройств: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async () => {
    setBusy(true);
    setToast("");
    try {
      const { data } = await api.post("/v1/pairing/start");
      setPairCode(data.code);
      setPairExpires(data.expiresInSec);
      setToast("Код создан ✅");
    } catch (e: any) {
      setToast("Ошибка создания кода: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const deploy = async (deviceId: string) => {
    const versionId = prompt("versionId проекта (ProjectVersion.id)?");
    if (!versionId) return;

    setBusy(true);
    setToast("");
    try {
      const { data } = await api.post("/v1/deploy", {
        deviceId,
        versionId,
        baseUrl: api.defaults.baseURL, // позже уберём, сделаем PUBLIC_BASE_URL на сервере
      });
      setToast(data.ok ? "DEPLOY отправлен ✅" : "Устройство оффлайн ❌");
    } catch (e: any) {
      setToast("Ошибка deploy: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <aside className={`side ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <div className="brandName">BranchPro</div>
          <div className="brandSub">Admin Desktop</div>
        </div>

        <div className="sideBlock">
          <div className="sideLabel">Навигация</div>

          <NavBtn active={page === "dashboard"} onClick={() => setPage("dashboard")} icon="🏠" text="Dashboard" />
          <NavBtn active={page === "networks"} onClick={() => setPage("networks")} icon="🕸️" text="Networks" />
          <NavBtn active={page === "devices"} onClick={() => setPage("devices")} icon="📱" text="Devices" />
          <NavBtn active={page === "projects"} onClick={() => setPage("projects")} icon="📦" text="Projects" />
        </div>

        <div className="sideBlock">
          <div className="sideLabel">Система</div>

          <NavBtn active={page === "settings"} onClick={() => setPage("settings")} icon="⚙️" text="Settings" />
          <NavBtn active={page === "account"} onClick={() => setPage("account")} icon="👤" text="Account" />
        </div>

        <div className="sideFooter">
          <div className={`pill ${serverOk ? "on" : serverOk === false ? "off" : ""}`}>
            {serverOk === null ? "server: ?" : serverOk ? "server: ok" : "server: down"}
          </div>
          <div className="muted mono" title={baseUrl}>
            {baseUrl || "no server"}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <div className="ttl">
              {page === "dashboard"
                ? "Dashboard"
                : page === "networks"
                ? "Networks"
                : page === "devices"
                ? "Devices"
                : page === "projects"
                ? "Projects"
                : page === "settings"
                ? "Settings"
                : "Account"}
            </div>
            <div className="sub">
              {page === "networks"
                ? "Сначала подключи сервер → потом создавай сети → добавляй устройства"
                : page === "devices"
                ? "Список устройств на сервере"
                : page === "settings"
                ? "Адрес сервера и проверка соединения"
                : " "}
            </div>
          </div>

          <div className="row">
            {page !== "settings" ? (
              <button className="btn ghost" onClick={() => setPage("settings")}>
                ⚙️ Настроить сервер
              </button>
            ) : null}
          </div>
        </header>

        <div className="content">
          {page === "dashboard" ? (
            <Card title="Добро пожаловать">
              <div className="muted">
                Здесь будет обзор: активные сети, онлайн устройства, последние деплои и ошибки.
              </div>
              <div style={{ marginTop: 12 }} className="muted">
                Начни с <b>Settings</b>: укажи сервер и нажми “Проверить”.
              </div>
            </Card>
          ) : null}

          {page === "settings" ? (
            <Card title="Сервер">
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div className="label">Server URL</div>
                  <input
                    className="inp"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                  />
                </div>
                <button className="btn" onClick={saveServerUrl} disabled={busy}>
                  Сохранить
                </button>
                <button className="btn ghost" onClick={checkServer} disabled={busy || !baseUrl}>
                  🔎 Проверить
                </button>
              </div>

              <div style={{ marginTop: 12 }} className="muted">
                Подсказка: для dev можешь использовать <span className="mono">http://localhost:3000</span>.
              </div>
            </Card>
          ) : null}

          {page === "networks" ? (
            <NetworksPage baseUrl={baseUrl} serverOk={!!serverOk} />
          ) : null}


          {page === "devices" ? (
            <Card title="Устройства">
              <div className="row">
                <button className="btn ghost" onClick={loadDevices} disabled={busy || !serverOk}>
                  ⟳ Обновить
                </button>
                <button className="btn" onClick={startPairing} disabled={busy || !serverOk}>
                  Создать код
                </button>

                {pairCode ? (
                  <div className="codeBox">
                    <div className="code">{pairCode}</div>
                    <div className="muted">Действует: {pairExpires ?? "?"} сек</div>
                  </div>
                ) : (
                  <div className="muted">Код нужен для подключения нового Player</div>
                )}
              </div>

              <div className="table" style={{ marginTop: 12 }}>
                <div className="tr th">
                  <div>ID</div>
                  <div>Имя</div>
                  <div>Платформа</div>
                  <div>Версия</div>
                  <div>Online</div>
                  <div></div>
                </div>

                {devices.map((d) => (
                  <div className="tr" key={d.id}>
                    <div className="mono">{d.id.slice(0, 10)}…</div>
                    <div>{d.name}</div>
                    <div className="muted">
                      {d.platform} / {d.model}
                    </div>
                    <div className="muted">{d.appVersion}</div>
                    <div>
                      <span className={d.online ? "pill on" : "pill off"}>
                        {d.online ? "online" : "offline"}
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <button className="btn" disabled={busy || !d.online} onClick={() => deploy(d.id)}>
                        Deploy
                      </button>
                    </div>
                  </div>
                ))}

                {!devices.length ? <div className="muted" style={{ marginTop: 10 }}>Нажми “Обновить” чтобы загрузить список</div> : null}
              </div>
            </Card>
          ) : null}

          {page === "projects" ? (
            <Card title="Проекты">
              <div className="muted">Следующий шаг: upload zip → список версий → deploy в сеть/устройства.</div>
            </Card>
          ) : null}

          {page === "account" ? (
            <Card title="Аккаунт">
              <div className="muted">
                Здесь будет вход + статус подписки. Пока можно работать без аккаунта (dev режим).
              </div>
              <div style={{ marginTop: 10 }} className="muted">
                В проде ограничения будут на сервере: Pro 10 устройств, Enterprise ∞.
              </div>
            </Card>
          ) : null}

          {toast ? <div className="toast">{toast}</div> : null}
        </div>
      </main>
    </div>
  );
}

function NavBtn(props: { active?: boolean; onClick: () => void; icon: string; text: string }) {
  return (
    <button className={`nav ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="navIcon">{props.icon}</span>
      <span>{props.text}</span>
    </button>
  );
}

function Card(props: { title: string; children: any }) {
  return (
    <section className="card">
      <div className="cardTitle">{props.title}</div>
      {props.children}
    </section>
  );
}
