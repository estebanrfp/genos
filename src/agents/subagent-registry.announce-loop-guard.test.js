import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    session: { store: "/tmp/test-store", mainKey: "main" },
    agents: {},
  }),
}));
vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => ({}),
  resolveAgentIdFromSessionKey: (key) => {
    const match = key.match(/^agent:([^:]+)/);
    return match?.[1] ?? "main";
  },
  resolveMainSessionKey: () => "agent:default:main",
  resolveStorePath: () => "/tmp/test-store",
  updateSessionStore: vi.fn(),
}));
vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn().mockResolvedValue({ status: "ok" }),
}));
vi.mock("../infra/agent-events.js", () => ({
  onAgentEvent: vi.fn().mockReturnValue(() => {}),
}));
vi.mock("./subagent-announce.js", () => ({
  runSubagentAnnounceFlow: vi.fn().mockResolvedValue(false),
}));
const loadSubagentRegistryFromDisk = vi.fn(() => new Map());
const saveSubagentRegistryToDisk = vi.fn();
vi.mock("./subagent-registry.store.js", () => ({
  loadSubagentRegistryFromDisk,
  saveSubagentRegistryToDisk,
}));
vi.mock("./subagent-announce-queue.js", () => ({
  resetAnnounceQueuesForTests: vi.fn(),
}));
vi.mock("./timeout.js", () => ({
  resolveAgentTimeoutMs: () => 60000,
}));
describe("announce loop guard (#18264)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    loadSubagentRegistryFromDisk.mockReset();
    loadSubagentRegistryFromDisk.mockReturnValue(new Map());
    saveSubagentRegistryToDisk.mockClear();
    vi.clearAllMocks();
  });
  test("SubagentRunRecord has announceRetryCount and lastAnnounceRetryAt fields", async () => {
    const registry = await import("./subagent-registry.js");
    registry.resetSubagentRegistryForTests();
    const now = Date.now();
    registry.addSubagentRunForTests({
      runId: "test-loop-guard",
      childSessionKey: "agent:default:subagent:child-1",
      requesterSessionKey: "agent:default:main",
      requesterDisplayKey: "agent:default:main",
      task: "test task",
      cleanup: "keep",
      createdAt: now - 60000,
      startedAt: now - 55000,
      endedAt: now - 50000,
      announceRetryCount: 3,
      lastAnnounceRetryAt: now - 1e4,
    });
    const runs = registry.listSubagentRunsForRequester("agent:default:main");
    const entry = runs.find((r) => r.runId === "test-loop-guard");
    expect(entry).toBeDefined();
    expect(entry.announceRetryCount).toBe(3);
    expect(entry.lastAnnounceRetryAt).toBeDefined();
  });
  test("expired entries with high retry count are skipped by resumeSubagentRun", async () => {
    const registry = await import("./subagent-registry.js");
    const { runSubagentAnnounceFlow } = await import("./subagent-announce.js");
    const announceFn = vi.mocked(runSubagentAnnounceFlow);
    announceFn.mockClear();
    registry.resetSubagentRegistryForTests();
    const now = Date.now();
    const entry = {
      runId: "test-expired-loop",
      childSessionKey: "agent:default:subagent:expired-child",
      requesterSessionKey: "agent:default:main",
      requesterDisplayKey: "agent:default:main",
      task: "expired test task",
      cleanup: "keep",
      createdAt: now - 900000,
      startedAt: now - 840000,
      endedAt: now - 600000,
      announceRetryCount: 3,
      lastAnnounceRetryAt: now - 540000,
    };
    loadSubagentRegistryFromDisk.mockReturnValue(new Map([[entry.runId, entry]]));
    registry.initSubagentRegistry();
    expect(announceFn).not.toHaveBeenCalled();
    const runs = registry.listSubagentRunsForRequester("agent:default:main");
    const stored = runs.find((run) => run.runId === entry.runId);
    expect(stored?.cleanupCompletedAt).toBeDefined();
  });
  test("entries over retry budget are marked completed without announcing", async () => {
    const registry = await import("./subagent-registry.js");
    const { runSubagentAnnounceFlow } = await import("./subagent-announce.js");
    const announceFn = vi.mocked(runSubagentAnnounceFlow);
    announceFn.mockClear();
    registry.resetSubagentRegistryForTests();
    const now = Date.now();
    const entry = {
      runId: "test-retry-budget",
      childSessionKey: "agent:default:subagent:retry-budget",
      requesterSessionKey: "agent:default:main",
      requesterDisplayKey: "agent:default:main",
      task: "retry budget test",
      cleanup: "keep",
      createdAt: now - 120000,
      startedAt: now - 90000,
      endedAt: now - 60000,
      announceRetryCount: 3,
      lastAnnounceRetryAt: now - 30000,
    };
    loadSubagentRegistryFromDisk.mockReturnValue(new Map([[entry.runId, entry]]));
    registry.initSubagentRegistry();
    expect(announceFn).not.toHaveBeenCalled();
    const runs = registry.listSubagentRunsForRequester("agent:default:main");
    const stored = runs.find((run) => run.runId === entry.runId);
    expect(stored?.cleanupCompletedAt).toBeDefined();
  });
});
