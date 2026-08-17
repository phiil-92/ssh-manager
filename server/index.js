const express   = require("express");
const http      = require("http");
const dgram     = require("dgram");
const crypto    = require("crypto");
const QRCode    = require("qrcode");
const rateLimit = require("express-rate-limit");
const session   = require("express-session");
const { WebSocketServer } = require("ws");
const { Client } = require("ssh2");
const db        = require("./db");
const vault     = require("./crypto");
const pkg       = require("./package.json");

const app = express();
app.use(express.json({ limit: "10mb" }));
const server = http.createServer(app);

// ---------- Session (needed for SSO state) ----------
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.SECURE_COOKIES === "true",
  },
}));

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:;"
  );
  next();
});

app.set("trust proxy", 1);

// ---------- Rate limiters ----------
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
app.use(generalLimiter);

const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many unlock attempts. Try again in 15 minutes." },
});

// ---------- Session token (vault) ----------
let sessionToken = null;

// ---------- SSO (optional OIDC) ----------
const ssoEnabled = process.env.SSO_ENABLED === "true";
let ssoClient    = null;

if (ssoEnabled) {
  const { Issuer } = require("openid-client");
  (async () => {
    try {
      const issuer = await Issuer.discover(process.env.SSO_ISSUER);
      ssoClient = new issuer.Client({
        client_id:      process.env.SSO_CLIENT_ID,
        client_secret:  process.env.SSO_CLIENT_SECRET || undefined,
        redirect_uris:  [process.env.SSO_REDIRECT_URI || "http://localhost:3000/auth/callback"],
        response_types: ["code"],
      });
      console.log(`SSO enabled — issuer: ${issuer.issuer}`);
    } catch (e) {
      console.error("SSO init failed:", e.message);
    }
  })();
}

// ---------- SSO routes (public) ----------
app.get("/api/auth/status", (req, res) => {
  res.json({
    ssoEnabled,
    ssoAuthenticated: !ssoEnabled || !!req.session?.ssoAuthenticated,
    ssoUser: req.session?.ssoUser || null,
  });
});

app.get("/auth/login", (req, res) => {
  if (!ssoEnabled || !ssoClient) {
    return res.status(503).send("SSO is not configured correctly — check server logs.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  req.session.ssoState = { state, nonce };
  // Save session BEFORE redirecting to Keycloak so state is persisted
  req.session.save((err) => {
    if (err) console.error("Session save error on login:", err);
    const url = ssoClient.authorizationUrl({ scope: "openid profile email", state, nonce });
    res.redirect(url);
  });
});

app.get("/auth/callback", async (req, res) => {
  if (!ssoEnabled || !ssoClient) return res.redirect("/");
  const { state, nonce } = req.session.ssoState || {};
  if (!state) return res.status(400).send("Invalid session state — try signing in again.");
  try {
    const params   = ssoClient.callbackParams(req);
    const tokenSet = await ssoClient.callback(
      process.env.SSO_REDIRECT_URI || "http://localhost:3000/auth/callback",
      params, { state, nonce }
    );
    const claims = tokenSet.claims();

    // Optional role/group restriction
    if (process.env.SSO_ALLOWED_ROLES) {
      const roles = [
        ...(claims.groups || []),
        ...(claims.realm_access?.roles || []),
        ...(claims.roles || []),
        ...(claims.resource_access?.[process.env.SSO_CLIENT_ID]?.roles || []),
      ];
      const allowed = process.env.SSO_ALLOWED_ROLES.split(",").map((r) => r.trim());
      if (!allowed.some((r) => roles.includes(r))) {
        return res.status(403).send("Access denied — your account does not have the required role.");
      }
    }

    req.session.ssoAuthenticated = true;
    req.session.ssoIdToken = tokenSet.id_token;
    req.session.ssoUser = {
      name:  claims.name || claims.preferred_username || claims.email || "User",
      email: claims.email || null,
    };
    delete req.session.ssoState;
    // Save session BEFORE redirecting back to app
    req.session.save((err) => {
      if (err) console.error("Session save error on callback:", err);
      res.redirect("/");
    });
  } catch (e) {
    console.error("SSO callback error:", e.message);
    res.status(500).send("SSO authentication failed: " + e.message);
  }
});

app.get("/auth/logout", (req, res) => {
  const endSession = ssoClient?.issuer?.end_session_endpoint;
  const idToken    = req.session?.ssoIdToken;
  const postLogout = process.env.SSO_POST_LOGOUT_URI ||
  (process.env.SSO_REDIRECT_URI || "http://localhost:3000/auth/callback")
  .replace("/auth/callback", "/");

  req.session.destroy(() => {
    if (endSession) {
      const params = new URLSearchParams({ post_logout_redirect_uri: postLogout });
      if (idToken) params.set("id_token_hint", idToken);
      res.redirect(`${endSession}?${params.toString()}`);
    } else {
      res.redirect("/");
    }
  });
});

// ---------- Helpers ----------
function requireAccess(req, res, next) {
  if (ssoEnabled && !req.session?.ssoAuthenticated)
    return res.status(401).json({ error: "SSO authentication required", ssoRequired: true });
  const t = req.headers["x-session-token"];
  if (!sessionToken || t !== sessionToken)
    return res.status(401).json({ error: "Unauthorized" });
  if (!vault.isUnlocked())
    return res.status(403).json({ error: "Vault is locked" });
  next();
}

function sendMagicPacket(mac) {
  return new Promise((resolve, reject) => {
    const hex = mac.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length !== 12) return reject(new Error("Invalid MAC address"));
    const bytes = [];
    for (let i = 0; i < 6; i++) bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    const packet = Buffer.alloc(102);
    packet.fill(0xff, 0, 6);
    for (let i = 1; i <= 16; i++) bytes.forEach((b, j) => packet.writeUInt8(b, i * 6 + j));
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.once("error", (e) => { socket.close(); reject(e); });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.send(packet, 9, "255.255.255.255", (e) => { socket.close(); e ? reject(e) : resolve(); });
    });
  });
}

// ---------- Meta ----------
app.get("/api/version", (req, res) => res.json({ version: pkg.version }));

// ---------- Vault (public) ----------
app.get("/api/vault/status", (req, res) => {
  res.json({ setUp: vault.isSetUp(), unlocked: vault.isUnlocked(), twoFAEnabled: vault.is2FAEnabled() });
});

app.post("/api/vault/setup", async (req, res) => {
  if (vault.isSetUp()) return res.status(400).json({ error: "Already set up" });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  await vault.setup(password);
  sessionToken = crypto.randomBytes(32).toString("hex");
  res.json({ ok: true, token: sessionToken });
});

app.post("/api/vault/unlock", unlockLimiter, async (req, res) => {
  const { password, token } = req.body;
  const result = await vault.unlock(password || "", token || null);
  if (result.requires2fa)                           return res.json({ requires2fa: true });
  if (!result.ok && result.error === "wrong_token") return res.status(401).json({ error: "Invalid authenticator code" });
  if (!result.ok)                                   return res.status(401).json({ error: "Wrong password" });
  sessionToken = crypto.randomBytes(32).toString("hex");
  res.json({ ok: true, token: sessionToken });
});

// ---------- Vault (protected) ----------
app.post("/api/vault/lock", requireAccess, (req, res) => {
  vault.lock(); sessionToken = null; res.json({ ok: true });
});

app.post("/api/vault/change-password", requireAccess, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const ok = await vault.changeMasterPassword(currentPassword || "", newPassword);
  if (!ok) return res.status(401).json({ error: "Current password is wrong" });
  res.json({ ok: true });
});

app.post("/api/vault/wipe", requireAccess, (req, res) => {
  vault.wipeAll(); sessionToken = null; res.json({ ok: true });
});

// ---------- 2FA ----------
app.post("/api/vault/2fa/setup", requireAccess, async (req, res) => {
  try {
    const { secret, otpauthUrl } = vault.generate2FASecret();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 2 });
    res.json({ qrDataUrl, manualKey: secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/vault/2fa/confirm", requireAccess, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required" });
  try {
    const ok = vault.confirm2FASetup(token);
    if (!ok) return res.status(401).json({ error: "Invalid code — try again" });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/vault/2fa/disable", requireAccess, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Current authenticator code required" });
  const ok = vault.disable2FA(token);
  if (!ok) return res.status(401).json({ error: "Invalid code" });
  res.json({ ok: true });
});

// ---------- Export / Import ----------
app.post("/api/export", requireAccess, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const result = await vault.exportData(password);
  if (result === null) return res.status(401).json({ error: "Wrong password" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="ssh-manager-${Date.now()}.sshm"`);
  res.send(result);
});

app.post("/api/import", requireAccess, async (req, res) => {
  const { fileData, password } = req.body;
  if (!fileData || !password) return res.status(400).json({ error: "File data and password required" });
  let data;
  try { data = await vault.importData(fileData, password); }
  catch (e) { return res.status(401).json({ error: e.message }); }

  const folderIdMap = {};
  for (const f of (data.folders || [])) {
    const ex = db.prepare("SELECT id FROM folders WHERE name = ?").get(f.name);
    folderIdMap[f.id] = ex ? ex.id : db.prepare("INSERT INTO folders (name) VALUES (?)").run(f.name).lastInsertRowid;
  }
  let imported = 0, skipped = 0;
  for (const h of (data.hosts || [])) {
    if (db.prepare("SELECT id FROM hosts WHERE hostname=? AND port=? AND username=?").get(h.hostname, h.port, h.username)) { skipped++; continue; }
    const enc   = h.password             ? vault.encrypt(h.password)             : null;
    const encK  = h.private_key          ? vault.encrypt(h.private_key)          : null;
    const encKp = h.key_passphrase_plain ? vault.encrypt(h.key_passphrase_plain) : null;
    const port  = Math.max(1, Math.min(65535, parseInt(h.port) || 22));
    db.prepare("INSERT INTO hosts (name,hostname,port,username,enc_password,folder_id,tags,favorite,notes,auth_type,enc_private_key,key_passphrase,mac_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(h.name, h.hostname, port, h.username||"", enc,
        h.folder_id != null ? (folderIdMap[h.folder_id] ?? null) : null,
        h.tags||"", h.favorite||0, h.notes||"", h.auth_type||"password", encK, encKp, h.mac_address||"");
    imported++;
  }
  let snippetsImported = 0;
  for (const s of (data.snippets || [])) {
    if (!db.prepare("SELECT id FROM snippets WHERE name=? AND command=?").get(s.name, s.command)) {
      db.prepare("INSERT INTO snippets (name,command) VALUES (?,?)").run(s.name, s.command);
      snippetsImported++;
    }
  }
  res.json({ ok: true, imported, skipped, snippetsImported });
});

// ---------- Wake on LAN ----------
app.post("/api/wol/:id", requireAccess, async (req, res) => {
  const host = db.prepare("SELECT mac_address, name FROM hosts WHERE id = ?").get(req.params.id);
  if (!host) return res.status(404).json({ error: "Host not found" });
  if (!host.mac_address) return res.status(400).json({ error: "No MAC address configured" });
  try { await sendMagicPacket(host.mac_address); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Folders ----------
app.get   ("/api/folders",     requireAccess, (req, res) => res.json(db.prepare("SELECT * FROM folders ORDER BY name").all()));
app.post  ("/api/folders",     requireAccess, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  res.json({ id: db.prepare("INSERT INTO folders (name) VALUES (?)").run(name).lastInsertRowid });
});
app.put   ("/api/folders/:id", requireAccess, (req, res) => { db.prepare("UPDATE folders SET name=? WHERE id=?").run(req.body.name, req.params.id); res.json({ ok: true }); });
app.delete("/api/folders/:id", requireAccess, (req, res) => {
  db.prepare("UPDATE hosts SET folder_id=NULL WHERE folder_id=?").run(req.params.id);
  db.prepare("DELETE FROM folders WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Hosts ----------
app.get("/api/hosts", requireAccess, (req, res) => {
  res.json(db.prepare(
    "SELECT id,name,hostname,port,username,folder_id,tags,favorite,last_connected_at,notes,auth_type,mac_address,(enc_password IS NOT NULL) AS has_password,(enc_private_key IS NOT NULL) AS has_private_key FROM hosts ORDER BY name"
  ).all());
});

app.post("/api/hosts", requireAccess, (req, res) => {
  const { name, hostname, port, username, password, folder_id, tags, favorite, notes, auth_type, private_key, key_passphrase, mac_address } = req.body;
  if (!name || !hostname) return res.status(400).json({ error: "name and hostname are required" });
  const info = db.prepare(
    "INSERT INTO hosts (name,hostname,port,username,enc_password,folder_id,tags,favorite,notes,auth_type,enc_private_key,key_passphrase,mac_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(name, hostname, port||22, username||"",
    password      ? vault.encrypt(password)      : null,
    folder_id     || null, tags||"", favorite?1:0, notes||"", auth_type||"password",
    private_key   ? vault.encrypt(private_key)   : null,
    key_passphrase? vault.encrypt(key_passphrase): null,
    mac_address   || "");
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/hosts/:id", requireAccess, (req, res) => {
  const host = db.prepare("SELECT * FROM hosts WHERE id=?").get(req.params.id);
  if (!host) return res.status(404).json({ error: "Host not found" });
  const { name, hostname, port, username, password, clearPassword, folder_id, tags, favorite, notes, auth_type, private_key, key_passphrase, clearKey, mac_address } = req.body;
  let enc   = host.enc_password;    if (clearPassword) enc   = null; else if (password)     enc   = vault.encrypt(password);
  let encK  = host.enc_private_key; if (clearKey)      encK  = null; else if (private_key)  encK  = vault.encrypt(private_key);
  let encKp = host.key_passphrase;  if (key_passphrase !== undefined) encKp = key_passphrase ? vault.encrypt(key_passphrase) : null;
  db.prepare(
    "UPDATE hosts SET name=?,hostname=?,port=?,username=?,enc_password=?,folder_id=?,tags=?,favorite=?,notes=?,auth_type=?,enc_private_key=?,key_passphrase=?,mac_address=? WHERE id=?"
  ).run(
    name??host.name, hostname??host.hostname, port||host.port, username??host.username, enc,
    folder_id===undefined ? host.folder_id : folder_id||null,
    tags??host.tags, favorite===undefined ? host.favorite : favorite?1:0,
    notes??host.notes, auth_type??host.auth_type, encK, encKp,
    mac_address??host.mac_address, req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/hosts/:id", requireAccess, (req, res) => { db.prepare("DELETE FROM hosts WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// ---------- Snippet Folders ----------
app.get   ("/api/snippet-folders",     requireAccess, (req, res) => res.json(db.prepare("SELECT * FROM snippet_folders ORDER BY name").all()));
app.post  ("/api/snippet-folders",     requireAccess, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  res.json({ id: db.prepare("INSERT INTO snippet_folders (name) VALUES (?)").run(name).lastInsertRowid });
});
app.put   ("/api/snippet-folders/:id", requireAccess, (req, res) => { db.prepare("UPDATE snippet_folders SET name=? WHERE id=?").run(req.body.name, req.params.id); res.json({ ok: true }); });
app.delete("/api/snippet-folders/:id", requireAccess, (req, res) => {
  db.prepare("UPDATE snippets SET folder_id=NULL WHERE folder_id=?").run(req.params.id);
  db.prepare("DELETE FROM snippet_folders WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Snippets ----------
app.get("/api/snippets", requireAccess, (req, res) =>
  res.json(db.prepare("SELECT * FROM snippets ORDER BY favorite DESC, name ASC").all())
);
app.post("/api/snippets", requireAccess, (req, res) => {
  const { name, command, folder_id, favorite } = req.body;
  if (!name || !command) return res.status(400).json({ error: "name and command are required" });
  res.json({ id: db.prepare("INSERT INTO snippets (name,command,folder_id,favorite) VALUES (?,?,?,?)").run(name, command, folder_id||null, favorite?1:0).lastInsertRowid });
});
app.put("/api/snippets/:id", requireAccess, (req, res) => {
  const s = db.prepare("SELECT * FROM snippets WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Snippet not found" });
  const { name, command, folder_id, favorite } = req.body;
  db.prepare("UPDATE snippets SET name=?,command=?,folder_id=?,favorite=? WHERE id=?")
    .run(name??s.name, command??s.command,
      folder_id===undefined ? s.folder_id : folder_id||null,
      favorite===undefined  ? s.favorite  : favorite?1:0,
      req.params.id);
  res.json({ ok: true });
});
app.delete("/api/snippets/:id", requireAccess, (req, res) => { db.prepare("DELETE FROM snippets WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// ---------- WebSocket Terminal ----------
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url    = new URL(req.url, "http://localhost");
  const hostId = url.searchParams.get("hostId");
  const send   = (data) => ws.send(JSON.stringify({ type: "data", data }));

  ws.once("message", (authRaw) => {
    let authMsg;
    try { authMsg = JSON.parse(authRaw); } catch { send("\r\nBad auth.\r\n"); return ws.close(); }
    if (authMsg.type !== "auth" || !sessionToken || authMsg.token !== sessionToken) {
      send("\r\nUnauthorized.\r\n"); return ws.close();
    }
    if (!vault.isUnlocked()) { send("\r\nVault is locked.\r\n"); return ws.close(); }

    const host = db.prepare("SELECT * FROM hosts WHERE id=?").get(hostId);
    if (!host) { send("\r\nUnknown host.\r\n"); return ws.close(); }

    const ssh = new Client();
    let stream = null, lastSize = { cols: 80, rows: 24 }, promptHandler = null;
    let statsTimer = null, statsBusy = false, prevCpu = null;

    function pollStats() {
      if (statsBusy || !stream) return;
      statsBusy = true;
      const t0 = Date.now();
      ssh.exec("head -1 /proc/stat; free -b | grep -i '^mem'; df -B1 --output=used,size / | tail -1; whoami", (err, s) => {
        if (err) { statsBusy = false; return; }
        let out = "", ping = null;
        s.on("data", (d) => { if (ping === null) ping = Date.now() - t0; out += d.toString("utf8"); });
        s.stderr.on("data", () => {});
        s.on("close", () => {
          statsBusy = false;
          try {
            const lines    = out.trim().split("\n");
            const cpuParts = lines[0].trim().split(/\s+/).slice(1).map(Number);
            const total    = cpuParts.reduce((a, b) => a + b, 0), idle = cpuParts[3] + (cpuParts[4] || 0);
            let cpu = null;
            if (prevCpu) { const dt=total-prevCpu.total, di=idle-prevCpu.idle; if(dt>0) cpu=Math.max(0,Math.min(100,100*(1-di/dt))); }
            prevCpu = { total, idle };
            const mem  = lines[1].trim().split(/\s+/);
            const dsk  = lines[2].trim().split(/\s+/);
            const user = (lines[3]||"").trim();
            if (ws.readyState === ws.OPEN)
              ws.send(JSON.stringify({ type:"stats", ping, cpu,
                memUsed: Number(mem[1])-Number(mem[6]??mem[3]), memTotal: Number(mem[1]),
                diskUsed: Number(dsk[0]), diskTotal: Number(dsk[1]), user }));
          } catch {}
        });
      });
    }

    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === "resize") {
        const cols = Math.max(1, Math.min(500, parseInt(msg.cols)||80));
        const rows = Math.max(1, Math.min(200, parseInt(msg.rows)||24));
        lastSize = { cols, rows };
        if (stream) stream.setWindow(rows, cols, 0, 0);
      }
      if (msg.type === "data") { if (promptHandler) promptHandler(msg.data); else if (stream) stream.write(msg.data); }
    });

    function prompt(text, echo = true) {
      return new Promise((resolve) => {
        send(text); let buf = "";
        promptHandler = (data) => {
          for (const ch of data) {
            if (ch==="\r") { send("\r\n"); promptHandler=null; return resolve(buf); }
            if (ch==="\x7f") { if(buf.length>0){buf=buf.slice(0,-1);if(echo)send("\b \b");} continue; }
            if (ch<" ") continue;
            buf+=ch; if(echo) send(ch);
          }
        };
      });
    }

    ws.on("close", () => { if (statsTimer) clearInterval(statsTimer); ssh.end(); });

    ssh.on("ready", () => {
      ssh.shell({ term:"xterm-256color", cols:lastSize.cols, rows:lastSize.rows }, (err, s) => {
        if (err) { send(`\r\nError: ${err.message}\r\n`); return ws.close(); }
        stream = s;
        stream.setWindow(lastSize.rows, lastSize.cols, 0, 0);
        ws.send(JSON.stringify({ type:"status", status:"connected" }));
        db.prepare("UPDATE hosts SET last_connected_at=datetime('now') WHERE id=?").run(host.id);
        statsTimer = setInterval(pollStats, 5000);
        pollStats();
        stream.on("data",  (chunk) => send(chunk.toString("utf8")));
        stream.on("close", () => {
          if (statsTimer) clearInterval(statsTimer);
          ws.send(JSON.stringify({ type:"status", status:"disconnected" }));
          ssh.end(); ws.close();
        });
      });
    });

    ssh.on("error", (err) => {
      send(`\r\nSSH error: ${err.message}\r\n`);
      ws.send(JSON.stringify({ type:"status", status:"disconnected" }));
      ws.close();
    });

    ssh.on("keyboard-interactive", async (name, instr, lang, prompts, finish) => {
      const answers = [];
      for (const p of prompts) answers.push(await prompt(p.prompt, p.echo));
      finish(answers);
    });

    (async () => {
      let username = host.username;
      if (!username) username = await prompt("login as: ");
      send(`Connecting to ${host.hostname}:${host.port}...\r\n`);
      const opts = { host:host.hostname, port:host.port, username, tryKeyboard:true };
      if (host.auth_type === "key") {
        if (!host.enc_private_key) { send("\r\nNo private key stored.\r\n"); return ws.close(); }
        try { opts.privateKey = vault.decrypt(host.enc_private_key); } catch { send("\r\nFailed to decrypt key.\r\n"); return ws.close(); }
        if (host.key_passphrase) { try { opts.passphrase = vault.decrypt(host.key_passphrase); } catch {} }
        else { const pp = await prompt("Key passphrase (Enter if none): ", false); if(pp) opts.passphrase=pp; }
      } else {
        if (host.enc_password) { try { opts.password = vault.decrypt(host.enc_password); } catch { send("\r\nFailed to decrypt password.\r\n"); return ws.close(); } }
        else opts.password = await prompt(`${username}@${host.hostname}'s password: `, false);
      }
      ssh.connect(opts);
    })();
  });
});

if (process.env.NODE_ENV === "production") {
  const path = require("path");
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/{*path}", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
}

server.listen(3000, () => console.log("Backend running on http://localhost:3000"));
