import fs from "node:fs";
import { load, getLoadablePath } from "sqlite-vec";

const isBun = typeof globalThis.Bun !== "undefined";

let db;

if (isBun) {
  const { Database } = await import("bun:sqlite");

  // On macOS, Bun's bundled SQLite lacks extension support;
  // point it at Homebrew's build which includes load_extension.
  if (process.platform === "darwin") {
    const brewPaths = [
      "/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
    ];
    for (const p of brewPaths) {
      if (fs.existsSync(p)) {
        Database.setCustomSQLite(p);
        break;
      }
    }
  }

  db = new Database(":memory:");
} else {
  // Hide the specifier from Bun's static analysis
  const mod = ["node", "sqlite"].join(":");
  const { DatabaseSync } = await import(mod);
  db = new DatabaseSync(":memory:", { allowExtension: true });
}

/** @param {number[]} values */
const vec = (values) => Buffer.from(new Float32Array(values).buffer);

try {
  if (isBun) {
    db.loadExtension(getLoadablePath());
  } else {
    load(db);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("sqlite-vec load failed:");
  console.error(message);
  console.error("expected extension path:", getLoadablePath());
  process.exit(1);
}

db.exec(`
  CREATE VIRTUAL TABLE v USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[4]
  );
`);

const insert = db.prepare("INSERT INTO v (id, embedding) VALUES (?, ?)");
insert.run("a", vec([1, 0, 0, 0]));
insert.run("b", vec([0, 1, 0, 0]));
insert.run("c", vec([0.2, 0.2, 0, 0]));

const query = vec([1, 0, 0, 0]);
const rows = db
  .prepare("SELECT id, vec_distance_cosine(embedding, ?) AS dist FROM v ORDER BY dist ASC")
  .all(query);

console.log("sqlite-vec ok");
console.log(rows);
