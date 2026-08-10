import { useEffect, useRef, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

export default function App() {
  const [vault, setVault] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [sessions, setSessions] = useState([]);       // [{id, host}]
  const [activeId, setActiveId] = useState(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const nextId = useRef(1);

  useEffect(() => {
    api.vaultStatus().then(setVault).catch((e) => setError(e.message));
    api.vaultVersion?.();
    fetch("/api/version").then((r) => r.json()).then((d) => setVersion(d.version));
  }, []);

  async function refreshHosts() {
    setHosts(await api.listHosts());
  }

  async function handleUnlock(password) {
    setError("");
    try {
      if (!vault.setUp) await api.vaultSetup(password);
      else await api.vaultUnlock(password);
      setVault({ setUp: true, unlocked: true });
      await refreshHosts();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleLock() {
    await api.vaultLock();
    setSessions([]);
    setActiveId(null);
    setVault({ ...vault, unlocked: false });
  }

  function openSession(host) {
    const id = nextId.current++;
    setSessions((s) => [...s, { id, host }]);
    setActiveId(id);
  }

  function closeSession(id) {
    setSessions((s) => {
      const remaining = s.filter((x) => x.id !== id);
      if (activeId === id) setActiveId(remaining.length ? remaining[remaining.length - 1].id : null);
      return remaining;
    });
  }

  if (!vault) return <div className="center-screen">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">SSH Manager</span>
        {vault.unlocked && (
          <button className="btn btn-ghost" onClick={handleLock}>🔒 Lock</button>
        )}
      </header>

      {!vault.unlocked ? (
        <UnlockScreen setUp={vault.setUp} onSubmit={handleUnlock} error={error} />
      ) : (
        <div className="layout">
          <Sidebar
            hosts={hosts}
            onOpen={openSession}
            onChanged={refreshHosts}
            version={version}
          />
          <main className="main-col">
            {sessions.length > 0 && (
              <div className="tabbar">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={s.id === activeId ? "tab active" : "tab"}
                    onClick={() => setActiveId(s.id)}
                  >
                    <span className="tab-title">{s.host.name}</span>
                    <span
                      className="tab-close"
                      onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="workspace">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="session"
                  style={{ display: s.id === activeId ? "flex" : "none" }}
                >
                  <SshTerminal hostId={s.host.id} visible={s.id === activeId} />
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="center-screen muted">
                  Click a host on the left to open a session.
                </div>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function UnlockScreen({ setUp, onSubmit, error }) {
  const [pw, setPw] = useState("");
  return (
    <div className="center-screen">
      <div className="card">
        <h2>{setUp ? "Unlock vault" : "Create master password"}</h2>
        {!setUp && (
          <p className="muted small">
            This password encrypts all stored credentials. It cannot be recovered
            or reset — if you lose it, stored passwords are gone.
          </p>
        )}
        <input
          type="password"
          placeholder="Master password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(pw)}
        />
        <button className="btn" onClick={() => onSubmit(pw)}>
          {setUp ? "Unlock" : "Create vault"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function Sidebar({ hosts, onOpen, onChanged, version }) {
  const [formHost, setFormHost] = useState(undefined); // undefined=closed, null=new, object=edit

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Hosts</span>
        <button
          className="btn btn-small"
          onClick={() => setFormHost(formHost === undefined ? null : undefined)}
        >
          {formHost !== undefined ? "✕" : "+ Add"}
        </button>
      </div>

      {formHost !== undefined && (
        <HostForm
          host={formHost}
          onDone={() => { setFormHost(undefined); onChanged(); }}
        />
      )}

      <ul className="host-list">
        {hosts.map((h) => (
          <li key={h.id} className="host" onClick={() => onOpen(h)}>
            <div className="host-name">{h.name}</div>
            <div className="host-meta">
              {h.username ? `${h.username}@` : ""}{h.hostname}:{h.port}
            </div>
            <div className="host-actions">
              <button
                title="Edit host"
                onClick={(e) => { e.stopPropagation(); setFormHost(h); }}
              >
                ✎
              </button>
              <button
                title="Delete host"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${h.name}"?`)) {
                    await api.deleteHost(h.id);
                    onChanged();
                  }
                }}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
        {hosts.length === 0 && formHost === undefined && (
          <li className="muted small pad">No hosts yet.</li>
        )}
      </ul>

      <div className="sidebar-foot muted small">v{version}</div>
    </aside>
  );
}

function HostForm({ host, onDone }) {
  const editing = !!host;
  const [f, setF] = useState({
    name: host?.name || "",
    hostname: host?.hostname || "",
    port: host?.port || 22,
    username: host?.username || "",
    password: "",
    clearPassword: false,
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    try {
      const payload = { ...f, port: Number(f.port) || 22 };
      if (editing) await api.updateHost(host.id, payload);
      else await api.addHost(payload);
      onDone();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="add-form">
      <input placeholder="Name (e.g. Dev Server)" value={f.name} onChange={set("name")} autoFocus />
      <input placeholder="Hostname / IP" value={f.hostname} onChange={set("hostname")} />
      <input placeholder="Port" type="number" value={f.port} onChange={set("port")} />
      <input placeholder="Username (empty = ask on connect)" value={f.username} onChange={set("username")} />
      <input
        placeholder={editing && host.has_password ? "Password (empty = keep current)" : "Password (empty = ask on connect)"}
        type="password"
        value={f.password}
        onChange={set("password")}
      />
      {editing && host.has_password && (
        <label className="small muted checkline">
          <input
            type="checkbox"
            checked={f.clearPassword}
            onChange={(e) => setF({ ...f, clearPassword: e.target.checked })}
          />
          Remove saved password
        </label>
      )}
      <button className="btn" onClick={save}>{editing ? "Save changes" : "Save host"}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
