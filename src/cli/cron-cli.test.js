let buildProgram = function () {
    const program = new Command();
    program.exitOverride();
    registerCronCli(program);
    return program;
  },
  resetGatewayMock = function () {
    callGatewayFromCli.mockReset();
    callGatewayFromCli.mockImplementation(defaultGatewayMock);
  },
  mockCronEditJobLookup = function (schedule) {
    callGatewayFromCli.mockImplementation(async (method, _opts, params) => {
      if (method === "cron.status") {
        return { enabled: true };
      }
      if (method === "cron.list") {
        return {
          ok: true,
          params: {},
          jobs: [{ id: "job-1", schedule }],
        };
      }
      return { ok: true, params };
    });
  };
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
const defaultGatewayMock = async (method, _opts, params, _timeoutMs) => {
  if (method === "cron.status") {
    return { enabled: true };
  }
  return { ok: true, params };
};
const callGatewayFromCli = vi.fn(defaultGatewayMock);
vi.mock("./gateway-rpc.js", async () => {
  const actual = await vi.importActual("./gateway-rpc.js");
  return {
    ...actual,
    callGatewayFromCli: (method, opts, params, extra) =>
      callGatewayFromCli(method, opts, params, extra),
  };
});
vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: (code) => {
      throw new Error(`__exit__:${code}`);
    },
  },
}));
const { registerCronCli } = await import("./cron-cli.js");
async function runCronEditAndGetPatch(editArgs) {
  resetGatewayMock();
  const program = buildProgram();
  await program.parseAsync(["cron", "edit", "job-1", ...editArgs], { from: "user" });
  const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
  return updateCall?.[2] ?? {};
}
async function runCronAddAndGetParams(addArgs) {
  resetGatewayMock();
  const program = buildProgram();
  await program.parseAsync(["cron", "add", ...addArgs], { from: "user" });
  const addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
  return addCall?.[2] ?? {};
}
async function runCronSimpleAndGetUpdatePatch(command) {
  resetGatewayMock();
  const program = buildProgram();
  await program.parseAsync(["cron", command, "job-1"], { from: "user" });
  const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
  return updateCall?.[2]?.patch ?? {};
}
describe("cron cli", () => {
  it("trims model and thinking on cron add", { timeout: 60000 }, async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      [
        "cron",
        "add",
        "--name",
        "Daily",
        "--cron",
        "* * * * *",
        "--session",
        "isolated",
        "--message",
        "hello",
        "--model",
        "  opus  ",
        "--thinking",
        "  low  ",
      ],
      { from: "user" },
    );
    const addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    const params = addCall?.[2];
    expect(params?.payload?.model).toBe("opus");
    expect(params?.payload?.thinking).toBe("low");
  });
  it("defaults isolated cron add to announce delivery", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      [
        "cron",
        "add",
        "--name",
        "Daily",
        "--cron",
        "* * * * *",
        "--session",
        "isolated",
        "--message",
        "hello",
      ],
      { from: "user" },
    );
    const addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    const params = addCall?.[2];
    expect(params?.delivery?.mode).toBe("announce");
  });
  it("infers sessionTarget from payload when --session is omitted", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      ["cron", "add", "--name", "Main reminder", "--cron", "* * * * *", "--system-event", "hi"],
      { from: "user" },
    );
    let addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    let params = addCall?.[2];
    expect(params?.sessionTarget).toBe("main");
    expect(params?.payload?.kind).toBe("systemEvent");
    resetGatewayMock();
    await program.parseAsync(
      ["cron", "add", "--name", "Isolated task", "--cron", "* * * * *", "--message", "hello"],
      { from: "user" },
    );
    addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    params = addCall?.[2];
    expect(params?.sessionTarget).toBe("isolated");
    expect(params?.payload?.kind).toBe("agentTurn");
  });
  it("supports --keep-after-run on cron add", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      [
        "cron",
        "add",
        "--name",
        "Keep me",
        "--at",
        "20m",
        "--session",
        "main",
        "--system-event",
        "hello",
        "--keep-after-run",
      ],
      { from: "user" },
    );
    const addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    const params = addCall?.[2];
    expect(params?.deleteAfterRun).toBe(false);
  });
  it("cron enable sets enabled=true patch", async () => {
    const patch = await runCronSimpleAndGetUpdatePatch("enable");
    expect(patch.enabled).toBe(true);
  });
  it("cron disable sets enabled=false patch", async () => {
    const patch = await runCronSimpleAndGetUpdatePatch("disable");
    expect(patch.enabled).toBe(false);
  });
  it("sends agent id on cron add", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      [
        "cron",
        "add",
        "--name",
        "Agent pinned",
        "--cron",
        "* * * * *",
        "--session",
        "isolated",
        "--message",
        "hi",
        "--agent",
        "ops",
      ],
      { from: "user" },
    );
    const addCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.add");
    const params = addCall?.[2];
    expect(params?.agentId).toBe("ops");
  });
  it("omits empty model and thinking on cron edit", async () => {
    const patch = await runCronEditAndGetPatch([
      "--message",
      "hello",
      "--model",
      "   ",
      "--thinking",
      "  ",
    ]);
    expect(patch?.patch?.payload?.model).toBeUndefined();
    expect(patch?.patch?.payload?.thinking).toBeUndefined();
  });
  it("trims model and thinking on cron edit", async () => {
    const patch = await runCronEditAndGetPatch([
      "--message",
      "hello",
      "--model",
      "  opus  ",
      "--thinking",
      "  high  ",
    ]);
    expect(patch?.patch?.payload?.model).toBe("opus");
    expect(patch?.patch?.payload?.thinking).toBe("high");
  });
  it("sets and clears agent id on cron edit", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--agent", " Ops ", "--message", "hello"], {
      from: "user",
    });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.agentId).toBe("ops");
    resetGatewayMock();
    await program.parseAsync(["cron", "edit", "job-2", "--clear-agent"], {
      from: "user",
    });
    const clearCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const clearPatch = clearCall?.[2];
    expect(clearPatch?.patch?.agentId).toBeNull();
  });
  it("allows model/thinking updates without --message", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--model", "opus", "--thinking", "low"], {
      from: "user",
    });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.payload?.kind).toBe("agentTurn");
    expect(patch?.patch?.payload?.model).toBe("opus");
    expect(patch?.patch?.payload?.thinking).toBe("low");
  });
  it("updates delivery settings without requiring --message", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(
      ["cron", "edit", "job-1", "--deliver", "--channel", "telegram", "--to", "19098680"],
      { from: "user" },
    );
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.payload?.kind).toBe("agentTurn");
    expect(patch?.patch?.delivery?.mode).toBe("announce");
    expect(patch?.patch?.delivery?.channel).toBe("telegram");
    expect(patch?.patch?.delivery?.to).toBe("19098680");
    expect(patch?.patch?.payload?.message).toBeUndefined();
  });
  it("supports --no-deliver on cron edit", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--no-deliver"], { from: "user" });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.payload?.kind).toBe("agentTurn");
    expect(patch?.patch?.delivery?.mode).toBe("none");
  });
  it("does not include undefined delivery fields when updating message", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--message", "Updated message"], {
      from: "user",
    });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.payload?.message).toBe("Updated message");
    expect(patch?.patch?.payload).not.toHaveProperty("deliver");
    expect(patch?.patch?.payload).not.toHaveProperty("channel");
    expect(patch?.patch?.payload).not.toHaveProperty("to");
    expect(patch?.patch?.payload).not.toHaveProperty("bestEffortDeliver");
    expect(patch?.patch).not.toHaveProperty("delivery");
  });
  it("includes delivery fields when explicitly provided with message", async () => {
    const patch = await runCronEditAndGetPatch([
      "--message",
      "Updated message",
      "--deliver",
      "--channel",
      "telegram",
      "--to",
      "19098680",
    ]);
    expect(patch?.patch?.payload?.message).toBe("Updated message");
    expect(patch?.patch?.delivery?.mode).toBe("announce");
    expect(patch?.patch?.delivery?.channel).toBe("telegram");
    expect(patch?.patch?.delivery?.to).toBe("19098680");
  });
  it("includes best-effort delivery when provided with message", async () => {
    const patch = await runCronEditAndGetPatch([
      "--message",
      "Updated message",
      "--best-effort-deliver",
    ]);
    expect(patch?.patch?.payload?.message).toBe("Updated message");
    expect(patch?.patch?.delivery?.mode).toBe("announce");
    expect(patch?.patch?.delivery?.bestEffort).toBe(true);
  });
  it("includes no-best-effort delivery when provided with message", async () => {
    const patch = await runCronEditAndGetPatch([
      "--message",
      "Updated message",
      "--no-best-effort-deliver",
    ]);
    expect(patch?.patch?.payload?.message).toBe("Updated message");
    expect(patch?.patch?.delivery?.mode).toBe("announce");
    expect(patch?.patch?.delivery?.bestEffort).toBe(false);
  });
  it("sets explicit stagger for cron add", async () => {
    const params = await runCronAddAndGetParams([
      "--name",
      "staggered",
      "--cron",
      "0 * * * *",
      "--stagger",
      "45s",
      "--session",
      "main",
      "--system-event",
      "tick",
    ]);
    expect(params?.schedule?.kind).toBe("cron");
    expect(params?.schedule?.staggerMs).toBe(45000);
  });
  it("sets exact cron mode on add", async () => {
    const params = await runCronAddAndGetParams([
      "--name",
      "exact",
      "--cron",
      "0 * * * *",
      "--exact",
      "--session",
      "main",
      "--system-event",
      "tick",
    ]);
    expect(params?.schedule?.kind).toBe("cron");
    expect(params?.schedule?.staggerMs).toBe(0);
  });
  it("rejects --stagger with --exact on add", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await expect(
      program.parseAsync(
        [
          "cron",
          "add",
          "--name",
          "invalid",
          "--cron",
          "0 * * * *",
          "--stagger",
          "1m",
          "--exact",
          "--session",
          "main",
          "--system-event",
          "tick",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("__exit__:1");
  });
  it("rejects --stagger when schedule is not cron", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await expect(
      program.parseAsync(
        [
          "cron",
          "add",
          "--name",
          "invalid",
          "--every",
          "10m",
          "--stagger",
          "30s",
          "--session",
          "main",
          "--system-event",
          "tick",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("__exit__:1");
  });
  it("sets explicit stagger for cron edit", async () => {
    resetGatewayMock();
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--cron", "0 * * * *", "--stagger", "30s"], {
      from: "user",
    });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.schedule?.kind).toBe("cron");
    expect(patch?.patch?.schedule?.staggerMs).toBe(30000);
  });
  it("applies --exact to existing cron job without requiring --cron on edit", async () => {
    resetGatewayMock();
    mockCronEditJobLookup({ kind: "cron", expr: "0 */2 * * *", tz: "UTC", staggerMs: 300000 });
    const program = buildProgram();
    await program.parseAsync(["cron", "edit", "job-1", "--exact"], { from: "user" });
    const updateCall = callGatewayFromCli.mock.calls.find((call) => call[0] === "cron.update");
    const patch = updateCall?.[2];
    expect(patch?.patch?.schedule).toEqual({
      kind: "cron",
      expr: "0 */2 * * *",
      tz: "UTC",
      staggerMs: 0,
    });
  });
  it("rejects --exact on edit when existing job is not cron", async () => {
    resetGatewayMock();
    mockCronEditJobLookup({ kind: "every", everyMs: 60000 });
    const program = buildProgram();
    await expect(
      program.parseAsync(["cron", "edit", "job-1", "--exact"], { from: "user" }),
    ).rejects.toThrow("__exit__:1");
  });
});
