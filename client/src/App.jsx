import { useEffect, useRef, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

export default function App() {
  const [vault, setVault] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [sessions, setSessions] = useState([]); // [{id, host, status}]
  const [activeId, setActiveId] = useState(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const nextId = useRef(1);
  const dragId = useRef(null);

  useEffect(() => {
    api.vaultStatus().then(setVault).catch((e) => setError(e.message));
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
    setShowSettings(false);
    setVault({ ...vault, unlocked: false });
  }

  function openSession(host) {
    const id = nextId.current++;
    setSessions((s) => [...s, { id, host, status: "connecting" }]);
    setActiveId(id);
  }

  function closeSession(id) {
    setSessions((s) => {
      const remaining = s.filter((x) => x.id !== id);
      if (activeId === id) setActiveId(remaining.length ? remaining[remaining.length - 1].id : null);
      return remaining;
    });
  }

  function setStatus(id, status) {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, status } : x)));
  }

  function reorderTabs(fromId, toId) {
    if (fromId === toId) return;
    setSessions((s) => {
      const arr = [...s];
      const fromIdx = arr.findIndex((x) => x.id === fromId);
      const toIdx = arr.findIndex((x) => x.id === toId);
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }

  const connectedHostIds = new Set(
    sessions.filter((s) => s.status === "connected").map((s) => s.host.id)
  );

  if (!vault) return <div className="center-screen">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">SSH Manager</span>
        {vault.unlocked && (
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
            <button className="btn btn-ghost" onClick={handleLock}>Lock</button>
          </div>
        )}
      </header>

      {!vault.unlocked ? (
        <UnlockScreen setUp={vault.setUp} onSubmit={handleUnlock} error={error} />
      ) : (
        <div className="layout">
          <Sidebar
            hosts={hosts}
            connectedHostIds={connectedHostIds}
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
                    draggable
                    onDragStart={() => (dragId.current = s.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => reorderTabs(dragId.current, s.id)}
                    className={s.id === activeId ? "tab active" : "tab"}
                    onClick={() => setActiveId(s.id)}
                  >
                    <span className={`dot dot-${s.status}`} />
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
                  <SshTerminal
                    hostId={s.host.id}
                    visible={s.id === activeId}
                    onStatus={(status) => setStatus(s.id, status)}
                  />
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

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onWiped={() => {
            setSessions([]);
            setActiveId(null);
            setShowSettings(false);
            setVault({ setUp: false, unlocked: false });
            setHosts([]);
          }}
        />
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

function Sidebar({ hosts, connectedHostIds, onOpen, onChanged, version }) {
  const [formHost, setFormHost] = useState(undefined);

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
        <HostForm host={formHost} onDone={() => { setFormHost(undefined); onChanged(); }} />
      )}

      <ul className="host-list">
        {hosts.map((h) => (
          <li key={h.id} className="host" onClick={() => onOpen(h)}>
            <div className="host-name">
              {connectedHostIds.has(h.id) && <span className="dot dot-connected" />}
              {h.name}
            </div>
            <div className="host-meta">
              {h.username ? `${h.username}@` : ""}{h.hostname}:{h.port}
            </div>
            <div className="host-actions">
              <button onClick={(e) => { e.stopPropagation(); setFormHost(h); }}>
                Edit
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${h.name}"?`)) {
                    await api.deleteHost(h.id);
                    onChanged();
                  }
                }}
              >
                Delete
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

function SettingsModal({ onClose, onWiped }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [nw2, setNw2] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function changePw() {
    setError(""); setMsg("");
    if (nw !== nw2) return setError("New passwords do not match");
    try {
      await api.changeMasterPassword(cur, nw);
      setMsg("Master password changed. Stored credentials were re-encrypted.");
      setCur(""); setNw(""); setNw2("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function wipe() {
    if (!confirm("Delete ALL hosts and credentials and reset the vault? This cannot be undone.")) return;
    if (!confirm("Really sure? Everything will be gone.")) return;
    await api.wipeAll();
    onWiped();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="btn btn-small btn-ghost" onClick={onClose}>✕</button>
        </div>

        <h3>Change master password</h3>
        <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input type="password" placeholder="New password (min 8 chars)" value={nw} onChange={(e) => setNw(e.target.value)} />
        <input type="password" placeholder="Repeat new password" value={nw2} onChange={(e) => setNw2(e.target.value)} />
        <button className="btn" onClick={changePw}>Change password</button>

        <h3 className="danger-title">Danger zone</h3>
        <button className="btn btn-danger" onClick={wipe}>Delete ALL saved data</button>

        {msg && <p className="success">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
