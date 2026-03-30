let cloneFirstTemplateModel = function (params) {
    const { normalizedProvider, trimmedModelId, templateIds, modelRegistry } = params;
    for (const templateId of [...new Set(templateIds)].filter(Boolean)) {
      const template = modelRegistry.find(normalizedProvider, templateId);
      if (!template) {
        continue;
      }
      return normalizeModelCompat({
        ...template,
        id: trimmedModelId,
        name: trimmedModelId,
        ...params.patch,
      });
    }
    return;
  },
  resolveOpenAICodexGpt53FallbackModel = function (provider, modelId, modelRegistry) {
    const normalizedProvider = normalizeProviderId(provider);
    const trimmedModelId = modelId.trim();
    if (normalizedProvider !== "openai-codex") {
      return;
    }
    if (trimmedModelId.toLowerCase() !== OPENAI_CODEX_GPT_53_MODEL_ID) {
      return;
    }
    for (const templateId of OPENAI_CODEX_TEMPLATE_MODEL_IDS) {
      const template = modelRegistry.find(normalizedProvider, templateId);
      if (!template) {
        continue;
      }
      return normalizeModelCompat({
        ...template,
        id: trimmedModelId,
        name: trimmedModelId,
      });
    }
    return normalizeModelCompat({
      id: trimmedModelId,
      name: trimmedModelId,
      api: "openai-codex-responses",
      provider: normalizedProvider,
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CONTEXT_TOKENS,
      maxTokens: DEFAULT_CONTEXT_TOKENS,
    });
  },
  resolveAnthropic46ForwardCompatModel = function (params) {
    const { provider, modelId, modelRegistry, dashModelId, dotModelId } = params;
    const normalizedProvider = normalizeProviderId(provider);
    if (normalizedProvider !== "anthropic") {
      return;
    }
    const trimmedModelId = modelId.trim();
    const lower = trimmedModelId.toLowerCase();
    const is46Model =
      lower === dashModelId ||
      lower === dotModelId ||
      lower.startsWith(`${dashModelId}-`) ||
      lower.startsWith(`${dotModelId}-`);
    if (!is46Model) {
      return;
    }
    const templateIds = [];
    if (lower.startsWith(dashModelId)) {
      templateIds.push(lower.replace(dashModelId, params.dashTemplateId));
    }
    if (lower.startsWith(dotModelId)) {
      templateIds.push(lower.replace(dotModelId, params.dotTemplateId));
    }
    templateIds.push(...params.fallbackTemplateIds);
    return cloneFirstTemplateModel({
      normalizedProvider,
      trimmedModelId,
      templateIds,
      modelRegistry,
    });
  },
  resolveAnthropicOpus46ForwardCompatModel = function (provider, modelId, modelRegistry) {
    return resolveAnthropic46ForwardCompatModel({
      provider,
      modelId,
      modelRegistry,
      dashModelId: ANTHROPIC_OPUS_46_MODEL_ID,
      dotModelId: ANTHROPIC_OPUS_46_DOT_MODEL_ID,
      dashTemplateId: "claude-opus-4-5",
      dotTemplateId: "claude-opus-4.5",
      fallbackTemplateIds: ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS,
    });
  },
  resolveAnthropicSonnet46ForwardCompatModel = function (provider, modelId, modelRegistry) {
    return resolveAnthropic46ForwardCompatModel({
      provider,
      modelId,
      modelRegistry,
      dashModelId: ANTHROPIC_SONNET_46_MODEL_ID,
      dotModelId: ANTHROPIC_SONNET_46_DOT_MODEL_ID,
      dashTemplateId: "claude-sonnet-4-5",
      dotTemplateId: "claude-sonnet-4.5",
      fallbackTemplateIds: ANTHROPIC_SONNET_TEMPLATE_MODEL_IDS,
    });
  },
  resolveZaiGlm5ForwardCompatModel = function (provider, modelId, modelRegistry) {
    if (normalizeProviderId(provider) !== "zai") {
      return;
    }
    const trimmed = modelId.trim();
    const lower = trimmed.toLowerCase();
    if (lower !== ZAI_GLM5_MODEL_ID && !lower.startsWith(`${ZAI_GLM5_MODEL_ID}-`)) {
      return;
    }
    for (const templateId of ZAI_GLM5_TEMPLATE_MODEL_IDS) {
      const template = modelRegistry.find("zai", templateId);
      if (!template) {
        continue;
      }
      return normalizeModelCompat({
        ...template,
        id: trimmed,
        name: trimmed,
        reasoning: true,
      });
    }
    return normalizeModelCompat({
      id: trimmed,
      name: trimmed,
      api: "openai-completions",
      provider: "zai",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CONTEXT_TOKENS,
      maxTokens: DEFAULT_CONTEXT_TOKENS,
    });
  },
  resolveAntigravityOpus46ForwardCompatModel = function (provider, modelId, modelRegistry) {
    const normalizedProvider = normalizeProviderId(provider);
    if (normalizedProvider !== "google-antigravity") {
      return;
    }
    const trimmedModelId = modelId.trim();
    const lower = trimmedModelId.toLowerCase();
    const isOpus46 =
      lower === ANTIGRAVITY_OPUS_46_MODEL_ID ||
      lower === ANTIGRAVITY_OPUS_46_DOT_MODEL_ID ||
      lower.startsWith(`${ANTIGRAVITY_OPUS_46_MODEL_ID}-`) ||
      lower.startsWith(`${ANTIGRAVITY_OPUS_46_DOT_MODEL_ID}-`);
    const isOpus46Thinking =
      lower === ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID ||
      lower === ANTIGRAVITY_OPUS_46_DOT_THINKING_MODEL_ID ||
      lower.startsWith(`${ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID}-`) ||
      lower.startsWith(`${ANTIGRAVITY_OPUS_46_DOT_THINKING_MODEL_ID}-`);
    if (!isOpus46 && !isOpus46Thinking) {
      return;
    }
    const templateIds = [];
    if (lower.startsWith(ANTIGRAVITY_OPUS_46_MODEL_ID)) {
      templateIds.push(lower.replace(ANTIGRAVITY_OPUS_46_MODEL_ID, "claude-opus-4-5"));
    }
    if (lower.startsWith(ANTIGRAVITY_OPUS_46_DOT_MODEL_ID)) {
      templateIds.push(lower.replace(ANTIGRAVITY_OPUS_46_DOT_MODEL_ID, "claude-opus-4.5"));
    }
    if (lower.startsWith(ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID)) {
      templateIds.push(
        lower.replace(ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID, "claude-opus-4-5-thinking"),
      );
    }
    if (lower.startsWith(ANTIGRAVITY_OPUS_46_DOT_THINKING_MODEL_ID)) {
      templateIds.push(
        lower.replace(ANTIGRAVITY_OPUS_46_DOT_THINKING_MODEL_ID, "claude-opus-4.5-thinking"),
      );
    }
    templateIds.push(...ANTIGRAVITY_OPUS_TEMPLATE_MODEL_IDS);
    templateIds.push(...ANTIGRAVITY_OPUS_THINKING_TEMPLATE_MODEL_IDS);
    return cloneFirstTemplateModel({
      normalizedProvider,
      trimmedModelId,
      templateIds,
      modelRegistry,
    });
  };
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";
import { normalizeModelCompat } from "./model-compat.js";
import { normalizeProviderId } from "./model-selection.js";
const OPENAI_CODEX_GPT_53_MODEL_ID = "gpt-5.3-codex";
const OPENAI_CODEX_TEMPLATE_MODEL_IDS = ["gpt-5.2-codex"];
const ANTHROPIC_OPUS_46_MODEL_ID = "claude-opus-4-6";
const ANTHROPIC_OPUS_46_DOT_MODEL_ID = "claude-opus-4.6";
const ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS = ["claude-opus-4-5", "claude-opus-4.5"];
const ANTHROPIC_SONNET_46_MODEL_ID = "claude-sonnet-4-6";
const ANTHROPIC_SONNET_46_DOT_MODEL_ID = "claude-sonnet-4.6";
const ANTHROPIC_SONNET_TEMPLATE_MODEL_IDS = ["claude-sonnet-4-5", "claude-sonnet-4.5"];
const ZAI_GLM5_MODEL_ID = "glm-5";
const ZAI_GLM5_TEMPLATE_MODEL_IDS = ["glm-4.7"];
const ANTIGRAVITY_OPUS_46_MODEL_ID = "claude-opus-4-6";
const ANTIGRAVITY_OPUS_46_DOT_MODEL_ID = "claude-opus-4.6";
const ANTIGRAVITY_OPUS_TEMPLATE_MODEL_IDS = ["claude-opus-4-5", "claude-opus-4.5"];
const ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID = "claude-opus-4-6-thinking";
const ANTIGRAVITY_OPUS_46_DOT_THINKING_MODEL_ID = "claude-opus-4.6-thinking";
const ANTIGRAVITY_OPUS_THINKING_TEMPLATE_MODEL_IDS = [
  "claude-opus-4-5-thinking",
  "claude-opus-4.5-thinking",
];
export const ANTIGRAVITY_OPUS_46_FORWARD_COMPAT_CANDIDATES = [
  {
    id: ANTIGRAVITY_OPUS_46_THINKING_MODEL_ID,
    templatePrefixes: [
      "google-antigravity/claude-opus-4-5-thinking",
      "google-antigravity/claude-opus-4.5-thinking",
    ],
  },
  {
    id: ANTIGRAVITY_OPUS_46_MODEL_ID,
    templatePrefixes: ["google-antigravity/claude-opus-4-5", "google-antigravity/claude-opus-4.5"],
  },
];
export function resolveForwardCompatModel(provider, modelId, modelRegistry) {
  return (
    resolveOpenAICodexGpt53FallbackModel(provider, modelId, modelRegistry) ??
    resolveAnthropicOpus46ForwardCompatModel(provider, modelId, modelRegistry) ??
    resolveAnthropicSonnet46ForwardCompatModel(provider, modelId, modelRegistry) ??
    resolveZaiGlm5ForwardCompatModel(provider, modelId, modelRegistry) ??
    resolveAntigravityOpus46ForwardCompatModel(provider, modelId, modelRegistry)
  );
}
