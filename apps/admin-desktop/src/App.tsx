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

type DashboardStats = {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  networks: number;
  projects: number;
  versions: number;
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
  const [authExpired, setAuthExpired] = useState(false);

  // devices state
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpires, setPairExpires] = useState<number | null>(null);
  const [deployVersionId, setDeployVersionId] = useState(localStorage.getItem("bp_deploy_version_id") ?? "");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceOnlineFilter, setDeviceOnlineFilter] = useState<"all" | "online" | "offline">("all");
  const [deviceSort, setDeviceSort] = useState<"name" | "status" | "platform" | "version">("status");

  const saveToken = () => {
    const token = authToken.trim();
    setAuthToken(token);
    localStorage.setItem("bp_auth_token", token);
    if (!token) {
      setToast("Токен очищен");
      return;
    }
    setAuthExpired(false);
    setToast("✅ API токен сохранён");
  };


  const handleUnauthorized = (message?: string) => {
    setAuthExpired(true);
    setAuthToken("");
    localStorage.removeItem("bp_auth_token");
    setPage("settings");
    setToast(message ?? "Сессия истекла (401). Выполни вход заново.");
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
      setAuthExpired(false);
      setToast("✅ Вход выполнен, токен сохранён");
    } catch (e: any) {
      setToast("❌ Ошибка входа: " + (e?.response?.data?.error ?? e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  async function checkServer() {
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
  }


  useEffect(() => {
    checkServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err?.response?.status === 401) {
          handleUnauthorized();
        }
        return Promise.reject(err);
      }
    );

  

  return () => api.interceptors.response.eject(id);
  }, [api]);

  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();

    let rows = [...devices];

    if (deviceOnlineFilter !== "all") {
      const wanted = deviceOnlineFilter === "online";
      rows = rows.filter((d) => d.online === wanted);
    }

    if (q) {
      rows = rows.filter((d) => {
        const id = String(d.id ?? "").toLowerCase();
        const name = String(d.name ?? "").toLowerCase();
        const platform = String(d.platform ?? "").toLowerCase();
        const model = String(d.model ?? "").toLowerCase();
        const version = String(d.appVersion ?? "").toLowerCase();
        return id.includes(q) || name.includes(q) || platform.includes(q) || model.includes(q) || version.includes(q);
      });
    }

    rows.sort((a, b) => {
      if (deviceSort === "status") {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.name.localeCompare(b.name);
      }
      if (deviceSort === "name") return a.name.localeCompare(b.name);
      if (deviceSort === "platform") return `${a.platform} ${a.model}`.localeCompare(`${b.platform} ${b.model}`);
      return String(a.appVersion ?? "").localeCompare(String(b.appVersion ?? ""));
    });

    return rows;
  }, [devices, deviceOnlineFilter, deviceQuery, deviceSort]);

  const loadDashboardStats = async () => {
    if (!serverOk) {
      setToast("Сначала проверь доступность сервера в Settings");
      return;
    }

    setBusy(true);
    setToast("");
    try {
      const [devicesRes, networksRes, projectsRes] = await Promise.allSettled([
        api.get<DeviceRow[]>(`${apiPrefix}/devices`),
        api.get(`${apiPrefix}/networks`),
        api.get(`${apiPrefix}/projects`),
      ]);

      const devices = devicesRes.status === "fulfilled" && Array.isArray(devicesRes.value.data)
        ? devicesRes.value.data
        : [];
      const networks = networksRes.status === "fulfilled" && Array.isArray(networksRes.value.data)
        ? networksRes.value.data
        : [];
      const projectRows = projectsRes.status === "fulfilled"
        ? normalizeProjects(projectsRes.value.data)
        : [];

      const onlineDevices = devices.filter((d) => d.online).length;
      const versions = projectRows.reduce((acc, p) => acc + p.versions.length, 0);

      setStats({
        totalDevices: devices.length,
        onlineDevices,
        offlineDevices: Math.max(0, devices.length - onlineDevices),
        networks: networks.length,
        projects: projectRows.length,
        versions,
      });

      setToast("Dashboard обновлён ✅");
    } catch (e: any) {
      setToast("Ошибка загрузки Dashboard: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  async function checkServer() {
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
  }


  useEffect(() => {
    checkServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (err) => {
        if (err?.response?.status === 401) {
          handleUnauthorized();
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [api]);

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
            <Card title="Dashboard">
              <div className="row">
                <button className="btn ghost" onClick={loadDashboardStats} disabled={busy || !serverOk}>
                  ⟳ Обновить метрики
                </button>
                <div className="muted">Сводка по устройствам, сетям и проектам.</div>
              </div>

              {stats ? (
                <div className="table" style={{ marginTop: 12 }}>
                  <div className="tr th" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div>Метрика</div>
                    <div>Значение</div>
                  </div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Устройства (всего)</div><div><b>{stats.totalDevices}</b></div></div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Устройства online</div><div><b>{stats.onlineDevices}</b></div></div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Устройства offline</div><div><b>{stats.offlineDevices}</b></div></div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Сети</div><div><b>{stats.networks}</b></div></div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Проекты</div><div><b>{stats.projects}</b></div></div>
                  <div className="tr" style={{ gridTemplateColumns: "1fr 1fr" }}><div>Версии проектов</div><div><b>{stats.versions}</b></div></div>
                </div>
              ) : (
                <div style={{ marginTop: 12 }} className="muted">
                  Нажми “Обновить метрики”, чтобы загрузить данные с сервера.
                </div>
              )}
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
              {authExpired ? (
                <div className="muted" style={{ marginTop: 0, marginBottom: 8, color: "#fca5a5" }}>
                  🔐 Сессия истекла. Войди заново.
                </div>
              ) : null}
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
            <NetworksPage
              baseUrl={baseUrl}
              apiPrefix={apiPrefix}
              serverOk={!!serverOk}
              authToken={authToken}
              onAuthExpired={handleUnauthorized}
            />
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

              <div className="label">Поиск / фильтры устройств</div>
              <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                <input
                  className="inp"
                  value={deviceQuery}
                  onChange={(e) => setDeviceQuery(e.target.value)}
                  placeholder="Поиск: id, имя, платформа, модель, версия"
                  style={{ minWidth: 280 }}
                />
                <select className="inp" value={deviceOnlineFilter} onChange={(e) => setDeviceOnlineFilter(e.target.value as any)} style={{ maxWidth: 180 }}>
                  <option value="all">Все статусы</option>
                  <option value="online">Только online</option>
                  <option value="offline">Только offline</option>
                </select>
                <select className="inp" value={deviceSort} onChange={(e) => setDeviceSort(e.target.value as any)} style={{ maxWidth: 220 }}>
                  <option value="status">Сортировка: статус</option>
                  <option value="name">Сортировка: имя</option>
                  <option value="platform">Сортировка: платформа</option>
                  <option value="version">Сортировка: версия</option>
                </select>
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

                {filteredDevices.map((d) => (
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

                {!devices.length ? <div className="muted" style={{ marginTop: 10 }}>Нажми “Обновить” чтобы загрузить список</div> : !filteredDevices.length ? <div className="muted" style={{ marginTop: 10 }}>По текущим фильтрам устройств нет</div> : null}
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
