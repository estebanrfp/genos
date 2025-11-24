import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddedPiAgent } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";
const mockedRunEmbeddedAttempt = vi.mocked(runEmbeddedAttempt);
describe("runEmbeddedPiAgent usage reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("reports total usage from the last turn instead of accumulated total", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce({
      aborted: false,
      promptError: null,
      timedOut: false,
      sessionIdUsed: "test-session",
      assistantTexts: ["Response 1", "Response 2"],
      lastAssistant: {
        usage: { input: 150, output: 50, total: 200 },
        stopReason: "end_turn",
      },
      attemptUsage: { input: 250, output: 100, total: 350 },
    });
    const result = await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });
    const usage = result.meta.agentMeta?.usage;
    expect(usage).toBeDefined();
    expect(usage?.total).toBe(200);
  });
});
