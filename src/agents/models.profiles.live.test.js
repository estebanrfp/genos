let parseCsvFilter = function (raw) {
    const trimmed = raw?.trim();
    if (!trimmed || trimmed === "all") {
      return null;
    }
    const ids = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length ? new Set(ids) : null;
  },
  parseProviderFilter = function (raw) {
    return parseCsvFilter(raw);
  },
  parseModelFilter = function (raw) {
    return parseCsvFilter(raw);
  },
  logProgress = function (message) {
    console.log(`[live] ${message}`);
  },
  isGoogleModelNotFoundError = function (err) {
    const msg = String(err);
    if (!/not found/i.test(msg)) {
      return false;
    }
    if (/models\/.+ is not found for api version/i.test(msg)) {
      return true;
    }
    if (/"status"\\s*:\\s*"NOT_FOUND"/.test(msg)) {
      return true;
    }
    if (/"code"\\s*:\\s*404/.test(msg)) {
      return true;
    }
    return false;
  },
  isModelNotFoundErrorMessage = function (raw) {
    const msg = raw.trim();
    if (!msg) {
      return false;
    }
    if (/\b404\b/.test(msg) && /not[_-]?found/i.test(msg)) {
      return true;
    }
    if (/not_found_error/i.test(msg)) {
      return true;
    }
    if (/model:\s*[a-z0-9._-]+/i.test(msg) && /not[_-]?found/i.test(msg)) {
      return true;
    }
    return false;
  },
  isChatGPTUsageLimitErrorMessage = function (raw) {
    const msg = raw.toLowerCase();
    return msg.includes("hit your chatgpt usage limit") && msg.includes("try again in");
  },
  isInstructionsRequiredError = function (raw) {
    return /instructions are required/i.test(raw);
  },
  toInt = function (value, fallback) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return fallback;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  resolveTestReasoning = function (model) {
    if (!model.reasoning) {
      return;
    }
    const id = model.id.toLowerCase();
    if (model.provider === "openai" || model.provider === "openai-codex") {
      if (id.includes("pro")) {
        return "high";
      }
      return "medium";
    }
    return "low";
  };
import { completeSimple } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/config.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
import {
  collectAnthropicApiKeys,
  isAnthropicBillingError,
  isAnthropicRateLimitError,
} from "./live-auth-keys.js";
import { isModernModelRef } from "./live-model-filter.js";
import { getApiKeyForModel, requireApiKey } from "./model-auth.js";
import { ensureGenosOSModelsJson } from "./models-config.js";
import { isRateLimitErrorMessage } from "./pi-embedded-helpers/errors.js";
import { discoverAuthStorage, discoverModels } from "./pi-model-discovery.js";
const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.GENOS_LIVE_TEST);
const DIRECT_ENABLED = Boolean(process.env.GENOS_LIVE_MODELS?.trim());
const REQUIRE_PROFILE_KEYS = isTruthyEnvValue(process.env.GENOS_LIVE_REQUIRE_PROFILE_KEYS);
const describeLive = LIVE ? describe : describe.skip;
async function completeSimpleWithTimeout(model, context, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  timer.unref?.();
  try {
    return await completeSimple(model, context, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
async function completeOkWithRetry(params) {
  const runOnce = async (maxTokens) => {
    const res = await completeSimpleWithTimeout(
      params.model,
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
        apiKey: params.apiKey,
        reasoning: resolveTestReasoning(params.model),
        maxTokens,
      },
      params.timeoutMs,
    );
    const text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    return { res, text };
  };
  const first = await runOnce(64);
  if (first.text.length > 0) {
    return first;
  }
  return await runOnce(256);
}
describeLive("live models (profile keys)", () => {
  it("completes across selected models", async () => {
    const cfg = loadConfig();
    await ensureGenosOSModelsJson(cfg);
    if (!DIRECT_ENABLED) {
      logProgress("[live-models] skipping (set GENOS_LIVE_MODELS=modern|all|<list>; all=modern)");
      return;
    }
    const anthropicKeys = collectAnthropicApiKeys();
    if (anthropicKeys.length > 0) {
      process.env.ANTHROPIC_API_KEY = anthropicKeys[0];
      logProgress(`[live-models] anthropic keys loaded: ${anthropicKeys.length}`);
    }
    const agentDir = resolveGenosOSAgentDir();
    const authStorage = discoverAuthStorage(agentDir);
    const modelRegistry = discoverModels(authStorage, agentDir);
    const models = modelRegistry.getAll();
    const rawModels = process.env.GENOS_LIVE_MODELS?.trim();
    const useModern = rawModels === "modern" || rawModels === "all";
    const useExplicit = Boolean(rawModels) && !useModern;
    const filter = useExplicit ? parseModelFilter(rawModels) : null;
    const allowNotFoundSkip = useModern;
    const providers = parseProviderFilter(process.env.GENOS_LIVE_PROVIDERS);
    const perModelTimeoutMs = toInt(process.env.GENOS_LIVE_MODEL_TIMEOUT_MS, 30000);
    const failures = [];
    const skipped = [];
    const candidates = [];
    for (const model of models) {
      if (providers && !providers.has(model.provider)) {
        continue;
      }
      const id = `${model.provider}/${model.id}`;
      if (filter && !filter.has(id)) {
        continue;
      }
      if (!filter && useModern) {
        if (!isModernModelRef({ provider: model.provider, id: model.id })) {
          continue;
        }
      }
      try {
        const apiKeyInfo = await getApiKeyForModel({ model, cfg });
        if (REQUIRE_PROFILE_KEYS && !apiKeyInfo.source.startsWith("profile:")) {
          skipped.push({
            model: id,
            reason: `non-profile credential source: ${apiKeyInfo.source}`,
          });
          continue;
        }
        candidates.push({ model, apiKeyInfo });
      } catch (err) {
        skipped.push({ model: id, reason: String(err) });
      }
    }
    if (candidates.length === 0) {
      logProgress("[live-models] no API keys found; skipping");
      return;
    }
    logProgress(`[live-models] selection=${useExplicit ? "explicit" : "modern"}`);
    logProgress(`[live-models] running ${candidates.length} models`);
    const total = candidates.length;
    for (const [index, entry] of candidates.entries()) {
      const { model, apiKeyInfo } = entry;
      const id = `${model.provider}/${model.id}`;
      const progressLabel = `[live-models] ${index + 1}/${total} ${id}`;
      const attemptMax =
        model.provider === "anthropic" && anthropicKeys.length > 0 ? anthropicKeys.length : 1;
      for (let attempt = 0; attempt < attemptMax; attempt += 1) {
        if (model.provider === "anthropic" && anthropicKeys.length > 0) {
          process.env.ANTHROPIC_API_KEY = anthropicKeys[attempt];
        }
        const apiKey =
          model.provider === "anthropic" && anthropicKeys.length > 0
            ? anthropicKeys[attempt]
            : requireApiKey(apiKeyInfo, model.provider);
        try {
          if (
            model.provider === "openai" &&
            model.api === "openai-responses" &&
            model.id === "gpt-5.2"
          ) {
            logProgress(`${progressLabel}: tool-only regression`);
            const noopTool = {
              name: "noop",
              description: "Return ok.",
              parameters: Type.Object({}, { additionalProperties: false }),
            };
            let firstUserContent = "Call the tool `noop` with {}. Do not write any other text.";
            let firstUser = {
              role: "user",
              content: firstUserContent,
              timestamp: Date.now(),
            };
            let first = await completeSimpleWithTimeout(
              model,
              { messages: [firstUser], tools: [noopTool] },
              {
                apiKey,
                reasoning: resolveTestReasoning(model),
                maxTokens: 128,
              },
              perModelTimeoutMs,
            );
            let toolCall = first.content.find((b) => b.type === "toolCall");
            let firstText = first.content
              .filter((b) => b.type === "text")
              .map((b) => b.text.trim())
              .join(" ")
              .trim();
            for (let i = 0; i < 2 && (!toolCall || firstText.length > 0); i += 1) {
              firstUserContent =
                "Call the tool `noop` with {}. IMPORTANT: respond ONLY with the tool call; no other text.";
              firstUser = {
                role: "user",
                content: firstUserContent,
                timestamp: Date.now(),
              };
              first = await completeSimpleWithTimeout(
                model,
                { messages: [firstUser], tools: [noopTool] },
                {
                  apiKey,
                  reasoning: resolveTestReasoning(model),
                  maxTokens: 128,
                },
                perModelTimeoutMs,
              );
              toolCall = first.content.find((b) => b.type === "toolCall");
              firstText = first.content
                .filter((b) => b.type === "text")
                .map((b) => b.text.trim())
                .join(" ")
                .trim();
            }
            expect(toolCall).toBeTruthy();
            expect(firstText.length).toBe(0);
            if (!toolCall || toolCall.type !== "toolCall") {
              throw new Error("expected tool call");
            }
            const second = await completeSimpleWithTimeout(
              model,
              {
                messages: [
                  firstUser,
                  first,
                  {
                    role: "toolResult",
                    toolCallId: toolCall.id,
                    toolName: "noop",
                    content: [{ type: "text", text: "ok" }],
                    isError: false,
                    timestamp: Date.now(),
                  },
                  {
                    role: "user",
                    content: "Reply with the word ok.",
                    timestamp: Date.now(),
                  },
                ],
              },
              {
                apiKey,
                reasoning: resolveTestReasoning(model),
                maxTokens: 256,
              },
              perModelTimeoutMs,
            );
            const secondText = second.content
              .filter((b) => b.type === "text")
              .map((b) => b.text.trim())
              .join(" ");
            expect(secondText.length).toBeGreaterThan(0);
            logProgress(`${progressLabel}: done`);
            break;
          }
          logProgress(`${progressLabel}: prompt`);
          const ok = await completeOkWithRetry({
            model,
            apiKey,
            timeoutMs: perModelTimeoutMs,
          });
          if (ok.res.stopReason === "error") {
            const msg = ok.res.errorMessage ?? "";
            if (allowNotFoundSkip && isModelNotFoundErrorMessage(msg)) {
              skipped.push({ model: id, reason: msg });
              logProgress(`${progressLabel}: skip (model not found)`);
              break;
            }
            throw new Error(msg || "model returned error with no message");
          }
          if (ok.text.length === 0 && model.provider === "google") {
            skipped.push({
              model: id,
              reason: "no text returned (likely unavailable model id)",
            });
            logProgress(`${progressLabel}: skip (google model not found)`);
            break;
          }
          if (
            ok.text.length === 0 &&
            (model.provider === "openrouter" || model.provider === "opencode")
          ) {
            skipped.push({
              model: id,
              reason: "no text returned (provider returned empty content)",
            });
            logProgress(`${progressLabel}: skip (empty response)`);
            break;
          }
          if (
            ok.text.length === 0 &&
            allowNotFoundSkip &&
            (model.provider === "google-antigravity" || model.provider === "openai-codex")
          ) {
            skipped.push({
              model: id,
              reason: "no text returned (provider returned empty content)",
            });
            logProgress(`${progressLabel}: skip (empty response)`);
            break;
          }
          expect(ok.text.length).toBeGreaterThan(0);
          logProgress(`${progressLabel}: done`);
          break;
        } catch (err) {
          const message = String(err);
          if (
            model.provider === "anthropic" &&
            isAnthropicRateLimitError(message) &&
            attempt + 1 < attemptMax
          ) {
            logProgress(`${progressLabel}: rate limit, retrying with next key`);
            continue;
          }
          if (model.provider === "anthropic" && isAnthropicBillingError(message)) {
            if (attempt + 1 < attemptMax) {
              logProgress(`${progressLabel}: billing issue, retrying with next key`);
              continue;
            }
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (anthropic billing)`);
            break;
          }
          if (model.provider === "google" && isGoogleModelNotFoundError(err)) {
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (google model not found)`);
            break;
          }
          if (
            allowNotFoundSkip &&
            model.provider === "minimax" &&
            message.includes("request ended without sending any chunks")
          ) {
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (minimax empty response)`);
            break;
          }
          if (
            allowNotFoundSkip &&
            model.provider === "opencode" &&
            isRateLimitErrorMessage(message)
          ) {
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (rate limit)`);
            break;
          }
          if (
            allowNotFoundSkip &&
            model.provider === "openai-codex" &&
            isChatGPTUsageLimitErrorMessage(message)
          ) {
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (chatgpt usage limit)`);
            break;
          }
          if (
            allowNotFoundSkip &&
            model.provider === "openai-codex" &&
            isInstructionsRequiredError(message)
          ) {
            skipped.push({ model: id, reason: message });
            logProgress(`${progressLabel}: skip (instructions required)`);
            break;
          }
          logProgress(`${progressLabel}: failed`);
          failures.push({ model: id, error: message });
          break;
        }
      }
    }
    if (failures.length > 0) {
      const preview = failures
        .slice(0, 10)
        .map((f) => `- ${f.model}: ${f.error}`)
        .join("\n");
      throw new Error(`live model failures (${failures.length}):\n${preview}`);
    }
  }, 900000);
});
