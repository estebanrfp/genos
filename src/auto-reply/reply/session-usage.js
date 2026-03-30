let applyCliSessionIdToSessionPatch = function (params, entry, patch) {
  const cliProvider = params.providerUsed ?? entry.modelProvider;
  if (params.cliSessionId && cliProvider) {
    const nextEntry = { ...entry, ...patch };
    setCliSessionId(nextEntry, cliProvider, params.cliSessionId);
    return {
      ...patch,
      cliSessionIds: nextEntry.cliSessionIds,
      claudeCliSessionId: nextEntry.claudeCliSessionId,
    };
  }
  return patch;
};
import { setCliSessionId } from "../../agents/cli-session.js";
import { deriveSessionTotalTokens, hasNonzeroUsage } from "../../agents/usage.js";
import { updateSessionStoreEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
export async function persistSessionUsageUpdate(params) {
  const { storePath, sessionKey } = params;
  if (!storePath || !sessionKey) {
    return;
  }
  const label = params.logLabel ? `${params.logLabel} ` : "";
  if (hasNonzeroUsage(params.usage)) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          const input = params.usage?.input ?? 0;
          const output = params.usage?.output ?? 0;
          const resolvedContextTokens = params.contextTokensUsed ?? entry.contextTokens;
          const hasPromptTokens =
            typeof params.promptTokens === "number" &&
            Number.isFinite(params.promptTokens) &&
            params.promptTokens > 0;
          const hasFreshContextSnapshot = Boolean(params.lastCallUsage) || hasPromptTokens;
          const usageForContext = params.lastCallUsage ?? params.usage;
          const totalTokens = hasFreshContextSnapshot
            ? deriveSessionTotalTokens({
                usage: usageForContext,
                contextTokens: resolvedContextTokens,
                promptTokens: params.promptTokens,
              })
            : undefined;
          const patch = {
            inputTokens: input,
            outputTokens: output,
            totalTokens,
            totalTokensFresh: typeof totalTokens === "number",
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: resolvedContextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            updatedAt: Date.now(),
          };
          return applyCliSessionIdToSessionPatch(params, entry, patch);
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}usage update: ${String(err)}`);
    }
    return;
  }
  if (params.modelUsed || params.contextTokensUsed) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          const patch = {
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: params.contextTokensUsed ?? entry.contextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            updatedAt: Date.now(),
          };
          return applyCliSessionIdToSessionPatch(params, entry, patch);
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}model/context update: ${String(err)}`);
    }
  }
}
