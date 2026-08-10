const argon2 = require("argon2");
const crypto = require("crypto");
const db = require("./db");

let masterKey = null;

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function isSetUp() {
  return !!db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
}

function isUnlocked() {
  return masterKey !== null;
}

async function setup(masterPassword) {
  const verifyHash = await argon2.hash(masterPassword, ARGON_OPTS);
  const salt = crypto.randomBytes(16);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('verify_hash', ?)").run(verifyHash);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('kdf_salt', ?)").run(salt.toString("base64"));
  masterKey = await deriveKey(masterPassword, salt);
}

async function unlock(masterPassword) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
  if (!row) throw new Error("Not set up yet");
  const ok = await argon2.verify(row.value, masterPassword);
  if (!ok) return false;
  const salt = Buffer.from(
    db.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get().value,
    "base64"
  );
  masterKey = await deriveKey(masterPassword, salt);
  return true;
}

function lock() {
  masterKey = null;
}

async function deriveKey(password, salt) {
  return argon2.hash(password, { ...ARGON_OPTS, salt, hashLength: 32, raw: true });
}

function encryptWith(key, plaintext) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
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

// Verify old password, re-encrypt every credential under a new key
async function changeMasterPassword(currentPassword, newPassword) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
  if (!row) throw new Error("Not set up");
  const ok = await argon2.verify(row.value, currentPassword);
  if (!ok) return false;

  const salt = Buffer.from(
    db.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get().value,
    "base64"
  );
  const oldKey = await deriveKey(currentPassword, salt);

  const rows = db.prepare("SELECT id, enc_password FROM hosts WHERE enc_password IS NOT NULL").all();
  const decrypted = rows.map((r) => ({ id: r.id, pw: decryptWith(oldKey, r.enc_password) }));

  await setup(newPassword); // new salt + hash, masterKey now = new key

  const upd = db.prepare("UPDATE hosts SET enc_password = ? WHERE id = ?");
  for (const d of decrypted) upd.run(encrypt(d.pw), d.id);
  return true;
}

// Nuclear option: all hosts + the vault itself
function wipeAll() {
  db.exec("DELETE FROM hosts; DELETE FROM meta;");
  masterKey = null;
}

module.exports = {
  isSetUp, isUnlocked, setup, unlock, lock,
  encrypt, decrypt, changeMasterPassword, wipeAll,
};
