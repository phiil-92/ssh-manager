import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function SshTerminal({ hostId, visible, onStatus }) {
  const containerRef = useRef(null);
  const resizeRef = useRef(() => {});
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Mono", "Consolas", "DejaVu Sans Mono", monospace',
      scrollback: 5000,
      theme: {
        background: "#16141f",
        foreground: "#e4e2f0",
        cursor: "#8f86d4",
        selectionBackground: "#3A336B",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?hostId=${hostId}`);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "data") term.write(msg.data);
      if (msg.type === "status") statusRef.current?.(msg.status);
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

  return <div ref={containerRef} className="terminal-container" />;
}
