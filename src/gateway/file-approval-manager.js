import { randomUUID } from "node:crypto";

const RESOLVED_ENTRY_GRACE_MS = 15000;
export const DEFAULT_FILE_APPROVAL_TIMEOUT_MS = 120000;

export class FileApprovalManager {
  pending = new Map();

  /** @param {{ agentId: string, name: string, operation: string, preview: string }} request */
  create(request, timeoutMs = DEFAULT_FILE_APPROVAL_TIMEOUT_MS) {
    const now = Date.now();
    return { id: randomUUID(), request, createdAtMs: now, expiresAtMs: now + timeoutMs };
  }

  register(record, timeoutMs = DEFAULT_FILE_APPROVAL_TIMEOUT_MS) {
    const existing = this.pending.get(record.id);
    if (existing) {
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`file approval id '${record.id}' already resolved`);
    }
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const entry = { record, resolve: resolvePromise, timer: null, promise };
    entry.timer = setTimeout(() => {
      record.resolvedAtMs = Date.now();
      record.decision = null;
      resolvePromise(null);
      setTimeout(() => {
        if (this.pending.get(record.id) === entry) {
          this.pending.delete(record.id);
        }
      }, RESOLVED_ENTRY_GRACE_MS);
    }, timeoutMs);
    this.pending.set(record.id, entry);
    return promise;
  }

  resolve(id, decision, resolvedBy = null) {
    const pending = this.pending.get(id);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy;
    pending.resolve(decision);
    setTimeout(() => {
      if (this.pending.get(id) === pending) {
        this.pending.delete(id);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    return true;
  }

  getSnapshot(id) {
    return this.pending.get(id)?.record ?? null;
  }

  listPending() {
    const now = Date.now();
    return [...this.pending.values()]
      .filter((e) => e.record.resolvedAtMs === undefined && e.record.expiresAtMs > now)
      .map((e) => e.record);
  }
}
