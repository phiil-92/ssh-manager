import { useEffect, useRef, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

export default function App() {
  const [vault, setVault] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [folders, setFolders] = useState([]);
  const [snippets, setSnippets] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [tabOrder, setTabOrder] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [split, setSplit] = useState(null);
  const [focusedPane, setFocusedPane] = useState("left");
  const [splitHint, setSplitHint] = useState(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [sbWidth, setSbWidth] = useState(() => Number(localStorage.getItem("sbWidth")) || 260);
  const [snWidth, setSnWidth] = useState(() => Number(localStorage.getItem("snWidth")) || 260);
  const nextId = useRef(1);
  const workspaceRef = useRef(null);
  const termSenders = useRef({});

  useEffect(() => {
    api.vaultStatus().then((status) => {
      setVault(status);
      if (status.unlocked) { refreshData(); refreshSnippets(); }
    }).catch((e) => setError(e.message));
    fetch("/api/version").then((r) => r.json()).then((d) => setVersion(d.version));
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("sbWidth", String(sbWidth));
  }, [sbWidth]);

  useEffect(() => {
    localStorage.setItem("snWidth", String(snWidth));
  }, [snWidth]);

  function startSbResize(e) {
    e.preventDefault();
    const startX = e.clientX, startW = sbWidth;
    const move = (ev) => setSbWidth(Math.min(500, Math.max(180, startW + ev.clientX - startX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startSnResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = snWidth;
    const move = (ev) => setSnWidth(Math.min(600, Math.max(180, startW - (ev.clientX - startX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  async function refreshData() {
    setHosts(await api.listHosts());
    setFolders(await api.listFolders());
  }

  async function refreshSnippets() {
    setSnippets(await api.listSnippets());
  }

  async function handleUnlock(password) {
    setError("");
    try {
      if (!vault.setUp) await api.vaultSetup(password);
      else await api.vaultUnlock(password);
      setVault({ setUp: true, unlocked: true });
      await refreshData();
      await refreshSnippets();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleLock() {
    await api.vaultLock();
    setSessions([]); setTabOrder([]); setActiveId(null);
    setSplit(null); setShowSettings(false); setShowSnippets(false);
    setVault({ ...vault, unlocked: false });
  }

  function openSession(host) {
    const id = nextId.current++;
    setSessions((s) => [...s, { id, host, status: "connecting" }]);
    setTabOrder((o) => [...o, id]);
    if (split) {
      if (split.leftId == null) { setSplit({ ...split, leftId: id }); setFocusedPane("left"); }
      else if (split.rightId == null) { setSplit({ ...split, rightId: id }); setFocusedPane("right"); }
      else setSplit({ ...split, [focusedPane === "left" ? "leftId" : "rightId"]: id });
    }
    setActiveId(id);
  }

  function selectTab(id) {
    if (!split) return setActiveId(id);
    if (split.leftId === id) { setFocusedPane("left"); setActiveId(id); return; }
    if (split.rightId === id) { setFocusedPane("right"); setActiveId(id); return; }
    const next = { ...split };
    if (next.leftId == null) { next.leftId = id; setFocusedPane("left"); }
    else if (next.rightId == null) { next.rightId = id; setFocusedPane("right"); }
    else next[focusedPane === "left" ? "leftId" : "rightId"] = id;
    setSplit(next);
    setActiveId(id);
  }

  function closeSession(id) {
    const remainingOrder = tabOrder.filter((x) => x !== id);
    setTabOrder(remainingOrder);
    setSessions((s) => s.filter((x) => x.id !== id));
    delete termSenders.current[id];
    if (split && (split.leftId === id || split.rightId === id)) {
      const next = { ...split };
      if (next.leftId === id) next.leftId = null;
      if (next.rightId === id) next.rightId = null;
      if (next.leftId == null && next.rightId == null) {
        setSplit(null);
        setActiveId(remainingOrder.length ? remainingOrder[remainingOrder.length - 1] : null);
      } else {
        setSplit(next);
        if (activeId === id) {
          const survivor = next.leftId ?? next.rightId;
          setActiveId(survivor);
          setFocusedPane(next.leftId != null ? "left" : "right");
        }
      }
    } else if (activeId === id) {
      setActiveId(remainingOrder.length ? remainingOrder[remainingOrder.length - 1] : null);
    }
  }

  function setStatus(id, status) {
    setSessions((s) =>
      s.map((x) => x.id === id
        ? { ...x, status, connectedAt: status === "connected" ? x.connectedAt || Date.now() : x.connectedAt }
        : x
      )
    );
    if (status === "connected") refreshData();
  }

  function setStats(id, stats) {
    setSessions((s) => s.map((x) => (x.id === id ? { ...x, stats } : x)));
  }

  function reorderTabs(fromIdx, toIdx) {
    setTabOrder((o) => {
      const arr = [...o];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }

  function handleSplitDrop(id, side) {
    setSplitHint(null);
    const next = split ? { ...split } : { leftId: null, rightId: null };
    if (next.leftId === id) next.leftId = null;
    if (next.rightId === id) next.rightId = null;
    next[side === "left" ? "leftId" : "rightId"] = id;
    setSplit(next);
    setFocusedPane(side);
    setActiveId(id);
  }

  function exitSplit() {
    setSplit(null);
    if (activeId == null && tabOrder.length) setActiveId(tabOrder[tabOrder.length - 1]);
  }

  function sendSnippet(command) {
    const fn = termSenders.current[activeId];
    if (fn) fn(command + "\r");
  }

  const visibleIds = split
    ? new Set([split.leftId, split.rightId].filter((x) => x != null))
    : new Set(activeId != null ? [activeId] : []);

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
            <button className={showSnippets ? "btn btn-ghost btn-active" : "btn btn-ghost"} onClick={() => setShowSnippets((s) => !s)}>Snippets</button>
            <button className="btn btn-ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light" : "Dark"}</button>
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
            <button className="btn btn-ghost" onClick={handleLock}>Lock</button>
          </div>
        )}
      </header>

      {!vault.unlocked ? (
        <UnlockScreen setUp={vault.setUp} onSubmit={handleUnlock} error={error} />
      ) : (
        <div className="layout">
          <Sidebar hosts={hosts} folders={folders} connectedHostIds={connectedHostIds} onOpen={openSession} onChanged={refreshData} version={version} width={sbWidth} />
          <div className="sb-resizer" onPointerDown={startSbResize} />
          <main className="main-col">
            {sessions.length > 0 && (
              <TabBar
                sessions={sessions} tabOrder={tabOrder} activeId={activeId}
                visibleIds={visibleIds} split={!!split} workspaceRef={workspaceRef}
                onSelect={selectTab} onClose={closeSession} onReorder={reorderTabs}
                onSplitHint={setSplitHint} onSplitDrop={handleSplitDrop} onExitSplit={exitSplit}
              />
            )}
            <div ref={workspaceRef} className={split ? "workspace split" : "workspace"}>
              {splitHint && (
                <div className="split-overlay">
                  <div className={splitHint === "left" ? "half active" : "half"}>Drop left</div>
                  <div className={splitHint === "right" ? "half active" : "half"}>Drop right</div>
                </div>
              )}
              {split && split.leftId == null && <div className="pane pane-placeholder" style={{ order: 0 }}>Drag a tab here</div>}
              {split && split.rightId == null && <div className="pane pane-placeholder" style={{ order: 1 }}>Drag a tab here</div>}
              {sessions.map((s) => {
                const isVisible = visibleIds.has(s.id);
                const paneOrder = split && s.id === split.rightId ? 1 : 0;
                const isFocusedPane = split && isVisible && (focusedPane === "left" ? split.leftId : split.rightId) === s.id;
                return (
                  <div
                    key={s.id}
                    className={"session" + (split && isVisible ? " pane" : "") + (isFocusedPane ? " pane-focused" : "")}
                    style={{ display: isVisible ? "flex" : "none", order: paneOrder }}
                    onPointerDown={() => {
                      if (split && isVisible) {
                        setFocusedPane(s.id === split.rightId ? "right" : "left");
                        setActiveId(s.id);
                      }
                    }}
                  >
                    <SshTerminal
                      hostId={s.host.id} visible={isVisible} dark={theme === "dark"}
                      onStatus={(status) => setStatus(s.id, status)}
                      onStats={(st) => setStats(s.id, st)}
                      onReady={(fn) => { termSenders.current[s.id] = fn; }}
                    />
                  </div>
                );
              })}
              {sessions.length === 0 && <RecentHosts hosts={hosts} onOpen={openSession} />}
            </div>
            <StatusBar session={sessions.find((s) => s.id === activeId)} />
          </main>
          {showSnippets && <div className="sb-resizer" onPointerDown={startSnResize} />}
          {showSnippets && (
            <SnippetPanel
              width={snWidth}
              snippets={snippets}
              onChanged={refreshSnippets}
              onSend={sendSnippet}
              hasActive={activeId != null}
            />
          )}
        </div>
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onRefresh={() => { refreshData(); refreshSnippets(); }}
          onWiped={() => {
            setSessions([]); setTabOrder([]); setActiveId(null);
            setSplit(null); setShowSettings(false); setShowSnippets(false);
            setVault({ setUp: false, unlocked: false });
            setHosts([]); setFolders([]); setSnippets([]);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Snippet panel ---------- */
function SnippetPanel({ snippets, onChanged, onSend, hasActive, width }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");

  function startAdd() { setEditing(null); setName(""); setCommand(""); setShowForm(true); }
  function startEdit(s) { setEditing(s); setName(s.name); setCommand(s.command); setShowForm(true); }

  async function save() {
    if (!name.trim() || !command.trim()) return;
    if (editing) await api.updateSnippet(editing.id, { name: name.trim(), command: command.trim() });
    else await api.addSnippet({ name: name.trim(), command: command.trim() });
    setShowForm(false);
    onChanged();
  }

  return (
    <aside className="snippet-panel" style={{ width }}>
      <div className="snippet-head">
        <span>Snippets</span>
        <button className="btn btn-small" onClick={startAdd}>+ Add</button>
      </div>

      {showForm && (
        <div className="snippet-form">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <textarea className="snippet-textarea" placeholder="Command" value={command} onChange={(e) => setCommand(e.target.value)} rows={3} />
          <div className="snippet-form-btns">
            <button className="btn btn-small" onClick={save}>Save</button>
            <button className="btn btn-small btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="snippet-list">
        {snippets.map((s) => (
          <li key={s.id} className={"snippet-item" + (hasActive ? "" : " disabled")}>
            <div
              className="snippet-name"
              title={hasActive ? "Click to run in active terminal" : "Open a session first"}
              onClick={() => hasActive && onSend(s.command + "\r")}
            >
              {s.name}
            </div>
            <div className="snippet-cmd">{s.command}</div>
            <div className="snippet-actions">
              <button onClick={() => startEdit(s)}>Edit</button>
              <button onClick={async () => {
                if (confirm(`Delete "${s.name}"?`)) { await api.deleteSnippet(s.id); onChanged(); }
              }}>Delete</button>
            </div>
          </li>
        ))}
        {snippets.length === 0 && !showForm && <li className="muted small pad">No snippets yet.</li>}
      </ul>
    </aside>
  );
}

/* ---------- Recent connections ---------- */
function RecentHosts({ hosts, onOpen }) {
  const recent = hosts
    .filter((h) => h.last_connected_at)
    .sort((a, b) => b.last_connected_at.localeCompare(a.last_connected_at))
    .slice(0, 6);

  if (recent.length === 0) {
    return <div className="center-screen muted">Click a host on the left to open a session.</div>;
  }

  return (
    <div className="center-screen">
      <div className="recent-wrap">
        <div className="recent-title muted">Recent connections</div>
        <div className="recent-grid">
          {recent.map((h) => (
            <button key={h.id} className="recent-card" onClick={() => onOpen(h)}>
              <span className="recent-name">{h.name}{!!h.favorite && <span className="star-badge">★</span>}</span>
              <span className="recent-meta muted">{h.username ? `${h.username}@` : ""}{h.hostname}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Status bar ---------- */
function StatusBar({ session }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!session || session.status !== "connected") return null;
  const st = session.stats;
  const gb = (b) => (b / 1024 ** 3).toFixed(1);
  const dur = session.connectedAt ? Math.floor((Date.now() - session.connectedAt) / 1000) : null;
  const fmtDur = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="statusbar">
      <span className="sb-item"><b>{session.host.name}</b></span>
      <span className="sb-item">user: {st?.user ?? "…"}</span>
      <span className="sb-item">ping: {st?.ping != null ? `${st.ping} ms` : "…"}</span>
      <span className="sb-item">cpu: {st?.cpu != null ? `${st.cpu.toFixed(0)}%` : "…"}</span>
      <span className="sb-item">ram: {st?.memTotal ? `${gb(st.memUsed)} / ${gb(st.memTotal)} GB` : "…"}</span>
      <span className="sb-item">disk: {st?.diskTotal ? `${gb(st.diskUsed)} / ${gb(st.diskTotal)} GB` : "…"}</span>
      <span className="sb-item">session: {dur != null ? fmtDur(dur) : "…"}</span>
    </div>
  );
}

/* ---------- Tab bar ---------- */
function TabBar({ sessions, tabOrder, activeId, visibleIds, split, workspaceRef, onSelect, onClose, onReorder, onSplitHint, onSplitDrop, onExitSplit }) {
  const refs = useRef({});
  const dragData = useRef(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState(null);

  const ordered = tabOrder.map((id) => sessions.find((s) => s.id === id)).filter(Boolean);

  function onPointerDown(e, id, idx) {
    if (e.button !== 0) return;
    if (e.target.closest(".tab-close")) return;
    const rects = ordered.map((s) => refs.current[s.id].getBoundingClientRect());
    dragData.current = { id, fromIdx: idx, startX: e.clientX, startY: e.clientY, rects, width: rects[idx].width, moved: false, splitSide: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = dragData.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    let splitSide = null;
    const wsRect = workspaceRef.current?.getBoundingClientRect();
    if (wsRect && e.clientY > wsRect.top) {
      splitSide = e.clientX < wsRect.left + wsRect.width / 2 ? "left" : "right";
    }
    d.splitSide = splitSide;
    onSplitHint(splitSide);
    let toIdx = d.fromIdx;
    if (!splitSide) {
      const center = d.rects[d.fromIdx].left + d.width / 2 + dx;
      if (dx > 0) { for (let j = d.fromIdx + 1; j < d.rects.length; j++) { if (center > d.rects[j].left + d.rects[j].width / 2) toIdx = j; } }
      else { for (let j = d.fromIdx - 1; j >= 0; j--) { if (center < d.rects[j].left + d.rects[j].width / 2) toIdx = j; } }
    }
    setDrag({ id: d.id, dx, dy, fromIdx: d.fromIdx, toIdx, width: d.width, splitSide });
  }

  function onPointerUp() {
    const d = dragData.current;
    if (!d) return;
    dragData.current = null;
    onSplitHint(null);
    if (d.moved) {
      suppressClick.current = true;
      if (d.splitSide) onSplitDrop(d.id, d.splitSide);
      else if (drag && drag.toIdx !== drag.fromIdx) onReorder(drag.fromIdx, drag.toIdx);
    }
    setDrag(null);
  }

  function styleFor(idx, s) {
    if (!drag) return undefined;
    if (s.id === drag.id) {
      return { transform: `translate(${drag.dx}px, ${drag.splitSide ? drag.dy : 0}px)`, transition: "none", zIndex: 10, position: "relative", opacity: drag.splitSide ? 0.7 : 1 };
    }
    if (drag.splitSide) return undefined;
    if (drag.toIdx > drag.fromIdx && idx > drag.fromIdx && idx <= drag.toIdx) return { transform: `translateX(${-drag.width}px)` };
    if (drag.toIdx < drag.fromIdx && idx >= drag.toIdx && idx < drag.fromIdx) return { transform: `translateX(${drag.width}px)` };
    return undefined;
  }

  return (
    <div className="tabbar">
      {ordered.map((s, idx) => (
        <div
          key={s.id}
          ref={(el) => (refs.current[s.id] = el)}
          className={s.id === activeId ? "tab active" : visibleIds.has(s.id) ? "tab shown" : "tab"}
          style={styleFor(idx, s)}
          onPointerDown={(e) => onPointerDown(e, s.id, idx)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(s.id); }}
        >
          <span className={`dot dot-${s.status}`} />
          <span className="tab-title">{s.host.name}</span>
          <span className="tab-close" onClick={(e) => { e.stopPropagation(); onClose(s.id); }}>✕</span>
        </div>
      ))}
      {split && <button className="btn btn-small split-exit" onClick={onExitSplit}>Single view</button>}
    </div>
  );
}

function UnlockScreen({ setUp, onSubmit, error }) {
  const [pw, setPw] = useState("");
  return (
    <div className="center-screen">
      <div className="card">
        <h2>{setUp ? "Unlock vault" : "Create master password"}</h2>
        {!setUp && <p className="muted small">This password encrypts all stored credentials. It cannot be recovered or reset — if you lose it, stored passwords are gone.</p>}
        <input type="password" placeholder="Master password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit(pw)} />
        <button className="btn" onClick={() => onSubmit(pw)}>{setUp ? "Unlock" : "Create vault"}</button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

/* ---------- Sidebar ---------- */
function Sidebar({ hosts, folders, connectedHostIds, onOpen, onChanged, version, width }) {
  const [formHost, setFormHost] = useState(undefined);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [filter, setFilter] = useState("");
  const [dragHostId, setDragHostId] = useState(null);
  const [dropTarget, setDropTarget] = useState(undefined);

  const q = filter.trim().toLowerCase();
  const match = (h) => !q || h.name.toLowerCase().includes(q) || h.hostname.toLowerCase().includes(q) || (h.tags || "").toLowerCase().includes(q);
  const byFav = (a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name);
  const ungrouped = hosts.filter((h) => !h.folder_id && match(h)).sort(byFav);

  function toggleFolder(id) {
    setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function addFolder() {
    const name = window.prompt("Folder name:");
    if (name?.trim()) { await api.addFolder(name.trim()); onChanged(); }
  }

  async function dropOn(folderId) {
    const id = dragHostId;
    setDragHostId(null); setDropTarget(undefined);
    if (id == null) return;
    const host = hosts.find((h) => h.id === id);
    if (!host || (host.folder_id ?? null) === folderId) return;
    await api.updateHost(id, { folder_id: folderId });
    onChanged();
  }

  const dropProps = (folderId) => ({
    onDragOver: (e) => { if (dragHostId == null) return; e.preventDefault(); setDropTarget(folderId); },
    onDragLeave: () => setDropTarget(undefined),
    onDrop: (e) => { e.preventDefault(); dropOn(folderId); },
  });

  return (
    <aside className="sidebar" style={{ width }}>
      <div className={"sidebar-head" + (dragHostId != null && dropTarget === null ? " drop-target" : "")} {...dropProps(null)}>
        <span>{dragHostId != null ? "Drop here to unfile" : "Hosts"}</span>
        <div className="sidebar-head-actions">
          <button className="btn btn-small" onClick={addFolder}>+ Folder</button>
          <button className="btn btn-small" onClick={() => setFormHost(formHost === undefined ? null : undefined)}>{formHost !== undefined ? "✕" : "+ Add"}</button>
        </div>
      </div>

      <div className="filter-wrap">
        <input placeholder="Filter by name, host, tag…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {formHost !== undefined && (
        <HostForm host={formHost} folders={folders} onDone={() => { setFormHost(undefined); onChanged(); }} />
      )}

      <ul className="host-list">
        {ungrouped.map((h) => (
          <HostRow key={h.id} host={h} connected={connectedHostIds.has(h.id)} onOpen={onOpen} onEdit={() => setFormHost(h)} onChanged={onChanged} onDragStartHost={setDragHostId} onDragEndHost={() => { setDragHostId(null); setDropTarget(undefined); }} />
        ))}

        {folders.map((f) => {
          const inFolder = hosts.filter((h) => h.folder_id === f.id && match(h)).sort(byFav);
          const isCollapsed = collapsed.has(f.id);
          return (
            <li key={`f${f.id}`} className="folder">
              <div className={"folder-head" + (dropTarget === f.id ? " drop-target" : "")} onClick={() => toggleFolder(f.id)} {...dropProps(f.id)}>
                <span className="chev">{isCollapsed ? "▸" : "▾"}</span>
                <span className="folder-name">{f.name}</span>
                <span className="muted small">({inFolder.length})</span>
                <div className="host-actions">
                  <button onClick={async (e) => { e.stopPropagation(); const name = window.prompt("Rename folder:", f.name); if (name?.trim()) { await api.renameFolder(f.id, name.trim()); onChanged(); } }}>Rename</button>
                  <button onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete folder "${f.name}"? Hosts inside are kept.`)) { await api.deleteFolder(f.id); onChanged(); } }}>Delete</button>
                </div>
              </div>
              {!isCollapsed && (
                <ul className="folder-hosts">
                  {inFolder.map((h) => (
                    <HostRow key={h.id} host={h} connected={connectedHostIds.has(h.id)} onOpen={onOpen} onEdit={() => setFormHost(h)} onChanged={onChanged} onDragStartHost={setDragHostId} onDragEndHost={() => { setDragHostId(null); setDropTarget(undefined); }} />
                  ))}
                  {inFolder.length === 0 && <li className="muted small pad">Empty</li>}
                </ul>
              )}
            </li>
          );
        })}

        {hosts.length === 0 && formHost === undefined && <li className="muted small pad">No hosts yet.</li>}
      </ul>

      <div className="sidebar-foot small">
        <a className="repo-link muted" href="https://github.com/phiil-92/ssh-manager" target="_blank" rel="noopener noreferrer">v{version}</a>
      </div>
    </aside>
  );
}

function HostRow({ host: h, connected, onOpen, onEdit, onChanged, onDragStartHost, onDragEndHost }) {
  const tags = (h.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <li className="host" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStartHost(h.id); }} onDragEnd={onDragEndHost} onClick={() => onOpen(h)}>
      <div className="host-name">
        {connected && <span className="dot dot-connected" />}
        {h.name}
        {!!h.favorite && <span className="star-badge">★</span>}
      </div>
      <div className="host-meta">{h.username ? `${h.username}@` : ""}{h.hostname}:{h.port}</div>
      {tags.length > 0 && <div className="chips">{tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
      <div className="host-actions">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</button>
        <button onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete "${h.name}"?`)) { await api.deleteHost(h.id); onChanged(); } }}>Delete</button>
      </div>
    </li>
  );
}

function HostForm({ host, folders, onDone }) {
  const editing = !!host;
  const [f, setF] = useState({
    name: host?.name || "", hostname: host?.hostname || "", port: host?.port || 22,
    username: host?.username || "", password: "", clearPassword: false,
    folder_id: host?.folder_id || "", tags: host?.tags || "", favorite: host?.favorite ? true : false,
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    try {
      const payload = { ...f, port: Number(f.port) || 22, folder_id: f.folder_id ? Number(f.folder_id) : null };
      if (editing) await api.updateHost(host.id, payload);
      else await api.addHost(payload);
      onDone();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="add-form">
      <input placeholder="Name (e.g. Dev Server)" value={f.name} onChange={set("name")} autoFocus />
      <input placeholder="Hostname / IP" value={f.hostname} onChange={set("hostname")} />
      <input placeholder="Port" type="number" value={f.port} onChange={set("port")} />
      <input placeholder="Username (empty = ask on connect)" value={f.username} onChange={set("username")} />
      <input placeholder={editing && host.has_password ? "Password (empty = keep current)" : "Password (empty = ask on connect)"} type="password" value={f.password} onChange={set("password")} />
      <select value={f.folder_id} onChange={set("folder_id")}>
        <option value="">No folder</option>
        {folders.map((fo) => <option key={fo.id} value={fo.id}>{fo.name}</option>)}
      </select>
      <input placeholder="Tags (comma separated)" value={f.tags} onChange={set("tags")} />
      <label className="small muted checkline">
        <input type="checkbox" checked={f.favorite} onChange={(e) => setF({ ...f, favorite: e.target.checked })} />
        Favourite
      </label>
      {editing && host.has_password && (
        <label className="small muted checkline">
          <input type="checkbox" checked={f.clearPassword} onChange={(e) => setF({ ...f, clearPassword: e.target.checked })} />
          Remove saved password
        </label>
      )}
      <button className="btn" onClick={save}>{editing ? "Save changes" : "Save host"}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function SettingsModal({ onClose, onRefresh, onWiped }) {
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [nw2, setNw2] = useState("");
  const [pwMsg, setPwMsg] = useState(""); const [pwErr, setPwErr] = useState("");
  const [exportPw, setExportPw] = useState(""); const [exportMsg, setExportMsg] = useState(""); const [exportErr, setExportErr] = useState("");
  const [importFile, setImportFile] = useState(null); const [importPw, setImportPw] = useState(""); const [importMsg, setImportMsg] = useState(""); const [importErr, setImportErr] = useState("");

  async function changePw() {
    setPwErr(""); setPwMsg("");
    if (nw !== nw2) return setPwErr("New passwords do not match");
    try { await api.changeMasterPassword(cur, nw); setPwMsg("Password changed. Credentials re-encrypted."); setCur(""); setNw(""); setNw2(""); }
    catch (e) { setPwErr(e.message); }
  }

  async function handleExport() {
    setExportErr(""); setExportMsg("");
    try {
      const blob = await api.exportData(exportPw);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ssh-manager-${Date.now()}.sshm`; a.click();
      URL.revokeObjectURL(url);
      setExportMsg("Export downloaded."); setExportPw("");
    } catch (e) { setExportErr(e.message); }
  }

  async function handleImport() {
    setImportErr(""); setImportMsg("");
    if (!importFile) return setImportErr("Select a file first");
    try {
      const fileData = await importFile.text();
      const result = await api.importData(fileData, importPw);
      setImportMsg(`Imported ${result.imported} hosts (${result.skipped} skipped), ${result.snippetsImported} snippets.`);
      setImportPw(""); setImportFile(null);
      onRefresh();
    } catch (e) { setImportErr(e.message); }
  }

  async function wipe() {
    if (!confirm("Delete ALL hosts, folders, snippets and reset the vault? This cannot be undone.")) return;
    if (!confirm("Really sure? Everything will be gone.")) return;
    await api.wipeAll(); onWiped();
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
        {pwMsg && <p className="success">{pwMsg}</p>}
        {pwErr && <p className="error">{pwErr}</p>}

        <div className="divider" />
        <h3>Export</h3>
        <p className="small muted">Download an encrypted backup of all connections, folders, and snippets. The file is encrypted with your master password - you need it to import.</p>
        <input type="password" placeholder="Confirm master password" value={exportPw} onChange={(e) => setExportPw(e.target.value)} />
        <button className="btn" onClick={handleExport}>Download .sshm file</button>
        {exportMsg && <p className="success">{exportMsg}</p>}
        {exportErr && <p className="error">{exportErr}</p>}

        <div className="divider" />
        <h3>Import</h3>
        <p className="small muted">Import connections from a .sshm export file. Duplicates (same host+port+user) are skipped.</p>
        <label className="file-label">
          <input type="file" accept=".sshm" onChange={(e) => setImportFile(e.target.files[0])} />
          {importFile ? importFile.name : "Choose .sshm file…"}
        </label>
        <input type="password" placeholder="Password used when exporting" value={importPw} onChange={(e) => setImportPw(e.target.value)} />
        <button className="btn" onClick={handleImport}>Import</button>
        {importMsg && <p className="success">{importMsg}</p>}
        {importErr && <p className="error">{importErr}</p>}

        <div className="divider" />
        <h3 className="danger-title">Danger zone</h3>
        <button className="btn btn-danger" onClick={wipe}>Delete ALL saved data</button>
      </div>
    </div>
  );
}
