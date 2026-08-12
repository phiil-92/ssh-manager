const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "ssh-manager.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    enc_password TEXT,
    folder_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const cols = db.prepare("PRAGMA table_info(hosts)").all();
const migrations = [
  ["tags",            "ALTER TABLE hosts ADD COLUMN tags TEXT NOT NULL DEFAULT ''"],
  ["favorite",        "ALTER TABLE hosts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"],
  ["last_connected_at","ALTER TABLE hosts ADD COLUMN last_connected_at TEXT"],
  ["notes",           "ALTER TABLE hosts ADD COLUMN notes TEXT NOT NULL DEFAULT ''"],
  ["auth_type",       "ALTER TABLE hosts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password'"],
  ["enc_private_key", "ALTER TABLE hosts ADD COLUMN enc_private_key TEXT"],
  ["key_passphrase",  "ALTER TABLE hosts ADD COLUMN key_passphrase TEXT"],
  ["mac_address",     "ALTER TABLE hosts ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''"],
];
for (const [col, sql] of migrations) {
  if (!cols.some((c) => c.name === col)) db.exec(sql);
}

module.exports = db;
