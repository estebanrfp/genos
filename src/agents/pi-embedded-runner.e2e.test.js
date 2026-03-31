import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { ensureGenosOSModelsJson } from "./models-config.js";
vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual("@mariozechner/pi-ai");
  const buildAssistantMessage = (model) => ({
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: Date.now(),
  });
  const buildAssistantErrorMessage = (model) => ({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "boom",
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: Date.now(),
  });
  return {
    ...actual,
    complete: async (model) => {
      if (model.id === "mock-error") {
        return buildAssistantErrorMessage(model);
      }
      return buildAssistantMessage(model);
    },
    completeSimple: async (model) => {
      if (model.id === "mock-error") {
        return buildAssistantErrorMessage(model);
      }
      return buildAssistantMessage(model);
    },
    streamSimple: (model) => {
      if (model.id === "mock-throw") {
        throw new Error("transport failed");
      }
      const stream = actual.createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message:
            model.id === "mock-error"
              ? buildAssistantErrorMessage(model)
              : buildAssistantMessage(model),
        });
        stream.end();
      });
      return stream;
    },
  };
});
let runEmbeddedPiAgent;
let tempRoot;
let agentDir;
let workspaceDir;
let sessionCounter = 0;
let runCounter = 0;
beforeAll(async () => {
  vi.useRealTimers();
  ({ runEmbeddedPiAgent } = await import("./pi-embedded-runner.js"));
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-embedded-agent-"));
  agentDir = path.join(tempRoot, "agent");
  workspaceDir = path.join(tempRoot, "workspace");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
}, 60000);
afterAll(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});
const makeOpenAiConfig = (modelIds) => ({
  models: {
    providers: {
      openai: {
        api: "openai-responses",
        apiKey: "sk-test",
        baseUrl: "https://example.com",
        models: modelIds.map((id) => ({
          id,
          name: `Mock ${id}`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 16000,
          maxTokens: 2048,
        })),
      },
    },
  },
});
const ensureModels = (cfg) => ensureGenosOSModelsJson(cfg, agentDir);
const nextSessionFile = () => {
  sessionCounter += 1;
  return path.join(workspaceDir, `session-${sessionCounter}.jsonl`);
};
const nextRunId = (prefix = "run-embedded-test") => `${prefix}-${++runCounter}`;
const testSessionKey = "agent:test:embedded";
const immediateEnqueue = async (task) => task();
const runWithOrphanedSingleUserMessage = async (text) => {
  const { SessionManager } = await import("@mariozechner/pi-coding-agent");
  const sessionFile = nextSessionFile();
  const sessionManager = SessionManager.open(sessionFile);
  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  });
  const cfg = makeOpenAiConfig(["mock-1"]);
  await ensureModels(cfg);
  return await runEmbeddedPiAgent({
    sessionId: "session:test",
    sessionKey: testSessionKey,
    sessionFile,
    workspaceDir,
    config: cfg,
    prompt: "hello",
    provider: "openai",
    model: "mock-1",
    timeoutMs: 5000,
    agentDir,
    runId: nextRunId("orphaned-user"),
    enqueue: immediateEnqueue,
  });
};
const textFromContent = (content) => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content[0]?.type === "text") {
    return content[0].text;
  }
  return;
};
const readSessionEntries = async (sessionFile) => {
  const raw = await fs.readFile(sessionFile, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};
const readSessionMessages = async (sessionFile) => {
  const entries = await readSessionEntries(sessionFile);
  return entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
};
const runDefaultEmbeddedTurn = async (sessionFile, prompt) => {
  const cfg = makeOpenAiConfig(["mock-1"]);
  await ensureModels(cfg);
  await runEmbeddedPiAgent({
    sessionId: "session:test",
    sessionKey: testSessionKey,
    sessionFile,
    workspaceDir,
    config: cfg,
    prompt,
    provider: "openai",
    model: "mock-1",
    timeoutMs: 5000,
    agentDir,
    runId: nextRunId("default-turn"),
    enqueue: immediateEnqueue,
  });
};
describe("runEmbeddedPiAgent", () => {
  it("writes models.json into the provided agentDir", async () => {
    const sessionFile = nextSessionFile();
    const cfg = {
      models: {
        providers: {
          minimax: {
            baseUrl: "https://api.minimax.io/anthropic",
            api: "anthropic-messages",
            apiKey: "sk-minimax-test",
            models: [
              {
                id: "MiniMax-M2.1",
                name: "MiniMax M2.1",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 8192,
              },
            ],
          },
        },
      },
    };
    await expect(
      runEmbeddedPiAgent({
        sessionId: "session:test",
        sessionKey: testSessionKey,
        sessionFile,
        workspaceDir,
        config: cfg,
        prompt: "hi",
        provider: "definitely-not-a-provider",
        model: "definitely-not-a-model",
        timeoutMs: 1,
        agentDir,
        runId: nextRunId("unknown-model"),
        enqueue: immediateEnqueue,
      }),
    ).rejects.toThrow(/Unknown model:/);
    await expect(fs.stat(path.join(agentDir, "models.json"))).resolves.toBeTruthy();
  });
  it("falls back to per-agent workspace when runtime workspaceDir is missing", async () => {
    const sessionFile = nextSessionFile();
    const fallbackWorkspace = path.join(tempRoot ?? os.tmpdir(), "workspace-fallback-main");
    const cfg = {
      ...makeOpenAiConfig(["mock-1"]),
      agents: {
        defaults: {
          workspace: fallbackWorkspace,
        },
      },
    };
    await ensureModels(cfg);
    const result = await runEmbeddedPiAgent({
      sessionId: "session:test-fallback",
      sessionKey: "agent:default:subagent:fallback-workspace",
      sessionFile,
      workspaceDir: undefined,
      config: cfg,
      prompt: "hello",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5000,
      agentDir,
      runId: "run-fallback-workspace",
      enqueue: immediateEnqueue,
    });
    expect(result.payloads?.[0]?.text).toBe("ok");
    await expect(fs.stat(fallbackWorkspace)).resolves.toBeTruthy();
  });
  it("throws when sessionKey is malformed", async () => {
    const sessionFile = nextSessionFile();
    const cfg = {
      ...makeOpenAiConfig(["mock-1"]),
      agents: {
        defaults: {
          workspace: path.join(tempRoot ?? os.tmpdir(), "workspace-fallback-main"),
        },
        list: [
          {
            id: "research",
            workspace: path.join(tempRoot ?? os.tmpdir(), "workspace-fallback-research"),
          },
        ],
      },
    };
    await ensureModels(cfg);
    await expect(
      runEmbeddedPiAgent({
        sessionId: "session:test-fallback-malformed",
        sessionKey: "agent::broken",
        agentId: "research",
        sessionFile,
        workspaceDir: undefined,
        config: cfg,
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 5000,
        agentDir,
        runId: "run-fallback-workspace-malformed",
        enqueue: immediateEnqueue,
      }),
    ).rejects.toThrow("Malformed agent session key");
  });
  it("persists the first user message before assistant output", { timeout: 120000 }, async () => {
    const sessionFile = nextSessionFile();
    await runDefaultEmbeddedTurn(sessionFile, "hello");
    const messages = await readSessionMessages(sessionFile);
    const firstUserIndex = messages.findIndex(
      (message) => message?.role === "user" && textFromContent(message.content) === "hello",
    );
    const firstAssistantIndex = messages.findIndex((message) => message?.role === "assistant");
    expect(firstUserIndex).toBeGreaterThanOrEqual(0);
    if (firstAssistantIndex !== -1) {
      expect(firstUserIndex).toBeLessThan(firstAssistantIndex);
    }
  });
  it("persists the user message when prompt fails before assistant output", async () => {
    const sessionFile = nextSessionFile();
    const cfg = makeOpenAiConfig(["mock-error"]);
    await ensureModels(cfg);
    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "boom",
      provider: "openai",
      model: "mock-error",
      timeoutMs: 5000,
      agentDir,
      runId: nextRunId("prompt-error"),
      enqueue: immediateEnqueue,
    });
    expect(result.payloads?.[0]?.isError).toBe(true);
    const messages = await readSessionMessages(sessionFile);
    const userIndex = messages.findIndex(
      (message) => message?.role === "user" && textFromContent(message.content) === "boom",
    );
    expect(userIndex).toBeGreaterThanOrEqual(0);
  });
  it("persists prompt transport errors as transcript entries", async () => {
    const sessionFile = nextSessionFile();
    const cfg = makeOpenAiConfig(["mock-throw"]);
    await ensureModels(cfg);
    const result = await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "transport error",
      provider: "openai",
      model: "mock-throw",
      timeoutMs: 5000,
      agentDir,
      runId: nextRunId("transport-error"),
      enqueue: immediateEnqueue,
    });
    expect(result.payloads?.[0]?.isError).toBe(true);
    const entries = await readSessionEntries(sessionFile);
    const promptErrorEntry = entries.find(
      (entry) => entry.type === "custom" && entry.customType === "genosos:prompt-error",
    );
    expect(promptErrorEntry).toBeTruthy();
    expect(promptErrorEntry?.data?.error).toContain("transport failed");
  });
  it(
    "appends new user + assistant after existing transcript entries",
    { timeout: 90000 },
    async () => {
      const { SessionManager } = await import("@mariozechner/pi-coding-agent");
      const sessionFile = nextSessionFile();
      const sessionManager = SessionManager.open(sessionFile);
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "seed user" }],
        timestamp: Date.now(),
      });
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "seed assistant" }],
        stopReason: "stop",
        api: "openai-responses",
        provider: "openai",
        model: "mock-1",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        timestamp: Date.now(),
      });
      await runDefaultEmbeddedTurn(sessionFile, "hello");
      const messages = await readSessionMessages(sessionFile);
      const seedUserIndex = messages.findIndex(
        (message) => message?.role === "user" && textFromContent(message.content) === "seed user",
      );
      const seedAssistantIndex = messages.findIndex(
        (message) =>
          message?.role === "assistant" && textFromContent(message.content) === "seed assistant",
      );
      const newUserIndex = messages.findIndex(
        (message) => message?.role === "user" && textFromContent(message.content) === "hello",
      );
      const newAssistantIndex = messages.findIndex(
        (message, index) => index > newUserIndex && message?.role === "assistant",
      );
      expect(seedUserIndex).toBeGreaterThanOrEqual(0);
      expect(seedAssistantIndex).toBeGreaterThan(seedUserIndex);
      expect(newUserIndex).toBeGreaterThan(seedAssistantIndex);
      expect(newAssistantIndex).toBeGreaterThan(newUserIndex);
    },
  );
  it("persists multi-turn user/assistant ordering across runs", async () => {
    const sessionFile = nextSessionFile();
    const cfg = makeOpenAiConfig(["mock-1"]);
    await ensureModels(cfg);
    await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "first",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5000,
      agentDir,
      runId: nextRunId("turn-first"),
      enqueue: immediateEnqueue,
    });
    await runEmbeddedPiAgent({
      sessionId: "session:test",
      sessionKey: testSessionKey,
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: "second",
      provider: "openai",
      model: "mock-1",
      timeoutMs: 5000,
      agentDir,
      runId: nextRunId("turn-second"),
      enqueue: immediateEnqueue,
    });
    const messages = await readSessionMessages(sessionFile);
    const firstUserIndex = messages.findIndex(
      (message) => message?.role === "user" && textFromContent(message.content) === "first",
    );
    const firstAssistantIndex = messages.findIndex(
      (message, index) => index > firstUserIndex && message?.role === "assistant",
    );
    const secondUserIndex = messages.findIndex(
      (message, index) =>
        index > firstAssistantIndex &&
        message?.role === "user" &&
        textFromContent(message.content) === "second",
    );
    const secondAssistantIndex = messages.findIndex(
      (message, index) => index > secondUserIndex && message?.role === "assistant",
    );
    expect(firstUserIndex).toBeGreaterThanOrEqual(0);
    expect(firstAssistantIndex).toBeGreaterThan(firstUserIndex);
    expect(secondUserIndex).toBeGreaterThan(firstAssistantIndex);
    expect(secondAssistantIndex).toBeGreaterThan(secondUserIndex);
  });
  it("repairs orphaned user messages and continues", async () => {
    const result = await runWithOrphanedSingleUserMessage("orphaned user");
    expect(result.meta.error).toBeUndefined();
    expect(result.payloads?.length ?? 0).toBeGreaterThan(0);
  });
  it("repairs orphaned single-user sessions and continues", async () => {
    const result = await runWithOrphanedSingleUserMessage("solo user");
    expect(result.meta.error).toBeUndefined();
    expect(result.payloads?.length ?? 0).toBeGreaterThan(0);
  });
});
