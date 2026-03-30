let summarizeSources = function (sources) {
    const counts = new Map();
    for (const s of sources) {
      const key = s?.trim() ? s.trim() : "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .map(([key, n]) => `${key}${n > 1 ? `\xD7${n}` : ""}`);
    const label = parts.length > 0 ? parts.join("+") : "unknown";
    return { label, parts };
  },
  existsSyncMaybe = function (p) {
    const path = p?.trim() || "";
    if (!path) {
      return null;
    }
    try {
      return fs.existsSync(path);
    } catch {
      return null;
    }
  },
  formatTokenHint = function (token, opts) {
    const t = token.trim();
    if (!t) {
      return "empty";
    }
    if (!opts.showSecrets) {
      return `sha256:${sha256HexPrefix(t, 8)} \xB7 len ${t.length}`;
    }
    const head = t.slice(0, 4);
    const tail = t.slice(-4);
    if (t.length <= 10) {
      return `${t} \xB7 len ${t.length}`;
    }
    return `${head}\u2026${tail} \xB7 len ${t.length}`;
  },
  resolveLinkFields = function (summary) {
    const rec = asRecord(summary);
    const linked = typeof rec.linked === "boolean" ? rec.linked : null;
    const authAgeMs = typeof rec.authAgeMs === "number" ? rec.authAgeMs : null;
    const self = asRecord(rec.self);
    const selfE164 = typeof self.e164 === "string" && self.e164.trim() ? self.e164.trim() : null;
    return { linked, authAgeMs, selfE164 };
  },
  collectMissingPaths = function (accounts) {
    const missing = [];
    for (const entry of accounts) {
      const accountRec = asRecord(entry.account);
      const snapshotRec = asRecord(entry.snapshot);
      for (const key of [
        "tokenFile",
        "botTokenFile",
        "appTokenFile",
        "cliPath",
        "dbPath",
        "authDir",
      ]) {
        const raw = accountRec[key] ?? snapshotRec[key];
        const ok = existsSyncMaybe(raw);
        if (ok === false) {
          missing.push(String(raw));
        }
      }
    }
    return missing;
  },
  summarizeTokenConfig = function (params) {
    const enabled = params.accounts.filter((a) => a.enabled);
    if (enabled.length === 0) {
      return { state: null, detail: null };
    }
    const accountRecs = enabled.map((a) => asRecord(a.account));
    const hasBotTokenField = accountRecs.some((r) => "botToken" in r);
    const hasAppTokenField = accountRecs.some((r) => "appToken" in r);
    const hasTokenField = accountRecs.some((r) => "token" in r);
    if (!hasBotTokenField && !hasAppTokenField && !hasTokenField) {
      return { state: null, detail: null };
    }
    if (hasBotTokenField && hasAppTokenField) {
      const ready = enabled.filter((a) => {
        const rec = asRecord(a.account);
        const bot = typeof rec.botToken === "string" ? rec.botToken.trim() : "";
        const app = typeof rec.appToken === "string" ? rec.appToken.trim() : "";
        return Boolean(bot) && Boolean(app);
      });
      const partial = enabled.filter((a) => {
        const rec = asRecord(a.account);
        const bot = typeof rec.botToken === "string" ? rec.botToken.trim() : "";
        const app = typeof rec.appToken === "string" ? rec.appToken.trim() : "";
        const hasBot = Boolean(bot);
        const hasApp = Boolean(app);
        return (hasBot && !hasApp) || (!hasBot && hasApp);
      });
      if (partial.length > 0) {
        return {
          state: "warn",
          detail: `partial tokens (need bot+app) \xB7 accounts ${partial.length}`,
        };
      }
      if (ready.length === 0) {
        return { state: "setup", detail: "no tokens (need bot+app)" };
      }
      const botSources = summarizeSources(ready.map((a) => a.snapshot.botTokenSource ?? "none"));
      const appSources = summarizeSources(ready.map((a) => a.snapshot.appTokenSource ?? "none"));
      const sample = ready[0]?.account ? asRecord(ready[0].account) : {};
      const botToken = typeof sample.botToken === "string" ? sample.botToken : "";
      const appToken = typeof sample.appToken === "string" ? sample.appToken : "";
      const botHint = botToken.trim()
        ? formatTokenHint(botToken, { showSecrets: params.showSecrets })
        : "";
      const appHint = appToken.trim()
        ? formatTokenHint(appToken, { showSecrets: params.showSecrets })
        : "";
      const hint = botHint || appHint ? ` (bot ${botHint || "?"}, app ${appHint || "?"})` : "";
      return {
        state: "ok",
        detail: `tokens ok (bot ${botSources.label}, app ${appSources.label})${hint} \xB7 accounts ${ready.length}/${enabled.length || 1}`,
      };
    }
    if (hasBotTokenField) {
      const ready = enabled.filter((a) => {
        const rec = asRecord(a.account);
        const bot = typeof rec.botToken === "string" ? rec.botToken.trim() : "";
        return Boolean(bot);
      });
      if (ready.length === 0) {
        return { state: "setup", detail: "no bot token" };
      }
      const sample = ready[0]?.account ? asRecord(ready[0].account) : {};
      const botToken = typeof sample.botToken === "string" ? sample.botToken : "";
      const botHint = botToken.trim()
        ? formatTokenHint(botToken, { showSecrets: params.showSecrets })
        : "";
      const hint = botHint ? ` (${botHint})` : "";
      return {
        state: "ok",
        detail: `bot token config${hint} \xB7 accounts ${ready.length}/${enabled.length || 1}`,
      };
    }
    const ready = enabled.filter((a) => {
      const rec = asRecord(a.account);
      return typeof rec.token === "string" ? Boolean(rec.token.trim()) : false;
    });
    if (ready.length === 0) {
      return { state: "setup", detail: "no token" };
    }
    const sources = summarizeSources(ready.map((a) => a.snapshot.tokenSource));
    const sample = ready[0]?.account ? asRecord(ready[0].account) : {};
    const token = typeof sample.token === "string" ? sample.token : "";
    const hint = token.trim()
      ? ` (${formatTokenHint(token, { showSecrets: params.showSecrets })})`
      : "";
    return {
      state: "ok",
      detail: `token ${sources.label}${hint} \xB7 accounts ${ready.length}/${enabled.length || 1}`,
    };
  };
import fs from "node:fs";
import {
  buildChannelAccountSnapshot,
  formatChannelAllowFrom,
} from "../../channels/account-summary.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import { sha256HexPrefix } from "../../logging/redact-identifier.js";
import { formatTimeAgo } from "./format.js";
const asRecord = (value) => (value && typeof value === "object" ? value : {});
const formatAccountLabel = (params) => {
  const base = params.accountId || "default";
  if (params.name?.trim()) {
    return `${base} (${params.name.trim()})`;
  }
  return base;
};
const resolveAccountEnabled = (plugin, account, cfg) => {
  if (plugin.config.isEnabled) {
    return plugin.config.isEnabled(account, cfg);
  }
  const enabled = asRecord(account).enabled;
  return enabled !== false;
};
const resolveAccountConfigured = async (plugin, account, cfg) => {
  if (plugin.config.isConfigured) {
    return await plugin.config.isConfigured(account, cfg);
  }
  const configured = asRecord(account).configured;
  return configured !== false;
};
const buildAccountNotes = (params) => {
  const { plugin, cfg, entry } = params;
  const notes = [];
  const snapshot = entry.snapshot;
  if (snapshot.enabled === false) {
    notes.push("disabled");
  }
  if (snapshot.dmPolicy) {
    notes.push(`dm:${snapshot.dmPolicy}`);
  }
  if (snapshot.tokenSource && snapshot.tokenSource !== "none") {
    notes.push(`token:${snapshot.tokenSource}`);
  }
  if (snapshot.botTokenSource && snapshot.botTokenSource !== "none") {
    notes.push(`bot:${snapshot.botTokenSource}`);
  }
  if (snapshot.appTokenSource && snapshot.appTokenSource !== "none") {
    notes.push(`app:${snapshot.appTokenSource}`);
  }
  if (snapshot.baseUrl) {
    notes.push(snapshot.baseUrl);
  }
  if (snapshot.port != null) {
    notes.push(`port:${snapshot.port}`);
  }
  if (snapshot.cliPath) {
    notes.push(`cli:${snapshot.cliPath}`);
  }
  if (snapshot.dbPath) {
    notes.push(`db:${snapshot.dbPath}`);
  }
  const allowFrom =
    plugin.config.resolveAllowFrom?.({ cfg, accountId: snapshot.accountId }) ?? snapshot.allowFrom;
  if (allowFrom?.length) {
    const formatted = formatChannelAllowFrom({
      plugin,
      cfg,
      accountId: snapshot.accountId,
      allowFrom,
    }).slice(0, 3);
    if (formatted.length > 0) {
      notes.push(`allow:${formatted.join(",")}`);
    }
  }
  return notes;
};
export async function buildChannelsTable(cfg, opts) {
  const showSecrets = opts?.showSecrets === true;
  const rows = [];
  const details = [];
  for (const plugin of listChannelPlugins()) {
    const accountIds = plugin.config.listAccountIds(cfg);
    const defaultAccountId = resolveChannelDefaultAccountId({
      plugin,
      cfg,
      accountIds,
    });
    const resolvedAccountIds = accountIds.length > 0 ? accountIds : [defaultAccountId];
    const accounts = [];
    for (const accountId of resolvedAccountIds) {
      const account = plugin.config.resolveAccount(cfg, accountId);
      const enabled = resolveAccountEnabled(plugin, account, cfg);
      const configured = await resolveAccountConfigured(plugin, account, cfg);
      const snapshot = buildChannelAccountSnapshot({
        plugin,
        cfg,
        accountId,
        account,
        enabled,
        configured,
      });
      accounts.push({ accountId, account, enabled, configured, snapshot });
    }
    const anyEnabled = accounts.some((a) => a.enabled);
    const enabledAccounts = accounts.filter((a) => a.enabled);
    const configuredAccounts = enabledAccounts.filter((a) => a.configured);
    const defaultEntry = accounts.find((a) => a.accountId === defaultAccountId) ?? accounts[0];
    const summary = plugin.status?.buildChannelSummary
      ? await plugin.status.buildChannelSummary({
          account: defaultEntry?.account ?? {},
          cfg,
          defaultAccountId,
          snapshot: defaultEntry?.snapshot ?? { accountId: defaultAccountId },
        })
      : undefined;
    const link = resolveLinkFields(summary);
    const missingPaths = collectMissingPaths(enabledAccounts);
    const tokenSummary = summarizeTokenConfig({
      plugin,
      cfg,
      accounts,
      showSecrets,
    });
    const issues = plugin.status?.collectStatusIssues
      ? plugin.status.collectStatusIssues(accounts.map((a) => a.snapshot))
      : [];
    const label = plugin.meta.label ?? plugin.id;
    const state = (() => {
      if (!anyEnabled) {
        return "off";
      }
      if (missingPaths.length > 0) {
        return "warn";
      }
      if (issues.length > 0) {
        return "warn";
      }
      if (link.linked === false) {
        return "setup";
      }
      if (tokenSummary.state) {
        return tokenSummary.state;
      }
      if (link.linked === true) {
        return "ok";
      }
      if (configuredAccounts.length > 0) {
        return "ok";
      }
      return "setup";
    })();
    const detail = (() => {
      if (!anyEnabled) {
        if (!defaultEntry) {
          return "disabled";
        }
        return plugin.config.disabledReason?.(defaultEntry.account, cfg) ?? "disabled";
      }
      if (missingPaths.length > 0) {
        return `missing file (${missingPaths[0]})`;
      }
      if (issues.length > 0) {
        return issues[0]?.message ?? "misconfigured";
      }
      if (link.linked !== null) {
        const base = link.linked ? "linked" : "not linked";
        const extra = [];
        if (link.linked && link.selfE164) {
          extra.push(link.selfE164);
        }
        if (link.linked && link.authAgeMs != null && link.authAgeMs >= 0) {
          extra.push(`auth ${formatTimeAgo(link.authAgeMs)}`);
        }
        if (accounts.length > 1 || plugin.meta.forceAccountBinding) {
          extra.push(`accounts ${accounts.length || 1}`);
        }
        return extra.length > 0 ? `${base} \xB7 ${extra.join(" \xB7 ")}` : base;
      }
      if (tokenSummary.detail) {
        return tokenSummary.detail;
      }
      if (configuredAccounts.length > 0) {
        const head = "configured";
        if (accounts.length <= 1 && !plugin.meta.forceAccountBinding) {
          return head;
        }
        return `${head} \xB7 accounts ${configuredAccounts.length}/${enabledAccounts.length || 1}`;
      }
      const reason =
        defaultEntry && plugin.config.unconfiguredReason
          ? plugin.config.unconfiguredReason(defaultEntry.account, cfg)
          : null;
      return reason ?? "not configured";
    })();
    rows.push({
      id: plugin.id,
      label,
      enabled: anyEnabled,
      state,
      detail,
    });
    if (configuredAccounts.length > 0) {
      details.push({
        title: `${label} accounts`,
        columns: ["Account", "Status", "Notes"],
        rows: configuredAccounts.map((entry) => {
          const notes = buildAccountNotes({ plugin, cfg, entry });
          return {
            Account: formatAccountLabel({
              accountId: entry.accountId,
              name: entry.snapshot.name,
            }),
            Status: entry.enabled ? "OK" : "WARN",
            Notes: notes.join(" \xB7 "),
          };
        }),
      });
    }
  }
  return {
    rows,
    details,
  };
}
