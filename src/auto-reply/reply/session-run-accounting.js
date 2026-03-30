import { deriveSessionTotalTokens } from "../../agents/usage.js";
import { incrementCompactionCount } from "./session-updates.js";
import { persistSessionUsageUpdate } from "./session-usage.js";
export async function persistRunSessionUsage(params) {
  await persistSessionUsageUpdate({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    usage: params.usage,
    lastCallUsage: params.lastCallUsage,
    promptTokens: params.promptTokens,
    modelUsed: params.modelUsed,
    providerUsed: params.providerUsed,
    contextTokensUsed: params.contextTokensUsed,
    systemPromptReport: params.systemPromptReport,
    cliSessionId: params.cliSessionId,
    logLabel: params.logLabel,
  });
}
export async function incrementRunCompactionCount(params) {
  const tokensAfterCompaction = params.lastCallUsage
    ? deriveSessionTotalTokens({
        usage: params.lastCallUsage,
        contextTokens: params.contextTokensUsed,
      })
    : undefined;
  return incrementCompactionCount({
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    tokensAfter: tokensAfterCompaction,
  });
}
