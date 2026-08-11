import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const THEMES = {
  dark: {
    background: "#16141f",
    foreground: "#e4e2f0",
    cursor: "#8f86d4",
    selectionBackground: "#3A336B",
  },
  light: {
    background: "#ffffff",
    foreground: "#26233a",
    cursor: "#3A336B",
    selectionBackground: "#c9c3ee",
  },
};

export default function SshTerminal({ hostId, visible, dark, onStatus, onStats, onReady }) {
  const containerRef = useRef(null);
  const termInstance = useRef(null);
  const resizeRef = useRef(() => {});
  const statusRef = useRef(onStatus);
  const statsRef = useRef(onStats);
  statusRef.current = onStatus;
  statsRef.current = onStats;

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace',
      scrollback: 5000,
      theme: dark ? THEMES.dark : THEMES.light,
    });
    termInstance.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?hostId=${hostId}`);

    // Expose send function so the snippet panel can push commands into this terminal
    onReady?.((text) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: text }));
      }
    });

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "data") term.write(msg.data);
      if (msg.type === "status") statusRef.current?.(msg.status);
      if (msg.type === "stats") statsRef.current?.(msg);
    };
    ws.onclose = () => {
      statusRef.current?.("disconnected");
      term.write("\r\n\x1b[38;2;143;134;212m[connection closed]\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
        return false;
      }
      return true;
    });

    const sendResize = () => {
      if (!containerRef.current || containerRef.current.offsetParent === null) return;
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    resizeRef.current = sendResize;
    ws.onopen = sendResize;
    const ro = new ResizeObserver(sendResize);
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); ws.close(); term.dispose(); };
  }, []);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => resizeRef.current());
  }, [visible]);

  useEffect(() => {
    if (termInstance.current) {
      termInstance.current.options.theme = dark ? THEMES.dark : THEMES.light;
    }
  }, [dark]);

  return <div ref={containerRef} className="terminal-container" />;
}
