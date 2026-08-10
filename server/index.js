const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { Client } = require("ssh2");
const config = require("./config.json");

const app = express();
const server = http.createServer(app);

// WebSocket endpoint the browser terminal will connect to
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("Browser connected, opening SSH session...");
  const ssh = new Client();
  let stream = null;
  let lastSize = { cols: 80, rows: 24 };

  // Listen from the very start, so no message is ever lost
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "resize") {
      lastSize = { cols: msg.cols, rows: msg.rows };
      if (stream) stream.setWindow(msg.rows, msg.cols, 0, 0);
    }
    if (msg.type === "data" && stream) {
      stream.write(msg.data);
    }
  });

  ssh.on("ready", () => {
    // Open the shell with the size we already know about
    ssh.shell(
      { term: "xterm-256color", cols: lastSize.cols, rows: lastSize.rows },
      (err, s) => {
        if (err) {
          ws.send(JSON.stringify({ type: "data", data: `\r\nError: ${err.message}\r\n` }));
          return ws.close();
        }
        stream = s;
        stream.setWindow(lastSize.rows, lastSize.cols, 0, 0); // in case size arrived mid-handshake

        stream.on("data", (chunk) => {
          ws.send(JSON.stringify({ type: "data", data: chunk.toString("utf8") }));
        });
        stream.on("close", () => {
          ssh.end();
          ws.close();
        });
      }
    );
  });

  ssh.on("error", (err) => {
    ws.send(JSON.stringify({ type: "data", data: `\r\nSSH error: ${err.message}\r\n` }));
    ws.close();
  });

  ws.on("close", () => ssh.end());

  ssh.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
  });
});

server.listen(3000, () => console.log("Backend running on http://localhost:3000"));
