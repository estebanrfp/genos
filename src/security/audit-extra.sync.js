let summarizeGroupPolicy = function (cfg) {
    const channels = cfg.channels;
    if (!channels || typeof channels !== "object") {
      return { open: 0, allowlist: 0, other: 0 };
    }
    let open = 0;
    let allowlist = 0;
    let other = 0;
    for (const value of Object.values(channels)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const section = value;
      const policy = section.groupPolicy;
      if (policy === "open") {
        open += 1;
      } else if (policy === "allowlist") {
        allowlist += 1;
      } else {
        other += 1;
      }
    }
    return { open, allowlist, other };
  },
  isProbablySyncedPath = function (p) {
    const s = p.toLowerCase();
    return (
      s.includes("icloud") ||
      s.includes("dropbox") ||
      s.includes("google drive") ||
      s.includes("googledrive") ||
      s.includes("onedrive")
    );
  },
  looksLikeEnvRef = function (value) {
    const v = value.trim();
    return v.startsWith("${") && v.endsWith("}");
  },
  isGatewayRemotelyExposed = function (cfg) {
    const bind = typeof cfg.gateway?.bind === "string" ? cfg.gateway.bind : "loopback";
    if (bind !== "loopback") {
      return true;
    }
    const tailscaleMode = cfg.gateway?.tailscale?.mode ?? "off";
    return tailscaleMode === "serve" || tailscaleMode === "funnel";
  },
  addModel = function (models, raw, source) {
    if (typeof raw !== "string") {
      return;
    }
    const id = raw.trim();
    if (!id) {
      return;
    }
    models.push({ id, source });
  },
  collectModels = function (cfg) {
    const out = [];
    addModel(out, cfg.agents?.defaults?.model?.primary, "agents.defaults.model.primary");
    for (const f of cfg.agents?.defaults?.model?.fallbacks ?? []) {
      addModel(out, f, "agents.defaults.model.fallbacks");
    }
    addModel(out, cfg.agents?.defaults?.imageModel?.primary, "agents.defaults.imageModel.primary");
    for (const f of cfg.agents?.defaults?.imageModel?.fallbacks ?? []) {
      addModel(out, f, "agents.defaults.imageModel.fallbacks");
    }
    const list = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
    for (const agent of list ?? []) {
      if (!agent || typeof agent !== "object") {
        continue;
      }
      const id = typeof agent.id === "string" ? agent.id : "";
      const model = agent.model;
      if (typeof model === "string") {
        addModel(out, model, `agents.list.${id}.model`);
      } else if (model && typeof model === "object") {
        addModel(out, model.primary, `agents.list.${id}.model.primary`);
        const fallbacks = model.fallbacks;
        if (Array.isArray(fallbacks)) {
          for (const f of fallbacks) {
            addModel(out, f, `agents.list.${id}.model.fallbacks`);
          }
        }
      }
    }
    return out;
  },
  isGptModel = function (id) {
    return /\bgpt-/i.test(id);
  },
  isGpt5OrHigher = function (id) {
    return /\bgpt-5(?:\b|[.-])/i.test(id);
  },
  isClaudeModel = function (id) {
    return /\bclaude-/i.test(id);
  },
  isClaude45OrHigher = function (id) {
    return /\bclaude-[^\s/]*?(?:-4-?(?:[5-9]|[1-9]\d)\b|4\.(?:[5-9]|[1-9]\d)\b|-[5-9](?:\b|[.-]))/i.test(
      id,
    );
  },
  extractAgentIdFromSource = function (source) {
    const match = source.match(/^agents\.list\.([^.]*)\./);
    return match?.[1] ?? null;
  },
  normalizeNodeCommand = function (value) {
    return typeof value === "string" ? value.trim() : "";
  },
  listKnownNodeCommands = function (cfg) {
    const baseCfg = {
      ...cfg,
      gateway: {
        ...cfg.gateway,
        nodes: {
          ...cfg.gateway?.nodes,
          denyCommands: [],
        },
      },
    };
    const out = new Set();
    for (const platform of ["ios", "android", "macos", "linux", "windows", "unknown"]) {
      const allow = resolveNodeCommandAllowlist(baseCfg, { platform });
      for (const cmd of allow) {
        const normalized = normalizeNodeCommand(cmd);
        if (normalized) {
          out.add(normalized);
        }
      }
    }
    // Dangerous commands are valid names — excluded from defaults but still recognized
    for (const cmd of DEFAULT_DANGEROUS_NODE_COMMANDS) {
      const normalized = normalizeNodeCommand(cmd);
      if (normalized) {
        out.add(normalized);
      }
    }
    return out;
  },
  looksLikeNodeCommandPattern = function (value) {
    if (!value) {
      return false;
    }
    if (/[?*[\]{}(),|]/.test(value)) {
      return true;
    }
    if (
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.startsWith("^") ||
      value.endsWith("$")
    ) {
      return true;
    }
    return /\s/.test(value) || value.includes("group:");
  },
  resolveToolPolicies = function (params) {
    const policies = [];
    const profile = params.agentTools?.profile ?? params.cfg.tools?.profile;
    const profilePolicy = resolveToolProfilePolicy(profile);
    if (profilePolicy) {
      policies.push(profilePolicy);
    }
    return policies;
  },
  hasWebSearchKey = function (cfg, env) {
    const search = cfg.tools?.web?.search;
    return Boolean(
      search?.apiKey ||
      search?.perplexity?.apiKey ||
      env.BRAVE_API_KEY ||
      env.PERPLEXITY_API_KEY ||
      env.OPENROUTER_API_KEY,
    );
  },
  isWebSearchEnabled = function (cfg, env) {
    const enabled = cfg.tools?.web?.search?.enabled;
    if (enabled === false) {
      return false;
    }
    if (enabled === true) {
      return true;
    }
    return hasWebSearchKey(cfg, env);
  },
  isWebFetchEnabled = function (cfg) {
    const enabled = cfg.tools?.web?.fetch?.enabled;
    if (enabled === false) {
      return false;
    }
    return true;
  },
  isBrowserEnabled = function (cfg) {
    try {
      return resolveBrowserConfig(cfg.browser, cfg).enabled;
    } catch {
      return true;
    }
  },
  listGroupPolicyOpen = function (cfg) {
    const out = [];
    const channels = cfg.channels;
    if (!channels || typeof channels !== "object") {
      return out;
    }
    for (const [channelId, value] of Object.entries(channels)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const section = value;
      if (section.groupPolicy === "open") {
        out.push(`channels.${channelId}.groupPolicy`);
      }
      const accounts = section.accounts;
      if (accounts && typeof accounts === "object") {
        for (const [accountId, accountVal] of Object.entries(accounts)) {
          if (!accountVal || typeof accountVal !== "object") {
            continue;
          }
          const acc = accountVal;
          if (acc.groupPolicy === "open") {
            out.push(`channels.${channelId}.accounts.${accountId}.groupPolicy`);
          }
        }
      }
    }
    return out;
  };
import { isToolAllowedByPolicies } from "../agents/pi-tools.policy.js";
import { resolveToolProfilePolicy } from "../agents/tool-policy.js";
import { resolveBrowserConfig } from "../browser/config.js";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import {
  resolveNodeCommandAllowlist,
  DEFAULT_DANGEROUS_NODE_COMMANDS,
} from "../gateway/node-command-policy.js";
import { inferParamBFromIdOrName } from "../shared/model-param-b.js";
const SMALL_MODEL_PARAM_B_MAX = 300;
const LEGACY_MODEL_PATTERNS = [
  { id: "openai.gpt35", re: /\bgpt-3\.5\b/i, label: "GPT-3.5 family" },
  { id: "anthropic.claude2", re: /\bclaude-(instant|2)\b/i, label: "Claude 2/Instant family" },
  { id: "openai.gpt4_legacy", re: /\bgpt-4-(0314|0613)\b/i, label: "Legacy GPT-4 snapshots" },
];
const WEAK_TIER_MODEL_PATTERNS = [
  { id: "anthropic.haiku", re: /\bhaiku\b/i, label: "Haiku tier (smaller model)" },
];
export function collectAttackSurfaceSummaryFindings(cfg) {
  const group = summarizeGroupPolicy(cfg);
  const elevated = cfg.tools?.elevated?.enabled !== false;
  const webhooksEnabled = cfg.hooks?.enabled === true;
  const internalHooksEnabled = cfg.hooks?.internal?.enabled === true;
  const browserEnabled = cfg.browser?.enabled ?? true;
  const detail = `groups: open=${group.open}, allowlist=${group.allowlist}\ntools.elevated: ${elevated ? "enabled" : "disabled"}\nhooks.webhooks: ${webhooksEnabled ? "enabled" : "disabled"}\nhooks.internal: ${internalHooksEnabled ? "enabled" : "disabled"}\nbrowser control: ${browserEnabled ? "enabled" : "disabled"}`;
  return [
    {
      checkId: "summary.attack_surface",
      severity: "info",
      title: "Attack surface summary",
      detail,
    },
  ];
}
export function collectSyncedFolderFindings(params) {
  const findings = [];
  if (isProbablySyncedPath(params.stateDir) || isProbablySyncedPath(params.configPath)) {
    findings.push({
      checkId: "fs.synced_dir",
      severity: "warn",
      title: "State/config path looks like a synced folder",
      detail: `stateDir=${params.stateDir}, configPath=${params.configPath}. Synced folders (iCloud/Dropbox/OneDrive/Google Drive) can leak tokens and transcripts onto other devices.`,
      remediation: `Keep GENOS_STATE_DIR on a local-only volume and re-run "${formatCliCommand("genosos security audit --fix")}".`,
    });
  }
  return findings;
}
export function collectSecretsInConfigFindings(cfg) {
  const findings = [];
  const password =
    typeof cfg.gateway?.auth?.password === "string" ? cfg.gateway.auth.password.trim() : "";
  if (password && !looksLikeEnvRef(password)) {
    findings.push({
      checkId: "config.secrets.gateway_password_in_config",
      severity: "warn",
      title: "Gateway password is stored in config",
      detail:
        "gateway.auth.password is set in the config file; prefer environment variables for secrets when possible.",
      remediation:
        "Prefer GENOS_GATEWAY_PASSWORD (env) and remove gateway.auth.password from disk.",
    });
  }
  const hooksToken = typeof cfg.hooks?.token === "string" ? cfg.hooks.token.trim() : "";
  if (cfg.hooks?.enabled === true && hooksToken && !looksLikeEnvRef(hooksToken)) {
    findings.push({
      checkId: "config.secrets.hooks_token_in_config",
      severity: "info",
      title: "Hooks token is stored in config",
      detail:
        "hooks.token is set in the config file; keep config perms tight and treat it like an API secret.",
    });
  }
  return findings;
}
export function collectHooksHardeningFindings(cfg, env = process.env) {
  const findings = [];
  if (cfg.hooks?.enabled !== true) {
    return findings;
  }
  const token = typeof cfg.hooks?.token === "string" ? cfg.hooks.token.trim() : "";
  if (token && token.length < 24) {
    findings.push({
      checkId: "hooks.token_too_short",
      severity: "warn",
      title: "Hooks token looks short",
      detail: `hooks.token is ${token.length} chars; prefer a long random token.`,
    });
  }
  const gatewayAuth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
    env,
  });
  const genososGatewayToken =
    typeof env.GENOS_GATEWAY_TOKEN === "string" && env.GENOS_GATEWAY_TOKEN.trim()
      ? env.GENOS_GATEWAY_TOKEN.trim()
      : null;
  const gatewayToken =
    gatewayAuth.mode === "token" &&
    typeof gatewayAuth.token === "string" &&
    gatewayAuth.token.trim()
      ? gatewayAuth.token.trim()
      : genososGatewayToken
        ? genososGatewayToken
        : null;
  if (token && gatewayToken && token === gatewayToken) {
    findings.push({
      checkId: "hooks.token_reuse_gateway_token",
      severity: "warn",
      title: "Hooks token reuses the Gateway token",
      detail:
        "hooks.token matches gateway.auth token; compromise of hooks expands blast radius to the Gateway API.",
      remediation: "Use a separate hooks.token dedicated to hook ingress.",
    });
  }
  const rawPath = typeof cfg.hooks?.path === "string" ? cfg.hooks.path.trim() : "";
  if (rawPath === "/") {
    findings.push({
      checkId: "hooks.path_root",
      severity: "critical",
      title: "Hooks base path is '/'",
      detail: "hooks.path='/' would shadow other HTTP endpoints and is unsafe.",
      remediation: "Use a dedicated path like '/hooks'.",
    });
  }
  const allowRequestSessionKey = cfg.hooks?.allowRequestSessionKey === true;
  const defaultSessionKey =
    typeof cfg.hooks?.defaultSessionKey === "string" ? cfg.hooks.defaultSessionKey.trim() : "";
  const allowedPrefixes = Array.isArray(cfg.hooks?.allowedSessionKeyPrefixes)
    ? cfg.hooks.allowedSessionKeyPrefixes
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix.length > 0)
    : [];
  const remoteExposure = isGatewayRemotelyExposed(cfg);
  if (!defaultSessionKey) {
    findings.push({
      checkId: "hooks.default_session_key_unset",
      severity: "warn",
      title: "hooks.defaultSessionKey is not configured",
      detail:
        "Hook agent runs without explicit sessionKey use generated per-request keys. Set hooks.defaultSessionKey to keep hook ingress scoped to a known session.",
      remediation: 'Set hooks.defaultSessionKey (for example, "hook:ingress").',
    });
  }
  if (allowRequestSessionKey) {
    findings.push({
      checkId: "hooks.request_session_key_enabled",
      severity: remoteExposure ? "critical" : "warn",
      title: "External hook payloads may override sessionKey",
      detail:
        "hooks.allowRequestSessionKey=true allows `/hooks/agent` callers to choose the session key. Treat hook token holders as full-trust unless you also restrict prefixes.",
      remediation:
        "Set hooks.allowRequestSessionKey=false (recommended) or constrain hooks.allowedSessionKeyPrefixes.",
    });
  }
  if (allowRequestSessionKey && allowedPrefixes.length === 0) {
    findings.push({
      checkId: "hooks.request_session_key_prefixes_missing",
      severity: remoteExposure ? "critical" : "warn",
      title: "Request sessionKey override is enabled without prefix restrictions",
      detail:
        "hooks.allowRequestSessionKey=true and hooks.allowedSessionKeyPrefixes is unset/empty, so request payloads can target arbitrary session key shapes.",
      remediation:
        'Set hooks.allowedSessionKeyPrefixes (for example, ["hook:"]) or disable request overrides.',
    });
  }
  return findings;
}
export function collectGatewayHttpSessionKeyOverrideFindings(cfg) {
  const findings = [];
  const chatCompletionsEnabled = cfg.gateway?.http?.endpoints?.chatCompletions?.enabled === true;
  const responsesEnabled = cfg.gateway?.http?.endpoints?.responses?.enabled === true;
  if (!chatCompletionsEnabled && !responsesEnabled) {
    return findings;
  }
  const enabledEndpoints = [
    chatCompletionsEnabled ? "/v1/chat/completions" : null,
    responsesEnabled ? "/v1/responses" : null,
  ].filter((entry) => Boolean(entry));
  findings.push({
    checkId: "gateway.http.session_key_override_enabled",
    severity: "info",
    title: "HTTP API session-key override is enabled",
    detail: `${enabledEndpoints.join(", ")} accept x-genosos-session-key for per-request session routing. Treat API credential holders as trusted principals.`,
  });
  return findings;
}
export function collectSandboxDockerNoopFindings(_cfg) {
  return [];
}
export function collectSandboxDangerousConfigFindings(_cfg) {
  return [];
}
export function collectNodeDenyCommandPatternFindings(cfg) {
  const findings = [];
  const denyListRaw = cfg.gateway?.nodes?.denyCommands;
  if (!Array.isArray(denyListRaw) || denyListRaw.length === 0) {
    return findings;
  }
  const denyList = denyListRaw.map(normalizeNodeCommand).filter(Boolean);
  if (denyList.length === 0) {
    return findings;
  }
  const knownCommands = listKnownNodeCommands(cfg);
  const patternLike = denyList.filter((entry) => looksLikeNodeCommandPattern(entry));
  const unknownExact = denyList.filter(
    (entry) => !looksLikeNodeCommandPattern(entry) && !knownCommands.has(entry),
  );
  if (patternLike.length === 0 && unknownExact.length === 0) {
    return findings;
  }
  const detailParts = [];
  if (patternLike.length > 0) {
    detailParts.push(
      `Pattern-like entries (not supported by exact matching): ${patternLike.join(", ")}`,
    );
  }
  if (unknownExact.length > 0) {
    detailParts.push(
      `Unknown command names (not in defaults/allowCommands): ${unknownExact.join(", ")}`,
    );
  }
  const examples = Array.from(knownCommands).slice(0, 8);
  findings.push({
    checkId: "gateway.nodes.deny_commands_ineffective",
    severity: "warn",
    title: "Some gateway.nodes.denyCommands entries are ineffective",
    detail:
      "gateway.nodes.denyCommands uses exact command-name matching only.\n" +
      detailParts.map((entry) => `- ${entry}`).join("\n"),
    remediation: `Use exact command names (for example: ${examples.join(", ")}). If you need broader restrictions, remove risky commands from allowCommands/default workflows.`,
  });
  return findings;
}
export function collectMinimalProfileOverrideFindings(cfg) {
  const findings = [];
  if (cfg.tools?.profile !== "minimal") {
    return findings;
  }
  const overrides = (cfg.agents?.list ?? [])
    .filter((entry) => {
      return Boolean(
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        entry.tools?.profile &&
        entry.tools.profile !== "minimal",
      );
    })
    .map((entry) => `${entry.id}=${entry.tools?.profile}`);
  if (overrides.length === 0) {
    return findings;
  }
  findings.push({
    checkId: "tools.profile_minimal_overridden",
    severity: "warn",
    title: "Global tools.profile=minimal is overridden by agent profiles",
    detail:
      "Global minimal profile is set, but these agent profiles take precedence:\n" +
      overrides.map((entry) => `- agents.list.${entry}`).join("\n"),
    remediation:
      'Set those agents to `tools.profile="minimal"` (or remove the agent override) if you want minimal tools enforced globally.',
  });
  return findings;
}
export function collectModelHygieneFindings(cfg) {
  const findings = [];
  const models = collectModels(cfg);
  if (models.length === 0) {
    return findings;
  }
  const weakMatches = new Map();
  const addWeakMatch = (model, source, reason) => {
    const key = `${model}@@${source}`;
    const existing = weakMatches.get(key);
    if (!existing) {
      weakMatches.set(key, { model, source, reasons: [reason] });
      return;
    }
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
  };
  for (const entry of models) {
    for (const pat of WEAK_TIER_MODEL_PATTERNS) {
      if (pat.re.test(entry.id)) {
        addWeakMatch(entry.id, entry.source, pat.label);
        break;
      }
    }
    if (isGptModel(entry.id) && !isGpt5OrHigher(entry.id)) {
      addWeakMatch(entry.id, entry.source, "Below GPT-5 family");
    }
    if (isClaudeModel(entry.id) && !isClaude45OrHigher(entry.id)) {
      addWeakMatch(entry.id, entry.source, "Below Claude 4.5");
    }
  }
  const matches = [];
  for (const entry of models) {
    for (const pat of LEGACY_MODEL_PATTERNS) {
      if (pat.re.test(entry.id)) {
        matches.push({ model: entry.id, source: entry.source, reason: pat.label });
        break;
      }
    }
  }
  if (matches.length > 0) {
    const lines = matches
      .slice(0, 12)
      .map((m) => `- ${m.model} (${m.reason}) @ ${m.source}`)
      .join("\n");
    const more =
      matches.length > 12
        ? `
\u2026${matches.length - 12} more`
        : "";
    findings.push({
      checkId: "models.legacy",
      severity: "warn",
      title: "Some configured models look legacy",
      detail:
        "Older/legacy models can be less robust against prompt injection and tool misuse.\n" +
        lines +
        more,
      remediation: "Prefer modern, instruction-hardened models for any bot that can run tools.",
    });
  }
  if (weakMatches.size > 0) {
    const lines = Array.from(weakMatches.values())
      .slice(0, 12)
      .map((m) => `- ${m.model} (${m.reasons.join("; ")}) @ ${m.source}`)
      .join("\n");
    const more =
      weakMatches.size > 12
        ? `
\u2026${weakMatches.size - 12} more`
        : "";
    findings.push({
      checkId: "models.weak_tier",
      severity: "warn",
      title: "Some configured models are below recommended tiers",
      detail:
        "Smaller/older models are generally more susceptible to prompt injection and tool misuse.\n" +
        lines +
        more,
      remediation:
        "Use the latest, top-tier model for any bot with tools or untrusted inboxes. Avoid Haiku tiers; prefer GPT-5+ and Claude 4.5+.",
    });
  }
  return findings;
}
export function collectSmallModelRiskFindings(params) {
  const findings = [];
  const models = collectModels(params.cfg).filter((entry) => !entry.source.includes("imageModel"));
  if (models.length === 0) {
    return findings;
  }
  const smallModels = models
    .map((entry) => {
      const paramB = inferParamBFromIdOrName(entry.id);
      if (!paramB || paramB > SMALL_MODEL_PARAM_B_MAX) {
        return null;
      }
      return { ...entry, paramB };
    })
    .filter((entry) => Boolean(entry));
  if (smallModels.length === 0) {
    return findings;
  }
  let hasUnsafe = false;
  const modelLines = [];
  const exposureSet = new Set();
  for (const entry of smallModels) {
    const agentId = extractAgentIdFromSource(entry.source);
    const agentTools =
      agentId && params.cfg.agents?.list
        ? params.cfg.agents.list.find((agent) => agent?.id === agentId)?.tools
        : undefined;
    const policies = resolveToolPolicies({
      cfg: params.cfg,
      agentTools,
      agentId,
    });
    const exposed = [];
    if (isWebSearchEnabled(params.cfg, params.env)) {
      if (isToolAllowedByPolicies("web_search", policies)) {
        exposed.push("web_search");
      }
    }
    if (isWebFetchEnabled(params.cfg)) {
      if (isToolAllowedByPolicies("web_fetch", policies)) {
        exposed.push("web_fetch");
      }
    }
    if (isBrowserEnabled(params.cfg)) {
      if (isToolAllowedByPolicies("browser", policies)) {
        exposed.push("browser");
      }
    }
    for (const tool of exposed) {
      exposureSet.add(tool);
    }
    const exposureLabel = exposed.length > 0 ? ` web=[${exposed.join(", ")}]` : " web=[off]";
    const safe = exposed.length === 0;
    if (!safe) {
      hasUnsafe = true;
    }
    const statusLabel = safe ? "ok" : "unsafe";
    modelLines.push(
      `- ${entry.id} (${entry.paramB}B) @ ${entry.source} (${statusLabel};${exposureLabel})`,
    );
  }
  const exposureList = Array.from(exposureSet);
  const exposureDetail =
    exposureList.length > 0
      ? `Uncontrolled input tools allowed: ${exposureList.join(", ")}.`
      : "No web/browser tools detected for these models.";
  findings.push({
    checkId: "models.small_params",
    severity: hasUnsafe ? "critical" : "info",
    title: "Small models detected — review web tool exposure",
    detail:
      `Small models (<=${SMALL_MODEL_PARAM_B_MAX}B params) detected:\n` +
      modelLines.join("\n") +
      `\n` +
      exposureDetail +
      `\nSmall models are not recommended for untrusted inputs.`,
    remediation:
      'If you must use small models, disable web_search/web_fetch/browser (tools.deny=["group:web","browser"]).',
  });
  return findings;
}
export function collectExposureMatrixFindings(cfg) {
  const findings = [];
  const openGroups = listGroupPolicyOpen(cfg);
  if (openGroups.length === 0) {
    return findings;
  }
  const elevatedEnabled = cfg.tools?.elevated?.enabled !== false;
  if (elevatedEnabled) {
    findings.push({
      checkId: "security.exposure.open_groups_with_elevated",
      severity: "critical",
      title: "Open groupPolicy with elevated tools enabled",
      detail: `Found groupPolicy="open" at:\n${openGroups.map((p) => `- ${p}`).join("\n")}\nWith tools.elevated enabled, a prompt injection in those rooms can become a high-impact incident.`,
      remediation: `Set groupPolicy="allowlist" and keep elevated allowlists extremely tight.`,
    });
  }
  return findings;
}
