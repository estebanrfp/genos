let shouldSendWarning = function () {
    return !process.env.VITEST && true;
  },
  buildWarningContext = function (params) {
    const { warning } = params;
    return [
      warning.activeSessionKey,
      warning.pruneAfterMs,
      warning.maxEntries,
      warning.wouldPrune ? "prune" : "",
      warning.wouldCap ? "cap" : "",
    ]
      .filter(Boolean)
      .join("|");
  },
  formatDuration = function (ms) {
    if (ms >= 86400000) {
      const days = Math.round(ms / 86400000);
      return `${days} day${days === 1 ? "" : "s"}`;
    }
    if (ms >= 3600000) {
      const hours = Math.round(ms / 3600000);
      return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
    if (ms >= 60000) {
      const mins = Math.round(ms / 60000);
      return `${mins} minute${mins === 1 ? "" : "s"}`;
    }
    const secs = Math.round(ms / 1000);
    return `${secs} second${secs === 1 ? "" : "s"}`;
  },
  buildWarningText = function (warning) {
    const reasons = [];
    if (warning.wouldPrune) {
      reasons.push(`older than ${formatDuration(warning.pruneAfterMs)}`);
    }
    if (warning.wouldCap) {
      reasons.push(`not in the most recent ${warning.maxEntries} sessions`);
    }
    const reasonText = reasons.length > 0 ? reasons.join(" and ") : "over maintenance limits";
    return `\u26A0\uFE0F Session maintenance warning: this active session would be evicted (${reasonText}). Maintenance is set to warn-only, so nothing was reset. To enforce cleanup, set \`session.maintenance.mode: "enforce"\` or increase the limits.`;
  };
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import { resolveSessionDeliveryTarget } from "./outbound/targets.js";
import { enqueueSystemEvent } from "./system-events.js";
const warnedContexts = new Map();
export async function deliverSessionMaintenanceWarning(params) {
  if (!shouldSendWarning()) {
    return;
  }
  const contextKey = buildWarningContext(params);
  if (warnedContexts.get(params.sessionKey) === contextKey) {
    return;
  }
  warnedContexts.set(params.sessionKey, contextKey);
  const text = buildWarningText(params.warning);
  const target = resolveSessionDeliveryTarget({
    entry: params.entry,
    requestedChannel: "last",
  });
  if (!target.channel || !target.to) {
    enqueueSystemEvent(text, { sessionKey: params.sessionKey });
    return;
  }
  const channel = normalizeMessageChannel(target.channel) ?? target.channel;
  if (!isDeliverableMessageChannel(channel)) {
    enqueueSystemEvent(text, { sessionKey: params.sessionKey });
    return;
  }
  try {
    const { deliverOutboundPayloads } = await import("./outbound/deliver.js");
    await deliverOutboundPayloads({
      cfg: params.cfg,
      channel,
      to: target.to,
      accountId: target.accountId,
      threadId: target.threadId,
      payloads: [{ text }],
      agentId: resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg }),
    });
  } catch (err) {
    console.warn(`Failed to deliver session maintenance warning: ${String(err)}`);
    enqueueSystemEvent(text, { sessionKey: params.sessionKey });
  }
}
