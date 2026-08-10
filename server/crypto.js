const argon2 = require("argon2");
const crypto = require("crypto");
const db = require("./db");

// Held in RAM only while unlocked. Never persisted.
let masterKey = null;

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

function isSetUp() {
  return !!db.prepare("SELECT value FROM meta WHERE key = 'verify_hash'").get();
}

function isUnlocked() {
  return masterKey !== null;
}

// First run: create verify-hash + salt, derive key
async function setup(masterPassword) {
  const verifyHash = await argon2.hash(masterPassword, ARGON_OPTS);
  const salt = crypto.randomBytes(16);

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('verify_hash', ?)").run(verifyHash);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('kdf_salt', ?)").run(salt.toString("base64"));

  masterKey = await deriveKey(masterPassword, salt);
}

// Later runs: check password, derive the same key
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

// AES-256-GCM, fresh nonce per secret. Output: nonce.ciphertext.authTag (base64)
function encrypt(plaintext) {
  if (!masterKey) throw new Error("Vault is locked");
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce, ct, tag].map((b) => b.toString("base64")).join(".");
}

function decrypt(payload) {
  if (!masterKey) throw new Error("Vault is locked");
  const [nonce, ct, tag] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

module.exports = { isSetUp, isUnlocked, setup, unlock, lock, encrypt, decrypt };
