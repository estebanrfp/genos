import { Database } from "bun:sqlite";
import { loadSqliteVecExtension } from "../src/memory/sqlite-vec.js";

const TARGET = "memory/2026-02-22-transporte-valencia.md";

const db = new Database("/Users/estebanrfp/.genos/memory/main.sqlite");
await loadSqliteVecExtension({ db });

const chunks = db.prepare("SELECT id FROM chunks WHERE path = ?").all(TARGET);
console.log("Chunks to delete:", chunks.length);

for (const { id } of chunks) {
  db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(id);
}

const r1 = db.prepare("DELETE FROM chunks WHERE path = ?").run(TARGET);
console.log("Deleted from chunks:", r1.changes);

const r2 = db.prepare("DELETE FROM files WHERE path = ?").run(TARGET);
console.log("Deleted from files:", r2.changes);

const remaining = db
  .prepare(
    "SELECT COUNT(*) as n FROM chunks WHERE path LIKE '%transporte%' OR path LIKE '%metrobus%' OR path LIKE '%135%'",
  )
  .get();
console.log("Remaining transport chunks:", remaining.n);

db.close();
console.log("✅ Done — transport data removed from vector index");
