let findLastCall = function (calls, predicate) {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i];
    if (call && predicate(call)) {
      return call;
    }
  }
  return;
};
import { describe, expect, it, vi } from "vitest";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual("../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({
      agents: {
        defaults: {
          subagents: {
            thinking: "high",
          },
        },
      },
      routing: {
        sessions: {
          mainKey: "agent:test:main",
        },
      },
    }),
  };
});
vi.mock("../gateway/call.js", () => {
  return {
    callGateway: vi.fn(async ({ method }) => {
      if (method === "agent") {
        return { runId: "run-123" };
      }
      return {};
    }),
  };
});
async function getGatewayCalls() {
  const { callGateway } = await import("../gateway/call.js");
  return callGateway.mock.calls.map((call) => call[0]);
}
async function expectThinkingPropagation(params) {
  const tool = createSessionsSpawnTool({ agentSessionKey: "agent:test:main" });
  const result = await tool.execute(params.callId, params.payload);
  expect(result.details).toMatchObject({ status: "accepted" });
  const calls = await getGatewayCalls();
  const agentCall = findLastCall(calls, (call) => call.method === "agent");
  const thinkingPatch = findLastCall(
    calls,
    (call) => call.method === "sessions.patch" && call.params?.thinkingLevel !== undefined,
  );
  expect(agentCall?.params?.thinking).toBe(params.expectedThinking);
  expect(thinkingPatch?.params?.thinkingLevel).toBe(params.expectedThinking);
}
describe("sessions_spawn thinking defaults", () => {
  it("applies agents.defaults.subagents.thinking when thinking is omitted", async () => {
    await expectThinkingPropagation({
      callId: "call-1",
      payload: { task: "hello" },
      expectedThinking: "high",
    });
  });
  it("prefers explicit sessions_spawn.thinking over config default", async () => {
    await expectThinkingPropagation({
      callId: "call-2",
      payload: { task: "hello", thinking: "low" },
      expectedThinking: "low",
    });
  });
});
