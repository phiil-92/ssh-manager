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
`);

// Migration: add tags column to existing databases
const cols = db.prepare("PRAGMA table_info(hosts)").all();
if (!cols.some((c) => c.name === "tags")) {
  db.exec("ALTER TABLE hosts ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
}
if (!cols.some((c) => c.name === "favorite")) {
  db.exec("ALTER TABLE hosts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
}
if (!cols.some((c) => c.name === "last_connected_at")) {
  db.exec("ALTER TABLE hosts ADD COLUMN last_connected_at TEXT");
}
module.exports = db;
