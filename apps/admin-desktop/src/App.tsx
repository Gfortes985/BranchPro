import { useEffect, useMemo, useState } from "react";
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

type ProjectVersion = {
  id: string;
  label: string;
  createdAt?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  versions: ProjectVersion[];
};

const FIXED_SERVER_HOST = "81.30.105.141";
const BASE_URL_CANDIDATES = [`https://${FIXED_SERVER_HOST}`, `http://${FIXED_SERVER_HOST}`] as const;

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  const [authToken, setAuthToken] = useState(localStorage.getItem("bp_auth_token") ?? "");
  const [authEmail, setAuthEmail] = useState(localStorage.getItem("bp_auth_email") ?? "");
  const [authPassword, setAuthPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState<string>(BASE_URL_CANDIDATES[0]);
  const [apiPrefix, setApiPrefix] = useState<"/v1" | "/api/v1">("/v1");

  const api = useMemo(
    () =>
      axios.create({
        baseURL: baseUrl,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      }),
    [baseUrl, authToken]
  );

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
  const [deployVersionId, setDeployVersionId] = useState(localStorage.getItem("bp_deploy_version_id") ?? "");
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const saveToken = () => {
    const token = authToken.trim();
    setAuthToken(token);
    localStorage.setItem("bp_auth_token", token);
    if (!token) {
      setToast("Токен очищен");
      return;
    }
    setToast("✅ API токен сохранён");
  };

  const handleLoginAndSaveToken = async () => {
    if (!baseUrl) return;
    setBusy(true);
    setToast("");
    try {
      const { data } = await axios.post(`${baseUrl}/api/auth/login`, {
        email: authEmail,
        password: authPassword,
      });
      const token = String(data?.token ?? "").trim();
      if (!token) throw new Error("Токен не получен");

      setAuthToken(token);
      localStorage.setItem("bp_auth_token", token);
      localStorage.setItem("bp_auth_email", authEmail);
      setToast("✅ Вход выполнен, токен сохранён");
    } catch (e: any) {
      setToast("❌ Ошибка входа: " + (e?.response?.data?.error ?? e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const checkServer = async () => {
    setBusy(true);
    setToast("");
    try {
      let found = false;

      for (const candidateBase of BASE_URL_CANDIDATES) {
        for (const candidatePrefix of ["/v1", "/api/v1"] as const) {
          try {
            const r = await axios.get(`${candidateBase}${candidatePrefix}/health`, {
              timeout: 7000,
              validateStatus: () => true,
            });
            if (r.status >= 200 && r.status < 300) {
              setBaseUrl(candidateBase);
              setApiPrefix(candidatePrefix);
              setServerOk(true);
              setToast(`✅ Сервер доступен: ${candidateBase}${candidatePrefix}`);
              found = true;
              break;
            }
          } catch {
            // пробуем следующий вариант
          }
        }
        if (found) break;
      }

      if (!found) {
        setServerOk(false);
        setToast("❌ Сервер недоступен. Проверь HTTPS/HTTP, CORS и прокси до API.");
      }
    } finally {
      setBusy(false);
    }
  };


  useEffect(() => {
    checkServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDevices = async () => {
    setBusy(true);
    setToast("");
    try {
      const { data } = await api.get<DeviceRow[]>(`${apiPrefix}/devices`);
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
      const { data } = await api.post(`${apiPrefix}/pairing/start`);
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
    const versionId = deployVersionId.trim();
    if (!versionId) {
      setToast("Укажи versionId перед deploy");
      return;
    }

    setBusy(true);
    setToast("");
    try {
      const { data } = await api.post(`${apiPrefix}/deploy`, {
        deviceId,
        versionId,
        baseUrl: api.defaults.baseURL,
      });
      setToast(data.ok ? `DEPLOY отправлен ✅ (versionId: ${versionId})` : "Устройство оффлайн ❌");
    } catch (e: any) {
      setToast("Ошибка deploy: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };


  const normalizeProjects = (raw: any): ProjectRow[] => {
    if (!Array.isArray(raw)) return [];

    return raw.map((p: any, idx: number) => {
      const versionsRaw = Array.isArray(p?.versions) ? p.versions : [];
      const versions: ProjectVersion[] = versionsRaw.map((v: any, vIdx: number) => ({
        id: String(v?.id ?? v?.versionId ?? `${idx}-${vIdx}`),
        label: String(v?.name ?? v?.label ?? v?.version ?? v?.id ?? `Version ${vIdx + 1}`),
        createdAt: v?.createdAt ?? v?.created_at,
      }));

      return {
        id: String(p?.id ?? idx),
        name: String(p?.name ?? p?.title ?? `Project ${idx + 1}`),
        versions,
      };
    });
  };

  const loadProjects = async () => {
    setBusy(true);
    setToast("");
    try {
      const { data } = await api.get(`${apiPrefix}/projects`);
      setProjects(normalizeProjects(data));
      setToast("Проекты обновлены ✅");
    } catch (e: any) {
      setProjects([]);
      setToast("Проекты пока недоступны на сервере: " + (e?.response?.status ?? e?.message ?? String(e)));
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
            {`${baseUrl}${apiPrefix}` || "no server"}
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
                ? "Проверь сервер → потом создавай сети → добавляй устройства"
                : page === "devices"
                ? "Список устройств на сервере"
                : page === "settings"
                ? "Фиксированный сервер и авторизация"
                : " "}
            </div>
          </div>

          <div className="row">
            {page !== "settings" ? (
              <button className="btn ghost" onClick={() => setPage("settings")}>
                ⚙️ Настройки
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
                Начни с <b>Settings</b>: проверь соединение и выполни вход.
              </div>
            </Card>
          ) : null}

          {page === "settings" ? (
            <Card title="Сервер">
              <div className="label">Server URL (фиксирован в приложении)</div>
              <div className="muted mono" style={{ marginTop: 6 }}>{`${baseUrl}${apiPrefix}`}</div>

              <div style={{ marginTop: 12 }}>
                <button className="btn ghost" onClick={checkServer} disabled={busy}>
                  🔎 Проверить
                </button>
              </div>

              <div style={{ marginTop: 12 }} className="muted">
                Хост зашит в код. Приложение само подбирает HTTPS/HTTP и префикс API.
              </div>

              <div style={{ height: 16 }} />

              <div className="label">BranchProLicenseServer API token (Bearer)</div>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <input
                  className="inp"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Вставь токен или выполни вход ниже"
                />
                <button className="btn" onClick={saveToken} disabled={busy}>
                  Сохранить токен
                </button>
              </div>

              <div style={{ height: 12 }} />

              <div className="label">Вход (получить токен автоматически)</div>
              <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                <input
                  className="inp"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="email"
                  style={{ minWidth: 220 }}
                />
                <input
                  className="inp"
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="password"
                  style={{ minWidth: 200 }}
                />
                <button className="btn" onClick={handleLoginAndSaveToken} disabled={busy || !authEmail || !authPassword}>
                  Войти и сохранить токен
                </button>
              </div>

              <div style={{ marginTop: 10 }} className="muted">
                Для BranchProLicenseServer защищённые endpoint'ы <span className="mono">/v1/*</span> требуют Bearer-токен.
              </div>
            </Card>
          ) : null}

          {page === "networks" ? (
            <NetworksPage baseUrl={baseUrl} apiPrefix={apiPrefix} serverOk={!!serverOk} authToken={authToken} />
          ) : null}


          {page === "devices" ? (
            <Card title="Устройства">
              <div className="label">Project versionId для deploy</div>
              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  className="inp"
                  value={deployVersionId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDeployVersionId(v);
                    localStorage.setItem("bp_deploy_version_id", v);
                  }}
                  placeholder="Например: 42"
                />
              </div>

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
                      <button className="btn" disabled={busy || !d.online || !deployVersionId.trim()} onClick={() => deploy(d.id)}>
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
              <div className="row">
                <button className="btn ghost" onClick={loadProjects} disabled={busy || !serverOk}>
                  ⟳ Обновить проекты
                </button>
                <div className="muted">Выбери версию и нажми “Использовать для Deploy”.</div>
              </div>

              <div className="table" style={{ marginTop: 12 }}>
                <div className="tr th" style={{ gridTemplateColumns: "1.3fr 1.3fr .8fr .8fr" }}>
                  <div>Проект</div>
                  <div>Версия</div>
                  <div>Дата</div>
                  <div></div>
                </div>

                {projects.flatMap((project) =>
                  (project.versions.length ? project.versions : [{ id: "", label: "Нет версий", createdAt: "" }]).map((version) => (
                    <div className="tr" key={`${project.id}:${version.id || "none"}`} style={{ gridTemplateColumns: "1.3fr 1.3fr .8fr .8fr" }}>
                      <div>{project.name}</div>
                      <div className="mono">{version.label} {version.id ? `(id: ${version.id})` : ""}</div>
                      <div className="muted">{version.createdAt ? String(version.createdAt) : "—"}</div>
                      <div style={{ textAlign: "right" }}>
                        <button
                          className="btn"
                          disabled={busy || !version.id}
                          onClick={() => {
                            setDeployVersionId(version.id);
                            localStorage.setItem("bp_deploy_version_id", version.id);
                            setPage("devices");
                            setToast(`Выбрана версия ${version.id} для deploy ✅`);
                          }}
                        >
                          Использовать для Deploy
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {!projects.length ? <div className="muted" style={{ marginTop: 10 }}>Нажми “Обновить проекты”, чтобы загрузить список</div> : null}
              </div>
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
