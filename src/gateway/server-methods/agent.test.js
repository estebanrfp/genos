let mockMainSessionEntry = function (entry, cfg = {}) {
    mocks.loadSessionEntry.mockReturnValue({
      cfg,
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
        ...entry,
      },
      canonicalKey: "agent:default:main",
    });
  },
  captureUpdatedMainEntry = function () {
    let capturedEntry;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store = {};
      await updater(store);
      capturedEntry = store["agent:default:main"];
    });
    return () => capturedEntry;
  };
import { describe, expect, it, vi } from "vitest";
import { BARE_SESSION_RESET_PROMPT } from "../../auto-reply/reply/session-reset-prompt.js";
import { agentHandlers } from "./agent.js";
const mocks = vi.hoisted(() => ({
  loadSessionEntry: vi.fn(),
  updateSessionStore: vi.fn(),
  agentCommand: vi.fn(),
  registerAgentRunContext: vi.fn(),
  sessionsResetHandler: vi.fn(),
  loadConfigReturn: {},
}));
vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual("../session-utils.js");
  return {
    ...actual,
    loadSessionEntry: mocks.loadSessionEntry,
  };
});
vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual("../../config/sessions.js");
  return {
    ...actual,
    updateSessionStore: mocks.updateSessionStore,
    resolveAgentIdFromSessionKey: () => "main",
    resolveExplicitAgentSessionKey: () => {
      return;
    },
    resolveAgentMainSessionKey: ({ cfg, agentId }) =>
      `agent:${agentId}:${cfg?.session?.mainKey ?? "main"}`,
  };
});
vi.mock("../../commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));
vi.mock("../../config/config.js", async () => {
  const actual = await vi.importActual("../../config/config.js");
  return {
    ...actual,
    loadConfig: () => mocks.loadConfigReturn,
  };
});
vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
}));
vi.mock("../../infra/agent-events.js", () => ({
  registerAgentRunContext: mocks.registerAgentRunContext,
  onAgentEvent: vi.fn(),
}));
vi.mock("./sessions.js", () => ({
  sessionsHandlers: {
    "sessions.reset": (...args) => mocks.sessionsResetHandler(...args),
  },
}));
vi.mock("../../sessions/send-policy.js", () => ({
  resolveSendPolicy: () => "allow",
}));
vi.mock("../../utils/delivery-context.js", async () => {
  const actual = await vi.importActual("../../utils/delivery-context.js");
  return {
    ...actual,
    normalizeSessionDeliveryFields: () => ({}),
  };
});
const makeContext = () => ({
  dedupe: new Map(),
  addChatRun: vi.fn(),
  logGateway: { info: vi.fn(), error: vi.fn() },
});
async function runMainAgent(message, idempotencyKey) {
  const respond = vi.fn();
  await invokeAgent(
    {
      message,
      agentId: "main",
      sessionKey: "agent:default:main",
      idempotencyKey,
    },
    { respond, reqId: idempotencyKey },
  );
  return respond;
}
async function invokeAgent(params, options) {
  const respond = options?.respond ?? vi.fn();
  await agentHandlers.agent({
    params,
    respond,
    context: options?.context ?? makeContext(),
    req: { type: "req", id: options?.reqId ?? "agent-test-req", method: "agent" },
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}
async function invokeAgentIdentityGet(params, options) {
  const respond = options?.respond ?? vi.fn();
  await agentHandlers["agent.identity.get"]({
    params,
    respond,
    context: options?.context ?? makeContext(),
    req: {
      type: "req",
      id: options?.reqId ?? "agent-identity-test-req",
      method: "agent.identity.get",
    },
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}
describe("gateway agent handler", () => {
  it("preserves cliSessionIds from existing session entry", async () => {
    const existingCliSessionIds = { "claude-cli": "abc-123-def" };
    const existingClaudeCliSessionId = "abc-123-def";
    mockMainSessionEntry({
      cliSessionIds: existingCliSessionIds,
      claudeCliSessionId: existingClaudeCliSessionId,
    });
    const getCapturedEntry = captureUpdatedMainEntry();
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    await runMainAgent("test", "test-idem");
    expect(mocks.updateSessionStore).toHaveBeenCalled();
    const capturedEntry = getCapturedEntry();
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry?.cliSessionIds).toEqual(existingCliSessionIds);
    expect(capturedEntry?.claudeCliSessionId).toBe(existingClaudeCliSessionId);
  });
  it("injects a timestamp into the message passed to agentCommand", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-29T01:30:00.000Z"));
    mocks.agentCommand.mockReset();
    mocks.loadConfigReturn = {
      agents: {
        defaults: {
          userTimezone: "America/New_York",
        },
      },
    };
    mocks.loadSessionEntry.mockReturnValue({
      cfg: mocks.loadConfigReturn,
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:default:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    await invokeAgent(
      {
        message: "Is it the weekend?",
        agentId: "main",
        sessionKey: "agent:default:main",
        idempotencyKey: "test-timestamp-inject",
      },
      { reqId: "ts-1" },
    );
    await vi.waitFor(() => expect(mocks.agentCommand).toHaveBeenCalled());
    const callArgs = mocks.agentCommand.mock.calls[0][0];
    expect(callArgs.message).toBe("[Wed 2026-01-28 20:30 EST] Is it the weekend?");
    mocks.loadConfigReturn = {};
    vi.useRealTimers();
  });
  it("handles missing cliSessionIds gracefully", async () => {
    mockMainSessionEntry({});
    const getCapturedEntry = captureUpdatedMainEntry();
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    await runMainAgent("test", "test-idem-2");
    expect(mocks.updateSessionStore).toHaveBeenCalled();
    const capturedEntry = getCapturedEntry();
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry?.cliSessionIds).toBeUndefined();
    expect(capturedEntry?.claudeCliSessionId).toBeUndefined();
  });
  it("prunes legacy main alias keys when writing a canonical session entry", async () => {
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {
        session: { mainKey: "work" },
        agents: { list: [{ id: "main", default: true }] },
      },
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:default:work",
    });
    let capturedStore;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store = {
        "agent:default:work": { sessionId: "existing-session-id", updatedAt: 10 },
        "agent:default:MAIN": { sessionId: "legacy-session-id", updatedAt: 5 },
      };
      await updater(store);
      capturedStore = store;
    });
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    await invokeAgent(
      {
        message: "test",
        agentId: "main",
        sessionKey: "main",
        idempotencyKey: "test-idem-alias-prune",
      },
      { reqId: "3" },
    );
    expect(mocks.updateSessionStore).toHaveBeenCalled();
    expect(capturedStore).toBeDefined();
    expect(capturedStore?.["agent:default:work"]).toBeDefined();
    expect(capturedStore?.["agent:default:MAIN"]).toBeUndefined();
  });
  it("handles bare /new by resetting the same session and sending reset greeting prompt", async () => {
    mocks.sessionsResetHandler.mockImplementation(async (opts) => {
      expect(opts.params.key).toBe("agent:default:main");
      expect(opts.params.reason).toBe("new");
      opts.respond(true, {
        ok: true,
        key: "agent:default:main",
        entry: { sessionId: "reset-session-id" },
      });
    });
    mocks.loadSessionEntry.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "reset-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:default:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });
    await invokeAgent(
      {
        message: "/new",
        sessionKey: "agent:default:main",
        idempotencyKey: "test-idem-new",
      },
      { reqId: "4" },
    );
    await vi.waitFor(() => expect(mocks.agentCommand).toHaveBeenCalled());
    expect(mocks.sessionsResetHandler).toHaveBeenCalledTimes(1);
    const call = mocks.agentCommand.mock.calls.at(-1)?.[0];
    expect(call?.message).toBe(BARE_SESSION_RESET_PROMPT);
    expect(call?.sessionId).toBe("reset-session-id");
  });
  it("rejects malformed agent session keys early in agent handler", async () => {
    mocks.agentCommand.mockClear();
    const respond = await invokeAgent(
      {
        message: "test",
        sessionKey: "agent:main",
        idempotencyKey: "test-malformed-session-key",
      },
      { reqId: "4" },
    );
    expect(mocks.agentCommand).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("malformed session key"),
      }),
    );
  });
  it("rejects malformed session keys in agent.identity.get", async () => {
    const respond = await invokeAgentIdentityGet(
      {
        sessionKey: "agent:main",
      },
      { reqId: "5" },
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("malformed session key"),
      }),
    );
  });
});
