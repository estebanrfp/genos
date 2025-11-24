import { createSubsystemLogger } from "../logging/subsystem.js";
import { buildFileEntry, listMemoryFiles } from "./internal.js";
import { indexFileEntryIfChanged } from "./sync-index.js";
import { bumpSyncProgressTotal } from "./sync-progress.js";
import { deleteStaleIndexedPaths } from "./sync-stale.js";
const log = createSubsystemLogger("memory");
export async function syncMemoryFiles(params) {
  const files = await listMemoryFiles(params.workspaceDir, params.extraPaths);
  const fileEntries = await Promise.all(
    files.map(async (file) => buildFileEntry(file, params.workspaceDir)),
  );
  log.debug("memory sync: indexing memory files", {
    files: fileEntries.length,
    needsFullReindex: params.needsFullReindex,
    batch: params.batchEnabled,
    concurrency: params.concurrency,
  });
  const activePaths = new Set(fileEntries.map((entry) => entry.path));
  bumpSyncProgressTotal(
    params.progress,
    fileEntries.length,
    params.batchEnabled ? "Indexing memory files (batch)..." : "Indexing memory files\u2026",
  );
  const tasks = fileEntries.map((entry) => async () => {
    await indexFileEntryIfChanged({
      db: params.db,
      source: "memory",
      needsFullReindex: params.needsFullReindex,
      entry,
      indexFile: params.indexFile,
      progress: params.progress,
    });
  });
  await params.runWithConcurrency(tasks, params.concurrency);
  deleteStaleIndexedPaths({
    db: params.db,
    source: "memory",
    activePaths,
    vectorTable: params.vectorTable,
    ftsTable: params.ftsTable,
    ftsEnabled: params.ftsEnabled,
    ftsAvailable: params.ftsAvailable,
    model: params.model,
  });
}
