let isLikelyEmoji = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.length > 16) {
      return false;
    }
    let hasNonAscii = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed.charCodeAt(i) > 127) {
        hasNonAscii = true;
        break;
      }
    }
    if (!hasNonAscii) {
      return false;
    }
    if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
      return false;
    }
    return true;
  },
  resolveConfiguredModels = function (configForm) {
    const cfg = configForm;
    const models = cfg?.agents?.defaults?.models;
    if (!models || typeof models !== "object") {
      return [];
    }
    const options = [];
    for (const [modelId, modelRaw] of Object.entries(models)) {
      const trimmed = modelId.trim();
      if (!trimmed) {
        continue;
      }
      const alias =
        modelRaw && typeof modelRaw === "object" && "alias" in modelRaw
          ? typeof modelRaw.alias === "string"
            ? modelRaw.alias?.trim()
            : undefined
          : undefined;
      const label = alias && alias !== trimmed ? `${alias} (${trimmed})` : trimmed;
      options.push({ value: trimmed, label });
    }
    return options;
  };
import { html } from "lit";
export function normalizeAgentLabel(agent) {
  return agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
}
export function resolveAgentEmoji(agent, agentIdentity) {
  const identityEmoji = agentIdentity?.emoji?.trim();
  if (identityEmoji && isLikelyEmoji(identityEmoji)) {
    return identityEmoji;
  }
  const agentEmoji = agent.identity?.emoji?.trim();
  if (agentEmoji && isLikelyEmoji(agentEmoji)) {
    return agentEmoji;
  }
  const identityAvatar = agentIdentity?.avatar?.trim();
  if (identityAvatar && isLikelyEmoji(identityAvatar)) {
    return identityAvatar;
  }
  const avatar = agent.identity?.avatar?.trim();
  if (avatar && isLikelyEmoji(avatar)) {
    return avatar;
  }
  return "";
}
export function agentBadgeText(agentId, defaultId) {
  return defaultId && agentId === defaultId ? "default" : null;
}
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}
export function resolveAgentConfig(config, agentId) {
  const cfg = config;
  const list = cfg?.agents?.list ?? [];
  const entry = list.find((agent) => agent?.id === agentId);
  return {
    entry,
    defaults: cfg?.agents?.defaults,
    globalTools: cfg?.tools,
  };
}
export function buildAgentContext(agent, configForm, agentFilesList, defaultId, agentIdentity) {
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const modelLabel = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    agent.id;
  const identityEmoji = resolveAgentEmoji(agent, agentIdentity) || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  return {
    workspace,
    model: modelLabel,
    identityName,
    identityEmoji,
    skillsLabel: skillFilter ? `${skillCount} selected` : "all skills",
    isDefault: Boolean(defaultId && agent.id === defaultId),
  };
}
export function resolveModelLabel(model) {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model;
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}
export function normalizeModelValue(label) {
  const match = label.match(/^(.+) \(\+\d+ fallback\)$/);
  return match ? match[1] : label;
}
export function resolveModelPrimary(model) {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}
export function resolveModelFallbacks(model) {
  if (!model || typeof model === "string") {
    return null;
  }
  if (typeof model === "object" && model) {
    const record = model;
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks
      : Array.isArray(record.fallback)
        ? record.fallback
        : null;
    return fallbacks ? fallbacks.filter((entry) => typeof entry === "string") : null;
  }
  return null;
}
export function parseFallbackList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
export function buildModelOptions(configForm, current) {
  const options = resolveConfiguredModels(configForm);
  const hasCurrent = current ? options.some((option) => option.value === current) : false;
  if (current && !hasCurrent) {
    options.unshift({ value: current, label: `Current (${current})` });
  }
  if (options.length === 0) {
    return html`
      <option value="" disabled>No configured models</option>
    `;
  }
  return options.map((option) => html`<option value=${option.value}>${option.label}</option>`);
}
