let ensureBunCustomSqlite = function (BunDatabase) {
    if (customSqliteConfigured || process.platform !== "darwin") {
      customSqliteConfigured = true;
      return;
    }
    customSqliteConfigured = true;
    const brewPaths = [
      "/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
    ];
    for (const p of brewPaths) {
      try {
        if (fs.existsSync(p)) {
          BunDatabase.setCustomSQLite(p);
          return;
        }
      } catch {}
    }
  },
  openBunDatabase = function (dbPath) {
    const req = createRequire(import.meta.url);
    const { Database } = req("bun:sqlite");
    ensureBunCustomSqlite(Database);
    return new Database(dbPath);
  },
  openNodeDatabase = function (dbPath) {
    installProcessWarningFilter();
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req("node:sqlite");
    const db = new DatabaseSync(dbPath, { allowExtension: true });
    return db;
  };
import fs from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { installProcessWarningFilter } from "../infra/warning-filter.js";
const isBun = !!process.versions.bun;
let customSqliteConfigured = false;

/**
 * Apply security-hardening PRAGMAs to a database connection.
 * @param {object} db
 */
function applySecurityPragmas(db) {
  db.exec("PRAGMA secure_delete = ON");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA journal_size_limit = 0");
}

export function openDatabase(dbPath) {
  const db = isBun ? openBunDatabase(dbPath) : openNodeDatabase(dbPath);
  applySecurityPragmas(db);
  // Ensure DB file has restricted permissions
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {}
  return db;
}

/**
 * Close a database connection with WAL cleanup.
 * Checkpoints the WAL, closes the connection, and removes WAL/SHM files.
 * @param {object} db
 * @param {string} dbPath
 */
export function closeDatabase(db, dbPath) {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {}
  db.close();
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {}
  }
}
