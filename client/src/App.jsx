import { useEffect, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

export default function App() {
  const [vault, setVault] = useState(null);        // {setUp, unlocked}
  const [hosts, setHosts] = useState([]);
  const [activeHost, setActiveHost] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.vaultStatus().then(setVault).catch((e) => setError(e.message));
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
    setActiveHost(null);
    setVault({ ...vault, unlocked: false });
  }

  if (!vault) return <div className="center-screen">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">SSH Manager</span>
        {vault.unlocked && (
          <button className="btn btn-ghost" onClick={handleLock}>
            🔒 Lock
          </button>
        )}
      </header>

      {!vault.unlocked ? (
        <UnlockScreen setUp={vault.setUp} onSubmit={handleUnlock} error={error} />
      ) : (
        <div className="layout">
          <Sidebar
            hosts={hosts}
            activeHost={activeHost}
            onSelect={setActiveHost}
            onChanged={refreshHosts}
          />
          <main className="workspace">
            {activeHost ? (
              <SshTerminal key={activeHost.id} hostId={activeHost.id} />
            ) : (
              <div className="center-screen muted">
                Select a host on the left, or add one.
              </div>
            )}
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

function Sidebar({ hosts, activeHost, onSelect, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Hosts</span>
        <button className="btn btn-small" onClick={() => setShowForm(!showForm)}>
          {showForm ? "✕" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <AddHostForm
          onDone={() => {
            setShowForm(false);
            onChanged();
          }}
        />
      )}

      <ul className="host-list">
        {hosts.map((h) => (
          <li
            key={h.id}
            className={activeHost?.id === h.id ? "host active" : "host"}
            onClick={() => onSelect(h)}
          >
            <div className="host-name">{h.name}</div>
            <div className="host-meta">
              {h.username}@{h.hostname}:{h.port}
            </div>
            <button
              className="host-delete"
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
          </li>
        ))}
        {hosts.length === 0 && !showForm && (
          <li className="muted small pad">No hosts yet.</li>
        )}
      </ul>
    </aside>
  );
}

function AddHostForm({ onDone }) {
  const [f, setF] = useState({ name: "", hostname: "", port: 22, username: "", password: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    try {
      await api.addHost({ ...f, port: Number(f.port) || 22 });
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
      <input placeholder="Username" value={f.username} onChange={set("username")} />
      <input placeholder="Password" type="password" value={f.password} onChange={set("password")} />
      <button className="btn" onClick={save}>Save host</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
