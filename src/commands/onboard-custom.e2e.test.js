let createTestPrompter = function (params) {
    const text = vi.fn();
    for (const answer of params.text) {
      text.mockResolvedValueOnce(answer);
    }
    const select = vi.fn();
    for (const answer of params.select ?? []) {
      select.mockResolvedValueOnce(answer);
    }
    return {
      text,
      progress: vi.fn(() => ({
        update: vi.fn(),
        stop: vi.fn(),
      })),
      select,
      confirm: vi.fn(),
      note: vi.fn(),
    };
  },
  stubFetchSequence = function (responses) {
    const fetchMock = vi.fn();
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce({
        ok: response.ok,
        status: response.status,
        json: async () => ({}),
      });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  },
  expectOpenAiCompatResult = function (params) {
    expect(params.prompter.text).toHaveBeenCalledTimes(params.textCalls);
    expect(params.prompter.select).toHaveBeenCalledTimes(params.selectCalls);
    expect(params.result.config.models?.providers?.custom?.api).toBe("openai-completions");
  };
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../runtime.js";
import {
  applyCustomApiConfig,
  parseNonInteractiveCustomApiFlags,
  promptCustomApiConfig,
} from "./onboard-custom.js";
vi.mock("./model-picker.js", () => ({
  applyPrimaryModel: vi.fn((cfg) => cfg),
}));
async function runPromptCustomApi(prompter, config = {}) {
  return promptCustomApiConfig({
    prompter,
    runtime: { ...defaultRuntime, log: vi.fn() },
    config,
  });
}
describe("promptCustomApiConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("handles openai flow and saves alias", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "llama3", "custom", "local"],
      select: ["openai"],
    });
    stubFetchSequence([{ ok: true }]);
    const result = await runPromptCustomApi(prompter);
    expectOpenAiCompatResult({ prompter, textCalls: 5, selectCalls: 1, result });
    expect(result.config.agents?.defaults?.models?.["custom/llama3"]?.alias).toBe("local");
  });
  it("retries when verification fails", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "bad-model", "good-model", "custom", ""],
      select: ["openai", "model"],
    });
    stubFetchSequence([{ ok: false, status: 400 }, { ok: true }]);
    await runPromptCustomApi(prompter);
    expect(prompter.text).toHaveBeenCalledTimes(6);
    expect(prompter.select).toHaveBeenCalledTimes(2);
  });
  it("detects openai compatibility when unknown", async () => {
    const prompter = createTestPrompter({
      text: ["https://example.com/v1", "test-key", "detected-model", "custom", "alias"],
      select: ["unknown"],
    });
    stubFetchSequence([{ ok: true }]);
    const result = await runPromptCustomApi(prompter);
    expectOpenAiCompatResult({ prompter, textCalls: 5, selectCalls: 1, result });
  });
  it("re-prompts base url when unknown detection fails", async () => {
    const prompter = createTestPrompter({
      text: [
        "https://bad.example.com/v1",
        "bad-key",
        "bad-model",
        "https://ok.example.com/v1",
        "ok-key",
        "custom",
        "",
      ],
      select: ["unknown", "baseUrl"],
    });
    stubFetchSequence([{ ok: false, status: 404 }, { ok: false, status: 404 }, { ok: true }]);
    await runPromptCustomApi(prompter);
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("did not respond"),
      "Endpoint detection",
    );
  });
  it("renames provider id when baseUrl differs", async () => {
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "llama3", "custom", ""],
      select: ["openai"],
    });
    stubFetchSequence([{ ok: true }]);
    const result = await runPromptCustomApi(prompter, {
      models: {
        providers: {
          custom: {
            baseUrl: "http://old.example.com/v1",
            api: "openai-completions",
            models: [
              {
                id: "old-model",
                name: "Old",
                contextWindow: 1,
                maxTokens: 1,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                reasoning: false,
              },
            ],
          },
        },
      },
    });
    expect(result.providerId).toBe("custom-2");
    expect(result.config.models?.providers?.custom).toBeDefined();
    expect(result.config.models?.providers?.["custom-2"]).toBeDefined();
  });
  it("aborts verification after timeout", async () => {
    vi.useFakeTimers();
    const prompter = createTestPrompter({
      text: ["http://localhost:11434/v1", "", "slow-model", "fast-model", "custom", ""],
      select: ["openai", "model"],
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        });
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const promise = runPromptCustomApi(prompter);
    await vi.advanceTimersByTimeAsync(1e4);
    await promise;
    expect(prompter.text).toHaveBeenCalledTimes(6);
  });
});
describe("applyCustomApiConfig", () => {
  it("rejects invalid compatibility values at runtime", () => {
    expect(() =>
      applyCustomApiConfig({
        config: {},
        baseUrl: "https://llm.example.com/v1",
        modelId: "foo-large",
        compatibility: "invalid",
      }),
    ).toThrow('Custom provider compatibility must be "openai" or "anthropic".');
  });
  it("rejects explicit provider ids that normalize to empty", () => {
    expect(() =>
      applyCustomApiConfig({
        config: {},
        baseUrl: "https://llm.example.com/v1",
        modelId: "foo-large",
        compatibility: "openai",
        providerId: "!!!",
      }),
    ).toThrow("Custom provider ID must include letters, numbers, or hyphens.");
  });
});
describe("parseNonInteractiveCustomApiFlags", () => {
  it("parses required flags and defaults compatibility to openai", () => {
    const result = parseNonInteractiveCustomApiFlags({
      baseUrl: " https://llm.example.com/v1 ",
      modelId: " foo-large ",
      apiKey: " custom-test-key ",
      providerId: " my-custom ",
    });
    expect(result).toEqual({
      baseUrl: "https://llm.example.com/v1",
      modelId: "foo-large",
      compatibility: "openai",
      apiKey: "custom-test-key",
      providerId: "my-custom",
    });
  });
  it("rejects missing required flags", () => {
    expect(() =>
      parseNonInteractiveCustomApiFlags({
        baseUrl: "https://llm.example.com/v1",
      }),
    ).toThrow('Auth choice "custom-api-key" requires a base URL and model ID.');
  });
  it("rejects invalid compatibility values", () => {
    expect(() =>
      parseNonInteractiveCustomApiFlags({
        baseUrl: "https://llm.example.com/v1",
        modelId: "foo-large",
        compatibility: "xmlrpc",
      }),
    ).toThrow('Invalid --custom-compatibility (use "openai" or "anthropic").');
  });
  it("rejects invalid explicit provider ids", () => {
    expect(() =>
      parseNonInteractiveCustomApiFlags({
        baseUrl: "https://llm.example.com/v1",
        modelId: "foo-large",
        providerId: "!!!",
      }),
    ).toThrow("Custom provider ID must include letters, numbers, or hyphens.");
  });
});
