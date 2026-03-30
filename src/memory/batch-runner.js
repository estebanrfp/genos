import { splitBatchRequests } from "./batch-utils.js";
import { runWithConcurrency } from "./internal.js";
export async function runEmbeddingBatchGroups(params) {
  if (params.requests.length === 0) {
    return new Map();
  }
  const groups = splitBatchRequests(params.requests, params.maxRequests);
  const byCustomId = new Map();
  const tasks = groups.map((group, groupIndex) => async () => {
    await params.runGroup({ group, groupIndex, groups: groups.length, byCustomId });
  });
  params.debug?.(params.debugLabel, {
    requests: params.requests.length,
    groups: groups.length,
    wait: params.wait,
    concurrency: params.concurrency,
    pollIntervalMs: params.pollIntervalMs,
    timeoutMs: params.timeoutMs,
  });
  await runWithConcurrency(tasks, params.concurrency);
  return byCustomId;
}
