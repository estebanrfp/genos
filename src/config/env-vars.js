export function collectConfigEnvVars(cfg) {
  const envConfig = cfg?.env;
  if (!envConfig) {
    return {};
  }
  const entries = {};
  if (envConfig.vars) {
    for (const [key, value] of Object.entries(envConfig.vars)) {
      if (!value) {
        continue;
      }
      entries[key] = value;
    }
  }
  for (const [key, value] of Object.entries(envConfig)) {
    if (key === "shellEnv" || key === "vars") {
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    entries[key] = value;
  }
  return entries;
}
/** @type {Record<string, string>} provider id → env var name */
const PROVIDER_ENV_MAP = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  together: "TOGETHER_API_KEY",
  voyage: "VOYAGE_API_KEY",
  nvidia: "NVIDIA_API_KEY",
};

/**
 * Inject env vars from providers[*].credentials so SDKs and skills
 * that read process.env.*_API_KEY keep working after migration.
 * Only sets vars that are not already present in the environment.
 * @param {object} cfg
 * @param {object} env
 */
function applyProviderCredentialEnvVars(cfg, env) {
  const providers = cfg?.providers;
  if (!providers || typeof providers !== "object") {
    return;
  }
  for (const [provider, entry] of Object.entries(providers)) {
    if (!entry?.credentials?.length) {
      continue;
    }
    const envVar = PROVIDER_ENV_MAP[provider];
    if (!envVar || env[envVar]?.trim()) {
      continue;
    }
    // Find first non-disabled api_key credential
    const apiKey = entry.credentials.find(
      (c) => c.type === "api_key" && !c.disabled && c.key?.trim(),
    );
    if (apiKey) {
      env[envVar] = apiKey.key;
      continue;
    }
    // Fallback: first non-disabled token credential
    const token = entry.credentials.find(
      (c) => c.type === "token" && !c.disabled && c.token?.trim(),
    );
    if (token) {
      env[envVar] = token.token;
    }
  }
}

export function applyConfigEnvVars(cfg, env = process.env) {
  const entries = collectConfigEnvVars(cfg);
  for (const [key, value] of Object.entries(entries)) {
    if (env[key]?.trim()) {
      continue;
    }
    env[key] = value;
  }
  // Inject env vars from providers[*].credentials for SDK/skill compatibility
  applyProviderCredentialEnvVars(cfg, env);
}
