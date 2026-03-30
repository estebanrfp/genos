let normalizeChunkProvider = function (provider) {
    if (!provider) {
      return;
    }
    const cleaned = provider.trim().toLowerCase();
    return getBlockChunkProviders().has(cleaned) ? cleaned : undefined;
  },
  resolveProviderBlockStreamingCoalesce = function (params) {
    const { cfg, providerKey, accountId } = params;
    if (!cfg || !providerKey) {
      return;
    }
    const providerCfg = cfg[providerKey];
    if (!providerCfg || typeof providerCfg !== "object") {
      return;
    }
    const normalizedAccountId = normalizeAccountId(accountId);
    const typed = providerCfg;
    const accountCfg = typed.accounts?.[normalizedAccountId];
    return accountCfg?.blockStreamingCoalesce ?? typed.blockStreamingCoalesce;
  };
import { getChannelDock } from "../../channels/dock.js";
import { normalizeChannelId } from "../../channels/plugins/index.js";
import { normalizeAccountId } from "../../routing/session-key.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  listDeliverableMessageChannels,
} from "../../utils/message-channel.js";
import { resolveChunkMode, resolveTextChunkLimit } from "../chunk.js";
const DEFAULT_BLOCK_STREAM_MIN = 800;
const DEFAULT_BLOCK_STREAM_MAX = 1200;
const DEFAULT_BLOCK_STREAM_COALESCE_IDLE_MS = 1000;
const getBlockChunkProviders = () =>
  new Set([...listDeliverableMessageChannels(), INTERNAL_MESSAGE_CHANNEL]);
export function resolveBlockStreamingChunking(cfg, provider, accountId) {
  const providerKey = normalizeChunkProvider(provider);
  const providerConfigKey = providerKey;
  const providerId = providerKey ? normalizeChannelId(providerKey) : null;
  const providerChunkLimit = providerId
    ? getChannelDock(providerId)?.outbound?.textChunkLimit
    : undefined;
  const textLimit = resolveTextChunkLimit(cfg, providerConfigKey, accountId, {
    fallbackLimit: providerChunkLimit,
  });
  const chunkCfg = cfg?.agents?.defaults?.blockStreamingChunk;
  const chunkMode = resolveChunkMode(cfg, providerConfigKey, accountId);
  const maxRequested = Math.max(1, Math.floor(chunkCfg?.maxChars ?? DEFAULT_BLOCK_STREAM_MAX));
  const maxChars = Math.max(1, Math.min(maxRequested, textLimit));
  const minFallback = DEFAULT_BLOCK_STREAM_MIN;
  const minRequested = Math.max(1, Math.floor(chunkCfg?.minChars ?? minFallback));
  const minChars = Math.min(minRequested, maxChars);
  const breakPreference =
    chunkCfg?.breakPreference === "newline" || chunkCfg?.breakPreference === "sentence"
      ? chunkCfg.breakPreference
      : "paragraph";
  return {
    minChars,
    maxChars,
    breakPreference,
    flushOnParagraph: chunkMode === "newline",
  };
}
export function resolveBlockStreamingCoalescing(cfg, provider, accountId, chunking, opts) {
  const providerKey = normalizeChunkProvider(provider);
  const providerConfigKey = providerKey;
  const chunkMode = opts?.chunkMode ?? resolveChunkMode(cfg, providerConfigKey, accountId);
  const providerId = providerKey ? normalizeChannelId(providerKey) : null;
  const providerChunkLimit = providerId
    ? getChannelDock(providerId)?.outbound?.textChunkLimit
    : undefined;
  const textLimit = resolveTextChunkLimit(cfg, providerConfigKey, accountId, {
    fallbackLimit: providerChunkLimit,
  });
  const providerDefaults = providerId
    ? getChannelDock(providerId)?.streaming?.blockStreamingCoalesceDefaults
    : undefined;
  const providerCfg = resolveProviderBlockStreamingCoalesce({
    cfg,
    providerKey,
    accountId,
  });
  const coalesceCfg = providerCfg ?? cfg?.agents?.defaults?.blockStreamingCoalesce;
  const minRequested = Math.max(
    1,
    Math.floor(
      coalesceCfg?.minChars ??
        providerDefaults?.minChars ??
        chunking?.minChars ??
        DEFAULT_BLOCK_STREAM_MIN,
    ),
  );
  const maxRequested = Math.max(1, Math.floor(coalesceCfg?.maxChars ?? textLimit));
  const maxChars = Math.max(1, Math.min(maxRequested, textLimit));
  const minChars = Math.min(minRequested, maxChars);
  const idleMs = Math.max(
    0,
    Math.floor(
      coalesceCfg?.idleMs ?? providerDefaults?.idleMs ?? DEFAULT_BLOCK_STREAM_COALESCE_IDLE_MS,
    ),
  );
  const preference = chunking?.breakPreference ?? "paragraph";
  const joiner = preference === "sentence" ? " " : preference === "newline" ? "\n" : "\n\n";
  return {
    minChars,
    maxChars,
    idleMs,
    joiner,
    flushOnEnqueue: chunkMode === "newline",
  };
}
