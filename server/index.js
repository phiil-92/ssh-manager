const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { Client } = require("ssh2");
const db = require("./db");
const vault = require("./crypto");
const pkg = require("./package.json");

const app = express();
app.use(express.json());
const server = http.createServer(app);

// ---------- Meta ----------
app.get("/api/version", (req, res) => res.json({ version: pkg.version }));

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
  const hosts = db
    .prepare(
      "SELECT id, name, hostname, port, username, folder_id, (enc_password IS NOT NULL) AS has_password FROM hosts ORDER BY name"
    )
    .all();
  res.json(hosts);
});

app.post("/api/hosts", requireUnlocked, (req, res) => {
  const { name, hostname, port, username, password } = req.body;
  if (!name || !hostname)
    return res.status(400).json({ error: "name and hostname are required" });
  const enc = password ? vault.encrypt(password) : null;
  const info = db
    .prepare("INSERT INTO hosts (name, hostname, port, username, enc_password) VALUES (?, ?, ?, ?, ?)")
    .run(name, hostname, port || 22, username || "", enc);
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/hosts/:id", requireUnlocked, (req, res) => {
  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(req.params.id);
  if (!host) return res.status(404).json({ error: "Host not found" });

  const { name, hostname, port, username, password, clearPassword } = req.body;
  // password: "" = keep existing, non-empty = replace; clearPassword = remove
  let enc = host.enc_password;
  if (clearPassword) enc = null;
  else if (password) enc = vault.encrypt(password);

  db.prepare(
    "UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, enc_password = ? WHERE id = ?"
  ).run(
    name ?? host.name,
    hostname ?? host.hostname,
    port || host.port,
    username ?? host.username,
    enc,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/hosts/:id", requireUnlocked, (req, res) => {
  db.prepare("DELETE FROM hosts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Terminal WebSocket ----------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const hostId = url.searchParams.get("hostId");

  const send = (data) => ws.send(JSON.stringify({ type: "data", data }));

  if (!vault.isUnlocked()) {
    send("\r\nVault is locked.\r\n");
    return ws.close();
  }

  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(hostId);
  if (!host) {
    send("\r\nUnknown host.\r\n");
    return ws.close();
  }

  const ssh = new Client();
  let stream = null;
  let lastSize = { cols: 80, rows: 24 };
  let promptHandler = null; // when set, incoming keystrokes go to the prompt, not SSH

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "resize") {
      lastSize = { cols: msg.cols, rows: msg.rows };
      if (stream) stream.setWindow(msg.rows, msg.cols, 0, 0);
    }
    if (msg.type === "data") {
      if (promptHandler) promptHandler(msg.data);
      else if (stream) stream.write(msg.data);
    }
  });

  // Ask the user something inside the terminal. echo=false hides input (passwords).
  function prompt(text, echo = true) {
    return new Promise((resolve) => {
      send(text);
      let buf = "";
      promptHandler = (data) => {
        for (const ch of data) {
          if (ch === "\r") {           // Enter
            send("\r\n");
            promptHandler = null;
            return resolve(buf);
          }
          if (ch === "\x7f") {         // Backspace
            if (buf.length > 0) {
              buf = buf.slice(0, -1);
              if (echo) send("\b \b");
            }
            continue;
          }
          if (ch < " ") continue;      // ignore other control chars
          buf += ch;
          if (echo) send(ch);
        }
      };
    });
  }

  ws.on("close", () => ssh.end());

  ssh.on("ready", () => {
    ssh.shell(
      { term: "xterm-256color", cols: lastSize.cols, rows: lastSize.rows },
      (err, s) => {
        if (err) {
          send(`\r\nError: ${err.message}\r\n`);
          return ws.close();
        }
        stream = s;
        stream.setWindow(lastSize.rows, lastSize.cols, 0, 0);
        stream.on("data", (chunk) => send(chunk.toString("utf8")));
        stream.on("close", () => {
          ssh.end();
          ws.close();
        });
      }
    );
  });

  ssh.on("error", (err) => {
    send(`\r\nSSH error: ${err.message}\r\n`);
    ws.close();
  });

  // Some servers use "keyboard-interactive" instead of plain password auth
  ssh.on("keyboard-interactive", async (name, instr, lang, prompts, finish) => {
    const answers = [];
    for (const p of prompts) {
      answers.push(await prompt(p.prompt, p.echo));
    }
    finish(answers);
  });

  // Gather credentials (prompting for whatever is missing), then connect
  (async () => {
    let username = host.username;
    if (!username) username = await prompt(`login as: `);

    let password;
    if (host.enc_password) {
      try {
        password = vault.decrypt(host.enc_password);
      } catch {
        send("\r\nFailed to decrypt credentials.\r\n");
        return ws.close();
      }
    } else {
      password = await prompt(`${username}@${host.hostname}'s password: `, false);
    }

    send(`Connecting to ${host.hostname}:${host.port}...\r\n`);
    ssh.connect({
      host: host.hostname,
      port: host.port,
      username,
      password,
      tryKeyboard: true,
    });
  })();
});

server.listen(3000, () => console.log("Backend running on http://localhost:3000"));
