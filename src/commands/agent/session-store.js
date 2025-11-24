import { setCliSessionId } from "../../agents/cli-session.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { deriveSessionTotalTokens, hasNonzeroUsage } from "../../agents/usage.js";
import { updateSessionStore } from "../../config/sessions.js";
export async function updateSessionStoreAfterAgentRun(params) {
  const {
    cfg,
    sessionId,
    sessionKey,
    storePath,
    sessionStore,
    defaultProvider,
    defaultModel,
    fallbackProvider,
    fallbackModel,
    result,
  } = params;
  const usage = result.meta.agentMeta?.usage;
  const promptTokens = result.meta.agentMeta?.promptTokens;
  const compactionsThisRun = Math.max(0, result.meta.agentMeta?.compactionCount ?? 0);
  const modelUsed = result.meta.agentMeta?.model ?? fallbackModel ?? defaultModel;
  const providerUsed = result.meta.agentMeta?.provider ?? fallbackProvider ?? defaultProvider;
  const contextTokens =
    params.contextTokensOverride ?? lookupContextTokens(modelUsed) ?? DEFAULT_CONTEXT_TOKENS;
  const entry = sessionStore[sessionKey] ?? {
    sessionId,
    updatedAt: Date.now(),
  };
  const next = {
    ...entry,
    sessionId,
    updatedAt: Date.now(),
    modelProvider: providerUsed,
    model: modelUsed,
    contextTokens,
  };
  if (isCliProvider(providerUsed, cfg)) {
    const cliSessionId = result.meta.agentMeta?.sessionId?.trim();
    if (cliSessionId) {
      setCliSessionId(next, providerUsed, cliSessionId);
    }
  }
  next.abortedLastRun = result.meta.aborted ?? false;
  if (hasNonzeroUsage(usage)) {
    const input = usage.input ?? 0;
    const output = usage.output ?? 0;
    const totalTokens =
      deriveSessionTotalTokens({
        usage,
        contextTokens,
        promptTokens,
      }) ?? input;
    next.inputTokens = input;
    next.outputTokens = output;
    next.totalTokens = totalTokens;
    next.totalTokensFresh = true;
  }
  if (compactionsThisRun > 0) {
    next.compactionCount = (entry.compactionCount ?? 0) + compactionsThisRun;
  }
  sessionStore[sessionKey] = next;
  // Override fields (modelOverride, providerOverride) are exclusively managed by
  // session_status / sessions.patch. The in-memory `entry` (loaded at request start) may
  // hold stale values. Strip them from the merge payload, then explicitly re-apply whatever
  // the on-disk entry has — this is the authoritative source written by tools during the run.
  const { modelOverride: _mo, providerOverride: _po, ...nextWithoutOverrides } = next;
  await updateSessionStore(storePath, (store) => {
    const current = store[sessionKey];
    if (!current) {
      store[sessionKey] = next;
      return;
    }
    const merged = { ...current, ...nextWithoutOverrides };
    // Re-apply authoritative override values from the on-disk entry
    if ("modelOverride" in current) {
      merged.modelOverride = current.modelOverride;
    } else {
      delete merged.modelOverride;
    }
    if ("providerOverride" in current) {
      merged.providerOverride = current.providerOverride;
    } else {
      delete merged.providerOverride;
    }
    store[sessionKey] = merged;
  });
}
