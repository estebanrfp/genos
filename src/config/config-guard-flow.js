let normalizeIssuePath = function (path) {
    return path.filter((part) => typeof part !== "symbol");
  },
  isUnrecognizedKeysIssue = function (issue) {
    return issue.code === "unrecognized_keys";
  },
  formatPath = function (parts) {
    if (parts.length === 0) {
      return "<root>";
    }
    let out = "";
    for (const part of parts) {
      if (typeof part === "number") {
        out += `[${part}]`;
        continue;
      }
      out = out ? `${out}.${part}` : part;
    }
    return out || "<root>";
  },
  resolvePathTarget = function (root, path) {
    let current = root;
    for (const part of path) {
      if (typeof part === "number") {
        if (!Array.isArray(current)) {
          return null;
        }
        if (part < 0 || part >= current.length) {
          return null;
        }
        current = current[part];
        continue;
      }
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      const record = current;
      if (!(part in record)) {
        return null;
      }
      current = record[part];
    }
    return current;
  },
  stripUnknownConfigKeys = function (config) {
    const parsed = GenosOSSchema.safeParse(config);
    if (parsed.success) {
      return { config, removed: [] };
    }
    const next = structuredClone(config);
    const removed = [];
    for (const issue of parsed.error.issues) {
      if (!isUnrecognizedKeysIssue(issue)) {
        continue;
      }
      const path = normalizeIssuePath(issue.path);
      const target = resolvePathTarget(next, path);
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        continue;
      }
      const record = target;
      for (const key of issue.keys) {
        if (typeof key !== "string") {
          continue;
        }
        if (!(key in record)) {
          continue;
        }
        delete record[key];
        removed.push(formatPath([...path, key]));
      }
    }
    return { config: next, removed };
  },
  noteOpencodeProviderOverrides = function (cfg) {
    const providers = cfg.models?.providers;
    if (!providers) {
      return;
    }
    const overrides = [];
    if (providers.opencode) {
      overrides.push("opencode");
    }
    if (providers["opencode-zen"]) {
      overrides.push("opencode-zen");
    }
    if (overrides.length === 0) {
      return;
    }
    const lines = overrides.flatMap((id) => {
      const providerEntry = providers[id];
      const api =
        isRecord(providerEntry) && typeof providerEntry.api === "string"
          ? providerEntry.api
          : undefined;
      return [
        `- models.providers.${id} is set; this overrides the built-in OpenCode Zen catalog.`,
        api ? `- models.providers.${id}.api=${api}` : null,
      ].filter((line) => Boolean(line));
    });
    lines.push(
      "- Remove these entries to restore per-model API routing + costs (then re-run onboarding if needed).",
    );
    note(lines.join("\n"), "OpenCode Zen");
  },
  noteIncludeConfinementWarning = function (snapshot) {
    const issues = snapshot.issues ?? [];
    const includeIssue = issues.find(
      (issue) =>
        issue.message.includes("Include path escapes config directory") ||
        issue.message.includes("Include path resolves outside config directory"),
    );
    if (!includeIssue) {
      return;
    }
    const configRoot = path.dirname(snapshot.path ?? CONFIG_PATH);
    note(
      [
        `- $include paths must stay under: ${configRoot}`,
        '- Move shared include files under that directory and update to relative paths like "./shared/common.json".',
        `- Error: ${includeIssue.message}`,
      ].join("\n"),
      "Doctor warnings",
    );
  },
  asObjectRecord = function (value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  },
  collectTelegramAccountScopes = function (cfg) {
    const scopes = [];
    const telegram = asObjectRecord(cfg.channels?.telegram);
    if (!telegram) {
      return scopes;
    }
    scopes.push({ prefix: "channels.telegram", account: telegram });
    const accounts = asObjectRecord(telegram.accounts);
    if (!accounts) {
      return scopes;
    }
    for (const key of Object.keys(accounts)) {
      const account = asObjectRecord(accounts[key]);
      if (!account) {
        continue;
      }
      scopes.push({ prefix: `channels.telegram.accounts.${key}`, account });
    }
    return scopes;
  },
  collectTelegramAllowFromLists = function (prefix, account) {
    const refs = [
      { pathLabel: `${prefix}.allowFrom`, holder: account, key: "allowFrom" },
      { pathLabel: `${prefix}.groupAllowFrom`, holder: account, key: "groupAllowFrom" },
    ];
    const groups = asObjectRecord(account.groups);
    if (!groups) {
      return refs;
    }
    for (const groupId of Object.keys(groups)) {
      const group = asObjectRecord(groups[groupId]);
      if (!group) {
        continue;
      }
      refs.push({
        pathLabel: `${prefix}.groups.${groupId}.allowFrom`,
        holder: group,
        key: "allowFrom",
      });
      const topics = asObjectRecord(group.topics);
      if (!topics) {
        continue;
      }
      for (const topicId of Object.keys(topics)) {
        const topic = asObjectRecord(topics[topicId]);
        if (!topic) {
          continue;
        }
        refs.push({
          pathLabel: `${prefix}.groups.${groupId}.topics.${topicId}.allowFrom`,
          holder: topic,
          key: "allowFrom",
        });
      }
    }
    return refs;
  },
  scanTelegramAllowFromUsernameEntries = function (cfg) {
    const hits = [];
    const scanList = (pathLabel, list) => {
      if (!Array.isArray(list)) {
        return;
      }
      for (const entry of list) {
        const normalized = normalizeTelegramAllowFromEntry(entry);
        if (!normalized || normalized === "*") {
          continue;
        }
        if (isNumericTelegramUserId(normalized)) {
          continue;
        }
        hits.push({ path: pathLabel, entry: String(entry).trim() });
      }
    };
    for (const scope of collectTelegramAccountScopes(cfg)) {
      for (const ref of collectTelegramAllowFromLists(scope.prefix, scope.account)) {
        scanList(ref.pathLabel, ref.holder[ref.key]);
      }
    }
    return hits;
  },
  collectDiscordAccountScopes = function (cfg) {
    const scopes = [];
    const discord = asObjectRecord(cfg.channels?.discord);
    if (!discord) {
      return scopes;
    }
    scopes.push({ prefix: "channels.discord", account: discord });
    const accounts = asObjectRecord(discord.accounts);
    if (!accounts) {
      return scopes;
    }
    for (const key of Object.keys(accounts)) {
      const account = asObjectRecord(accounts[key]);
      if (!account) {
        continue;
      }
      scopes.push({ prefix: `channels.discord.accounts.${key}`, account });
    }
    return scopes;
  },
  collectDiscordIdLists = function (prefix, account) {
    const refs = [{ pathLabel: `${prefix}.allowFrom`, holder: account, key: "allowFrom" }];
    const dm = asObjectRecord(account.dm);
    if (dm) {
      refs.push({ pathLabel: `${prefix}.dm.allowFrom`, holder: dm, key: "allowFrom" });
      refs.push({ pathLabel: `${prefix}.dm.groupChannels`, holder: dm, key: "groupChannels" });
    }
    const execApprovals = asObjectRecord(account.execApprovals);
    if (execApprovals) {
      refs.push({
        pathLabel: `${prefix}.execApprovals.approvers`,
        holder: execApprovals,
        key: "approvers",
      });
    }
    const guilds = asObjectRecord(account.guilds);
    if (!guilds) {
      return refs;
    }
    for (const guildId of Object.keys(guilds)) {
      const guild = asObjectRecord(guilds[guildId]);
      if (!guild) {
        continue;
      }
      refs.push({ pathLabel: `${prefix}.guilds.${guildId}.users`, holder: guild, key: "users" });
      refs.push({ pathLabel: `${prefix}.guilds.${guildId}.roles`, holder: guild, key: "roles" });
      const channels = asObjectRecord(guild.channels);
      if (!channels) {
        continue;
      }
      for (const channelId of Object.keys(channels)) {
        const channel = asObjectRecord(channels[channelId]);
        if (!channel) {
          continue;
        }
        refs.push({
          pathLabel: `${prefix}.guilds.${guildId}.channels.${channelId}.users`,
          holder: channel,
          key: "users",
        });
        refs.push({
          pathLabel: `${prefix}.guilds.${guildId}.channels.${channelId}.roles`,
          holder: channel,
          key: "roles",
        });
      }
    }
    return refs;
  },
  scanDiscordNumericIdEntries = function (cfg) {
    const hits = [];
    const scanList = (pathLabel, list) => {
      if (!Array.isArray(list)) {
        return;
      }
      for (const [index, entry] of list.entries()) {
        if (typeof entry !== "number") {
          continue;
        }
        hits.push({ path: `${pathLabel}[${index}]`, entry });
      }
    };
    for (const scope of collectDiscordAccountScopes(cfg)) {
      for (const ref of collectDiscordIdLists(scope.prefix, scope.account)) {
        scanList(ref.pathLabel, ref.holder[ref.key]);
      }
    }
    return hits;
  },
  maybeRepairDiscordNumericIds = function (cfg) {
    const hits = scanDiscordNumericIdEntries(cfg);
    if (hits.length === 0) {
      return { config: cfg, changes: [] };
    }
    const next = structuredClone(cfg);
    const changes = [];
    const repairList = (pathLabel, holder, key) => {
      const raw = holder[key];
      if (!Array.isArray(raw)) {
        return;
      }
      let converted = 0;
      const updated = raw.map((entry) => {
        if (typeof entry === "number") {
          converted += 1;
          return String(entry);
        }
        return entry;
      });
      if (converted === 0) {
        return;
      }
      holder[key] = updated;
      changes.push(
        `- ${pathLabel}: converted ${converted} numeric ${converted === 1 ? "entry" : "entries"} to strings`,
      );
    };
    for (const scope of collectDiscordAccountScopes(next)) {
      for (const ref of collectDiscordIdLists(scope.prefix, scope.account)) {
        repairList(ref.pathLabel, ref.holder, ref.key);
      }
    }
    if (changes.length === 0) {
      return { config: cfg, changes: [] };
    }
    return { config: next, changes };
  },
  maybeRepairOpenPolicyAllowFrom = function (cfg) {
    const channels = cfg.channels;
    if (!channels || typeof channels !== "object") {
      return { config: cfg, changes: [] };
    }
    const next = structuredClone(cfg);
    const changes = [];
    const resolveAllowFromMode = (channelName) => {
      if (channelName === "googlechat") {
        return "nestedOnly";
      }
      if (channelName === "discord" || channelName === "slack") {
        return "topOrNested";
      }
      return "topOnly";
    };
    const hasWildcard = (list) => list?.some((v) => String(v).trim() === "*") ?? false;
    const ensureWildcard = (account, prefix, mode) => {
      const dmEntry = account.dm;
      const dm =
        dmEntry && typeof dmEntry === "object" && !Array.isArray(dmEntry) ? dmEntry : undefined;
      const dmPolicy = account.dmPolicy ?? dm?.policy ?? undefined;
      if (dmPolicy !== "open") {
        return;
      }
      const topAllowFrom = account.allowFrom;
      const nestedAllowFrom = dm?.allowFrom;
      if (mode === "nestedOnly") {
        if (hasWildcard(nestedAllowFrom)) {
          return;
        }
        if (Array.isArray(nestedAllowFrom)) {
          nestedAllowFrom.push("*");
          changes.push(`- ${prefix}.dm.allowFrom: added "*" (required by dmPolicy="open")`);
          return;
        }
        const nextDm = dm ?? {};
        nextDm.allowFrom = ["*"];
        account.dm = nextDm;
        changes.push(`- ${prefix}.dm.allowFrom: set to ["*"] (required by dmPolicy="open")`);
        return;
      }
      if (mode === "topOrNested") {
        if (hasWildcard(topAllowFrom) || hasWildcard(nestedAllowFrom)) {
          return;
        }
        if (Array.isArray(topAllowFrom)) {
          topAllowFrom.push("*");
          changes.push(`- ${prefix}.allowFrom: added "*" (required by dmPolicy="open")`);
        } else if (Array.isArray(nestedAllowFrom)) {
          nestedAllowFrom.push("*");
          changes.push(`- ${prefix}.dm.allowFrom: added "*" (required by dmPolicy="open")`);
        } else {
          account.allowFrom = ["*"];
          changes.push(`- ${prefix}.allowFrom: set to ["*"] (required by dmPolicy="open")`);
        }
        return;
      }
      if (hasWildcard(topAllowFrom)) {
        return;
      }
      if (Array.isArray(topAllowFrom)) {
        topAllowFrom.push("*");
        changes.push(`- ${prefix}.allowFrom: added "*" (required by dmPolicy="open")`);
      } else {
        account.allowFrom = ["*"];
        changes.push(`- ${prefix}.allowFrom: set to ["*"] (required by dmPolicy="open")`);
      }
    };
    const nextChannels = next.channels;
    for (const [channelName, channelConfig] of Object.entries(nextChannels)) {
      if (!channelConfig || typeof channelConfig !== "object") {
        continue;
      }
      const allowFromMode = resolveAllowFromMode(channelName);
      ensureWildcard(channelConfig, `channels.${channelName}`, allowFromMode);
      const accounts = channelConfig.accounts;
      if (accounts && typeof accounts === "object") {
        for (const [accountName, accountConfig] of Object.entries(accounts)) {
          if (accountConfig && typeof accountConfig === "object") {
            ensureWildcard(
              accountConfig,
              `channels.${channelName}.accounts.${accountName}`,
              allowFromMode,
            );
          }
        }
      }
    }
    if (changes.length === 0) {
      return { config: cfg, changes: [] };
    }
    return { config: next, changes };
  };
import fs from "node:fs/promises";
import path from "node:path";
import {
  isNumericTelegramUserId,
  normalizeTelegramAllowFromEntry,
} from "../channels/telegram/allow-from.js";
import { fetchTelegramChatId } from "../channels/telegram/api.js";
import { formatCliCommand } from "../cli/command-format.js";
import { autoMigrateLegacyStateDir } from "../infra/state-migrations.js";
import { listTelegramAccountIds, resolveTelegramAccount } from "../telegram/accounts.js";
import { note } from "../terminal/note.js";
import { isRecord, resolveHomeDir } from "../utils.js";
import {
  GenosOSSchema,
  CONFIG_PATH,
  migrateLegacyConfig,
  readConfigFileSnapshot,
} from "./config.js";
import { normalizeLegacyConfigValues } from "./legacy-config.js";
import { applyPluginAutoEnable } from "./plugin-auto-enable.js";
async function maybeRepairTelegramAllowFromUsernames(cfg) {
  const hits = scanTelegramAllowFromUsernameEntries(cfg);
  if (hits.length === 0) {
    return { config: cfg, changes: [] };
  }
  const tokens = Array.from(
    new Set(
      listTelegramAccountIds(cfg)
        .map((accountId) => resolveTelegramAccount({ cfg, accountId }))
        .map((account) => (account.tokenSource === "none" ? "" : account.token))
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  );
  if (tokens.length === 0) {
    return {
      config: cfg,
      changes: [
        `- Telegram allowFrom contains @username entries, but no Telegram bot token is configured; cannot auto-resolve (run onboarding or replace with numeric sender IDs).`,
      ],
    };
  }
  const resolveUserId = async (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const stripped = normalizeTelegramAllowFromEntry(trimmed);
    if (!stripped || stripped === "*") {
      return null;
    }
    if (isNumericTelegramUserId(stripped)) {
      return stripped;
    }
    if (/\s/.test(stripped)) {
      return null;
    }
    const username = stripped.startsWith("@") ? stripped : `@${stripped}`;
    for (const token of tokens) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const id = await fetchTelegramChatId({
          token,
          chatId: username,
          signal: controller.signal,
        });
        if (id) {
          return id;
        }
      } catch {
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  };
  const changes = [];
  const next = structuredClone(cfg);
  const repairList = async (pathLabel, holder, key) => {
    const raw = holder[key];
    if (!Array.isArray(raw)) {
      return;
    }
    const out = [];
    const replaced = [];
    for (const entry of raw) {
      const normalized = normalizeTelegramAllowFromEntry(entry);
      if (!normalized) {
        continue;
      }
      if (normalized === "*") {
        out.push("*");
        continue;
      }
      if (isNumericTelegramUserId(normalized)) {
        out.push(normalized);
        continue;
      }
      const resolved = await resolveUserId(String(entry));
      if (resolved) {
        out.push(resolved);
        replaced.push({ from: String(entry).trim(), to: resolved });
      } else {
        out.push(String(entry).trim());
      }
    }
    const deduped = [];
    const seen = new Set();
    for (const entry of out) {
      const k = String(entry).trim();
      if (!k || seen.has(k)) {
        continue;
      }
      seen.add(k);
      deduped.push(entry);
    }
    holder[key] = deduped;
    if (replaced.length > 0) {
      for (const rep of replaced.slice(0, 5)) {
        changes.push(`- ${pathLabel}: resolved ${rep.from} -> ${rep.to}`);
      }
      if (replaced.length > 5) {
        changes.push(`- ${pathLabel}: resolved ${replaced.length - 5} more @username entries`);
      }
    }
  };
  const repairAccount = async (prefix, account) => {
    for (const ref of collectTelegramAllowFromLists(prefix, account)) {
      await repairList(ref.pathLabel, ref.holder, ref.key);
    }
  };
  for (const scope of collectTelegramAccountScopes(next)) {
    await repairAccount(scope.prefix, scope.account);
  }
  if (changes.length === 0) {
    return { config: cfg, changes: [] };
  }
  return { config: next, changes };
}
async function maybeMigrateLegacyConfig() {
  const changes = [];
  const home = resolveHomeDir();
  if (!home) {
    return changes;
  }
  const targetDir = path.join(home, ".genosv1");
  const targetPath = path.join(targetDir, "genosos.json");
  try {
    await fs.access(targetPath);
    return changes;
  } catch {}
  const legacyCandidates = [
    path.join(home, ".genosv1", "genosos.json"),
    path.join(home, ".genosv1", "genosos.json"),
    path.join(home, ".genosv1", "genosos.json"),
  ];
  let legacyPath = null;
  for (const candidate of legacyCandidates) {
    try {
      await fs.access(candidate);
      legacyPath = candidate;
      break;
    } catch {}
  }
  if (!legacyPath) {
    return changes;
  }
  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.copyFile(legacyPath, targetPath, fs.constants.COPYFILE_EXCL);
    changes.push(`Migrated legacy config: ${legacyPath} -> ${targetPath}`);
  } catch {}
  return changes;
}
export async function loadAndMaybeMigrateDoctorConfig(params) {
  const shouldRepair = params.options.repair === true || params.options.yes === true;
  const stateDirResult = await autoMigrateLegacyStateDir({ env: process.env });
  if (stateDirResult.changes.length > 0) {
    note(stateDirResult.changes.map((entry) => `- ${entry}`).join("\n"), "Doctor changes");
  }
  if (stateDirResult.warnings.length > 0) {
    note(stateDirResult.warnings.map((entry) => `- ${entry}`).join("\n"), "Doctor warnings");
  }
  const legacyConfigChanges = await maybeMigrateLegacyConfig();
  if (legacyConfigChanges.length > 0) {
    note(legacyConfigChanges.map((entry) => `- ${entry}`).join("\n"), "Doctor changes");
  }
  let snapshot = await readConfigFileSnapshot();
  const baseCfg = snapshot.config ?? {};
  let cfg = baseCfg;
  let candidate = structuredClone(baseCfg);
  let pendingChanges = false;
  let shouldWriteConfig = false;
  const fixHints = [];
  if (snapshot.exists && !snapshot.valid && snapshot.legacyIssues.length === 0) {
    note("Config invalid; doctor will run with best-effort config.", "Config");
    noteIncludeConfinementWarning(snapshot);
  }
  const warnings = snapshot.warnings ?? [];
  if (warnings.length > 0) {
    const lines = warnings.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
    note(lines, "Config warnings");
  }
  if (snapshot.legacyIssues.length > 0) {
    note(
      snapshot.legacyIssues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n"),
      "Legacy config keys detected",
    );
    const { config: migrated, changes } = migrateLegacyConfig(snapshot.parsed);
    if (changes.length > 0) {
      note(changes.join("\n"), "Doctor changes");
    }
    if (migrated) {
      candidate = migrated;
      cfg = migrated;
      pendingChanges = pendingChanges || changes.length > 0;
      shouldWriteConfig = shouldWriteConfig || changes.length > 0;
    }
  }
  const normalized = normalizeLegacyConfigValues(candidate);
  if (normalized.changes.length > 0) {
    note(normalized.changes.join("\n"), "Doctor changes");
    candidate = normalized.config;
    pendingChanges = true;
    if (shouldRepair) {
      cfg = normalized.config;
    } else {
      fixHints.push(`Run "${formatCliCommand("genosos doctor --fix")}" to apply these changes.`);
    }
  }
  const autoEnable = applyPluginAutoEnable({ config: candidate, env: process.env });
  if (autoEnable.changes.length > 0) {
    note(autoEnable.changes.join("\n"), "Doctor changes");
    candidate = autoEnable.config;
    pendingChanges = true;
    if (shouldRepair) {
      cfg = autoEnable.config;
    } else {
      fixHints.push(`Run "${formatCliCommand("genosos doctor --fix")}" to apply these changes.`);
    }
  }
  if (shouldRepair) {
    const repair = await maybeRepairTelegramAllowFromUsernames(candidate);
    if (repair.changes.length > 0) {
      note(repair.changes.join("\n"), "Doctor changes");
      candidate = repair.config;
      pendingChanges = true;
      cfg = repair.config;
    }
    const discordRepair = maybeRepairDiscordNumericIds(candidate);
    if (discordRepair.changes.length > 0) {
      note(discordRepair.changes.join("\n"), "Doctor changes");
      candidate = discordRepair.config;
      pendingChanges = true;
      cfg = discordRepair.config;
    }
    const allowFromRepair = maybeRepairOpenPolicyAllowFrom(candidate);
    if (allowFromRepair.changes.length > 0) {
      note(allowFromRepair.changes.join("\n"), "Doctor changes");
      candidate = allowFromRepair.config;
      pendingChanges = true;
      cfg = allowFromRepair.config;
    }
  } else {
    const hits = scanTelegramAllowFromUsernameEntries(candidate);
    if (hits.length > 0) {
      note(
        [
          `- Telegram allowFrom contains ${hits.length} non-numeric entries (e.g. ${hits[0]?.entry ?? "@"}); Telegram authorization requires numeric sender IDs.`,
          `- Run "${formatCliCommand("genosos doctor --fix")}" to auto-resolve @username entries to numeric IDs (requires a Telegram bot token).`,
        ].join("\n"),
        "Doctor warnings",
      );
    }
    const discordHits = scanDiscordNumericIdEntries(candidate);
    if (discordHits.length > 0) {
      note(
        [
          `- Discord allowlists contain ${discordHits.length} numeric entries (e.g. ${discordHits[0]?.path}=${discordHits[0]?.entry}).`,
          `- Discord IDs must be strings; run "${formatCliCommand("genosos doctor --fix")}" to convert numeric IDs to quoted strings.`,
        ].join("\n"),
        "Doctor warnings",
      );
    }
    const allowFromScan = maybeRepairOpenPolicyAllowFrom(candidate);
    if (allowFromScan.changes.length > 0) {
      note(
        [
          ...allowFromScan.changes,
          `- Run "${formatCliCommand("genosos doctor --fix")}" to add missing allowFrom wildcards.`,
        ].join("\n"),
        "Doctor warnings",
      );
    }
  }
  const unknown = stripUnknownConfigKeys(candidate);
  if (unknown.removed.length > 0) {
    const lines = unknown.removed.map((path) => `- ${path}`).join("\n");
    candidate = unknown.config;
    pendingChanges = true;
    if (shouldRepair) {
      cfg = unknown.config;
      note(lines, "Doctor changes");
    } else {
      note(lines, "Unknown config keys");
      fixHints.push('Run "genosos doctor --fix" to remove these keys.');
    }
  }
  if (!shouldRepair && pendingChanges) {
    const shouldApply = await params.confirm({
      message: "Apply recommended config repairs now?",
      initialValue: true,
    });
    if (shouldApply) {
      cfg = candidate;
      shouldWriteConfig = true;
    } else if (fixHints.length > 0) {
      note(fixHints.join("\n"), "Doctor");
    }
  }
  noteOpencodeProviderOverrides(cfg);
  return {
    cfg,
    path: snapshot.path ?? CONFIG_PATH,
    shouldWriteConfig,
    sourceConfigValid: snapshot.valid,
  };
}
