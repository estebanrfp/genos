import { describe, expect, it } from "vitest";
import { applyExtraParamsToAgent, resolveExtraParams } from "./pi-embedded-runner.js";
describe("resolveExtraParams", () => {
  it("returns undefined with no model config", () => {
    const result = resolveExtraParams({
      cfg: undefined,
      provider: "zai",
      modelId: "glm-4.7",
    });
    expect(result).toBeUndefined();
  });
  it("returns params for exact provider/model key", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                  maxTokens: 2048,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4",
    });
    expect(result).toEqual({
      temperature: 0.7,
      maxTokens: 2048,
    });
  });
  it("ignores unrelated model entries", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
    expect(result).toBeUndefined();
  });
});
describe("applyExtraParamsToAgent", () => {
  function createOptionsCaptureAgent() {
    const calls = [];
    const baseStreamFn = (_model, _context, options) => {
      calls.push(options);
      return {};
    };
    return {
      calls,
      agent: { streamFn: baseStreamFn },
    };
  }
  function buildAnthropicModelConfig(modelKey, params) {
    return {
      agents: {
        defaults: {
          models: {
            [modelKey]: { params },
          },
        },
      },
    };
  }
  function runStoreMutationCase(params) {
    const payload = { store: false };
    const baseStreamFn = (_model, _context, options) => {
      options?.onPayload?.(payload);
      return {};
    };
    const agent = { streamFn: baseStreamFn };
    applyExtraParamsToAgent(agent, undefined, params.applyProvider, params.applyModelId);
    const context = { messages: [] };
    agent.streamFn?.(params.model, context, params.options ?? {});
    return payload;
  }
  it("adds OpenRouter attribution headers to stream options", () => {
    const { calls, agent } = createOptionsCaptureAgent();
    applyExtraParamsToAgent(agent, undefined, "openrouter", "openrouter/auto");
    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openrouter/auto",
    };
    const context = { messages: [] };
    agent.streamFn?.(model, context, { headers: { "X-Custom": "1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({
      "HTTP-Referer": "https://genosos.ai",
      "X-Title": "GenosOS",
      "X-Custom": "1",
    });
  });
  it("adds Anthropic 1M beta header when context1m is enabled for Opus/Sonnet", () => {
    const { calls, agent } = createOptionsCaptureAgent();
    const cfg = buildAnthropicModelConfig("anthropic/claude-opus-4-6", { context1m: true });
    applyExtraParamsToAgent(agent, cfg, "anthropic", "claude-opus-4-6");
    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-opus-4-6",
    };
    const context = { messages: [] };
    agent.streamFn?.(model, context, { headers: { "X-Custom": "1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({
      "X-Custom": "1",
      "anthropic-beta": "context-1m-2025-08-07",
    });
  });
  it("merges existing anthropic-beta headers with configured betas", () => {
    const { calls, agent } = createOptionsCaptureAgent();
    const cfg = buildAnthropicModelConfig("anthropic/claude-sonnet-4-5", {
      context1m: true,
      anthropicBeta: ["files-api-2025-04-14"],
    });
    applyExtraParamsToAgent(agent, cfg, "anthropic", "claude-sonnet-4-5");
    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-sonnet-4-5",
    };
    const context = { messages: [] };
    agent.streamFn?.(model, context, {
      headers: { "anthropic-beta": "prompt-caching-2024-07-31" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({
      "anthropic-beta": "prompt-caching-2024-07-31,files-api-2025-04-14,context-1m-2025-08-07",
    });
  });
  it("ignores context1m for non-Opus/Sonnet Anthropic models", () => {
    const { calls, agent } = createOptionsCaptureAgent();
    const cfg = buildAnthropicModelConfig("anthropic/claude-haiku-3-5", { context1m: true });
    applyExtraParamsToAgent(agent, cfg, "anthropic", "claude-haiku-3-5");
    const model = {
      api: "anthropic-messages",
      provider: "anthropic",
      id: "claude-haiku-3-5",
    };
    const context = { messages: [] };
    agent.streamFn?.(model, context, { headers: { "X-Custom": "1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({ "X-Custom": "1" });
  });
  it("forces store=true for direct OpenAI Responses payloads", () => {
    const payload = runStoreMutationCase({
      applyProvider: "openai",
      applyModelId: "gpt-5",
      model: {
        api: "openai-responses",
        provider: "openai",
        id: "gpt-5",
        baseUrl: "https://api.openai.com/v1",
      },
    });
    expect(payload.store).toBe(true);
  });
  it("does not force store for OpenAI Responses routed through non-OpenAI base URLs", () => {
    const payload = runStoreMutationCase({
      applyProvider: "openai",
      applyModelId: "gpt-5",
      model: {
        api: "openai-responses",
        provider: "openai",
        id: "gpt-5",
        baseUrl: "https://proxy.example.com/v1",
      },
    });
    expect(payload.store).toBe(false);
  });
  it("does not force store=true for Codex responses (Codex requires store=false)", () => {
    const payload = runStoreMutationCase({
      applyProvider: "openai-codex",
      applyModelId: "codex-mini-latest",
      model: {
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "codex-mini-latest",
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      },
    });
    expect(payload.store).toBe(false);
  });
  it("does not force store=true for Codex responses (Codex requires store=false)", () => {
    const payload = { store: false };
    const baseStreamFn = (_model, _context, options) => {
      options?.onPayload?.(payload);
      return {};
    };
    const agent = { streamFn: baseStreamFn };
    applyExtraParamsToAgent(agent, undefined, "openai-codex", "codex-mini-latest");
    const model = {
      api: "openai-codex-responses",
      provider: "openai-codex",
      id: "codex-mini-latest",
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    };
    const context = { messages: [] };
    agent.streamFn?.(model, context, {});
    expect(payload.store).toBe(false);
  });
});
