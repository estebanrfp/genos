import { listAgentIds } from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { resolveMemoryBackendConfig } from "../memory/backend-config.js";
import { getMemorySearchManager } from "../memory/index.js";

export async function startGatewayMemoryBackend(params) {
  const agentIds = listAgentIds(params.cfg);
  for (const agentId of agentIds) {
    const resolved = resolveMemoryBackendConfig({ cfg: params.cfg, agentId });
    if (resolved.backend === "qmd" && resolved.qmd) {
      const { manager, error } = await getMemorySearchManager({ cfg: params.cfg, agentId });
      if (!manager) {
        params.log.warn(
          `qmd memory startup initialization failed for agent "${agentId}": ${error ?? "unknown error"}`,
        );
        continue;
      }
      params.log.info?.(`qmd memory startup initialization armed for agent "${agentId}"`);
    } else {
      await warmupBuiltinMemoryEmbeddings(params, agentId);
    }
  }
}

/**
 * Warm up the builtin memory embedding provider at gateway startup.
 * Initializes the manager (SQLite + sqlite-vec) and makes a probe embedding call
 * to establish the HTTP connection pool, so the first real user query hits warm paths.
 * @param {{ cfg: object, log: object }} params
 * @param {string} agentId
 */
async function warmupBuiltinMemoryEmbeddings(params, agentId) {
  const memSearchCfg = resolveMemorySearchConfig(params.cfg, agentId);
  if (!memSearchCfg?.enabled) {
    return;
  }

  const { manager, error } = await getMemorySearchManager({ cfg: params.cfg, agentId });
  if (!manager) {
    params.log.debug?.(`memory warmup: manager unavailable for agent "${agentId}": ${error}`);
    return;
  }

  const probe = await manager.probeEmbeddingAvailability();
  if (probe.ok) {
    params.log.info(`memory embeddings warmed (agent=${agentId})`);
  } else {
    params.log.warn(`memory embedding provider unavailable (agent=${agentId}): ${probe.error}`);
  }
}
