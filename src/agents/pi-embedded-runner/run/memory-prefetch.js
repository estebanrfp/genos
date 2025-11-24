import { encode } from "@toon-format/toon";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { getMemorySearchManager } from "../../../memory/index.js";
import { resolveSessionAgentId } from "../../agent-scope.js";
import { resolveMemorySearchConfig } from "../../memory-search.js";

const prefetchLog = createSubsystemLogger("memory/prefetch");

const DEFAULT_PREFETCH_MAX_CHUNKS = 5;
const DEFAULT_PREFETCH_MIN_GATE = 0.2;

// Internal system prompts that should never trigger memory prefetch.
const INTERNAL_PROMPT_RE =
  /^Pre-compaction memory flush\b|^\[Memory Prefetch|^System compaction|^Context window/i;

/**
 * Strip system/channel metadata from the prompt to extract the user's actual query.
 * Removes: System: lines, Conversation info JSON blocks, timestamp prefixes,
 * and internal compaction/prefetch directives.
 * @param {string} prompt
 * @returns {string}
 */
const extractUserQuery = (prompt) => {
  if (INTERNAL_PROMPT_RE.test(prompt.trimStart())) {
    return "";
  }

  return prompt
    .replace(/^System:\s*\[.*?\].*$/gm, "")
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/g, "")
    .replace(/^\[.*?GMT.*?\]\s*/gm, "")
    .trim();
};

/**
 * Format memory chunks as TOON tabular array for compact LLM context.
 * @param {Array<{ snippet: string, path?: string, startLine?: number, endLine?: number, score?: number }>} chunks
 * @returns {string}
 */
const formatChunks = (chunks) => {
  const rows = chunks.map((chunk, i) => ({
    rank: i + 1,
    score: typeof chunk.score === "number" ? Number(chunk.score.toFixed(2)) : 0,
    source: chunk.path
      ? chunk.startLine
        ? `${chunk.path}:${chunk.startLine}-${chunk.endLine}`
        : chunk.path
      : "",
    snippet: chunk.snippet,
  }));
  return encode({ memories: rows });
};

/**
 * Prefetch relevant memory chunks for the user's prompt before sending to the LLM.
 * Uses a dynamic gate: retrieves all candidates then only injects if the top chunk
 * meets the minimum relevance threshold — no language-specific query normalization.
 *
 * @param {object} options
 * @param {string} options.prompt - User's prompt text
 * @param {object} options.config - GenosOS config
 * @param {string} [options.sessionKey] - Session key for agent scope resolution
 * @returns {Promise<{ context: string|null, chunks: number, searchMs: number }>}
 */
export async function prefetchMemoryContext({ prompt, config, sessionKey }) {
  const cfg = config;
  if (!cfg) {
    prefetchLog.info("skip: no config");
    return { context: null, chunks: 0, searchMs: 0 };
  }

  const memSearch = cfg.agents?.defaults?.memorySearch;
  if (!memSearch?.enabled) {
    prefetchLog.info("skip: memorySearch disabled");
    return { context: null, chunks: 0, searchMs: 0 };
  }

  const prefetch = memSearch?.prefetch;
  if (prefetch?.enabled === false) {
    prefetchLog.info("skip: prefetch explicitly disabled");
    return { context: null, chunks: 0, searchMs: 0 };
  }

  const agentId = sessionKey ? resolveSessionAgentId({ sessionKey, config: cfg }) : "main";

  if (!resolveMemorySearchConfig(cfg, agentId)) {
    prefetchLog.info(`skip: memorySearch not configured for agent=${agentId}`);
    return { context: null, chunks: 0, searchMs: 0 };
  }

  const maxChunks = prefetch?.maxChunks ?? DEFAULT_PREFETCH_MAX_CHUNKS;
  const minGate = prefetch?.minScore ?? DEFAULT_PREFETCH_MIN_GATE;

  const userQuery = extractUserQuery(prompt);
  if (!userQuery) {
    prefetchLog.info("skip: empty user query after stripping system lines");
    return { context: null, chunks: 0, searchMs: 0 };
  }

  const queryPreview = userQuery.length > 80 ? `${userQuery.slice(0, 80)}…` : userQuery;
  prefetchLog.info(
    `searching: query="${queryPreview}" maxChunks=${maxChunks} gate=${minGate} agent=${agentId}`,
  );

  const searchStart = Date.now();

  let manager;
  try {
    const result = await getMemorySearchManager({ cfg, agentId });
    manager = result.manager;
    if (!manager) {
      prefetchLog.info(`skip: manager unavailable — ${result.error ?? "unknown"}`);
      return { context: null, chunks: 0, searchMs: Date.now() - searchStart };
    }
  } catch (err) {
    prefetchLog.warn(`failed to get manager — ${err?.message ?? err}`);
    return { context: null, chunks: 0, searchMs: Date.now() - searchStart };
  }

  const searchSessionKey = sessionKey || `agent:${agentId}:direct:prefetch`;

  let chunks;
  try {
    chunks = await manager.search(userQuery, {
      maxResults: maxChunks,
      sessionKey: searchSessionKey,
    });
  } catch (err) {
    const msg = err?.message ?? String(err);
    const isProviderError =
      /429|402|rate.?limit|quota|billing|insufficient|api.?key|unauthorized/i.test(msg);
    if (isProviderError) {
      prefetchLog.error(`embedding provider error — ${msg}`);
    } else {
      prefetchLog.warn(`search failed — ${msg}`);
    }
    return { context: null, chunks: 0, searchMs: Date.now() - searchStart };
  }

  const searchMs = Date.now() - searchStart;

  if (!chunks?.length) {
    prefetchLog.info(`no chunks found (${searchMs}ms)`);
    return { context: null, chunks: 0, searchMs };
  }

  // Dynamic gate: only inject if the top chunk is relevant enough
  const topScore = chunks[0].score ?? 0;
  if (topScore < minGate) {
    prefetchLog.info(`gate blocked: top score ${topScore.toFixed(2)} < ${minGate} (${searchMs}ms)`);
    return { context: null, chunks: 0, searchMs };
  }

  const bottomScore = chunks[chunks.length - 1]?.score?.toFixed(2) ?? "?";
  prefetchLog.info(
    `injected ${chunks.length} chunks (${searchMs}ms) scores=${topScore.toFixed(2)}..${bottomScore}`,
  );

  const header = `[Memory Prefetch — ${chunks.length} relevant memories retrieved in ${searchMs}ms]`;
  const context = `${header}\n${formatChunks(chunks)}`;

  return { context, chunks: chunks.length, searchMs };
}
