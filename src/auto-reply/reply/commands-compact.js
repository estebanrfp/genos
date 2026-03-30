let extractCompactInstructions = function (params) {
  const raw = stripStructuralPrefixes(params.rawBody ?? "");
  const stripped = params.isGroup
    ? stripMentions(raw, params.ctx, params.cfg, params.agentId)
    : raw;
  const trimmed = stripped.trim();
  if (!trimmed) {
    return;
  }
  const lowered = trimmed.toLowerCase();
  const prefix = lowered.startsWith("/compact") ? "/compact" : null;
  if (!prefix) {
    return;
  }
  let rest = trimmed.slice(prefix.length).trimStart();
  if (rest.startsWith(":")) {
    rest = rest.slice(1).trimStart();
  }
  return rest.length ? rest : undefined;
};
import {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  waitForEmbeddedPiRunEnd,
} from "../../agents/pi-embedded.js";
import {
  resolveFreshSessionTotalTokens,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { formatTokenCount } from "../status.js";
import { stripMentions, stripStructuralPrefixes } from "./mentions.js";
import { incrementCompactionCount } from "./session-updates.js";
export const handleCompactCommand = async (params) => {
  const compactRequested =
    params.command.commandBodyNormalized === "/compact" ||
    params.command.commandBodyNormalized.startsWith("/compact ");
  if (!compactRequested) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /compact from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!params.sessionEntry?.sessionId) {
    return {
      shouldContinue: false,
      reply: { text: "\u2699\uFE0F Compaction unavailable (missing session id)." },
    };
  }
  const sessionId = params.sessionEntry.sessionId;
  if (isEmbeddedPiRunActive(sessionId)) {
    abortEmbeddedPiRun(sessionId);
    await waitForEmbeddedPiRunEnd(sessionId, 15000);
  }
  const customInstructions = extractCompactInstructions({
    rawBody: params.ctx.CommandBody ?? params.ctx.RawBody ?? params.ctx.Body,
    ctx: params.ctx,
    cfg: params.cfg,
    agentId: params.agentId,
    isGroup: params.isGroup,
  });
  const compactRunId = `compact-manual-${sessionId}`;
  emitAgentEvent({
    runId: compactRunId,
    sessionKey: params.sessionKey,
    stream: "compaction",
    data: { phase: "start" },
  });
  const result = await compactEmbeddedPiSession({
    sessionId,
    sessionKey: params.sessionKey,
    messageChannel: params.command.channel,
    groupId: params.sessionEntry.groupId,
    groupChannel: params.sessionEntry.groupChannel,
    groupSpace: params.sessionEntry.space,
    spawnedBy: params.sessionEntry.spawnedBy,
    authProfileId: params.sessionEntry.authProfileOverride,
    sessionFile: resolveSessionFilePath(
      sessionId,
      params.sessionEntry,
      resolveSessionFilePathOptions({
        agentId: params.agentId,
        storePath: params.storePath,
      }),
    ),
    workspaceDir: params.workspaceDir,
    config: params.cfg,
    skillsSnapshot: params.sessionEntry.skillsSnapshot,
    provider: params.provider,
    model: params.model,
    thinkLevel: params.resolvedThinkLevel ?? (await params.resolveDefaultThinkingLevel()),
    bashElevated: {
      enabled: false,
      allowed: false,
      defaultLevel: "off",
    },
    customInstructions,
    trigger: "manual",
    senderIsOwner: params.command.senderIsOwner,
    ownerNumbers: params.command.ownerList.length > 0 ? params.command.ownerList : undefined,
  });
  emitAgentEvent({
    runId: compactRunId,
    sessionKey: params.sessionKey,
    stream: "compaction",
    data: { phase: "end", willRetry: false },
  });
  if (result.ok && result.compacted) {
    await incrementCompactionCount({
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      storePath: params.storePath,
      tokensAfter: result.result?.tokensAfter,
    });
  }
  const tokensAfterCompaction = result.result?.tokensAfter;
  const totalTokens = tokensAfterCompaction ?? resolveFreshSessionTotalTokens(params.sessionEntry);
  const ctxTokens = params.contextTokens ?? params.sessionEntry.contextTokens ?? null;
  const line = (() => {
    if (!result.ok) {
      const reason = result.reason?.trim();
      return reason ? `Compaction failed: ${reason}` : "Compaction failed";
    }
    if (!result.compacted) {
      return "Compaction skipped";
    }
    const before = result.result?.tokensBefore;
    const after = result.result?.tokensAfter;
    const ctxLabel = ctxTokens ? formatTokenCount(ctxTokens) : null;
    const pct =
      typeof totalTokens === "number" && ctxTokens
        ? Math.round((totalTokens / ctxTokens) * 100)
        : null;
    const suffix = ctxLabel ? `/${ctxLabel}${pct !== null ? ` (${pct}%)` : ""}` : "";
    if (before && after) {
      return `Compaction ${formatTokenCount(before)} \u2192 ${formatTokenCount(after)}${suffix}`;
    }
    if (before) {
      return `Compaction ${formatTokenCount(before)} \u2192 ${formatTokenCount(totalTokens)}${suffix}`;
    }
    return `Compaction ${formatTokenCount(totalTokens)}${suffix}`;
  })();
  // Compaction result shown via divider — no need to enqueue as system event.
  return { shouldContinue: false, reply: { text: line } };
};
