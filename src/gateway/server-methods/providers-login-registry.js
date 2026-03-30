/**
 * Provider login registry — maps provider names to auth flow type and defaults.
 * Used by providers-login.js to route login requests to the correct flow.
 *
 * Flow types:
 * - "api-key"       → user pastes key, saved immediately
 * - "device"        → device code flow (polling) — Copilot, Qwen, MiniMax
 * - "browser-oauth" → browser redirect OAuth (callback server) — Chutes, Codex, Google
 *
 * Interactive providers include a `cli` field with the correct terminal command.
 * Some live in the plugin system (`models auth login`), others only in onboarding.
 */

/** @type {Record<string, {flow: string, type?: string, defaultModel?: string, cli?: string}>} */
export const PROVIDER_REGISTRY = {
  // === API KEY PROVIDERS ===
  anthropic: { flow: "api-key", type: "api_key", defaultModel: "anthropic/claude-opus-4-6" },
  openai: { flow: "api-key", type: "api_key", defaultModel: "openai/gpt-4o" },
  google: { flow: "api-key", type: "api_key", defaultModel: "google/gemini-2.0-flash" },
  xai: { flow: "api-key", type: "api_key", defaultModel: "xai/grok-4" },
  openrouter: { flow: "api-key", type: "api_key", defaultModel: "openrouter/auto" },
  together: { flow: "api-key", type: "api_key", defaultModel: "together/moonshotai/Kimi-K2.5" },
  venice: { flow: "api-key", type: "api_key", defaultModel: "venice/default" },
  huggingface: {
    flow: "api-key",
    type: "api_key",
    defaultModel: "huggingface/deepseek-ai/DeepSeek-R1",
  },
  litellm: { flow: "api-key", type: "api_key", defaultModel: "litellm/claude-opus-4-6" },
  moonshot: { flow: "api-key", type: "api_key", defaultModel: "moonshot/kimi-k2.5" },
  "kimi-coding": { flow: "api-key", type: "api_key", defaultModel: "kimi-coding/k2p5" },
  zai: { flow: "api-key", type: "api_key", defaultModel: "zai/glm-5" },
  xiaomi: { flow: "api-key", type: "api_key", defaultModel: "xiaomi/mimo-v2-flash" },
  qianfan: { flow: "api-key", type: "api_key", defaultModel: "qianfan/ernie-4o" },
  synthetic: { flow: "api-key", type: "api_key", defaultModel: "synthetic/default" },
  minimax: { flow: "api-key", type: "api_key", defaultModel: "minimax/MiniMax-M1" },
  "vercel-ai-gateway": {
    flow: "api-key",
    type: "api_key",
    defaultModel: "vercel-ai-gateway/anthropic/claude-opus-4.6",
  },
  opencode: { flow: "api-key", type: "api_key", defaultModel: "opencode/claude-opus-4-6" },
  custom: { flow: "api-key", type: "api_key" },
  // Anthropic setup-token variant
  "anthropic-token": { flow: "api-key", type: "token", defaultModel: "anthropic/claude-opus-4-6" },

  // === DEVICE FLOW PROVIDERS ===
  "github-copilot": { flow: "device", cli: "genosos models auth login --provider github-copilot" },
  "qwen-portal": { flow: "device", cli: "genosos models auth login --provider qwen-portal" },
  "minimax-portal": { flow: "device", cli: "genosos models auth login --provider minimax-portal" },

  // === BROWSER OAUTH PROVIDERS ===
  chutes: { flow: "browser-oauth", cli: "genosos models auth login --provider chutes" },
  "openai-codex": {
    flow: "browser-oauth",
    cli: "genosos models auth login --provider openai-codex",
  },
  "google-antigravity": {
    flow: "browser-oauth",
    cli: "genosos models auth login --provider google-antigravity",
  },
  "google-gemini-cli": {
    flow: "browser-oauth",
    cli: "genosos models auth login --provider google-gemini-cli",
  },
};

/**
 * Get all provider names that support a given flow type.
 * @param {"api-key"|"device"|"browser-oauth"} flow
 * @returns {string[]}
 */
export const providersByFlow = (flow) =>
  Object.entries(PROVIDER_REGISTRY)
    .filter(([, entry]) => entry.flow === flow)
    .map(([name]) => name);
