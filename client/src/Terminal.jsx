import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon }    from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { api } from "./api.js";
import "@xterm/xterm/css/xterm.css";

export default function SshTerminal({ hostId, visible, termTheme, onStatus, onStats, onReady, onOutput }) {
  const containerRef   = useRef(null);
  const termRef        = useRef(null);
  const resizeRef      = useRef(() => {});
  const wsRef          = useRef(null);
  const searchRef      = useRef(null);
  const shouldRecon    = useRef(true);
  const reconTimer     = useRef(null);
  const reconAttempts  = useRef(0);
  const statusRef      = useRef(onStatus);
  const statsRef       = useRef(onStats);
  const outputRef      = useRef(onOutput);
  const searchOpenRef  = useRef(false);

  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  statusRef.current = onStatus;
  statsRef .current = onStats;
  outputRef.current = onOutput;

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true, fontSize: 14,
      fontFamily: '"Cascadia Mono","Consolas","DejaVu Sans Mono",monospace',
      scrollback: 5000,
      theme: termTheme,
    });
    termRef.current = term;

    const fit    = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    searchRef.current = search;
    term.open(containerRef.current);

    onReady?.((text) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "data", data: text }));
    });

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "data", data }));
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
        const sel = term.getSelection(); if (sel) navigator.clipboard.writeText(sel); return false;
      }
      if (e.ctrlKey && e.code === "KeyF" && e.type === "keydown") {
        setSearchOpen((v) => { searchOpenRef.current = !v; return !v; }); return false;
      }
      if (e.code === "Escape" && e.type === "keydown" && searchOpenRef.current) {
        setSearchOpen(false); setSearchQuery(""); searchOpenRef.current = false; return false;
      }
      return true;
    });

    const sendResize = () => {
      if (!containerRef.current || containerRef.current.offsetParent === null) return;
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    resizeRef.current = sendResize;

    const ro = new ResizeObserver(sendResize);
    ro.observe(containerRef.current);

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws    = new WebSocket(`${proto}://${location.host}/ws?hostId=${hostId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send token as first message — keeps it out of server logs
        ws.send(JSON.stringify({ type: "auth", token: api.getSessionToken() }));
        reconAttempts.current = 0;
        sendResize();
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "data")   { term.write(msg.data); outputRef.current?.(msg.data); }
        if (msg.type === "status") statusRef.current?.(msg.status);
        if (msg.type === "stats")  statsRef .current?.(msg);
      };

      ws.onclose = () => {
        statusRef.current?.("disconnected");
        if (!shouldRecon.current) return;
        const MAX = 5;
        if (reconAttempts.current >= MAX) {
          term.write("\r\n\x1b[31m[Disconnected. Max retries reached.]\x1b[0m\r\n"); return;
        }
        reconAttempts.current++;
        const delay = Math.min(reconAttempts.current * 3, 15);
        term.write(`\r\n\x1b[33m[Reconnecting in ${delay}s… (${reconAttempts.current}/${MAX})]\x1b[0m\r\n`);
        reconTimer.current = setTimeout(connect, delay * 1000);
      };
    }

    connect();

    return () => {
      shouldRecon.current = false;
      clearTimeout(reconTimer.current);
      wsRef.current?.close();
      ro.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => { if (visible) requestAnimationFrame(() => resizeRef.current()); }, [visible]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !termTheme) return;
    term.options.theme = { ...termTheme };
    term.refresh(0, term.rows - 1);
  }, [JSON.stringify(termTheme)]);

  function doSearch(query, forward = true) {
    if (!searchRef.current || !query) return;
    forward ? searchRef.current.findNext(query) : searchRef.current.findPrevious(query);
  }

  return (
    <div className="terminal-wrapper">
      {searchOpen && (
        <div className="terminal-search-bar">
          <input
            autoFocus placeholder="Search…" value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); doSearch(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter")  doSearch(searchQuery, !e.shiftKey);
              if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); searchOpenRef.current = false; }
            }}
          />
          <button title="Previous" onClick={() => doSearch(searchQuery, false)}>▲</button>
          <button title="Next"     onClick={() => doSearch(searchQuery, true)}>▼</button>
          <button title="Close"    onClick={() => { setSearchOpen(false); setSearchQuery(""); searchOpenRef.current = false; }}>✕</button>
        </div>
      )}
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}
