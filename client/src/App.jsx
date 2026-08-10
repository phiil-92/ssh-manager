import { useEffect, useRef, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

export default function App() {
  const [vault, setVault] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [sessions, setSessions] = useState([]);   // creation order — NEVER reordered
  const [tabOrder, setTabOrder] = useState([]);   // visual tab order — array of session ids
  const [activeId, setActiveId] = useState(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const nextId = useRef(1);

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
    setTabOrder([]);
    setActiveId(null);
    setShowSettings(false);
    setVault({ ...vault, unlocked: false });
  }

  function openSession(host) {
    const id = nextId.current++;
    setSessions((s) => [...s, { id, host, status: "connecting" }]);
    setTabOrder((o) => [...o, id]);
    setActiveId(id);
  }

  function closeSession(id) {
    const remainingOrder = tabOrder.filter((x) => x !== id);
    setTabOrder(remainingOrder);
    setSessions((s) => s.filter((x) => x.id !== id));
    if (activeId === id) {
      setActiveId(remainingOrder.length ? remainingOrder[remainingOrder.length - 1] : null);
    }
  }

  function setStatus(id, status) {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, status } : x)));
  }

  function reorderTabs(fromIdx, toIdx) {
    setTabOrder((o) => {
      const arr = [...o];
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
              <TabBar
                sessions={sessions}
                tabOrder={tabOrder}
                activeId={activeId}
                onSelect={setActiveId}
                onClose={closeSession}
                onReorder={reorderTabs}
              />
            )}
            <div className="workspace">
              {/* rendered in creation order — reordering tabs never touches these */}
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
            setTabOrder([]);
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

/* ---------- Tab bar with pointer-based drag ---------- */
function TabBar({ sessions, tabOrder, activeId, onSelect, onClose, onReorder }) {
  const refs = useRef({});
  const dragData = useRef(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState(null); // {id, dx, fromIdx, toIdx, width}

  const ordered = tabOrder
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean);

  function onPointerDown(e, id, idx) {
    if (e.button !== 0) return;
    if (e.target.closest(".tab-close")) return; // closing, not dragging
    const rects = ordered.map((s) => refs.current[s.id].getBoundingClientRect());
    dragData.current = { id, fromIdx: idx, startX: e.clientX, rects, width: rects[idx].width, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = dragData.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 4) return; // small tolerance so clicks stay clicks
    d.moved = true;

    // where is the dragged tab's center now, measured against original centers?
    const center = d.rects[d.fromIdx].left + d.width / 2 + dx;
    let toIdx = d.fromIdx;
    if (dx > 0) {
      for (let j = d.fromIdx + 1; j < d.rects.length; j++) {
        if (center > d.rects[j].left + d.rects[j].width / 2) toIdx = j;
      }
    } else {
      for (let j = d.fromIdx - 1; j >= 0; j--) {
        if (center < d.rects[j].left + d.rects[j].width / 2) toIdx = j;
      }
    }
    setDrag({ id: d.id, dx, fromIdx: d.fromIdx, toIdx, width: d.width });
  }

  function onPointerUp() {
    const d = dragData.current;
    if (!d) return;
    dragData.current = null;
    if (d.moved) {
      suppressClick.current = true; // don't let the release also count as a click
      if (drag && drag.toIdx !== drag.fromIdx) onReorder(drag.fromIdx, drag.toIdx);
    }
    setDrag(null);
  }

  function styleFor(idx, s) {
    if (!drag) return undefined;
    if (s.id === drag.id) {
      return {
        transform: `translateX(${drag.dx}px)`,
        transition: "none",
        zIndex: 10,
        position: "relative",
      };
    }
    // neighbors slide out of the way
    if (drag.toIdx > drag.fromIdx && idx > drag.fromIdx && idx <= drag.toIdx) {
      return { transform: `translateX(${-drag.width}px)` };
    }
    if (drag.toIdx < drag.fromIdx && idx >= drag.toIdx && idx < drag.fromIdx) {
      return { transform: `translateX(${drag.width}px)` };
    }
    return undefined;
  }

  return (
    <div className="tabbar">
      {ordered.map((s, idx) => (
        <div
          key={s.id}
          ref={(el) => (refs.current[s.id] = el)}
          className={s.id === activeId ? "tab active" : "tab"}
          style={styleFor(idx, s)}
          onPointerDown={(e) => onPointerDown(e, s.id, idx)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            onSelect(s.id);
          }}
        >
          <span className={`dot dot-${s.status}`} />
          <span className="tab-title">{s.host.name}</span>
          <span
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
          >
            ✕
          </span>
        </div>
      ))}
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
