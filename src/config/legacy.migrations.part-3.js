import { resolveAuthStorePath } from "../agents/auth-profiles/paths.js";
import { loadJsonFile } from "../infra/json-file.js";
import {
  ensureAgentEntry,
  ensureRecord,
  getAgentsList,
  getRecord,
  isRecord,
  mergeMissing,
  resolveDefaultAgentIdFromRaw,
} from "./legacy.shared.js";

/** Extract only the credential payload fields (no id/type) for a given credential type. */
const credPayload = (cred) => {
  if (cred.type === "api_key") {
    return {
      key: cred.key,
      ...(cred.disabled ? { disabled: true } : {}),
    };
  }
  if (cred.type === "token") {
    return {
      token: cred.token,
      ...(cred.email ? { email: cred.email } : {}),
      ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
      ...(cred.disabled ? { disabled: true } : {}),
    };
  }
  // oauth
  return {
    ...(cred.access ? { access: cred.access } : {}),
    ...(cred.refresh ? { refresh: cred.refresh } : {}),
    ...(typeof cred.expires === "number" ? { expires: cred.expires } : {}),
    ...(cred.email ? { email: cred.email } : {}),
    ...(cred.enterpriseUrl ? { enterpriseUrl: cred.enterpriseUrl } : {}),
    ...(cred.projectId ? { projectId: cred.projectId } : {}),
    ...(cred.accountId ? { accountId: cred.accountId } : {}),
    ...(cred.disabled ? { disabled: true } : {}),
  };
};

/** Convert "provider:id" → ["provider", "id"] safely. */
const splitProfileKey = (key) => {
  const idx = key.indexOf(":");
  if (idx === -1) {
    return [key, "default"];
  }
  return [key.slice(0, idx), key.slice(idx + 1)];
};

export const LEGACY_CONFIG_MIGRATIONS_PART_3 = [
  {
    id: "memorySearch->agents.defaults.memorySearch",
    describe: "Move top-level memorySearch to agents.defaults.memorySearch",
    apply: (raw, changes) => {
      const legacyMemorySearch = getRecord(raw.memorySearch);
      if (!legacyMemorySearch) {
        return;
      }
      const agents = ensureRecord(raw, "agents");
      const defaults = ensureRecord(agents, "defaults");
      const existing = getRecord(defaults.memorySearch);
      if (!existing) {
        defaults.memorySearch = legacyMemorySearch;
        changes.push("Moved memorySearch \u2192 agents.defaults.memorySearch.");
      } else {
        const merged = structuredClone(existing);
        mergeMissing(merged, legacyMemorySearch);
        defaults.memorySearch = merged;
        changes.push(
          "Merged memorySearch \u2192 agents.defaults.memorySearch (filled missing fields from legacy; kept explicit agents.defaults values).",
        );
      }
      agents.defaults = defaults;
      raw.agents = agents;
      delete raw.memorySearch;
    },
  },
  {
    id: "auth.anthropic-claude-cli-mode-oauth",
    describe: "Switch anthropic:claude-cli auth profile mode to oauth",
    apply: (raw, changes) => {
      const auth = getRecord(raw.auth);
      const profiles = getRecord(auth?.profiles);
      if (!profiles) {
        return;
      }
      const claudeCli = getRecord(profiles["anthropic:claude-cli"]);
      if (!claudeCli) {
        return;
      }
      if (claudeCli.mode !== "token") {
        return;
      }
      claudeCli.mode = "oauth";
      changes.push('Updated auth.profiles["anthropic:claude-cli"].mode \u2192 "oauth".');
    },
  },
  {
    id: "tools.bash->tools.exec",
    describe: "Move tools.bash to tools.exec",
    apply: (raw, changes) => {
      const tools = ensureRecord(raw, "tools");
      const bash = getRecord(tools.bash);
      if (!bash) {
        return;
      }
      if (tools.exec === undefined) {
        tools.exec = bash;
        changes.push("Moved tools.bash \u2192 tools.exec.");
      } else {
        changes.push("Removed tools.bash (tools.exec already set).");
      }
      delete tools.bash;
    },
  },
  {
    id: "messages.tts.enabled->auto",
    describe: "Move messages.tts.enabled to messages.tts.auto",
    apply: (raw, changes) => {
      const messages = getRecord(raw.messages);
      const tts = getRecord(messages?.tts);
      if (!tts) {
        return;
      }
      if (tts.auto !== undefined) {
        if ("enabled" in tts) {
          delete tts.enabled;
          changes.push("Removed messages.tts.enabled (messages.tts.auto already set).");
        }
        return;
      }
      if (typeof tts.enabled !== "boolean") {
        return;
      }
      tts.auto = tts.enabled ? "always" : "off";
      delete tts.enabled;
      changes.push(`Moved messages.tts.enabled \u2192 messages.tts.auto (${String(tts.auto)}).`);
    },
  },
  {
    id: "agent.defaults-v2",
    describe: "Move agent config to agents.defaults and tools",
    apply: (raw, changes) => {
      const agent = getRecord(raw.agent);
      if (!agent) {
        return;
      }
      const agents = ensureRecord(raw, "agents");
      const defaults = getRecord(agents.defaults) ?? {};
      const tools = ensureRecord(raw, "tools");
      const agentTools = getRecord(agent.tools);
      if (agentTools) {
        if (tools.allow === undefined && agentTools.allow !== undefined) {
          tools.allow = agentTools.allow;
          changes.push("Moved agent.tools.allow \u2192 tools.allow.");
        }
        if (tools.deny === undefined && agentTools.deny !== undefined) {
          tools.deny = agentTools.deny;
          changes.push("Moved agent.tools.deny \u2192 tools.deny.");
        }
      }
      const elevated = getRecord(agent.elevated);
      if (elevated) {
        if (tools.elevated === undefined) {
          tools.elevated = elevated;
          changes.push("Moved agent.elevated \u2192 tools.elevated.");
        } else {
          changes.push("Removed agent.elevated (tools.elevated already set).");
        }
      }
      const bash = getRecord(agent.bash);
      if (bash) {
        if (tools.exec === undefined) {
          tools.exec = bash;
          changes.push("Moved agent.bash \u2192 tools.exec.");
        } else {
          changes.push("Removed agent.bash (tools.exec already set).");
        }
      }
      const sandbox = getRecord(agent.sandbox);
      if (sandbox) {
        const sandboxTools = getRecord(sandbox.tools);
        if (sandboxTools) {
          const toolsSandbox = ensureRecord(tools, "sandbox");
          const toolPolicy = ensureRecord(toolsSandbox, "tools");
          mergeMissing(toolPolicy, sandboxTools);
          delete sandbox.tools;
          changes.push("Moved agent.sandbox.tools \u2192 tools.sandbox.tools.");
        }
      }
      const subagents = getRecord(agent.subagents);
      if (subagents) {
        const subagentTools = getRecord(subagents.tools);
        if (subagentTools) {
          const toolsSubagents = ensureRecord(tools, "subagents");
          const toolPolicy = ensureRecord(toolsSubagents, "tools");
          mergeMissing(toolPolicy, subagentTools);
          delete subagents.tools;
          changes.push("Moved agent.subagents.tools \u2192 tools.subagents.tools.");
        }
      }
      const agentCopy = structuredClone(agent);
      delete agentCopy.tools;
      delete agentCopy.elevated;
      delete agentCopy.bash;
      if (isRecord(agentCopy.sandbox)) {
        delete agentCopy.sandbox.tools;
      }
      if (isRecord(agentCopy.subagents)) {
        delete agentCopy.subagents.tools;
      }
      mergeMissing(defaults, agentCopy);
      agents.defaults = defaults;
      raw.agents = agents;
      delete raw.agent;
      changes.push("Moved agent \u2192 agents.defaults.");
    },
  },
  {
    id: "identity->agents.list",
    describe: "Move identity to agents.list[].identity",
    apply: (raw, changes) => {
      const identity = getRecord(raw.identity);
      if (!identity) {
        return;
      }
      const agents = ensureRecord(raw, "agents");
      const list = getAgentsList(agents);
      const defaultId = resolveDefaultAgentIdFromRaw(raw);
      const entry = ensureAgentEntry(list, defaultId);
      if (entry.identity === undefined) {
        entry.identity = identity;
        changes.push(`Moved identity \u2192 agents.list (id "${defaultId}").identity.`);
      } else {
        changes.push("Removed identity (agents.list identity already set).");
      }
      agents.list = list;
      raw.agents = agents;
      delete raw.identity;
    },
  },
  {
    id: "auth-profiles-file->providers.credentials",
    describe: "Absorb auth-profiles.json credentials → genosos.json providers",
    apply: (raw, changes) => {
      // Read auth-profiles.json synchronously
      const authPath = resolveAuthStorePath();
      const authRaw = loadJsonFile(authPath);
      if (!authRaw || typeof authRaw !== "object" || !isRecord(authRaw.profiles)) {
        return;
      }
      const existingProviders = getRecord(raw.providers);
      const providers = existingProviders ? structuredClone(existingProviders) : {};
      let migrated = 0;
      for (const [profileKey, credential] of Object.entries(authRaw.profiles)) {
        if (!credential || typeof credential !== "object") {
          continue;
        }
        if (
          credential.type !== "api_key" &&
          credential.type !== "token" &&
          credential.type !== "oauth"
        ) {
          continue;
        }
        const [provider, id] = splitProfileKey(profileKey);
        providers[provider] ??= {};
        providers[provider].credentials ??= [];
        const exists = providers[provider].credentials.some((c) => c.id === id);
        if (!exists) {
          providers[provider].credentials.push({
            id,
            type: credential.type,
            ...credPayload(credential),
          });
          migrated++;
        }
      }
      // Migrate order → failover
      if (isRecord(authRaw.order)) {
        for (const [provider, order] of Object.entries(authRaw.order)) {
          if (!Array.isArray(order)) {
            continue;
          }
          if (providers[provider] && !providers[provider].failover) {
            providers[provider].failover = order.map((k) => splitProfileKey(k)[1]);
          }
        }
      }
      if (migrated === 0) {
        return;
      }
      raw.providers = providers;
      changes.push(`Migrated ${migrated} credential(s) from auth-profiles.json \u2192 providers.`);
    },
  },
  {
    id: "auth-order-models-providers->providers",
    describe: "Unify auth.order + models.providers → providers section",
    apply: (raw, changes) => {
      const hasAuthOrder = isRecord(raw.auth?.order) && Object.keys(raw.auth.order).length > 0;
      const hasAuthProfiles =
        isRecord(raw.auth?.profiles) && Object.keys(raw.auth.profiles).length > 0;
      const hasModelsProviders =
        isRecord(raw.models?.providers) && Object.keys(raw.models.providers).length > 0;
      if (!hasAuthOrder && !hasAuthProfiles && !hasModelsProviders) {
        return;
      }
      const existingProviders = getRecord(raw.providers);
      const providers = existingProviders ? structuredClone(existingProviders) : {};
      // auth.order → providers.*.failover
      if (hasAuthOrder) {
        for (const [p, order] of Object.entries(raw.auth.order)) {
          if (!Array.isArray(order)) {
            continue;
          }
          providers[p] ??= {};
          if (!providers[p].failover) {
            providers[p].failover = order.map((k) => splitProfileKey(k)[1]);
          }
        }
      }
      // models.providers → providers.* (non-destructive: only fills missing fields)
      if (hasModelsProviders) {
        for (const [p, provCfg] of Object.entries(raw.models.providers)) {
          if (!provCfg || typeof provCfg !== "object") {
            continue;
          }
          providers[p] ??= {};
          const target = providers[p];
          const { baseUrl, apiKey, api, headers, authHeader, auth, models } = provCfg;
          if (baseUrl !== undefined && target.baseUrl === undefined) {
            target.baseUrl = baseUrl;
          }
          if (apiKey !== undefined && target.apiKey === undefined) {
            target.apiKey = apiKey;
          }
          if (api !== undefined && target.api === undefined) {
            target.api = api;
          }
          if (headers !== undefined && target.headers === undefined) {
            target.headers = headers;
          }
          if (authHeader !== undefined && target.authHeader === undefined) {
            target.authHeader = authHeader;
          }
          if (auth !== undefined && target.auth === undefined) {
            target.auth = auth;
          }
          if (models !== undefined && target.models === undefined) {
            target.models = models;
          }
        }
      }
      raw.providers = providers;
      // Clean up auth.order and auth.profiles (keep auth.cooldowns)
      if (hasAuthOrder || hasAuthProfiles) {
        const authNext = { ...raw.auth };
        if (hasAuthOrder) {
          delete authNext.order;
        }
        if (hasAuthProfiles) {
          delete authNext.profiles;
        }
        if (Object.keys(authNext).length > 0) {
          raw.auth = authNext;
        } else {
          delete raw.auth;
        }
      }
      // Clean up models.providers and remove models if only default values remain
      if (hasModelsProviders) {
        const modelsNext = { ...raw.models };
        delete modelsNext.providers;
        // Remove mode if it's the default ("merge") — no need to persist redundant defaults
        if (modelsNext.mode === "merge") {
          delete modelsNext.mode;
        }
        if (Object.keys(modelsNext).length > 0) {
          raw.models = modelsNext;
        } else {
          delete raw.models;
        }
      }
      changes.push("Migrated auth.order + models.providers \u2192 providers.");
    },
  },
  {
    id: "env-vars-ai-keys->providers.credentials",
    describe: "Move AI provider API keys from env.vars and env.* → providers[*].credentials",
    apply: (raw, changes) => {
      const env = getRecord(raw.env);
      if (!env) {
        return;
      }
      /** @type {Record<string, string>} env var name → provider id */
      const envToProvider = {
        OPENAI_API_KEY: "openai",
        ANTHROPIC_API_KEY: "anthropic",
        GEMINI_API_KEY: "google",
        GROQ_API_KEY: "groq",
        DEEPGRAM_API_KEY: "deepgram",
        CEREBRAS_API_KEY: "cerebras",
        XAI_API_KEY: "xai",
        OPENROUTER_API_KEY: "openrouter",
        MISTRAL_API_KEY: "mistral",
        TOGETHER_API_KEY: "together",
        VOYAGE_API_KEY: "voyage",
        NVIDIA_API_KEY: "nvidia",
        VLLM_API_KEY: "vllm",
      };
      const providers = getRecord(raw.providers) ? structuredClone(raw.providers) : {};
      const vars = getRecord(env.vars);
      let migrated = 0;

      /** Move a single key → providers[provider].credentials or .apiKey */
      const migrateKey = (envVar, value, provider) => {
        if (!value || typeof value !== "string" || !value.trim()) {
          return false;
        }
        providers[provider] ??= {};
        // For providers that use apiKey field (no credentials needed), just set .apiKey
        if (providers[provider].apiKey && providers[provider].apiKey === value) {
          return true; // already there, just clean the env key
        }
        if (!providers[provider].credentials) {
          // If provider already has apiKey set, don't duplicate into credentials
          if (providers[provider].apiKey) {
            return true;
          }
        }
        providers[provider].credentials ??= [];
        const exists = providers[provider].credentials.some(
          (c) => c.type === "api_key" && c.key === value,
        );
        if (!exists) {
          const hasDefault = providers[provider].credentials.some((c) => c.id === "default");
          const credId = hasDefault ? "api-key" : "default";
          providers[provider].credentials.unshift({
            id: credId,
            type: "api_key",
            key: value,
          });
          if (providers[provider].credentials.length > 1) {
            providers[provider].failover = providers[provider].credentials.map((c) => c.id);
          }
        }
        return true;
      };

      // Phase 1: env.vars.* (explicit vars section)
      if (vars) {
        for (const [envVar, provider] of Object.entries(envToProvider)) {
          if (vars[envVar] && migrateKey(envVar, vars[envVar], provider)) {
            delete vars[envVar];
            migrated++;
          }
        }
        if (Object.keys(vars).length === 0) {
          delete env.vars;
        }
      }

      // Phase 2: env.* (top-level keys like env.OPENAI_API_KEY)
      for (const [envVar, provider] of Object.entries(envToProvider)) {
        if (envVar in env && envVar !== "vars" && envVar !== "shellEnv") {
          if (migrateKey(envVar, env[envVar], provider)) {
            delete env[envVar];
            migrated++;
          }
        }
      }

      if (migrated === 0) {
        return;
      }
      raw.providers = providers;
      // Clean up env — remove if empty (only vars/shellEnv remain valid)
      if (Object.keys(env).length === 0) {
        delete raw.env;
      } else {
        raw.env = env;
      }
      changes.push(
        `Migrated ${migrated} AI provider key(s) from env \u2192 providers[*].credentials.`,
      );
    },
  },
  {
    id: "models-default-only->remove",
    describe: "Remove models section when it only contains default values",
    apply: (raw, changes) => {
      const models = getRecord(raw.models);
      if (!models) {
        return;
      }
      const keys = Object.keys(models);
      // Only clean up if the section has no meaningful non-default content
      if (keys.length === 0) {
        delete raw.models;
        changes.push("Removed empty models section.");
        return;
      }
      if (keys.length === 1 && models.mode === "merge") {
        delete raw.models;
        changes.push("Removed models section (only contained default mode).");
      }
    },
  },
];
