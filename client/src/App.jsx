import { useEffect, useRef, useState } from "react";
import SshTerminal from "./Terminal.jsx";
import { api } from "./api.js";

// ---------- Color schemes (global UI theme) ----------
const COLOR_SCHEMES = {
  purple: { name: "Purple",     accent: "#3A336B", accentLight: "#8f86d4", tabBase: "#2B2652" },
  blue:   { name: "Ocean Blue", accent: "#1a3a5c", accentLight: "#5b9bd5", tabBase: "#152d47" },
  green:  { name: "Forest",     accent: "#1a3a28", accentLight: "#5bc48d", tabBase: "#142d1f" },
  red:    { name: "Ruby",       accent: "#5c1a24", accentLight: "#d55b6b", tabBase: "#471519" },
  orange: { name: "Sunset",     accent: "#5c3a1a", accentLight: "#d5955b", tabBase: "#472e14" },
  teal:   { name: "Teal",       accent: "#1a3a3a", accentLight: "#5bc4c4", tabBase: "#142d2d" },
  custom: { name: "Custom",     accent: "#3A336B", accentLight: "#8f86d4", tabBase: "#2B2652" },
};

// ---------- Terminal theme presets ----------
const TERMINAL_THEMES = {
  dark: {
    name: "SSH Manager Dark",
    theme: { background:"#16141f", foreground:"#e4e2f0", cursor:"#8f86d4", selectionBackground:"#3A336B" },
  },
  light: {
    name: "SSH Manager Light",
    theme: { background:"#ffffff", foreground:"#26233a", cursor:"#3A336B", selectionBackground:"#c9c3ee" },
  },
  dracula: {
    name: "Dracula",
    theme: { background:"#282a36", foreground:"#f8f8f2", cursor:"#f8f8f2", selectionBackground:"#44475a",
      black:"#21222c", red:"#ff5555", green:"#50fa7b", yellow:"#f1fa8c", blue:"#bd93f9", magenta:"#ff79c6", cyan:"#8be9fd", white:"#f8f8f2",
      brightBlack:"#6272a4", brightRed:"#ff6e6e", brightGreen:"#69ff94", brightYellow:"#ffffa5", brightBlue:"#d6acff", brightMagenta:"#ff92df", brightCyan:"#a4ffff", brightWhite:"#ffffff" },
  },
  nord: {
    name: "Nord",
    theme: { background:"#2e3440", foreground:"#d8dee9", cursor:"#d8dee9", selectionBackground:"#4c566a",
      black:"#3b4252", red:"#bf616a", green:"#a3be8c", yellow:"#ebcb8b", blue:"#81a1c1", magenta:"#b48ead", cyan:"#88c0d0", white:"#e5e9f0",
      brightBlack:"#4c566a", brightRed:"#bf616a", brightGreen:"#a3be8c", brightYellow:"#ebcb8b", brightBlue:"#81a1c1", brightMagenta:"#b48ead", brightCyan:"#8fbcbb", brightWhite:"#eceff4" },
  },
  monokai: {
    name: "Monokai",
    theme: { background:"#272822", foreground:"#f8f8f2", cursor:"#f8f8f2", selectionBackground:"#49483e",
      black:"#272822", red:"#f92672", green:"#a6e22e", yellow:"#f4bf75", blue:"#66d9ef", magenta:"#ae81ff", cyan:"#a1efe4", white:"#f8f8f2",
      brightBlack:"#75715e", brightRed:"#f92672", brightGreen:"#a6e22e", brightYellow:"#f4bf75", brightBlue:"#66d9ef", brightMagenta:"#ae81ff", brightCyan:"#a1efe4", brightWhite:"#f9f8f5" },
  },
  solarized: {
    name: "Solarized Dark",
    theme: { background:"#002b36", foreground:"#839496", cursor:"#839496", selectionBackground:"#073642",
      black:"#073642", red:"#dc322f", green:"#859900", yellow:"#b58900", blue:"#268bd2", magenta:"#d33682", cyan:"#2aa198", white:"#eee8d5",
      brightBlack:"#002b36", brightRed:"#cb4b16", brightGreen:"#586e75", brightYellow:"#657b83", brightBlue:"#839496", brightMagenta:"#6c71c4", brightCyan:"#93a1a1", brightWhite:"#fdf6e3" },
  },
  gruvbox: {
    name: "Gruvbox Dark",
    theme: { background:"#282828", foreground:"#ebdbb2", cursor:"#ebdbb2", selectionBackground:"#3c3836",
      black:"#282828", red:"#cc241d", green:"#98971a", yellow:"#d79921", blue:"#458588", magenta:"#b16286", cyan:"#689d6a", white:"#a89984",
      brightBlack:"#928374", brightRed:"#fb4934", brightGreen:"#b8bb26", brightYellow:"#fabd2f", brightBlue:"#83a598", brightMagenta:"#d3869b", brightCyan:"#8ec07c", brightWhite:"#ebdbb2" },
  },
};

const DEFAULT_CUSTOM_THEME  = { background:"#1a1a2e", foreground:"#eaeaea", cursor:"#ffffff", selectionBackground:"#444466" };
const DEFAULT_CUSTOM_SCHEME = { accent:"#3A336B", accentLight:"#8f86d4", tabBase:"#2B2652" };
const GROUP_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#ec4899","#6b7280"];

function buildDisplayItems(ordered, tabGroups, collapsedGroups) {
  const items = [], seen = new Set();
  for (const session of ordered) {
    if (session.groupId) {
      const group = tabGroups.find((g) => g.id === session.groupId);
      if (group && !seen.has(group.id)) {
        seen.add(group.id);
        items.push({ type:"group-header", group, count: ordered.filter((s)=>s.groupId===group.id).length });
      }
      if (!group || !collapsedGroups.has(session.groupId))
        items.push({ type:"tab", session, group: group||null });
    } else {
      items.push({ type:"tab", session, group:null });
    }
  }
  return items;
}

export default function App() {
  const [vault,           setVault]          = useState(null);
  const [ssoStatus,       setSsoStatus]      = useState(null);
  const [hosts,           setHosts]          = useState([]);
  const [folders,         setFolders]        = useState([]);
  const [snippets,        setSnippets]       = useState([]);
  const [snippetFolders,  setSnippetFolders] = useState([]);
  const [sessions,        setSessions]       = useState([]);
  const [tabOrder,        setTabOrder]       = useState([]);
  const [activeId,        setActiveId]       = useState(null);
  const [split,           setSplit]          = useState(null);
  const [focusedPane,     setFocusedPane]    = useState("left");
  const [splitHint,       setSplitHint]      = useState(null);
  const [tabGroups,       setTabGroups]      = useState([]);
  const [collapsedGroups, setCollapsedGroups]= useState(() => new Set());
  const [groupMenu,       setGroupMenu]      = useState(null);
  const [notification,    setNotification]   = useState(null);
  const [showSnippets,    setShowSnippets]   = useState(false);
  const [showSettings,    setShowSettings]   = useState(false);
  const [theme,           setTheme]          = useState(() => localStorage.getItem("theme") || "dark");
  const [colorSchemeId,   setColorSchemeId]  = useState(() => localStorage.getItem("colorSchemeId") || "purple");
  const [customScheme,    setCustomScheme]   = useState(() => { try { return JSON.parse(localStorage.getItem("customScheme")||"null") || DEFAULT_CUSTOM_SCHEME; } catch { return DEFAULT_CUSTOM_SCHEME; } });
  const [sbWidth,         setSbWidth]        = useState(() => Number(localStorage.getItem("sbWidth")) || 260);
  const [snWidth,         setSnWidth]        = useState(() => Number(localStorage.getItem("snWidth")) || 260);
  const [version,         setVersion]        = useState("");
  const [error,           setError]          = useState("");
  const [requires2fa,     setRequires2fa]    = useState(false);
  const [pendingPassword, setPendingPassword]= useState("");
  const [twoFAEnabled,    setTwoFAEnabled]   = useState(false);
  const [termThemeId,     setTermThemeId]    = useState(() => localStorage.getItem("termThemeId") || "dark");
  const [customTermTheme, setCustomTermTheme]= useState(() => { try { return JSON.parse(localStorage.getItem("customTermTheme")||"null") || DEFAULT_CUSTOM_THEME; } catch { return DEFAULT_CUSTOM_THEME; } });
  const [sessionLogs,     setSessionLogs]    = useState({});
  const [loggingEnabled,  setLoggingEnabled] = useState(() => new Set());

  const nextId       = useRef(1);
  const workspaceRef = useRef(null);
  const termSenders  = useRef({});
  const isLoggingIn  = useRef(false);

  // ---------- Init ----------
  useEffect(() => {
    api.authStatus().then((sso) => {
      setSsoStatus(sso);
      if (!sso.ssoEnabled || sso.ssoAuthenticated) {
        api.vaultStatus().then((v) => {
          setVault(v);
          if (v.twoFAEnabled !== undefined) setTwoFAEnabled(v.twoFAEnabled);
          if (v.unlocked) { refreshData(); refreshSnippets(); }
        }).catch((e) => setError(e.message));
      }
    }).catch((e) => setError(e.message));
    fetch("/api/version").then((r)=>r.json()).then((d)=>setVersion(d.version));
  }, []);

  // ---------- Theme effects ----------
  useEffect(() => { localStorage.setItem("theme", theme); document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    const scheme = colorSchemeId === "custom" ? customScheme : (COLOR_SCHEMES[colorSchemeId] || COLOR_SCHEMES.purple);
    document.documentElement.style.setProperty("--accent",       scheme.accent);
    document.documentElement.style.setProperty("--accent-light", scheme.accentLight);
    document.documentElement.style.setProperty("--tab-base",     scheme.tabBase);
    localStorage.setItem("colorSchemeId", colorSchemeId);
  }, [colorSchemeId, customScheme]);

  useEffect(() => { localStorage.setItem("customScheme", JSON.stringify(customScheme)); }, [customScheme]);
  useEffect(() => { localStorage.setItem("sbWidth", String(sbWidth)); }, [sbWidth]);
  useEffect(() => { localStorage.setItem("snWidth", String(snWidth)); }, [snWidth]);
  useEffect(() => { localStorage.setItem("termThemeId", termThemeId); }, [termThemeId]);
  useEffect(() => { localStorage.setItem("customTermTheme", JSON.stringify(customTermTheme)); }, [customTermTheme]);

  // ---------- Vault-locked listener ----------
  useEffect(() => {
    function handleVaultLocked() {
      if (isLoggingIn.current) return;
      setSessions([]); setTabOrder([]); setActiveId(null); setSplit(null);
      setShowSettings(false); setShowSnippets(false);
      setHosts([]); setFolders([]); setSnippets([]); setSnippetFolders([]);
      setTabGroups([]); setCollapsedGroups(new Set());
      setVault((v) => v ? { ...v, unlocked: false } : v);
      setNotification({ msg: "Session expired — please unlock again.", type: "error" });
      setTimeout(() => setNotification(null), 3000);
    }
    window.addEventListener("vault-locked", handleVaultLocked);
    return () => window.removeEventListener("vault-locked", handleVaultLocked);
  }, []);

  const currentTermTheme = termThemeId === "custom"
    ? customTermTheme
    : (TERMINAL_THEMES[termThemeId]?.theme || TERMINAL_THEMES.dark.theme);

  function startSbResize(e) {
    e.preventDefault(); const sx=e.clientX, sw=sbWidth;
    const mv=(ev)=>setSbWidth(Math.min(500,Math.max(180,sw+ev.clientX-sx)));
    const up=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up);};
    window.addEventListener("pointermove",mv); window.addEventListener("pointerup",up);
  }
  function startSnResize(e) {
    e.preventDefault(); const sx=e.clientX, sw=snWidth;
    const mv=(ev)=>setSnWidth(Math.min(600,Math.max(180,sw-(ev.clientX-sx))));
    const up=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up);};
    window.addEventListener("pointermove",mv); window.addEventListener("pointerup",up);
  }

  async function refreshData()    { setHosts(await api.listHosts()); setFolders(await api.listFolders()); }
  async function refreshSnippets(){ setSnippets(await api.listSnippets()); setSnippetFolders(await api.listSnippetFolders()); }

  function notify(msg, type="info") { setNotification({ msg, type }); setTimeout(() => setNotification(null), 3000); }

  async function handleUnlock(password) {
    isLoggingIn.current = true; setError("");
    try {
      if (!vault.setUp) {
        await api.vaultSetup(password);
        setVault({ setUp:true, unlocked:true });
        await refreshData(); await refreshSnippets(); return;
      }
      const result = await api.vaultUnlock(password, null);
      if (result.requires2fa) { setPendingPassword(password); setRequires2fa(true); return; }
      setVault({ setUp:true, unlocked:true });
      await refreshData(); await refreshSnippets();
    } catch (e) { setError(e.message); }
    finally { isLoggingIn.current = false; }
  }

  async function handle2FA(token) {
    isLoggingIn.current = true; setError("");
    try {
      await api.vaultUnlock(pendingPassword, token);
      setPendingPassword(""); setRequires2fa(false);
      setVault({ setUp:true, unlocked:true });
      await refreshData(); await refreshSnippets();
    } catch (e) { setError(e.message); }
    finally { isLoggingIn.current = false; }
  }

  async function handleLock() {
    await api.vaultLock();
    api.setVaultLockedSuppressed(false);
    setSessions([]); setTabOrder([]); setActiveId(null); setSplit(null);
    setTabGroups([]); setCollapsedGroups(new Set());
    setRequires2fa(false); setPendingPassword("");
    setShowSettings(false); setShowSnippets(false);
    setVault({ ...vault, unlocked:false });
  }

  function createGroup(name, color) { const id=Date.now(); setTabGroups((p)=>[...p,{id,name,color}]); return id; }
  function assignToGroup(sid, gid)  { setSessions((p)=>p.map((s)=>s.id===sid?{...s,groupId:gid}:s)); }
  function removeFromGroup(sid)     { setSessions((p)=>p.map((s)=>s.id===sid?{...s,groupId:null}:s)); }
  function deleteGroup(gid) {
    setTabGroups((p)=>p.filter((g)=>g.id!==gid));
    setSessions((p)=>p.map((s)=>s.groupId===gid?{...s,groupId:null}:s));
    setCollapsedGroups((p)=>{ const n=new Set(p); n.delete(gid); return n; });
  }
  function toggleGroupCollapse(gid) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(gid)) { n.delete(gid); }
      else {
        n.add(gid);
        const ids = sessions.filter((s)=>s.groupId===gid).map((s)=>s.id);
        if (ids.includes(activeId)) { const other=tabOrder.find((id)=>!ids.includes(id)); setActiveId(other??null); }
      }
      return n;
    });
  }

  function openSession(host) {
    const id = nextId.current++;
    setSessions((s)=>[...s,{id,host,status:"connecting",groupId:null}]);
    setTabOrder((o)=>[...o,id]);
    if (split) {
      if (split.leftId==null)       { setSplit({...split,leftId:id});  setFocusedPane("left");  }
      else if (split.rightId==null) { setSplit({...split,rightId:id}); setFocusedPane("right"); }
      else setSplit({...split,[focusedPane==="left"?"leftId":"rightId"]:id});
    }
    setActiveId(id);
  }

  function selectTab(id) {
    if (!split) return setActiveId(id);
    if (split.leftId===id)  { setFocusedPane("left");  setActiveId(id); return; }
    if (split.rightId===id) { setFocusedPane("right"); setActiveId(id); return; }
    const next={...split};
    if      (next.leftId==null)  { next.leftId=id;  setFocusedPane("left");  }
    else if (next.rightId==null) { next.rightId=id; setFocusedPane("right"); }
    else next[focusedPane==="left"?"leftId":"rightId"]=id;
    setSplit(next); setActiveId(id);
  }

  function closeSession(id) {
    const remaining = tabOrder.filter((x)=>x!==id);
    setTabOrder(remaining); setSessions((s)=>s.filter((x)=>x.id!==id));
    delete termSenders.current[id];
    setSessionLogs((p)=>{ const n={...p}; delete n[id]; return n; });
    setLoggingEnabled((p)=>{ const n=new Set(p); n.delete(id); return n; });
    if (split&&(split.leftId===id||split.rightId===id)) {
      const next={...split};
      if (next.leftId===id)  next.leftId=null;
      if (next.rightId===id) next.rightId=null;
      if (next.leftId==null&&next.rightId==null) {
        setSplit(null); setActiveId(remaining.length?remaining[remaining.length-1]:null);
      } else {
        setSplit(next);
        if (activeId===id) { const sv=next.leftId??next.rightId; setActiveId(sv); setFocusedPane(next.leftId!=null?"left":"right"); }
      }
    } else if (activeId===id) {
      setActiveId(remaining.length?remaining[remaining.length-1]:null);
    }
  }

  function setStatus(id, status) {
    setSessions((s)=>s.map((x)=>x.id===id?{...x,status,connectedAt:status==="connected"?x.connectedAt||Date.now():x.connectedAt}:x));
    if (status==="connected") refreshData();
  }
  function setStats(id, stats) { setSessions((s)=>s.map((x)=>x.id===id?{...x,stats}:x)); }

  function reorderTabs(fromIdx, toIdx) {
    setTabOrder((o)=>{ const a=[...o]; const [m]=a.splice(fromIdx,1); a.splice(toIdx,0,m); return a; });
  }

  function handleSplitDrop(id, side) {
    setSplitHint(null);
    const next=split?{...split}:{leftId:null,rightId:null};
    if (next.leftId===id) next.leftId=null;
    if (next.rightId===id) next.rightId=null;
    next[side==="left"?"leftId":"rightId"]=id;
    setSplit(next); setFocusedPane(side); setActiveId(id);
  }

  function exitSplit() { setSplit(null); if(activeId==null&&tabOrder.length) setActiveId(tabOrder[tabOrder.length-1]); }
  function sendSnippet(command) { const fn=termSenders.current[activeId]; if(fn) fn(command+"\r"); }

  function handleOutput(sessionId, data) {
    if (loggingEnabled.has(sessionId)) setSessionLogs((p)=>({...p,[sessionId]:(p[sessionId]||"")+data}));
  }
  function toggleLogging(id) { setLoggingEnabled((p)=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; }); }
  function downloadLog(id) {
    const log=sessionLogs[id]||"";
    const s=sessions.find((x)=>x.id===id);
    const filename=`${s?.host.hostname||"session"}-${new Date().toISOString().replace(/[:.]/g,"-")}.log`;
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([log],{type:"text/plain"}));
    a.download=filename; a.click(); URL.revokeObjectURL(a.href);
  }

  const visibleIds       = split ? new Set([split.leftId,split.rightId].filter((x)=>x!=null)) : new Set(activeId!=null?[activeId]:[]);
  const connectedHostIds = new Set(sessions.filter((s)=>s.status==="connected").map((s)=>s.host.id));
  const activeSession    = sessions.find((s)=>s.id===activeId);

  // ---------- SSO gate ----------
  if (ssoStatus?.ssoEnabled && !ssoStatus?.ssoAuthenticated) {
    return (
      <div className="app">
        <header className="topbar"><span className="logo">SSH Manager</span></header>
        <div className="center-screen">
          <div className="card">
            <h2>SSH Manager</h2>
            <p className="muted small">This instance requires authentication via your organisation's SSO provider.</p>
            <a href="/auth/login" className="btn" style={{ textAlign:"center", textDecoration:"none" }}>Sign in with SSO</a>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!vault) return <div className="center-screen">Loading…</div>;

  return (
    <div className="app" onClick={()=>groupMenu&&setGroupMenu(null)}>
      <header className="topbar">
        <span className="logo">SSH Manager</span>
        {vault.unlocked && (
          <div className="topbar-actions">
            {ssoStatus?.ssoEnabled && ssoStatus?.ssoUser && (
              <span className="sso-user muted small">{ssoStatus.ssoUser.name}</span>
            )}
            <button className={showSnippets?"btn btn-ghost btn-active":"btn btn-ghost"} onClick={()=>setShowSnippets((v)=>!v)}>Snippets</button>
            <button className="btn btn-ghost" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>{theme==="dark"?"Light":"Dark"}</button>
            <button className="btn btn-ghost" onClick={()=>{ api.setVaultLockedSuppressed(true); setShowSettings(true); }}>⚙</button>
            {ssoStatus?.ssoEnabled
              ? <a href="/auth/logout" className="btn btn-ghost" style={{textDecoration:"none"}}>Sign out</a>
              : <button className="btn btn-ghost" onClick={handleLock}>Lock</button>
            }
          </div>
        )}
      </header>

      {!vault.unlocked ? (
        <UnlockScreen setUp={vault.setUp} onSubmit={handleUnlock} on2FA={handle2FA} requires2fa={requires2fa} error={error} />
      ) : (
        <div className="layout">
          <Sidebar hosts={hosts} folders={folders} connectedHostIds={connectedHostIds} onOpen={openSession} onChanged={refreshData} version={version} width={sbWidth} onNotify={notify} />
          <div className="sb-resizer" onPointerDown={startSbResize} />
          <main className="main-col">
            {sessions.length>0 && (
              <TabBar
                sessions={sessions} tabOrder={tabOrder} activeId={activeId} visibleIds={visibleIds}
                split={!!split} workspaceRef={workspaceRef} tabGroups={tabGroups} collapsedGroups={collapsedGroups}
                onSelect={selectTab} onClose={closeSession} onReorder={reorderTabs}
                onSplitHint={setSplitHint} onSplitDrop={handleSplitDrop} onExitSplit={exitSplit}
                onToggleGroupCollapse={toggleGroupCollapse}
                onGroupContextMenu={(x,y,sid)=>setGroupMenu({x,y,sessionId:sid})}
              />
            )}
            <div ref={workspaceRef} className={split?"workspace split":"workspace"}>
              {splitHint&&(
                <div className="split-overlay">
                  <div className={splitHint==="left"?"half active":"half"}>Drop left</div>
                  <div className={splitHint==="right"?"half active":"half"}>Drop right</div>
                </div>
              )}
              {split&&split.leftId==null&&<div className="pane pane-placeholder" style={{order:0}}>Drag a tab here</div>}
              {split&&split.rightId==null&&<div className="pane pane-placeholder" style={{order:1}}>Drag a tab here</div>}
              {sessions.map((s)=>{
                const isVisible = visibleIds.has(s.id);
                const paneOrder = split&&s.id===split.rightId?1:0;
                const isFocused = split&&isVisible&&(focusedPane==="left"?split.leftId:split.rightId)===s.id;
                return (
                  <div key={s.id}
                    className={"session"+(split&&isVisible?" pane":"")+(isFocused?" pane-focused":"")}
                    style={{display:isVisible?"flex":"none",order:paneOrder}}
                    onPointerDown={()=>{ if(split&&isVisible){setFocusedPane(s.id===split.rightId?"right":"left");setActiveId(s.id);} }}
                  >
                    <SshTerminal
                      hostId={s.host.id} visible={isVisible}
                      termTheme={currentTermTheme}
                      onStatus={(st)=>setStatus(s.id,st)}
                      onStats={(st)=>setStats(s.id,st)}
                      onReady={(fn)=>{termSenders.current[s.id]=fn;}}
                      onOutput={(data)=>handleOutput(s.id,data)}
                    />
                  </div>
                );
              })}
              {sessions.length===0&&<RecentHosts hosts={hosts} onOpen={openSession}/>}
            </div>
            <StatusBar session={activeSession} logging={loggingEnabled.has(activeId)} hasLog={!!(sessionLogs[activeId])} onToggleLog={()=>toggleLogging(activeId)} onDownloadLog={()=>downloadLog(activeId)} />
          </main>
          {showSnippets&&<div className="sb-resizer" onPointerDown={startSnResize}/>}
          {showSnippets&&<SnippetPanel snippets={snippets} folders={snippetFolders} onChanged={refreshSnippets} onSend={sendSnippet} hasActive={activeId!=null} width={snWidth}/>}
        </div>
      )}

      {groupMenu&&(
        <TabGroupContextMenu x={groupMenu.x} y={groupMenu.y}
          session={sessions.find((s)=>s.id===groupMenu.sessionId)} tabGroups={tabGroups}
          onAssign={(gid)=>{assignToGroup(groupMenu.sessionId,gid);setGroupMenu(null);}}
          onRemove={()=>{removeFromGroup(groupMenu.sessionId);setGroupMenu(null);}}
          onCreate={(name,color)=>{const id=createGroup(name,color);assignToGroup(groupMenu.sessionId,id);setGroupMenu(null);}}
          onDeleteGroup={(gid)=>{deleteGroup(gid);setGroupMenu(null);}}
          onClose={()=>setGroupMenu(null)}
        />
      )}

      {notification&&<div className={`toast toast-${notification.type}`}>{notification.msg}</div>}

      {showSettings&&(
        <SettingsModal
          twoFAEnabled={twoFAEnabled}
          termThemeId={termThemeId} customTermTheme={customTermTheme}
          colorSchemeId={colorSchemeId} customScheme={customScheme}
          onTermThemeChange={(id)=>setTermThemeId(id)}
          onCustomTermColor={(k,v)=>setCustomTermTheme((p)=>({...p,[k]:v}))}
          onColorSchemeChange={(id)=>setColorSchemeId(id)}
          onCustomSchemeColor={(k,v)=>setCustomScheme((p)=>({...p,[k]:v}))}
          onClose={()=>{ api.setVaultLockedSuppressed(false); setShowSettings(false); }}
          onRefresh={()=>{ refreshData(); refreshSnippets(); }}
          on2FAChange={(enabled)=>setTwoFAEnabled(enabled)}
          ssoEnabled={ssoStatus?.ssoEnabled}
          onWiped={()=>{
            setSessions([]); setTabOrder([]); setActiveId(null); setSplit(null);
            setTabGroups([]); setCollapsedGroups(new Set());
            setShowSettings(false); setShowSnippets(false);
            setVault({setUp:false,unlocked:false});
            setHosts([]); setFolders([]); setSnippets([]); setSnippetFolders([]);
          }}
        />
      )}
    </div>
  );
}

function UnlockScreen({ setUp, onSubmit, on2FA, requires2fa, error }) {
  const [pw,   setPw]   = useState("");
  const [code, setCode] = useState("");

  if (requires2fa) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Two-Factor Authentication</h2>
          <p className="muted small">Enter the 6-digit code from your authenticator app.</p>
          <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            placeholder="000000" value={code} autoFocus className="totp-input"
            onChange={(e)=>setCode(e.target.value.replace(/\D/g,""))}
            onKeyDown={(e)=>e.key==="Enter"&&on2FA(code)} />
          <button className="btn" onClick={()=>on2FA(code)}>Verify</button>
          {error&&<p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="card">
        <h2>{setUp?"Unlock vault":"Create master password"}</h2>
        {!setUp&&<p className="muted small">This password encrypts all stored credentials and cannot be reset.</p>}
        <input type="password" placeholder="Master password" value={pw} autoFocus
          onChange={(e)=>setPw(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&onSubmit(pw)}/>
        <button className="btn" onClick={()=>onSubmit(pw)}>{setUp?"Unlock":"Create vault"}</button>
        {error&&<p className="error">{error}</p>}
      </div>
    </div>
  );
}

function TabGroupContextMenu({ x, y, session, tabGroups, onAssign, onRemove, onCreate, onDeleteGroup, onClose }) {
  const [showNew,  setShowNew]  = useState(tabGroups.length===0);
  const [newName,  setNewName]  = useState("");
  const [newColor, setNewColor] = useState(GROUP_COLORS[0]);
  const ref = useRef(null);

  useEffect(()=>{ function h(e){ if(ref.current&&!ref.current.contains(e.target)) onClose(); } document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h); },[]);

  const mx=Math.min(x,window.innerWidth-240), my=Math.min(y,window.innerHeight-320);

  return (
    <div ref={ref} className="group-context-menu" style={{left:mx,top:my}} onClick={(e)=>e.stopPropagation()}>
      <div className="group-menu-title">Tab Group</div>
      {session?.groupId&&<button className="group-menu-item" onClick={onRemove}>Remove from group</button>}
      {tabGroups.map((g)=>(
        <div key={g.id} className="group-menu-row">
          <button className={"group-menu-item"+(session?.groupId===g.id?" active-group":"")} onClick={()=>onAssign(g.id)}>
            <span className="group-dot" style={{background:g.color}}/>{g.name}
          </button>
          <button className="group-menu-del" onClick={()=>onDeleteGroup(g.id)}>✕</button>
        </div>
      ))}
      {!showNew&&<button className="group-menu-item group-menu-new" onClick={()=>setShowNew(true)}>+ New group</button>}
      {showNew&&(
        <div className="group-new-form">
          <input autoFocus placeholder="Group name" value={newName} onChange={(e)=>setNewName(e.target.value)}
            onKeyDown={(e)=>{if(e.key==="Enter"&&newName.trim())onCreate(newName.trim(),newColor);if(e.key==="Escape")setShowNew(false);}}/>
          <div className="color-picker">{GROUP_COLORS.map((c)=>(<div key={c} className={"color-swatch"+(newColor===c?" selected":"")} style={{background:c}} onClick={()=>setNewColor(c)}/>))}</div>
          <button className="btn btn-small" onClick={()=>{if(newName.trim())onCreate(newName.trim(),newColor);}}>Create</button>
        </div>
      )}
    </div>
  );
}

function TabBar({ sessions, tabOrder, activeId, visibleIds, split, workspaceRef, tabGroups, collapsedGroups,
  onSelect, onClose, onReorder, onSplitHint, onSplitDrop, onExitSplit, onToggleGroupCollapse, onGroupContextMenu }) {
  const refs=useRef({}); const dragData=useRef(null); const suppressClick=useRef(false);
  const [drag, setDrag] = useState(null);
  const ordered      = tabOrder.map((id)=>sessions.find((s)=>s.id===id)).filter(Boolean);
  const displayItems = buildDisplayItems(ordered, tabGroups, collapsedGroups);

  function onPointerDown(e, id, idx) {
    if (e.button!==0) return; if (e.target.closest(".tab-close")) return;
    const rects=ordered.map((s)=>refs.current[s.id]?.getBoundingClientRect()).filter(Boolean);
    if (!rects[idx]) return;
    dragData.current={id,fromIdx:idx,startX:e.clientX,startY:e.clientY,rects,width:rects[idx].width,moved:false,splitSide:null};
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d=dragData.current; if(!d) return;
    const dx=e.clientX-d.startX, dy=e.clientY-d.startY;
    if (!d.moved&&Math.abs(dx)<4&&Math.abs(dy)<4) return;
    d.moved=true;
    let splitSide=null;
    const wsRect=workspaceRef.current?.getBoundingClientRect();
    if (wsRect&&e.clientY>wsRect.top) splitSide=e.clientX<wsRect.left+wsRect.width/2?"left":"right";
    d.splitSide=splitSide; onSplitHint(splitSide);
    let toIdx=d.fromIdx;
    if (!splitSide) {
      const center=d.rects[d.fromIdx].left+d.width/2+dx;
      if(dx>0){for(let j=d.fromIdx+1;j<d.rects.length;j++){if(center>d.rects[j].left+d.rects[j].width/2)toIdx=j;}}
      else    {for(let j=d.fromIdx-1;j>=0;j--)            {if(center<d.rects[j].left+d.rects[j].width/2)toIdx=j;}}
    }
    setDrag({id:d.id,dx,dy,fromIdx:d.fromIdx,toIdx,width:d.width,splitSide});
  }

  function onPointerUp() {
    const d=dragData.current; if(!d) return;
    dragData.current=null; onSplitHint(null);
    if (d.moved) { suppressClick.current=true; if(d.splitSide) onSplitDrop(d.id,d.splitSide); else if(drag&&drag.toIdx!==drag.fromIdx) onReorder(drag.fromIdx,drag.toIdx); }
    setDrag(null);
  }

  function styleFor(idx, s) {
    if (!drag) return undefined;
    if (s.id===drag.id) return {transform:`translate(${drag.dx}px,${drag.splitSide?drag.dy:0}px)`,transition:"none",zIndex:10,position:"relative",opacity:drag.splitSide?0.7:1};
    if (drag.splitSide) return undefined;
    if (drag.toIdx>drag.fromIdx&&idx>drag.fromIdx&&idx<=drag.toIdx) return {transform:`translateX(${-drag.width}px)`};
    if (drag.toIdx<drag.fromIdx&&idx>=drag.toIdx&&idx<drag.fromIdx) return {transform:`translateX(${drag.width}px)`};
    return undefined;
  }

  return (
    <div className="tabbar">
      {displayItems.map((item)=>{
        if (item.type==="group-header") {
          const {group,count}=item; const collapsed=collapsedGroups.has(group.id);
          return (
            <div key={`gh-${group.id}`} className="tab-group-header" onClick={()=>onToggleGroupCollapse(group.id)}>
              <span className="group-header-dot" style={{background:group.color}}/>
              <span className="group-header-name">{group.name}</span>
              {collapsed&&<span className="group-header-count">{count}</span>}
              <span className="group-header-chev">{collapsed?"▸":"▾"}</span>
            </div>
          );
        }
        const {session:s,group}=item; const orderedIdx=ordered.findIndex((o)=>o.id===s.id);
        return (
          <div key={s.id} ref={(el)=>(refs.current[s.id]=el)}
            className={"tab"+(s.id===activeId?" active":visibleIds.has(s.id)?" shown":"")+(group?" grouped":"")}
            style={{...styleFor(orderedIdx,s),...(group?{borderBottom:`2px solid ${group.color}`}:{})}}
            onPointerDown={(e)=>onPointerDown(e,s.id,orderedIdx)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onContextMenu={(e)=>{e.preventDefault();onGroupContextMenu(e.clientX,e.clientY,s.id);}}
            onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}onSelect(s.id);}}
          >
            <span className={`dot dot-${s.status}`}/>
            <span className="tab-title">{s.host.name}</span>
            <span className="tab-close" onClick={(e)=>{e.stopPropagation();onClose(s.id);}}>✕</span>
          </div>
        );
      })}
      {split&&<button className="btn btn-small split-exit" onClick={onExitSplit}>Single view</button>}
    </div>
  );
}

function Sidebar({ hosts, folders, connectedHostIds, onOpen, onChanged, version, width, onNotify }) {
  const [formHost,   setFormHost]   = useState(undefined);
  const [collapsed,  setCollapsed]  = useState(()=>new Set());
  const [filter,     setFilter]     = useState("");
  const [dragHostId, setDragHostId] = useState(null);
  const [dropTarget, setDropTarget] = useState(undefined);

  const q     = filter.trim().toLowerCase();
  const match = (h)=>!q||h.name.toLowerCase().includes(q)||h.hostname.toLowerCase().includes(q)||(h.tags||"").toLowerCase().includes(q)||(h.notes||"").toLowerCase().includes(q);
  const byFav = (a,b)=>(b.favorite-a.favorite)||a.name.localeCompare(b.name);
  const ungrouped = hosts.filter((h)=>!h.folder_id&&match(h)).sort(byFav);

  function toggleFolder(id){setCollapsed((c)=>{const n=new Set(c);n.has(id)?n.delete(id):n.add(id);return n;});}
  async function addFolder(){const name=window.prompt("Folder name:");if(name?.trim()){await api.addFolder(name.trim());onChanged();}}

  async function dropOn(folderId){
    const id=dragHostId; setDragHostId(null); setDropTarget(undefined);
    if(id==null) return; const host=hosts.find((h)=>h.id===id);
    if(!host||(host.folder_id??null)===folderId) return;
    await api.updateHost(id,{folder_id:folderId}); onChanged();
  }

  const dropProps=(folderId)=>({
    onDragOver:(e)=>{if(dragHostId==null)return;e.preventDefault();setDropTarget(folderId);},
    onDragLeave:()=>setDropTarget(undefined),
    onDrop:(e)=>{e.preventDefault();dropOn(folderId);},
  });

  return (
    <aside className="sidebar" style={{width}}>
      <div className={"sidebar-head"+(dragHostId!=null&&dropTarget===null?" drop-target":"")} {...dropProps(null)}>
        <span>{dragHostId!=null?"Drop here to unfile":"Hosts"}</span>
        <div className="sidebar-head-actions">
          <button className="btn btn-small" onClick={addFolder}>+ Folder</button>
          <button className="btn btn-small" onClick={()=>setFormHost(formHost===undefined?null:undefined)}>{formHost!==undefined?"✕":"+ Add"}</button>
        </div>
      </div>
      <div className="filter-wrap"><input placeholder="Filter by name, host, tag, notes…" value={filter} onChange={(e)=>setFilter(e.target.value)}/></div>
      {formHost!==undefined&&<HostForm host={formHost} folders={folders} onDone={()=>{setFormHost(undefined);onChanged();}}/>}
      <ul className="host-list">
        {ungrouped.map((h)=>(<HostRow key={h.id} host={h} connected={connectedHostIds.has(h.id)} onOpen={onOpen} onEdit={()=>setFormHost(h)} onChanged={onChanged} onNotify={onNotify} onDragStartHost={setDragHostId} onDragEndHost={()=>{setDragHostId(null);setDropTarget(undefined);}}/>))}
        {folders.map((f)=>{
          const inFolder=hosts.filter((h)=>h.folder_id===f.id&&match(h)).sort(byFav); const isCollapsed=collapsed.has(f.id);
          return (
            <li key={`f${f.id}`} className="folder">
              <div className={"folder-head"+(dropTarget===f.id?" drop-target":"")} onClick={()=>toggleFolder(f.id)} {...dropProps(f.id)}>
                <span className="chev">{isCollapsed?"▸":"▾"}</span><span className="folder-name">{f.name}</span><span className="muted small">({inFolder.length})</span>
                <div className="host-actions">
                  <button onClick={async(e)=>{e.stopPropagation();const name=window.prompt("Rename folder:",f.name);if(name?.trim()){await api.renameFolder(f.id,name.trim());onChanged();}}}>Rename</button>
                  <button onClick={async(e)=>{e.stopPropagation();if(confirm(`Delete folder "${f.name}"? Hosts inside are kept.`)){await api.deleteFolder(f.id);onChanged();}}}>Delete</button>
                </div>
              </div>
              {!isCollapsed&&(<ul className="folder-hosts">
                {inFolder.map((h)=>(<HostRow key={h.id} host={h} connected={connectedHostIds.has(h.id)} onOpen={onOpen} onEdit={()=>setFormHost(h)} onChanged={onChanged} onNotify={onNotify} onDragStartHost={setDragHostId} onDragEndHost={()=>{setDragHostId(null);setDropTarget(undefined);}}/>))}
                {inFolder.length===0&&<li className="muted small pad">Empty</li>}
              </ul>)}
            </li>
          );
        })}
        {hosts.length===0&&formHost===undefined&&<li className="muted small pad">No hosts yet.</li>}
      </ul>
      <div className="sidebar-foot small"><a className="repo-link muted" href="https://github.com/phiil-92/ssh-manager" target="_blank" rel="noopener noreferrer">v{version}</a></div>
    </aside>
  );
}

function HostRow({ host:h, connected, onOpen, onEdit, onChanged, onNotify, onDragStartHost, onDragEndHost }) {
  const [showNotes, setShowNotes] = useState(false);
  const tags = (h.tags||"").split(",").map((t)=>t.trim()).filter(Boolean);
  return (
    <li className="host" draggable onDragStart={(e)=>{e.dataTransfer.effectAllowed="move";onDragStartHost(h.id);}} onDragEnd={onDragEndHost} onClick={()=>onOpen(h)}>
      <div className="host-name">
        {connected&&<span className="dot dot-connected"/>}
        {h.name}
        {!!h.favorite&&<span className="star-badge">★</span>}
        {h.auth_type==="key"&&<span className="auth-badge" title="SSH key auth">🔑</span>}
        {h.notes&&<button className="notes-btn" title="Notes" onClick={(e)=>{e.stopPropagation();setShowNotes((v)=>!v);}}>ℹ</button>}
      </div>
      <div className="host-meta">{h.username?`${h.username}@`:""}{h.hostname}:{h.port}</div>
      {showNotes&&h.notes&&<div className="host-notes">{h.notes}</div>}
      {tags.length>0&&<div className="chips">{tags.map((t)=><span key={t} className="chip">{t}</span>)}</div>}
      <div className="host-actions">
        {h.mac_address&&(<button title="Wake on LAN" onClick={async(e)=>{e.stopPropagation();try{await api.wakeOnLan(h.id);onNotify?.(`⚡ WOL sent to ${h.name}`);}catch(err){onNotify?.(`WOL failed: ${err.message}`,"error");}}}>⚡</button>)}
        <button onClick={(e)=>{e.stopPropagation();onEdit();}}>Edit</button>
        <button onClick={async(e)=>{e.stopPropagation();if(confirm(`Delete "${h.name}"?`)){await api.deleteHost(h.id);onChanged();}}}>Delete</button>
      </div>
    </li>
  );
}

function HostForm({ host, folders, onDone }) {
  const editing = !!host;
  const [f, setF] = useState({
    name:host?.name||"", hostname:host?.hostname||"", port:host?.port||22, username:host?.username||"",
    password:"", clearPassword:false, auth_type:host?.auth_type||"password", private_key:"", key_passphrase:"", clearKey:false,
    folder_id:host?.folder_id||"", tags:host?.tags||"", favorite:host?.favorite?true:false, notes:host?.notes||"", mac_address:host?.mac_address||"",
  });
  const [error, setError] = useState("");
  const set=(k)=>(e)=>setF({...f,[k]:e.target.value});

  async function save() {
    setError("");
    try { const payload={...f,port:Number(f.port)||22,folder_id:f.folder_id?Number(f.folder_id):null}; if(editing) await api.updateHost(host.id,payload); else await api.addHost(payload); onDone(); }
    catch(e){setError(e.message);}
  }

  return (
    <div className="add-form">
      <input placeholder="Name (e.g. Dev Server)" value={f.name} onChange={set("name")} autoFocus/>
      <input placeholder="Hostname / IP" value={f.hostname} onChange={set("hostname")}/>
      <input placeholder="Port" type="number" value={f.port} onChange={set("port")}/>
      <input placeholder="Username (empty = ask on connect)" value={f.username} onChange={set("username")}/>
      <div className="form-label">Authentication</div>
      <div className="auth-toggle">
        <button className={"auth-opt"+(f.auth_type==="password"?" active":"")} onClick={()=>setF({...f,auth_type:"password"})}>Password</button>
        <button className={"auth-opt"+(f.auth_type==="key"?" active":"")} onClick={()=>setF({...f,auth_type:"key"})}>SSH Key</button>
      </div>
      {f.auth_type==="password"&&(<>
        <input placeholder={editing&&host.has_password?"Password (empty = keep current)":"Password (empty = ask on connect)"} type="password" value={f.password} onChange={set("password")}/>
        {editing&&host.has_password&&<label className="small muted checkline"><input type="checkbox" checked={f.clearPassword} onChange={(e)=>setF({...f,clearPassword:e.target.checked})}/> Remove saved password</label>}
      </>)}
      {f.auth_type==="key"&&(<>
        <textarea className="key-textarea" placeholder={editing&&host.has_private_key?"Private key (empty = keep current)":"Paste private key (PEM format)\n-----BEGIN ... KEY-----"} value={f.private_key} onChange={set("private_key")} rows={5}/>
        <input placeholder="Key passphrase (empty = ask if needed)" type="password" value={f.key_passphrase} onChange={set("key_passphrase")}/>
        {editing&&host.has_private_key&&<label className="small muted checkline"><input type="checkbox" checked={f.clearKey} onChange={(e)=>setF({...f,clearKey:e.target.checked})}/> Remove saved key</label>}
      </>)}
      <select value={f.folder_id} onChange={set("folder_id")}><option value="">No folder</option>{folders.map((fo)=><option key={fo.id} value={fo.id}>{fo.name}</option>)}</select>
      <input placeholder="Tags (comma separated)" value={f.tags} onChange={set("tags")}/>
      <input placeholder="MAC address for Wake on LAN (e.g. AA:BB:CC:DD:EE:FF)" value={f.mac_address} onChange={set("mac_address")}/>
      <textarea className="notes-textarea" placeholder="Notes (services, anything useful)" value={f.notes} onChange={set("notes")} rows={3}/>
      <label className="small muted checkline"><input type="checkbox" checked={f.favorite} onChange={(e)=>setF({...f,favorite:e.target.checked})}/> Favourite</label>
      <button className="btn" onClick={save}>{editing?"Save changes":"Save host"}</button>
      {error&&<p className="error">{error}</p>}
    </div>
  );
}

function SnippetPanel({ snippets, folders, onChanged, onSend, hasActive, width }) {
  const [showForm,     setShowForm]     = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [name,         setName]         = useState("");
  const [command,      setCommand]      = useState("");
  const [folderId,     setFolderId]     = useState("");
  const [favorite,     setFavorite]     = useState(false);
  const [filter,       setFilter]       = useState("");
  const [collapsed,    setCollapsed]    = useState(()=>new Set());
  const [dragSnippetId,setDragSnippetId]= useState(null);
  const [dropTarget,   setDropTarget]   = useState(undefined);

  function startAdd() { setEditing(null);setName("");setCommand("");setFolderId("");setFavorite(false);setShowForm(true); }
  function startEdit(s) { setEditing(s);setName(s.name);setCommand(s.command);setFolderId(s.folder_id?String(s.folder_id):"");setFavorite(!!s.favorite);setShowForm(true); }

  async function save() {
    if (!name.trim()||!command.trim()) return;
    const payload={name:name.trim(),command:command.trim(),folder_id:folderId?Number(folderId):null,favorite};
    if(editing) await api.updateSnippet(editing.id,payload); else await api.addSnippet(payload);
    setShowForm(false); onChanged();
  }

  async function addFolder() { const n=window.prompt("Folder name:"); if(n?.trim()){await api.addSnippetFolder(n.trim());onChanged();} }
  function toggleCollapse(id) { setCollapsed((c)=>{const n=new Set(c);n.has(id)?n.delete(id):n.add(id);return n;}); }

  async function dropOn(folderId) {
    const id=dragSnippetId; setDragSnippetId(null); setDropTarget(undefined);
    if(id==null) return; const snippet=snippets.find((s)=>s.id===id);
    if(!snippet||(snippet.folder_id??null)===folderId) return;
    await api.updateSnippet(id,{folder_id:folderId}); onChanged();
  }

  const dropProps=(folderId)=>({
    onDragOver:(e)=>{if(dragSnippetId==null)return;e.preventDefault();setDropTarget(folderId);},
    onDragLeave:()=>setDropTarget(undefined),
    onDrop:(e)=>{e.preventDefault();dropOn(folderId);},
  });

  const q=filter.trim().toLowerCase();
  const match=(s)=>!q||s.name.toLowerCase().includes(q)||s.command.toLowerCase().includes(q);
  const byFav=(a,b)=>(b.favorite-a.favorite)||a.name.localeCompare(b.name);
  const ungrouped=snippets.filter((s)=>!s.folder_id&&match(s)).sort(byFav);

  return (
    <aside className="snippet-panel" style={{width}}>
      <div className={"snippet-head"+(dragSnippetId!=null&&dropTarget===null?" drop-target":"")} {...dropProps(null)}>
        <span>{dragSnippetId!=null?"Drop here to unfile":"Snippets"}</span>
        <div className="snippet-head-actions">
          <button className="btn btn-small" onClick={addFolder}>+ Folder</button>
          <button className="btn btn-small" onClick={startAdd}>+ Add</button>
        </div>
      </div>
      <div className="filter-wrap"><input placeholder="Search snippets…" value={filter} onChange={(e)=>setFilter(e.target.value)}/></div>
      {showForm&&(
        <div className="snippet-form">
          <input placeholder="Name" value={name} onChange={(e)=>setName(e.target.value)} autoFocus/>
          <textarea className="snippet-textarea" placeholder="Command" value={command} onChange={(e)=>setCommand(e.target.value)} rows={3}/>
          <select value={folderId} onChange={(e)=>setFolderId(e.target.value)}><option value="">No folder</option>{folders.map((f)=><option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <label className="small muted checkline"><input type="checkbox" checked={favorite} onChange={(e)=>setFavorite(e.target.checked)}/> Favourite</label>
          <div className="snippet-form-btns">
            <button className="btn btn-small" onClick={save}>Save</button>
            <button className="btn btn-small btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <ul className="snippet-list">
        {ungrouped.map((s)=>(<SnippetRow key={s.id} snippet={s} hasActive={hasActive} onSend={onSend} onEdit={startEdit} onChanged={onChanged} onDragStart={setDragSnippetId} onDragEnd={()=>{setDragSnippetId(null);setDropTarget(undefined);}}/>))}
        {folders.map((f)=>{
          const inFolder=snippets.filter((s)=>s.folder_id===f.id&&match(s)).sort(byFav); const isCollapsed=collapsed.has(f.id);
          return (
            <li key={`sf${f.id}`} className="folder">
              <div className={"folder-head"+(dropTarget===f.id?" drop-target":"")} onClick={()=>toggleCollapse(f.id)} {...dropProps(f.id)}>
                <span className="chev">{isCollapsed?"▸":"▾"}</span><span className="folder-name">{f.name}</span><span className="muted small">({inFolder.length})</span>
                <div className="host-actions">
                  <button onClick={async(e)=>{e.stopPropagation();const n=window.prompt("Rename folder:",f.name);if(n?.trim()){await api.renameSnippetFolder(f.id,n.trim());onChanged();}}}>Rename</button>
                  <button onClick={async(e)=>{e.stopPropagation();if(confirm(`Delete folder "${f.name}"? Snippets inside are kept.`)){await api.deleteSnippetFolder(f.id);onChanged();}}}>Delete</button>
                </div>
              </div>
              {!isCollapsed&&(<ul className="folder-hosts">
                {inFolder.map((s)=>(<SnippetRow key={s.id} snippet={s} hasActive={hasActive} onSend={onSend} onEdit={startEdit} onChanged={onChanged} onDragStart={setDragSnippetId} onDragEnd={()=>{setDragSnippetId(null);setDropTarget(undefined);}}/>))}
                {inFolder.length===0&&<li className="muted small pad">Empty</li>}
              </ul>)}
            </li>
          );
        })}
        {snippets.length===0&&!showForm&&<li className="muted small pad">No snippets yet.</li>}
      </ul>
    </aside>
  );
}

function SnippetRow({ snippet:s, hasActive, onSend, onEdit, onChanged, onDragStart, onDragEnd }) {
  return (
    <li className={"snippet-item"+(hasActive?"":" disabled")} draggable onDragStart={(e)=>{e.dataTransfer.effectAllowed="move";onDragStart(s.id);}} onDragEnd={onDragEnd}>
      <div className="snippet-name-row">
        <span className="snippet-name" style={{color: "var(--accent-light)", opacity: 1}} title={hasActive?"Click to run":"Open a session first"} onClick={()=>hasActive&&onSend(s.command+"\r")}>
          {!!s.favorite&&<span className="star-badge">★</span>}{s.name}
        </span>
      </div>
      <div className="snippet-cmd">{s.command}</div>
      <div className="snippet-actions">
        <button onClick={async(e)=>{e.stopPropagation();await api.updateSnippet(s.id,{favorite:!s.favorite});onChanged();}}>{s.favorite?"Unfav":"Fav"}</button>
        <button onClick={(e)=>{e.stopPropagation();onEdit(s);}}>Edit</button>
        <button onClick={async(e)=>{e.stopPropagation();if(confirm(`Delete "${s.name}"?`)){await api.deleteSnippet(s.id);onChanged();}}}>Delete</button>
      </div>
    </li>
  );
}

function RecentHosts({ hosts, onOpen }) {
  const recent=hosts.filter((h)=>h.last_connected_at).sort((a,b)=>b.last_connected_at.localeCompare(a.last_connected_at)).slice(0,6);
  if(recent.length===0) return <div className="center-screen muted">Click a host on the left to open a session.</div>;
  return (
    <div className="center-screen">
      <div className="recent-wrap">
        <div className="recent-title muted">Recent connections</div>
        <div className="recent-grid">
          {recent.map((h)=>(
            <button key={h.id} className="recent-card" onClick={()=>onOpen(h)}>
              <span className="recent-name">{h.name}{!!h.favorite&&<span className="star-badge">★</span>}</span>
              <span className="recent-meta muted">{h.username?`${h.username}@`:""}{h.hostname}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBar({ session, logging, hasLog, onToggleLog, onDownloadLog }) {
  const [,tick]=useState(0);
  useEffect(()=>{const t=setInterval(()=>tick((n)=>n+1),1000);return()=>clearInterval(t);},[]);
  if (!session||session.status!=="connected") return null;
  const st=session.stats;
  const gb=(b)=>(b/1024**3).toFixed(1);
  const dur=session.connectedAt?Math.floor((Date.now()-session.connectedAt)/1000):null;
  const fmtDur=(s)=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h>0?`${h}h ${m}m ${sec}s`:m>0?`${m}m ${sec}s`:`${sec}s`;};
  return (
    <div className="statusbar">
      <span className="sb-item"><b>{session.host.name}</b></span>
      <span className="sb-item">user: {st?.user??"…"}</span>
      <span className="sb-item">ping: {st?.ping!=null?`${st.ping} ms`:"…"}</span>
      <span className="sb-item">cpu: {st?.cpu!=null?`${st.cpu.toFixed(0)}%`:"…"}</span>
      <span className="sb-item">ram: {st?.memTotal?`${gb(st.memUsed)} / ${gb(st.memTotal)} GB`:"…"}</span>
      <span className="sb-item">disk: {st?.diskTotal?`${gb(st.diskUsed)} / ${gb(st.diskTotal)} GB`:"…"}</span>
      <span className="sb-item">session: {dur!=null?fmtDur(dur):"…"}</span>
      <div className="sb-log-controls">
        <button className={"sb-log-btn"+(logging?" active":"")} onClick={onToggleLog} title={logging?"Stop logging":"Start logging"}>{logging?"⏹ Logging":"⏺ Log"}</button>
        {hasLog&&<button className="sb-log-btn" onClick={onDownloadLog} title="Download log">⬇</button>}
      </div>
    </div>
  );
}

function SettingsModal({ twoFAEnabled, termThemeId, customTermTheme, colorSchemeId, customScheme,
  onTermThemeChange, onCustomTermColor, onColorSchemeChange, onCustomSchemeColor,
  onClose, onRefresh, on2FAChange, ssoEnabled, onWiped }) {
  const [cur,setCur]=useState(""); const [nw,setNw]=useState(""); const [nw2,setNw2]=useState("");
  const [pwMsg,setPwMsg]=useState(""); const [pwErr,setPwErr]=useState("");
  const [exportPw,setExportPw]=useState(""); const [exportMsg,setExportMsg]=useState(""); const [exportErr,setExportErr]=useState("");
  const [importFile,setImportFile]=useState(null); const [importPw,setImportPw]=useState(""); const [importMsg,setImportMsg]=useState(""); const [importErr,setImportErr]=useState("");

  async function changePw() {
    setPwErr(""); setPwMsg("");
    if(nw!==nw2) return setPwErr("New passwords do not match");
    try{await api.changeMasterPassword(cur,nw);setPwMsg("Password changed.");setCur("");setNw("");setNw2("");}
    catch(e){setPwErr(e.message);}
  }
  async function handleExport() {
    setExportErr(""); setExportMsg("");
    try{ const blob=await api.exportData(exportPw); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`ssh-manager-${Date.now()}.sshm`; a.click(); URL.revokeObjectURL(a.href); setExportMsg("Export downloaded."); setExportPw(""); }
    catch(e){setExportErr(e.message);}
  }
  async function handleImport() {
    setImportErr(""); setImportMsg("");
    if(!importFile) return setImportErr("Select a file first");
    try{ const result=await api.importData(await importFile.text(),importPw); setImportMsg(`Imported ${result.imported} hosts (${result.skipped} skipped), ${result.snippetsImported} snippets.`); setImportPw(""); setImportFile(null); onRefresh(); }
    catch(e){setImportErr(e.message);}
  }
  async function wipe() {
    if(!confirm("Delete ALL data and reset vault?")) return;
    if(!confirm("Really sure?")) return;
    await api.wipeAll(); onWiped();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-head"><h2>Settings</h2><button className="btn btn-small btn-ghost" onClick={onClose}>✕</button></div>

        {/* ---------- 2FA ---------- */}
        <h3>Two-Factor Authentication</h3>
        <p className="small muted">Works with any TOTP app: Google Authenticator, Authy, Microsoft Authenticator, Bitwarden, 1Password, KeePass.</p>
        {twoFAEnabled ? <TwoFADisable onDisabled={()=>on2FAChange(false)}/> : <TwoFASetup onEnabled={()=>on2FAChange(true)}/>}

        {/* ---------- SSO info ---------- */}
        {ssoEnabled && (<>
          <div className="divider"/>
          <h3>Single Sign-On</h3>
          <p className="small muted">SSO is enabled on this instance. Authentication is managed by your SSO provider. To sign out, use the "Sign out" button in the top bar.</p>
        </>)}

        {/* ---------- UI Color Scheme ---------- */}
        <div className="divider"/>
        <h3>UI Color Scheme</h3>
        <div className="scheme-grid">
          {Object.entries(COLOR_SCHEMES).filter(([id])=>id!=="custom").map(([id,s])=>(
            <button key={id}
              className={"scheme-swatch"+(colorSchemeId===id?" selected":"")}
              style={{background:s.accent,color:"#fff",border:`2px solid ${colorSchemeId===id?"#fff":"transparent"}`}}
              onClick={()=>onColorSchemeChange(id)}>
              {s.name}
            </button>
          ))}
          <button
            className={"scheme-swatch"+(colorSchemeId==="custom"?" selected":"")}
            style={{background:customScheme.accent,color:"#fff",border:`2px solid ${colorSchemeId==="custom"?"#fff":"transparent"}`}}
            onClick={()=>onColorSchemeChange("custom")}>
            Custom
          </button>
        </div>
        {colorSchemeId==="custom"&&(
          <div className="custom-colors">
            {[["accent","Accent (main)"],["accentLight","Accent (light)"],["tabBase","Tab base"]].map(([k,label])=>(
              <label key={k} className="color-row">
                <span className="small">{label}</span>
                <input type="color" value={customScheme[k]||"#3A336B"} onChange={(e)=>onCustomSchemeColor(k,e.target.value)}/>
                <span className="small muted">{customScheme[k]}</span>
              </label>
            ))}
          </div>
        )}

        {/* ---------- Terminal Theme ---------- */}
        <div className="divider"/>
        <h3>Terminal Theme</h3>
        <div className="theme-grid">
          {Object.entries(TERMINAL_THEMES).map(([id,t])=>(
            <button key={id}
              className={"theme-swatch"+(termThemeId===id?" selected":"")}
              style={{background:t.theme.background,color:t.theme.foreground,border:`2px solid ${termThemeId===id?"#8f86d4":"transparent"}`}}
              onClick={()=>onTermThemeChange(id)}>
              {t.name}
            </button>
          ))}
          <button
            className={"theme-swatch"+(termThemeId==="custom"?" selected":"")}
            style={{background:customTermTheme.background,color:customTermTheme.foreground,border:`2px solid ${termThemeId==="custom"?"#8f86d4":"transparent"}`}}
            onClick={()=>onTermThemeChange("custom")}>
            Custom
          </button>
        </div>
        {termThemeId==="custom"&&(
          <div className="custom-colors">
            {[["background","Background"],["foreground","Foreground"],["cursor","Cursor"],["selectionBackground","Selection"]].map(([k,label])=>(
              <label key={k} className="color-row">
                <span className="small">{label}</span>
                <input type="color" value={customTermTheme[k]||"#000000"} onChange={(e)=>onCustomTermColor(k,e.target.value)}/>
                <span className="small muted">{customTermTheme[k]}</span>
              </label>
            ))}
          </div>
        )}

        <div className="divider"/>
        <h3>Change master password</h3>
        <input type="password" placeholder="Current password" value={cur} onChange={(e)=>setCur(e.target.value)}/>
        <input type="password" placeholder="New password (min 8)" value={nw} onChange={(e)=>setNw(e.target.value)}/>
        <input type="password" placeholder="Repeat new password" value={nw2} onChange={(e)=>setNw2(e.target.value)}/>
        <button className="btn" onClick={changePw}>Change password</button>
        {pwMsg&&<p className="success">{pwMsg}</p>}
        {pwErr&&<p className="error">{pwErr}</p>}

        <div className="divider"/>
        <h3>Export</h3>
        <p className="small muted">Encrypted backup of all connections, folders and snippets.</p>
        <input type="password" placeholder="Confirm master password" value={exportPw} onChange={(e)=>setExportPw(e.target.value)}/>
        <button className="btn" onClick={handleExport}>Download .sshm file</button>
        {exportMsg&&<p className="success">{exportMsg}</p>}
        {exportErr&&<p className="error">{exportErr}</p>}

        <div className="divider"/>
        <h3>Import</h3>
        <p className="small muted">Import from a .sshm file. Duplicates are skipped.</p>
        <label className="file-label"><input type="file" accept=".sshm" onChange={(e)=>setImportFile(e.target.files[0])}/>{importFile?importFile.name:"Choose .sshm file…"}</label>
        <input type="password" placeholder="Password used when exporting" value={importPw} onChange={(e)=>setImportPw(e.target.value)}/>
        <button className="btn" onClick={handleImport}>Import</button>
        {importMsg&&<p className="success">{importMsg}</p>}
        {importErr&&<p className="error">{importErr}</p>}

        <div className="divider"/>
        <h3 className="danger-title">Danger zone</h3>
        <button className="btn btn-danger" onClick={wipe}>Delete ALL saved data</button>
      </div>
    </div>
  );
}

function TwoFASetup({ onEnabled }) {
  const [step,setStep]=useState(1); const [qrDataUrl,setQrDataUrl]=useState(""); const [manualKey,setManualKey]=useState("");
  const [token,setToken]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);

  async function startSetup() { setError("");setLoading(true); try{const d=await api.setup2FA();setQrDataUrl(d.qrDataUrl);setManualKey(d.manualKey);setStep(2);}catch(e){setError(e.message);}finally{setLoading(false);} }
  async function confirmSetup() { setError("");setLoading(true); try{await api.confirm2FA(token);setStep(3);onEnabled();}catch(e){setError(e.message);}finally{setLoading(false);} }
  const formatted=manualKey.match(/.{1,4}/g)?.join(" ")||manualKey;

  if(step===1) return (<div className="twofa-section"><p className="small muted">2FA is currently <b>disabled</b>.</p><button className="btn" onClick={startSetup} disabled={loading}>{loading?"Generating…":"Set up 2FA"}</button>{error&&<p className="error">{error}</p>}</div>);
  if(step===2) return (
    <div className="twofa-section">
      <p className="small muted">Scan this QR code, then enter the 6-digit code to confirm.</p>
      {qrDataUrl&&<img src={qrDataUrl} alt="2FA QR code" className="qr-code"/>}
      <p className="small muted">Can't scan? Enter this key manually:</p>
      <div className="manual-key">{formatted}</div>
      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="6-digit code" value={token} className="totp-input" autoFocus onChange={(e)=>setToken(e.target.value.replace(/\D/g,""))} onKeyDown={(e)=>e.key==="Enter"&&confirmSetup()}/>
      <button className="btn" onClick={confirmSetup} disabled={loading||token.length!==6}>{loading?"Verifying…":"Enable 2FA"}</button>
      {error&&<p className="error">{error}</p>}
    </div>
  );
  return <div className="twofa-section"><p className="success">✓ 2FA enabled successfully!</p></div>;
}

function TwoFADisable({ onDisabled }) {
  const [token,setToken]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function disable() { setError("");setLoading(true); try{await api.disable2FA(token);onDisabled();}catch(e){setError(e.message);}finally{setLoading(false);} }
  return (
    <div className="twofa-section">
      <p className="small muted">2FA is currently <b style={{color:"#4ecb71"}}>enabled</b>. Enter your current authenticator code to disable it.</p>
      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="6-digit code" value={token} className="totp-input" onChange={(e)=>setToken(e.target.value.replace(/\D/g,""))} onKeyDown={(e)=>e.key==="Enter"&&disable()}/>
      <button className="btn btn-danger" onClick={disable} disabled={loading||token.length!==6}>{loading?"Disabling…":"Disable 2FA"}</button>
      {error&&<p className="error">{error}</p>}
    </div>
  );
}
