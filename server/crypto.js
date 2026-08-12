const argon2   = require("argon2");
const crypto   = require("crypto");
const speakeasy= require("speakeasy");
const db       = require("./db");

let masterKey = null;

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function isSetUp()     { return !!db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get(); }
function isUnlocked()  { return masterKey !== null; }
function is2FAEnabled(){ return db.prepare("SELECT value FROM meta WHERE key = 'totp_enabled'").get()?.value === "true"; }

async function setup(masterPassword) {
  const verifyHash = await argon2.hash(masterPassword, ARGON_OPTS);
  const salt = crypto.randomBytes(16);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('verify_hash', ?)").run(verifyHash);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('kdf_salt', ?)"  ).run(salt.toString("base64"));
  masterKey = await deriveKey(masterPassword, salt);
}

// Returns { ok, requires2fa?, error? }
async function unlock(masterPassword, token = null) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
  if (!row) throw new Error("Not set up yet");

  const ok = await argon2.verify(row.value, masterPassword);
  if (!ok) return { ok: false, error: "wrong_password" };

  if (is2FAEnabled()) {
    if (!token) return { ok: false, requires2fa: true };
    const salt      = Buffer.from(db.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get().value, "base64");
    const tempKey   = await deriveKey(masterPassword, salt);
    const secretRow = db.prepare("SELECT value FROM meta WHERE key = 'totp_secret'").get();
    if (!secretRow) return { ok: false, requires2fa: true };
    const secret = decryptWith(tempKey, secretRow.value);
    const valid  = speakeasy.totp.verify({ secret, encoding: "base32", token: String(token), window: 2 });
    if (!valid) return { ok: false, error: "wrong_token" };
  }

  const salt = Buffer.from(db.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get().value, "base64");
  masterKey = await deriveKey(masterPassword, salt);
  return { ok: true };
}

function lock() { masterKey = null; }

async function deriveKey(password, salt) {
  return argon2.hash(password, { ...ARGON_OPTS, salt, hashLength: 32, raw: true });
}

function encryptWith(key, plaintext) {
  const nonce  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [nonce, ct, tag].map((b) => b.toString("base64")).join(".");
}

function decryptWith(key, payload) {
  const [nonce, ct, tag] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function encrypt(plaintext) {
  if (!masterKey) throw new Error("Vault is locked");
  return encryptWith(masterKey, plaintext);
}
function decrypt(payload) {
  if (!masterKey) throw new Error("Vault is locked");
  return decryptWith(masterKey, payload);
}

async function changeMasterPassword(currentPassword, newPassword) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
  if (!row) throw new Error("Not set up");
  const ok = await argon2.verify(row.value, currentPassword);
  if (!ok) return false;

  const salt   = Buffer.from(db.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get().value, "base64");
  const oldKey = await deriveKey(currentPassword, salt);

  const pwRows  = db.prepare("SELECT id, enc_password    FROM hosts WHERE enc_password    IS NOT NULL").all();
  const keyRows = db.prepare("SELECT id, enc_private_key FROM hosts WHERE enc_private_key IS NOT NULL").all();
  const kpRows  = db.prepare("SELECT id, key_passphrase  FROM hosts WHERE key_passphrase  IS NOT NULL").all();
  const totpRow = db.prepare("SELECT value FROM meta WHERE key = 'totp_secret'").get();

  const decPw   = pwRows .map((r) => ({ id: r.id, v: decryptWith(oldKey, r.enc_password) }));
  const decKey  = keyRows.map((r) => ({ id: r.id, v: decryptWith(oldKey, r.enc_private_key) }));
  const decKp   = kpRows .map((r) => ({ id: r.id, v: decryptWith(oldKey, r.key_passphrase) }));
  const decTotp = totpRow ? decryptWith(oldKey, totpRow.value) : null;

  await setup(newPassword); // new salt + hash + masterKey

  for (const d of decPw)  db.prepare("UPDATE hosts SET enc_password    = ? WHERE id = ?").run(encrypt(d.v), d.id);
  for (const d of decKey) db.prepare("UPDATE hosts SET enc_private_key = ? WHERE id = ?").run(encrypt(d.v), d.id);
  for (const d of decKp)  db.prepare("UPDATE hosts SET key_passphrase  = ? WHERE id = ?").run(encrypt(d.v), d.id);
  if (decTotp) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('totp_secret', ?)").run(encrypt(decTotp));

  return true;
}

function wipeAll() {
  db.exec("DELETE FROM hosts; DELETE FROM meta; DELETE FROM folders; DELETE FROM snippets;");
  masterKey = null;
}

// ---------- 2FA ----------

function generate2FASecret() {
  if (!masterKey) throw new Error("Vault is locked");
  const secret = speakeasy.generateSecret({ name: "SSH Manager", issuer: "SSH Manager", length: 32 });
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('totp_pending', ?)").run(encryptWith(masterKey, secret.base32));
  return { secret: secret.base32, otpauthUrl: secret.otpauth_url };
}

function confirm2FASetup(token) {
  if (!masterKey) throw new Error("Vault is locked");
  const pendingRow = db.prepare("SELECT value FROM meta WHERE key = 'totp_pending'").get();
  if (!pendingRow) throw new Error("No pending 2FA setup — start setup again.");
  const secret = decryptWith(masterKey, pendingRow.value);
  const valid  = speakeasy.totp.verify({ secret, encoding: "base32", token: String(token), window: 2 });
  if (!valid) return false;
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('totp_secret', ?)").run(pendingRow.value);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('totp_enabled', 'true')").run();
  db.prepare("DELETE FROM meta WHERE key = 'totp_pending'").run();
  return true;
}

function disable2FA(token) {
  if (!masterKey) throw new Error("Vault is locked");
  const secretRow = db.prepare("SELECT value FROM meta WHERE key = 'totp_secret'").get();
  if (secretRow) {
    const secret = decryptWith(masterKey, secretRow.value);
    const valid  = speakeasy.totp.verify({ secret, encoding: "base32", token: String(token), window: 2 });
    if (!valid) return false;
  }
  db.prepare("DELETE FROM meta WHERE key IN ('totp_secret','totp_enabled','totp_pending')").run();
  return true;
}

// ---------- Export / Import ----------

async function exportData(masterPassword) {
  if (!masterKey) throw new Error("Vault is locked");
  const row = db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
  if (!row) throw new Error("Not set up");
  const ok = await argon2.verify(row.value, masterPassword);
  if (!ok) return null;

  const folders  = db.prepare("SELECT id, name FROM folders").all();
  const snippets = db.prepare("SELECT id, name, command FROM snippets").all();
  const hosts    = db.prepare("SELECT * FROM hosts").all();

  const hostsClean = hosts.map((h) => {
    let password = null, private_key = null, key_passphrase_plain = null;
    if (h.enc_password)    try { password            = decryptWith(masterKey, h.enc_password); }    catch {}
    if (h.enc_private_key) try { private_key         = decryptWith(masterKey, h.enc_private_key); } catch {}
    if (h.key_passphrase)  try { key_passphrase_plain= decryptWith(masterKey, h.key_passphrase); }  catch {}
    const { enc_password, enc_private_key, key_passphrase, ...rest } = h;
    return { ...rest, password, private_key, key_passphrase_plain };
  });

  const payload   = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), folders, hosts: hostsClean, snippets });
  const salt      = crypto.randomBytes(16);
  const exportKey = await deriveKey(masterPassword, salt);
  const nonce     = crypto.randomBytes(12);
  const cipher    = crypto.createCipheriv("aes-256-gcm", exportKey, nonce);
  const ct        = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag       = cipher.getAuthTag();
  return JSON.stringify({ v: 1, app: "ssh-manager", salt: salt.toString("base64"), nonce: nonce.toString("base64"), tag: tag.toString("base64"), data: ct.toString("base64") });
}

async function importData(fileContent, exportPassword) {
  if (!masterKey) throw new Error("Vault is locked");
  let file;
  try { file = JSON.parse(fileContent); } catch { throw new Error("Invalid file format"); }
  if (file.app !== "ssh-manager" || file.v !== 1) throw new Error("Not an SSH Manager export file");
  const salt      = Buffer.from(file.salt,  "base64");
  const exportKey = await deriveKey(exportPassword, salt);
  const nonce     = Buffer.from(file.nonce, "base64");
  const ct        = Buffer.from(file.data,  "base64");
  const tag       = Buffer.from(file.tag,   "base64");
  const decipher  = crypto.createDecipheriv("aes-256-gcm", exportKey, nonce);
  decipher.setAuthTag(tag);
  let plaintext;
  try { plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"); }
  catch { throw new Error("Wrong password or corrupted file"); }
  return JSON.parse(plaintext);
}

module.exports = {
  isSetUp, isUnlocked, is2FAEnabled, setup, unlock, lock,
  encrypt, decrypt, changeMasterPassword, wipeAll,
  generate2FASecret, confirm2FASetup, disable2FA,
  exportData, importData,
};
