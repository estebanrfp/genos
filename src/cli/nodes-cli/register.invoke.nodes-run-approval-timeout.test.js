import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXEC_APPROVAL_TIMEOUT_MS } from "../../infra/exec-approvals.js";
import { parseTimeoutMs } from "../nodes-run.js";
const callGatewaySpy = vi.fn(async () => ({ decision: "allow-once" }));
vi.mock("../../gateway/call.js", () => ({
  callGateway: callGatewaySpy,
  randomIdempotencyKey: () => "mock-key",
}));
vi.mock("../progress.js", () => ({
  withProgress: (_opts, fn) => fn(),
}));
describe("nodes run: approval transport timeout (#12098)", () => {
  beforeEach(() => {
    callGatewaySpy.mockReset();
    callGatewaySpy.mockResolvedValue({ decision: "allow-once" });
  });
  it("callGatewayCli forwards opts.timeout as the transport timeoutMs", async () => {
    const { callGatewayCli } = await import("./rpc.js");
    await callGatewayCli(
      "exec.approval.request",
      { timeout: "35000" },
      {
        timeoutMs: 120000,
      },
    );
    expect(callGatewaySpy).toHaveBeenCalledTimes(1);
    const callOpts = callGatewaySpy.mock.calls[0][0];
    expect(callOpts.method).toBe("exec.approval.request");
    expect(callOpts.timeoutMs).toBe(35000);
  });
  it("fix: overriding transportTimeoutMs gives the approval enough transport time", async () => {
    const { callGatewayCli } = await import("./rpc.js");
    const approvalTimeoutMs = 120000;
    const transportTimeoutMs = Math.max(parseTimeoutMs("35000") ?? 0, approvalTimeoutMs + 1e4);
    expect(transportTimeoutMs).toBe(130000);
    await callGatewayCli(
      "exec.approval.request",
      { timeout: "35000" },
      { timeoutMs: approvalTimeoutMs },
      { transportTimeoutMs },
    );
    expect(callGatewaySpy).toHaveBeenCalledTimes(1);
    const callOpts = callGatewaySpy.mock.calls[0][0];
    expect(callOpts.timeoutMs).toBeGreaterThanOrEqual(approvalTimeoutMs);
    expect(callOpts.timeoutMs).toBe(130000);
  });
  it("fix: user-specified timeout larger than approval is preserved", async () => {
    const { callGatewayCli } = await import("./rpc.js");
    const approvalTimeoutMs = 120000;
    const userTimeout = 200000;
    const transportTimeoutMs = Math.max(
      parseTimeoutMs(String(userTimeout)) ?? 0,
      approvalTimeoutMs + 1e4,
    );
    expect(transportTimeoutMs).toBe(200000);
    await callGatewayCli(
      "exec.approval.request",
      { timeout: String(userTimeout) },
      { timeoutMs: approvalTimeoutMs },
      { transportTimeoutMs },
    );
    const callOpts = callGatewaySpy.mock.calls[0][0];
    expect(callOpts.timeoutMs).toBe(200000);
  });
  it("fix: non-numeric timeout falls back to approval floor", async () => {
    const { callGatewayCli } = await import("./rpc.js");
    const approvalTimeoutMs = DEFAULT_EXEC_APPROVAL_TIMEOUT_MS;
    const transportTimeoutMs = Math.max(parseTimeoutMs("foo") ?? 0, approvalTimeoutMs + 1e4);
    expect(transportTimeoutMs).toBe(130000);
    await callGatewayCli(
      "exec.approval.request",
      { timeout: "foo" },
      { timeoutMs: approvalTimeoutMs },
      { transportTimeoutMs },
    );
    const callOpts = callGatewaySpy.mock.calls[0][0];
    expect(callOpts.timeoutMs).toBe(130000);
  });
});
