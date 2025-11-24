import { randomUUID } from "node:crypto";
const RESOLVED_ENTRY_GRACE_MS = 15000;

export class ExecApprovalManager {
  pending = new Map();
  create(request, timeoutMs, id) {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    const record = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
    return record;
  }
  register(record, timeoutMs) {
    const existing = this.pending.get(record.id);
    if (existing) {
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`approval id '${record.id}' already resolved`);
    }
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry = {
      record,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer: null,
      promise,
    };
    entry.timer = setTimeout(() => {
      record.resolvedAtMs = Date.now();
      record.decision = undefined;
      record.resolvedBy = null;
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
  async waitForDecision(record, timeoutMs) {
    return this.register(record, timeoutMs);
  }
  resolve(recordId, decision, resolvedBy) {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return false;
    }
    if (pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(decision);
    setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    return true;
  }
  getSnapshot(recordId) {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }
  awaitDecision(recordId) {
    const entry = this.pending.get(recordId);
    return entry?.promise ?? null;
  }
}
