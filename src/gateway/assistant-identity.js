let coerceIdentityValue = function (value, maxLength) {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return trimmed.slice(0, maxLength);
  },
  isAvatarUrl = function (value) {
    return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
  },
  looksLikeAvatarPath = function (value) {
    if (/[\\/]/.test(value)) {
      return true;
    }
    return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(value);
  },
  normalizeAvatarValue = function (value) {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (isAvatarUrl(trimmed)) {
      return trimmed;
    }
    if (looksLikeAvatarPath(trimmed)) {
      return trimmed;
    }
    if (!/\s/.test(trimmed) && trimmed.length <= 4) {
      return trimmed;
    }
    return;
  },
  normalizeEmojiValue = function (value) {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.length > MAX_ASSISTANT_EMOJI) {
      return;
    }
    let hasNonAscii = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed.charCodeAt(i) > 127) {
        hasNonAscii = true;
        break;
      }
    }
    if (!hasNonAscii) {
      return;
    }
    if (isAvatarUrl(trimmed) || looksLikeAvatarPath(trimmed)) {
      return;
    }
    return trimmed;
  };
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { resolveAgentIdentity } from "../agents/identity.js";
import { loadAgentIdentity } from "../commands/agents.config.js";
import { normalizeAgentId } from "../routing/session-key.js";
const MAX_ASSISTANT_NAME = 50;
const MAX_ASSISTANT_AVATAR = 200;
const MAX_ASSISTANT_EMOJI = 16;
export const DEFAULT_ASSISTANT_IDENTITY = {
  agentId: "main",
  name: "Assistant",
  avatar: "A",
};
export function resolveAssistantIdentity(params) {
  const agentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const configAssistant = params.cfg.ui?.assistant;
  const agentEntry = resolveAgentConfig(params.cfg, agentId);
  const agentIdentity = resolveAgentIdentity(params.cfg, agentId);
  const fileIdentity = workspaceDir ? loadAgentIdentity(workspaceDir) : null;
  const name =
    coerceIdentityValue(configAssistant?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityValue(agentEntry?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityValue(agentIdentity?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityValue(fileIdentity?.name, MAX_ASSISTANT_NAME) ??
    DEFAULT_ASSISTANT_IDENTITY.name;
  const avatarCandidates = [
    coerceIdentityValue(configAssistant?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(agentIdentity?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(agentIdentity?.emoji, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(fileIdentity?.avatar, MAX_ASSISTANT_AVATAR),
    coerceIdentityValue(fileIdentity?.emoji, MAX_ASSISTANT_AVATAR),
  ];
  const avatar =
    avatarCandidates.map((candidate) => normalizeAvatarValue(candidate)).find(Boolean) ??
    DEFAULT_ASSISTANT_IDENTITY.avatar;
  const emojiCandidates = [
    coerceIdentityValue(agentIdentity?.emoji, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(fileIdentity?.emoji, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(agentIdentity?.avatar, MAX_ASSISTANT_EMOJI),
    coerceIdentityValue(fileIdentity?.avatar, MAX_ASSISTANT_EMOJI),
  ];
  const emoji = emojiCandidates.map((candidate) => normalizeEmojiValue(candidate)).find(Boolean);
  return { agentId, name, avatar, emoji };
}
