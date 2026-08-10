const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { Client } = require("ssh2");
const db = require("./db");
const vault = require("./crypto");

const app = express();
app.use(express.json());
const server = http.createServer(app);

// ---------- Vault endpoints ----------
app.get("/api/vault/status", (req, res) => {
  res.json({ setUp: vault.isSetUp(), unlocked: vault.isUnlocked() });
});

app.post("/api/vault/setup", async (req, res) => {
  if (vault.isSetUp()) return res.status(400).json({ error: "Already set up" });
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  await vault.setup(password);
  res.json({ ok: true });
});

app.post("/api/vault/unlock", async (req, res) => {
  const ok = await vault.unlock(req.body.password || "");
  if (!ok) return res.status(401).json({ error: "Wrong password" });
  res.json({ ok: true });
});

app.post("/api/vault/lock", (req, res) => {
  vault.lock();
  res.json({ ok: true });
});

// ---------- Host endpoints ----------
function requireUnlocked(req, res, next) {
  if (!vault.isUnlocked()) return res.status(403).json({ error: "Vault is locked" });
  next();
}

app.get("/api/hosts", requireUnlocked, (req, res) => {
  // Never send enc_password to the browser
  const hosts = db
    .prepare("SELECT id, name, hostname, port, username, folder_id FROM hosts ORDER BY name")
    .all();
  res.json(hosts);
});

app.post("/api/hosts", requireUnlocked, (req, res) => {
  const { name, hostname, port, username, password } = req.body;
  if (!name || !hostname || !username)
    return res.status(400).json({ error: "name, hostname and username are required" });
  const enc = password ? vault.encrypt(password) : null;
  const info = db
    .prepare("INSERT INTO hosts (name, hostname, port, username, enc_password) VALUES (?, ?, ?, ?, ?)")
    .run(name, hostname, port || 22, username, enc);
  res.json({ id: info.lastInsertRowid });
});

app.delete("/api/hosts/:id", requireUnlocked, (req, res) => {
  db.prepare("DELETE FROM hosts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Terminal WebSocket ----------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // Which host? e.g. /ws?hostId=3
  const url = new URL(req.url, "http://localhost");
  const hostId = url.searchParams.get("hostId");

  if (!vault.isUnlocked()) {
    ws.send(JSON.stringify({ type: "data", data: "\r\nVault is locked.\r\n" }));
    return ws.close();
  }

  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(hostId);
  if (!host) {
    ws.send(JSON.stringify({ type: "data", data: "\r\nUnknown host.\r\n" }));
    return ws.close();
  }

  let password;
  try {
    password = host.enc_password ? vault.decrypt(host.enc_password) : undefined;
  } catch {
    ws.send(JSON.stringify({ type: "data", data: "\r\nFailed to decrypt credentials.\r\n" }));
    return ws.close();
  }

  const ssh = new Client();
  let stream = null;
  let lastSize = { cols: 80, rows: 24 };

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "resize") {
      lastSize = { cols: msg.cols, rows: msg.rows };
      if (stream) stream.setWindow(msg.rows, msg.cols, 0, 0);
    }
    if (msg.type === "data" && stream) stream.write(msg.data);
  });

  ssh.on("ready", () => {
    ssh.shell(
      { term: "xterm-256color", cols: lastSize.cols, rows: lastSize.rows },
      (err, s) => {
        if (err) {
          ws.send(JSON.stringify({ type: "data", data: `\r\nError: ${err.message}\r\n` }));
          return ws.close();
        }
        stream = s;
        stream.setWindow(lastSize.rows, lastSize.cols, 0, 0);
        stream.on("data", (chunk) =>
          ws.send(JSON.stringify({ type: "data", data: chunk.toString("utf8") }))
        );
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
    host: host.hostname,
    port: host.port,
    username: host.username,
    password,
  });
});

server.listen(3000, () => console.log("Backend running on http://localhost:3000"));
