let resetSessionStore = function (store) {
    loadSessionStoreMock.mockReset();
    updateSessionStoreMock.mockReset();
    loadSessionStoreMock.mockReturnValue(store);
  },
  getSessionStatusTool = function (agentSessionKey = "main") {
    const tool = createGenosOSTools({ agentSessionKey }).find(
      (candidate) => candidate.name === "session_status",
    );
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing session_status tool");
    }
    return tool;
  };
import { describe, expect, it, vi } from "vitest";
const loadSessionStoreMock = vi.fn();
const updateSessionStoreMock = vi.fn();
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadSessionStore: (storePath) => loadSessionStoreMock(storePath),
    updateSessionStore: async (storePath, mutator) => {
      const store = loadSessionStoreMock(storePath);
      await mutator(store);
      updateSessionStoreMock(storePath, store);
      return store;
    },
    resolveStorePath: (_store, opts) =>
      opts?.agentId === "support" ? "/tmp/support/sessions.json" : "/tmp/main/sessions.json",
  };
});
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => ({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-5" },
          models: {},
        },
      },
    }),
  };
});
vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: async () => [
    {
      provider: "anthropic",
      id: "claude-opus-4-5",
      name: "Opus",
      contextWindow: 200000,
    },
    {
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      name: "Sonnet",
      contextWindow: 200000,
    },
  ],
}));
vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: () => ({ profiles: {} }),
  resolveAuthProfileDisplayLabel: () => {
    return;
  },
  resolveAuthProfileOrder: () => [],
}));
vi.mock("../agents/model-auth.js", () => ({
  resolveEnvApiKey: () => null,
  getCustomProviderApiKey: () => null,
  resolveModelAuthMode: () => "api-key",
}));
vi.mock("../infra/provider-usage.js", () => ({
  resolveUsageProviderId: () => {
    return;
  },
  loadProviderUsageSummary: async () => ({
    updatedAt: Date.now(),
    providers: [],
  }),
  formatUsageSummaryLine: () => null,
}));
import "./test-helpers/fast-core-tools.js";
import { createGenosOSTools } from "./genosos-tools.js";
describe("session_status tool", () => {
  it("returns a status card for the current session", async () => {
    resetSessionStore({
      main: {
        sessionId: "s1",
        updatedAt: 10,
      },
    });
    const tool = getSessionStatusTool();
    const result = await tool.execute("call1", {});
    const details = result.details;
    expect(details.ok).toBe(true);
    expect(details.statusText).toContain("GenosOS");
    expect(details.statusText).toContain("\uD83E\uDDE0 Model:");
    expect(details.statusText).not.toContain("OAuth/token status");
  });
  it("errors for unknown session keys", async () => {
    resetSessionStore({
      main: { sessionId: "s1", updatedAt: 10 },
    });
    const tool = getSessionStatusTool();
    await expect(tool.execute("call2", { sessionKey: "nope" })).rejects.toThrow(
      "Unknown sessionId",
    );
    expect(updateSessionStoreMock).not.toHaveBeenCalled();
  });
  it("resolves sessionId inputs", async () => {
    const sessionId = "sess-main";
    resetSessionStore({
      "agent:main:main": {
        sessionId,
        updatedAt: 10,
      },
    });
    const tool = getSessionStatusTool();
    const result = await tool.execute("call3", { sessionKey: sessionId });
    const details = result.details;
    expect(details.ok).toBe(true);
    expect(details.sessionKey).toBe("agent:main:main");
  });
  it("uses non-standard session keys without sessionId resolution", async () => {
    resetSessionStore({
      "temp:slug-generator": {
        sessionId: "sess-temp",
        updatedAt: 10,
      },
    });
    const tool = getSessionStatusTool();
    const result = await tool.execute("call4", { sessionKey: "temp:slug-generator" });
    const details = result.details;
    expect(details.ok).toBe(true);
    expect(details.sessionKey).toBe("temp:slug-generator");
  });
  it("blocks cross-agent session_status without agent-to-agent access", async () => {
    resetSessionStore({
      "agent:other:main": {
        sessionId: "s2",
        updatedAt: 10,
      },
    });
    const tool = getSessionStatusTool("agent:main:main");
    await expect(tool.execute("call5", { sessionKey: "agent:other:main" })).rejects.toThrow(
      "Agent-to-agent status is disabled",
    );
  });
  it("scopes bare session keys to the requester agent", async () => {
    loadSessionStoreMock.mockReset();
    updateSessionStoreMock.mockReset();
    const stores = new Map([
      [
        "/tmp/main/sessions.json",
        {
          "agent:main:main": { sessionId: "s-main", updatedAt: 10 },
        },
      ],
      [
        "/tmp/support/sessions.json",
        {
          main: { sessionId: "s-support", updatedAt: 20 },
        },
      ],
    ]);
    loadSessionStoreMock.mockImplementation((storePath) => {
      return stores.get(storePath) ?? {};
    });
    updateSessionStoreMock.mockImplementation((_storePath, store) => {
      if (_storePath) {
        stores.set(_storePath, store);
      }
    });
    const tool = getSessionStatusTool("agent:support:main");
    const result = await tool.execute("call6", { sessionKey: "main" });
    const details = result.details;
    expect(details.ok).toBe(true);
    expect(details.sessionKey).toBe("main");
  });
  it("resets per-session model override via model=default", async () => {
    resetSessionStore({
      main: {
        sessionId: "s1",
        updatedAt: 10,
        providerOverride: "anthropic",
        modelOverride: "claude-sonnet-4-5",
        authProfileOverride: "p1",
      },
    });
    const tool = getSessionStatusTool();
    await tool.execute("call3", { model: "default" });
    expect(updateSessionStoreMock).toHaveBeenCalled();
    const [, savedStore] = updateSessionStoreMock.mock.calls.at(-1);
    const saved = savedStore.main;
    expect(saved.providerOverride).toBeUndefined();
    expect(saved.modelOverride).toBeUndefined();
    expect(saved.authProfileOverride).toBeUndefined();
  });
});
