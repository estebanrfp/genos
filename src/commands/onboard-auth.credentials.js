import { resolveGenosOSAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
import {
  hasCredentialsInProviders,
  updateProvidersInConfig,
} from "../agents/auth-profiles/store.js";
export { CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF } from "../agents/cloudflare-ai-gateway.js";
export { XAI_DEFAULT_MODEL_REF } from "./onboard-auth.models.js";
const resolveAuthAgentDir = (agentDir) => agentDir ?? resolveGenosOSAgentDir();

/**
 * Save a credential using providers format (preferred) or legacy auth-profiles.
 * Detects active format from config on disk.
 * @param {{ profileId: string, credential: object, agentDir?: string }} opts
 */
export async function saveCredentialFormatAware({ profileId, credential, agentDir }) {
  const { readConfigFileSnapshotForWrite } = await import("../config/config.js");
  const { snapshot } = await readConfigFileSnapshotForWrite();
  const cfg = snapshot.config ?? {};
  const hasLegacy = Object.keys(cfg.auth?.profiles ?? {}).length > 0;
  if (hasCredentialsInProviders(cfg) || !hasLegacy) {
    const provider = profileId.slice(0, profileId.indexOf(":"));
    await updateProvidersInConfig((store) => {
      store.profiles[profileId] = credential;
      store.order ??= {};
      store.order[provider] ??= [];
      if (!store.order[provider].includes(profileId)) {
        store.order[provider].push(profileId);
      }
      return true;
    });
  } else {
    upsertAuthProfile({ profileId, credential, agentDir: resolveAuthAgentDir(agentDir) });
  }
}
export async function writeOAuthCredentials(provider, creds, agentDir) {
  const email =
    typeof creds.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  await saveCredentialFormatAware({
    profileId: `${provider}:${email}`,
    credential: {
      type: "oauth",
      provider,
      ...creds,
    },
    agentDir,
  });
}
export async function setAnthropicApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "anthropic:default",
    credential: { type: "api_key", provider: "anthropic", key },
    agentDir,
  });
}
export async function setGeminiApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "google:default",
    credential: { type: "api_key", provider: "google", key },
    agentDir,
  });
}
export async function setMinimaxApiKey(key, agentDir, profileId = "minimax:default") {
  const provider = profileId.split(":")[0] ?? "minimax";
  await saveCredentialFormatAware({
    profileId,
    credential: { type: "api_key", provider, key },
    agentDir,
  });
}
export async function setMoonshotApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "moonshot:default",
    credential: { type: "api_key", provider: "moonshot", key },
    agentDir,
  });
}
export async function setKimiCodingApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "kimi-coding:default",
    credential: { type: "api_key", provider: "kimi-coding", key },
    agentDir,
  });
}
export async function setSyntheticApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "synthetic:default",
    credential: { type: "api_key", provider: "synthetic", key },
    agentDir,
  });
}
export async function setVeniceApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "venice:default",
    credential: { type: "api_key", provider: "venice", key },
    agentDir,
  });
}
export const ZAI_DEFAULT_MODEL_REF = "zai/glm-5";
export const XIAOMI_DEFAULT_MODEL_REF = "xiaomi/mimo-v2-flash";
export const OPENROUTER_DEFAULT_MODEL_REF = "openrouter/auto";
export const HUGGINGFACE_DEFAULT_MODEL_REF = "huggingface/deepseek-ai/DeepSeek-R1";
export const TOGETHER_DEFAULT_MODEL_REF = "together/moonshotai/Kimi-K2.5";
export const LITELLM_DEFAULT_MODEL_REF = "litellm/claude-opus-4-6";
export const VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF = "vercel-ai-gateway/anthropic/claude-opus-4.6";
export async function setZaiApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "zai:default",
    credential: { type: "api_key", provider: "zai", key },
    agentDir,
  });
}
export async function setXiaomiApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "xiaomi:default",
    credential: { type: "api_key", provider: "xiaomi", key },
    agentDir,
  });
}
export async function setOpenrouterApiKey(key, agentDir) {
  const safeKey = key === "undefined" ? "" : key;
  await saveCredentialFormatAware({
    profileId: "openrouter:default",
    credential: { type: "api_key", provider: "openrouter", key: safeKey },
    agentDir,
  });
}
export async function setCloudflareAiGatewayConfig(accountId, gatewayId, apiKey, agentDir) {
  const normalizedAccountId = accountId.trim();
  const normalizedGatewayId = gatewayId.trim();
  const normalizedKey = apiKey.trim();
  await saveCredentialFormatAware({
    profileId: "cloudflare-ai-gateway:default",
    credential: {
      type: "api_key",
      provider: "cloudflare-ai-gateway",
      key: normalizedKey,
      metadata: { accountId: normalizedAccountId, gatewayId: normalizedGatewayId },
    },
    agentDir,
  });
}
export async function setLitellmApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "litellm:default",
    credential: { type: "api_key", provider: "litellm", key },
    agentDir,
  });
}
export async function setVercelAiGatewayApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "vercel-ai-gateway:default",
    credential: { type: "api_key", provider: "vercel-ai-gateway", key },
    agentDir,
  });
}
export async function setOpencodeZenApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "opencode:default",
    credential: { type: "api_key", provider: "opencode", key },
    agentDir,
  });
}
export async function setTogetherApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "together:default",
    credential: { type: "api_key", provider: "together", key },
    agentDir,
  });
}
export async function setHuggingfaceApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "huggingface:default",
    credential: { type: "api_key", provider: "huggingface", key },
    agentDir,
  });
}
export async function setQianfanApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "qianfan:default",
    credential: { type: "api_key", provider: "qianfan", key },
    agentDir,
  });
}
export async function setXaiApiKey(key, agentDir) {
  await saveCredentialFormatAware({
    profileId: "xai:default",
    credential: { type: "api_key", provider: "xai", key },
    agentDir,
  });
}
