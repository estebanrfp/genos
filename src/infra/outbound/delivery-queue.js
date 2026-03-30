let resolveQueueDir = function (stateDir) {
    const base = stateDir ?? resolveStateDir();
    return path.join(base, QUEUE_DIRNAME);
  },
  resolveFailedDir = function (stateDir) {
    return path.join(resolveQueueDir(stateDir), FAILED_DIRNAME);
  };
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { secureReadFile, secureWriteFile } from "../secure-io.js";
const QUEUE_DIRNAME = "delivery-queue";
const FAILED_DIRNAME = "failed";
const MAX_RETRIES = 5;
const BACKOFF_MS = [5000, 25000, 120000, 600000];
export async function ensureQueueDir(stateDir) {
  const queueDir = resolveQueueDir(stateDir);
  await fs.promises.mkdir(queueDir, { recursive: true, mode: 448 });
  await fs.promises.mkdir(resolveFailedDir(stateDir), { recursive: true, mode: 448 });
  return queueDir;
}
export async function enqueueDelivery(params, stateDir) {
  const queueDir = await ensureQueueDir(stateDir);
  const id = crypto.randomUUID();
  const entry = {
    id,
    enqueuedAt: Date.now(),
    channel: params.channel,
    to: params.to,
    accountId: params.accountId,
    payloads: params.payloads,
    threadId: params.threadId,
    replyToId: params.replyToId,
    bestEffort: params.bestEffort,
    gifPlayback: params.gifPlayback,
    silent: params.silent,
    mirror: params.mirror,
    retryCount: 0,
  };
  const filePath = path.join(queueDir, `${id}.json`);
  const json = JSON.stringify(entry, null, 2);
  await secureWriteFile(filePath, json);
  return id;
}
export async function ackDelivery(id, stateDir) {
  const filePath = path.join(resolveQueueDir(stateDir), `${id}.json`);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}
export async function failDelivery(id, error, stateDir) {
  const filePath = path.join(resolveQueueDir(stateDir), `${id}.json`);
  const raw = await secureReadFile(filePath);
  const entry = JSON.parse(raw);
  entry.retryCount += 1;
  entry.lastError = error;
  await secureWriteFile(filePath, JSON.stringify(entry, null, 2));
}
export async function loadPendingDeliveries(stateDir) {
  const queueDir = resolveQueueDir(stateDir);
  let files;
  try {
    files = await fs.promises.readdir(queueDir);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : null;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(queueDir, file);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      const raw = await secureReadFile(filePath);
      entries.push(JSON.parse(raw));
    } catch {}
  }
  return entries;
}
export async function moveToFailed(id, stateDir) {
  const queueDir = resolveQueueDir(stateDir);
  const failedDir = resolveFailedDir(stateDir);
  await fs.promises.mkdir(failedDir, { recursive: true, mode: 448 });
  const src = path.join(queueDir, `${id}.json`);
  const dest = path.join(failedDir, `${id}.json`);
  await fs.promises.rename(src, dest);
}
export function computeBackoffMs(retryCount) {
  if (retryCount <= 0) {
    return 0;
  }
  return BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1) ?? 0;
}
export async function recoverPendingDeliveries(opts) {
  const pending = await loadPendingDeliveries(opts.stateDir);
  if (pending.length === 0) {
    return { recovered: 0, failed: 0, skipped: 0 };
  }
  pending.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  opts.log.info(`Found ${pending.length} pending delivery entries \u2014 starting recovery`);
  const delayFn = opts.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.maxRecoveryMs ?? 60000);
  let recovered = 0;
  let failed = 0;
  let skipped = 0;
  for (const entry of pending) {
    const now = Date.now();
    if (now >= deadline) {
      const deferred = pending.length - recovered - failed - skipped;
      opts.log.warn(
        `Recovery time budget exceeded \u2014 ${deferred} entries deferred to next restart`,
      );
      break;
    }
    if (entry.retryCount >= MAX_RETRIES) {
      opts.log.warn(
        `Delivery ${entry.id} exceeded max retries (${entry.retryCount}/${MAX_RETRIES}) \u2014 moving to failed/`,
      );
      try {
        await moveToFailed(entry.id, opts.stateDir);
      } catch (err) {
        opts.log.error(`Failed to move entry ${entry.id} to failed/: ${String(err)}`);
      }
      skipped += 1;
      continue;
    }
    const backoff = computeBackoffMs(entry.retryCount + 1);
    if (backoff > 0) {
      if (now + backoff >= deadline) {
        const deferred = pending.length - recovered - failed - skipped;
        opts.log.warn(
          `Recovery time budget exceeded \u2014 ${deferred} entries deferred to next restart`,
        );
        break;
      }
      opts.log.info(`Waiting ${backoff}ms before retrying delivery ${entry.id}`);
      await delayFn(backoff);
    }
    try {
      await opts.deliver({
        cfg: opts.cfg,
        channel: entry.channel,
        to: entry.to,
        accountId: entry.accountId,
        payloads: entry.payloads,
        threadId: entry.threadId,
        replyToId: entry.replyToId,
        bestEffort: entry.bestEffort,
        gifPlayback: entry.gifPlayback,
        silent: entry.silent,
        mirror: entry.mirror,
        skipQueue: true,
      });
      await ackDelivery(entry.id, opts.stateDir);
      recovered += 1;
      opts.log.info(`Recovered delivery ${entry.id} to ${entry.channel}:${entry.to}`);
    } catch (err) {
      try {
        await failDelivery(
          entry.id,
          err instanceof Error ? err.message : String(err),
          opts.stateDir,
        );
      } catch {}
      failed += 1;
      opts.log.warn(
        `Retry failed for delivery ${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  opts.log.info(
    `Delivery recovery complete: ${recovered} recovered, ${failed} failed, ${skipped} skipped (max retries)`,
  );
  return { recovered, failed, skipped };
}

export { MAX_RETRIES };
