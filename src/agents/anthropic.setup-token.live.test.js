let isSetupToken = function (value) {
    return value.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
  },
  listSetupTokenProfiles = function (store) {
    return Object.entries(store.profiles)
      .filter(([, cred]) => {
        if (cred.type !== "token") {
          return false;
        }
        if (normalizeProviderId(cred.provider) !== "anthropic") {
          return false;
        }
        return isSetupToken(cred.token);
      })
      .map(([id]) => id);
  },
  pickSetupTokenProfile = function (candidates) {
    const preferred = ["anthropic:setup-token-test", "anthropic:setup-token", "anthropic:default"];
    for (const id of preferred) {
      if (candidates.includes(id)) {
        return id;
      }
    }
    return candidates[0] ?? "";
  },
  pickModel = function (models, raw) {
    const normalized = raw?.trim() ?? "";
    if (normalized) {
      const parsed = parseModelRef(normalized, "anthropic");
      if (!parsed) {
        return null;
      }
      return (
        models.find(
          (model) =>
            normalizeProviderId(model.provider) === parsed.provider && model.id === parsed.model,
        ) ?? null
      );
    }
    const preferred = [
      "claude-opus-4-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-0",
      "claude-haiku-3-5",
    ];
    for (const id of preferred) {
      const match = models.find((model) => model.id === id);
      if (match) {
        return match;
      }
    }
    return models[0] ?? null;
  },
  buildTestModel = function (id, provider = "anthropic") {
    return { id, provider };
  };
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completeSimple } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  validateAnthropicSetupToken,
} from "../commands/auth-token.js";
import { loadConfig } from "../config/config.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "./auth-profiles.js";
import { getApiKeyForModel, requireApiKey } from "./model-auth.js";
import { normalizeProviderId, parseModelRef } from "./model-selection.js";
import { ensureGenosOSModelsJson } from "./models-config.js";
import { discoverAuthStorage, discoverModels } from "./pi-model-discovery.js";
const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.GENOS_LIVE_TEST);
const SETUP_TOKEN_RAW = process.env.GENOS_LIVE_SETUP_TOKEN?.trim() ?? "";
const SETUP_TOKEN_VALUE = process.env.GENOS_LIVE_SETUP_TOKEN_VALUE?.trim() ?? "";
const SETUP_TOKEN_PROFILE = process.env.GENOS_LIVE_SETUP_TOKEN_PROFILE?.trim() ?? "";
const SETUP_TOKEN_MODEL = process.env.GENOS_LIVE_SETUP_TOKEN_MODEL?.trim() ?? "";
const ENABLED = LIVE && Boolean(SETUP_TOKEN_RAW || SETUP_TOKEN_VALUE || SETUP_TOKEN_PROFILE);
const describeLive = ENABLED ? describe : describe.skip;
async function resolveTokenSource() {
  const explicitToken =
    (SETUP_TOKEN_RAW && isSetupToken(SETUP_TOKEN_RAW) ? SETUP_TOKEN_RAW : "") || SETUP_TOKEN_VALUE;
  if (explicitToken) {
    const error = validateAnthropicSetupToken(explicitToken);
    if (error) {
      throw new Error(`Invalid setup-token: ${error}`);
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-setup-token-"));
    const profileId = `anthropic:setup-token-live-${randomUUID()}`;
    const store = ensureAuthProfileStore(tempDir, {
      allowKeychainPrompt: false,
    });
    store.profiles[profileId] = {
      type: "token",
      provider: "anthropic",
      token: explicitToken,
    };
    saveAuthProfileStore(store, tempDir);
    return {
      agentDir: tempDir,
      profileId,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  }
  const agentDir = resolveGenosOSAgentDir();
  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });
  const candidates = listSetupTokenProfiles(store);
  if (SETUP_TOKEN_PROFILE) {
    if (!candidates.includes(SETUP_TOKEN_PROFILE)) {
      const available = candidates.length > 0 ? candidates.join(", ") : "(none)";
      throw new Error(
        `Setup-token profile "${SETUP_TOKEN_PROFILE}" not found. Available: ${available}.`,
      );
    }
    return { agentDir, profileId: SETUP_TOKEN_PROFILE };
  }
  if (SETUP_TOKEN_RAW && SETUP_TOKEN_RAW !== "1" && SETUP_TOKEN_RAW !== "auto") {
    throw new Error(
      "GENOS_LIVE_SETUP_TOKEN did not look like a setup-token. Use GENOS_LIVE_SETUP_TOKEN_VALUE for raw tokens.",
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      "No Anthropics setup-token profiles found. Set GENOS_LIVE_SETUP_TOKEN_VALUE or GENOS_LIVE_SETUP_TOKEN_PROFILE.",
    );
  }
  return { agentDir, profileId: pickSetupTokenProfile(candidates) };
}
describe("pickModel", () => {
  it("resolves sonnet-4.6 aliases to claude-sonnet-4-6", () => {
    const model = pickModel(
      [buildTestModel("claude-opus-4-6"), buildTestModel("claude-sonnet-4-6")],
      "sonnet-4.6",
    );
    expect(model?.id).toBe("claude-sonnet-4-6");
  });
  it("resolves opus-4.6 aliases to claude-opus-4-6", () => {
    const model = pickModel(
      [buildTestModel("claude-sonnet-4-6"), buildTestModel("claude-opus-4-6")],
      "opus-4.6",
    );
    expect(model?.id).toBe("claude-opus-4-6");
  });
});
describeLive("live anthropic setup-token", () => {
  it("completes using a setup-token profile", async () => {
    const tokenSource = await resolveTokenSource();
    try {
      const cfg = loadConfig();
      await ensureGenosOSModelsJson(cfg, tokenSource.agentDir);
      const authStorage = discoverAuthStorage(tokenSource.agentDir);
      const modelRegistry = discoverModels(authStorage, tokenSource.agentDir);
      const all = Array.isArray(modelRegistry) ? modelRegistry : modelRegistry.getAll();
      const candidates = all.filter((model) => normalizeProviderId(model.provider) === "anthropic");
      expect(candidates.length).toBeGreaterThan(0);
      const model = pickModel(candidates, SETUP_TOKEN_MODEL);
      if (!model) {
        throw new Error(
          SETUP_TOKEN_MODEL
            ? `Model not found: ${SETUP_TOKEN_MODEL}`
            : "No Anthropic models available.",
        );
      }
      const apiKeyInfo = await getApiKeyForModel({
        model,
        cfg,
        profileId: tokenSource.profileId,
        agentDir: tokenSource.agentDir,
      });
      const apiKey = requireApiKey(apiKeyInfo, model.provider);
      const tokenError = validateAnthropicSetupToken(apiKey);
      if (tokenError) {
        throw new Error(`Resolved profile is not a setup-token: ${tokenError}`);
      }
      const res = await completeSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: "Reply with the word ok.",
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey,
          maxTokens: 64,
          temperature: 0,
        },
      );
      const text = res.content
        .filter((block) => block.type === "text")
        .map((block) => block.text.trim())
        .join(" ");
      expect(text.toLowerCase()).toContain("ok");
    } finally {
      if (tokenSource.cleanup) {
        await tokenSource.cleanup();
      }
    }
  }, 300000);
});
