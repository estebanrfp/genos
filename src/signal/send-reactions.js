let normalizeSignalId = function (raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/^signal:/i, "").trim();
  },
  normalizeSignalUuid = function (raw) {
    const trimmed = normalizeSignalId(raw);
    if (!trimmed) {
      return "";
    }
    if (trimmed.toLowerCase().startsWith("uuid:")) {
      return trimmed.slice("uuid:".length).trim();
    }
    return trimmed;
  },
  resolveTargetAuthorParams = function (params) {
    const candidates = [params.targetAuthor, params.targetAuthorUuid, params.fallback];
    for (const candidate of candidates) {
      const raw = candidate?.trim();
      if (!raw) {
        continue;
      }
      const normalized = normalizeSignalUuid(raw);
      if (normalized) {
        return { targetAuthor: normalized };
      }
    }
    return {};
  };
import { loadConfig } from "../config/config.js";
import { resolveSignalAccount } from "./accounts.js";
import { signalRpcRequest } from "./client.js";
import { resolveSignalRpcContext } from "./rpc-context.js";
async function sendReactionSignalCore(params) {
  const accountInfo = resolveSignalAccount({
    cfg: loadConfig(),
    accountId: params.opts.accountId,
  });
  const { baseUrl, account } = resolveSignalRpcContext(params.opts, accountInfo);
  const normalizedRecipient = normalizeSignalUuid(params.recipient);
  const groupId = params.opts.groupId?.trim();
  if (!normalizedRecipient && !groupId) {
    throw new Error(params.errors.missingRecipient);
  }
  if (!Number.isFinite(params.targetTimestamp) || params.targetTimestamp <= 0) {
    throw new Error(params.errors.invalidTargetTimestamp);
  }
  const normalizedEmoji = params.emoji?.trim();
  if (!normalizedEmoji) {
    throw new Error(params.errors.missingEmoji);
  }
  const targetAuthorParams = resolveTargetAuthorParams({
    targetAuthor: params.opts.targetAuthor,
    targetAuthorUuid: params.opts.targetAuthorUuid,
    fallback: normalizedRecipient,
  });
  if (groupId && !targetAuthorParams.targetAuthor) {
    throw new Error(params.errors.missingTargetAuthor);
  }
  const requestParams = {
    emoji: normalizedEmoji,
    targetTimestamp: params.targetTimestamp,
    ...(params.remove ? { remove: true } : {}),
    ...targetAuthorParams,
  };
  if (normalizedRecipient) {
    requestParams.recipients = [normalizedRecipient];
  }
  if (groupId) {
    requestParams.groupIds = [groupId];
  }
  if (account) {
    requestParams.account = account;
  }
  const result = await signalRpcRequest("sendReaction", requestParams, {
    baseUrl,
    timeoutMs: params.opts.timeoutMs,
  });
  return {
    ok: true,
    timestamp: result?.timestamp,
  };
}
export async function sendReactionSignal(recipient, targetTimestamp, emoji, opts = {}) {
  return await sendReactionSignalCore({
    recipient,
    targetTimestamp,
    emoji,
    remove: false,
    opts,
    errors: {
      missingRecipient: "Recipient or groupId is required for Signal reaction",
      invalidTargetTimestamp: "Valid targetTimestamp is required for Signal reaction",
      missingEmoji: "Emoji is required for Signal reaction",
      missingTargetAuthor: "targetAuthor is required for group reactions",
    },
  });
}
export async function removeReactionSignal(recipient, targetTimestamp, emoji, opts = {}) {
  return await sendReactionSignalCore({
    recipient,
    targetTimestamp,
    emoji,
    remove: true,
    opts,
    errors: {
      missingRecipient: "Recipient or groupId is required for Signal reaction removal",
      invalidTargetTimestamp: "Valid targetTimestamp is required for Signal reaction removal",
      missingEmoji: "Emoji is required for Signal reaction removal",
      missingTargetAuthor: "targetAuthor is required for group reaction removal",
    },
  });
}
