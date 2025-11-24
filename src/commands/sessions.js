let toRows = function (store) {
  return Object.entries(store)
    .map(([key, entry]) => {
      const updatedAt = entry?.updatedAt ?? null;
      return {
        key,
        kind: classifySessionKey(key, entry),
        updatedAt,
        ageMs: updatedAt ? Date.now() - updatedAt : null,
        sessionId: entry?.sessionId,
        systemSent: entry?.systemSent,
        abortedLastRun: entry?.abortedLastRun,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        elevatedLevel: entry?.elevatedLevel,
        responseUsage: entry?.responseUsage,
        groupActivation: entry?.groupActivation,
        inputTokens: entry?.inputTokens,
        outputTokens: entry?.outputTokens,
        totalTokens: entry?.totalTokens,
        totalTokensFresh: entry?.totalTokensFresh,
        model: entry?.model,
        modelProvider: entry?.modelProvider,
        providerOverride: entry?.providerOverride,
        modelOverride: entry?.modelOverride,
        contextTokens: entry?.contextTokens,
      };
    })
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};
import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveFreshSessionTotalTokens,
  resolveStorePath,
} from "../config/sessions.js";
import { classifySessionKey, resolveSessionModelRef } from "../gateway/session-utils.js";
import { info } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { isRich, theme } from "../terminal/theme.js";
const KIND_PAD = 6;
const KEY_PAD = 26;
const AGE_PAD = 9;
const MODEL_PAD = 14;
const TOKENS_PAD = 20;
const formatKTokens = (value) => `${(value / 1000).toFixed(value >= 1e4 ? 0 : 1)}k`;
const truncateKey = (key) => {
  if (key.length <= KEY_PAD) {
    return key;
  }
  const head = Math.max(4, KEY_PAD - 10);
  return `${key.slice(0, head)}...${key.slice(-6)}`;
};
const colorByPct = (label, pct, rich) => {
  if (!rich || pct === null) {
    return label;
  }
  if (pct >= 95) {
    return theme.error(label);
  }
  if (pct >= 80) {
    return theme.warn(label);
  }
  if (pct >= 60) {
    return theme.success(label);
  }
  return theme.muted(label);
};
const formatTokensCell = (total, contextTokens, rich) => {
  if (total === undefined) {
    const ctxLabel = contextTokens ? formatKTokens(contextTokens) : "?";
    const label = `unknown/${ctxLabel} (?%)`;
    return rich ? theme.muted(label.padEnd(TOKENS_PAD)) : label.padEnd(TOKENS_PAD);
  }
  const totalLabel = formatKTokens(total);
  const ctxLabel = contextTokens ? formatKTokens(contextTokens) : "?";
  const pct = contextTokens ? Math.min(999, Math.round((total / contextTokens) * 100)) : null;
  const label = `${totalLabel}/${ctxLabel} (${pct ?? "?"}%)`;
  const padded = label.padEnd(TOKENS_PAD);
  return colorByPct(padded, pct, rich);
};
const formatKindCell = (kind, rich) => {
  const label = kind.padEnd(KIND_PAD);
  if (!rich) {
    return label;
  }
  if (kind === "group") {
    return theme.accentBright(label);
  }
  if (kind === "global") {
    return theme.warn(label);
  }
  if (kind === "direct") {
    return theme.accent(label);
  }
  return theme.muted(label);
};
const formatAgeCell = (updatedAt, rich) => {
  const ageLabel = updatedAt ? formatTimeAgo(Date.now() - updatedAt) : "unknown";
  const padded = ageLabel.padEnd(AGE_PAD);
  return rich ? theme.muted(padded) : padded;
};
const formatModelCell = (model, rich) => {
  const label = (model ?? "unknown").padEnd(MODEL_PAD);
  return rich ? theme.info(label) : label;
};
const formatFlagsCell = (row, rich) => {
  const flags = [
    row.thinkingLevel ? `think:${row.thinkingLevel}` : null,
    row.verboseLevel ? `verbose:${row.verboseLevel}` : null,
    row.reasoningLevel ? `reasoning:${row.reasoningLevel}` : null,
    row.elevatedLevel ? `elev:${row.elevatedLevel}` : null,
    row.responseUsage ? `usage:${row.responseUsage}` : null,
    row.groupActivation ? `activation:${row.groupActivation}` : null,
    row.systemSent ? "system" : null,
    row.abortedLastRun ? "aborted" : null,
    row.sessionId ? `id:${row.sessionId}` : null,
  ].filter(Boolean);
  const label = flags.join(" ");
  return label.length === 0 ? "" : rich ? theme.muted(label) : label;
};
export async function sessionsCommand(opts, runtime) {
  const cfg = loadConfig();
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const configContextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(resolved.model) ??
    DEFAULT_CONTEXT_TOKENS;
  const configModel = resolved.model ?? DEFAULT_MODEL;
  const storePath = resolveStorePath(opts.store ?? cfg.session?.store);
  const store = loadSessionStore(storePath);
  let activeMinutes;
  if (opts.active !== undefined) {
    const parsed = Number.parseInt(String(opts.active), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      runtime.error("--active must be a positive integer (minutes)");
      runtime.exit(1);
      return;
    }
    activeMinutes = parsed;
  }
  const rows = toRows(store).filter((row) => {
    if (activeMinutes === undefined) {
      return true;
    }
    if (!row.updatedAt) {
      return false;
    }
    return Date.now() - row.updatedAt <= activeMinutes * 60000;
  });
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          path: storePath,
          count: rows.length,
          activeMinutes: activeMinutes ?? null,
          sessions: rows.map((r) => {
            const resolvedModel = resolveSessionModelRef(
              cfg,
              r,
              parseAgentSessionKey(r.key)?.agentId,
            );
            const model = resolvedModel.model ?? configModel;
            return {
              ...r,
              totalTokens: resolveFreshSessionTotalTokens(r) ?? null,
              totalTokensFresh:
                typeof r.totalTokens === "number" ? r.totalTokensFresh !== false : false,
              contextTokens:
                r.contextTokens ?? lookupContextTokens(model) ?? configContextTokens ?? null,
              model,
            };
          }),
        },
        null,
        2,
      ),
    );
    return;
  }
  runtime.log(info(`Session store: ${storePath}`));
  runtime.log(info(`Sessions listed: ${rows.length}`));
  if (activeMinutes) {
    runtime.log(info(`Filtered to last ${activeMinutes} minute(s)`));
  }
  if (rows.length === 0) {
    runtime.log("No sessions found.");
    return;
  }
  const rich = isRich();
  const header = [
    "Kind".padEnd(KIND_PAD),
    "Key".padEnd(KEY_PAD),
    "Age".padEnd(AGE_PAD),
    "Model".padEnd(MODEL_PAD),
    "Tokens (ctx %)".padEnd(TOKENS_PAD),
    "Flags",
  ].join(" ");
  runtime.log(rich ? theme.heading(header) : header);
  for (const row of rows) {
    const resolvedModel = resolveSessionModelRef(cfg, row, parseAgentSessionKey(row.key)?.agentId);
    const model = resolvedModel.model ?? configModel;
    const contextTokens = row.contextTokens ?? lookupContextTokens(model) ?? configContextTokens;
    const total = resolveFreshSessionTotalTokens(row);
    const keyLabel = truncateKey(row.key).padEnd(KEY_PAD);
    const keyCell = rich ? theme.accent(keyLabel) : keyLabel;
    const line = [
      formatKindCell(row.kind, rich),
      keyCell,
      formatAgeCell(row.updatedAt, rich),
      formatModelCell(model, rich),
      formatTokensCell(total, contextTokens ?? null, rich),
      formatFlagsCell(row, rich),
    ].join(" ");
    runtime.log(line.trimEnd());
  }
}
