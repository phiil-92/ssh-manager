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

app.post("/api/vault/change-password", requireUnlocked, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  const ok = await vault.changeMasterPassword(currentPassword || "", newPassword);
  if (!ok) return res.status(401).json({ error: "Current password is wrong" });
  res.json({ ok: true });
});

app.post("/api/vault/wipe", requireUnlocked, (req, res) => {
  vault.wipeAll();
  res.json({ ok: true });
});

// ---------- Helpers ----------
function requireUnlocked(req, res, next) {
  if (!vault.isUnlocked()) return res.status(403).json({ error: "Vault is locked" });
  next();
}

// ---------- Folder endpoints ----------
app.get("/api/folders", requireUnlocked, (req, res) => {
  res.json(db.prepare("SELECT * FROM folders ORDER BY name").all());
});

app.post("/api/folders", requireUnlocked, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const info = db.prepare("INSERT INTO folders (name) VALUES (?)").run(name);
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/folders/:id", requireUnlocked, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/folders/:id", requireUnlocked, (req, res) => {
  db.prepare("UPDATE hosts SET folder_id = NULL WHERE folder_id = ?").run(req.params.id);
  db.prepare("DELETE FROM folders WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Host endpoints ----------
app.get("/api/hosts", requireUnlocked, (req, res) => {
  const hosts = db
    .prepare(
      "SELECT id, name, hostname, port, username, folder_id, tags, favorite, (enc_password IS NOT NULL) AS has_password FROM hosts ORDER BY name"
    )
    .all();
  res.json(hosts);
});

app.post("/api/hosts", requireUnlocked, (req, res) => {
  const { name, hostname, port, username, password, folder_id, tags } = req.body;
  if (!name || !hostname)
    return res.status(400).json({ error: "name and hostname are required" });
  const enc = password ? vault.encrypt(password) : null;
  const info = db
    .prepare(
      "INSERT INTO hosts (name, hostname, port, username, enc_password, folder_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(name, hostname, port || 22, username || "", enc, folder_id || null, tags || "");
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/hosts/:id", requireUnlocked, (req, res) => {
  const host = db.prepare("SELECT * FROM hosts WHERE id = ?").get(req.params.id);
  if (!host) return res.status(404).json({ error: "Host not found" });

  const { name, hostname, port, username, password, clearPassword, folder_id, tags, favorite } = req.body;
  let enc = host.enc_password;
  if (clearPassword) enc = null;
  else if (password) enc = vault.encrypt(password);

  db.prepare(
    "UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, enc_password = ?, folder_id = ?, tags = ?, favorite = ? WHERE id = ?"
  ).run(
    name ?? host.name,
    hostname ?? host.hostname,
    port || host.port,
    username ?? host.username,
    enc,
    folder_id === undefined ? host.folder_id : folder_id || null,
    tags ?? host.tags,
    favorite === undefined ? host.favorite : favorite ? 1 : 0,
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
  let promptHandler = null;

  // ---- stats polling ----
  let statsTimer = null;
  let statsBusy = false;
  let prevCpu = null;

  function pollStats() {
    if (statsBusy || !stream) return;
    statsBusy = true;
    const t0 = Date.now();
    const cmd =
      "head -1 /proc/stat; free -b | grep -i '^mem'; df -B1 --output=used,size / | tail -1; whoami";
    ssh.exec(cmd, (err, s) => {
      if (err) { statsBusy = false; return; }
      let out = "";
      let ping = null;
      s.on("data", (d) => {
        if (ping === null) ping = Date.now() - t0;
        out += d.toString("utf8");
      });
      s.stderr.on("data", () => {});
      s.on("close", () => {
        statsBusy = false;
        try {
          const lines = out.trim().split("\n");
          const cpuParts = lines[0].trim().split(/\s+/).slice(1).map(Number);
          const total = cpuParts.reduce((a, b) => a + b, 0);
          const idle = cpuParts[3] + (cpuParts[4] || 0);
          let cpu = null;
          if (prevCpu) {
            const dt = total - prevCpu.total;
            const di = idle - prevCpu.idle;
            if (dt > 0) cpu = Math.max(0, Math.min(100, 100 * (1 - di / dt)));
          }
          prevCpu = { total, idle };

          const mem = lines[1].trim().split(/\s+/);
          const memTotal = Number(mem[1]);
          const memAvail = Number(mem[6] ?? mem[3]);

          const dsk = lines[2].trim().split(/\s+/);
          const user = (lines[3] || "").trim();

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: "stats",
              ping,
              cpu,
              memUsed: memTotal - memAvail,
              memTotal,
              diskUsed: Number(dsk[0]),
              diskTotal: Number(dsk[1]),
              user,
            }));
          }
        } catch { /* non-linux target or parse issue — just skip */ }
      });
    });
  }

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

  function prompt(text, echo = true) {
    return new Promise((resolve) => {
      send(text);
      let buf = "";
      promptHandler = (data) => {
        for (const ch of data) {
          if (ch === "\r") {
            send("\r\n");
            promptHandler = null;
            return resolve(buf);
          }
          if (ch === "\x7f") {
            if (buf.length > 0) {
              buf = buf.slice(0, -1);
              if (echo) send("\b \b");
            }
            continue;
          }
          if (ch < " ") continue;
          buf += ch;
          if (echo) send(ch);
        }
      };
    });
  }

  ws.on("close", () => {
    if (statsTimer) clearInterval(statsTimer);
    ssh.end();
  });

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
        ws.send(JSON.stringify({ type: "status", status: "connected" }));
        statsTimer = setInterval(pollStats, 5000);
        pollStats();
        stream.on("data", (chunk) => send(chunk.toString("utf8")));
        stream.on("close", () => {
          if (statsTimer) clearInterval(statsTimer);
          ws.send(JSON.stringify({ type: "status", status: "disconnected" }));
          ssh.end();
          ws.close();
        });
      }
    );
  });

  ssh.on("error", (err) => {
    send(`\r\nSSH error: ${err.message}\r\n`);
    ws.send(JSON.stringify({ type: "status", status: "disconnected" }));
    ws.close();
  });

  ssh.on("keyboard-interactive", async (name, instr, lang, prompts, finish) => {
    const answers = [];
    for (const p of prompts) {
      answers.push(await prompt(p.prompt, p.echo));
    }
    finish(answers);
  });

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
