let setup = function (config) {
  const methods = new Map();
  const tools = [];
  plugin.register({
    id: "voice-call",
    name: "Voice Call",
    description: "test",
    version: "0",
    source: "test",
    config: {},
    pluginConfig: config,
    runtime: { tts: { textToSpeechTelephony: vi.fn() } },
    logger: noopLogger,
    registerGatewayMethod: (method, handler) => methods.set(method, handler),
    registerTool: (tool) => tools.push(tool),
    registerCli: () => {},
    registerService: () => {},
    resolvePath: (p) => p,
  });
  return { methods, tools };
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let runtimeStub;
vi.mock("../../extensions/voice-call/src/runtime.js", () => ({
  createVoiceCallRuntime: vi.fn(async () => runtimeStub),
}));
import plugin from "../../extensions/voice-call/index.js";
const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
async function registerVoiceCallCli(program) {
  const { register } = plugin;
  await register({
    id: "voice-call",
    name: "Voice Call",
    description: "test",
    version: "0",
    source: "test",
    config: {},
    pluginConfig: { provider: "mock" },
    runtime: { tts: { textToSpeechTelephony: vi.fn() } },
    logger: noopLogger,
    registerGatewayMethod: () => {},
    registerTool: () => {},
    registerCli: (fn) =>
      fn({
        program,
        config: {},
        workspaceDir: undefined,
        logger: noopLogger,
      }),
    registerService: () => {},
    resolvePath: (p) => p,
  });
}
describe("voice-call plugin", () => {
  beforeEach(() => {
    runtimeStub = {
      config: { toNumber: "+15550001234" },
      manager: {
        initiateCall: vi.fn(async () => ({ callId: "call-1", success: true })),
        continueCall: vi.fn(async () => ({
          success: true,
          transcript: "hello",
        })),
        speak: vi.fn(async () => ({ success: true })),
        endCall: vi.fn(async () => ({ success: true })),
        getCall: vi.fn((id) => (id === "call-1" ? { callId: "call-1" } : undefined)),
        getCallByProviderCallId: vi.fn(() => {
          return;
        }),
      },
      stop: vi.fn(async () => {}),
    };
  });
  afterEach(() => vi.restoreAllMocks());
  it("registers gateway methods", () => {
    const { methods } = setup({ provider: "mock" });
    expect(methods.has("voicecall.initiate")).toBe(true);
    expect(methods.has("voicecall.continue")).toBe(true);
    expect(methods.has("voicecall.speak")).toBe(true);
    expect(methods.has("voicecall.end")).toBe(true);
    expect(methods.has("voicecall.status")).toBe(true);
    expect(methods.has("voicecall.start")).toBe(true);
  });
  it("initiates a call via voicecall.initiate", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.initiate");
    const respond = vi.fn();
    await handler?.({ params: { message: "Hi" }, respond });
    expect(runtimeStub.manager.initiateCall).toHaveBeenCalled();
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.callId).toBe("call-1");
  });
  it("returns call status", async () => {
    const { methods } = setup({ provider: "mock" });
    const handler = methods.get("voicecall.status");
    const respond = vi.fn();
    await handler?.({ params: { callId: "call-1" }, respond });
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.found).toBe(true);
  });
  it("tool get_status returns json payload", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = tools[0];
    const result = await tool.execute("id", {
      action: "get_status",
      callId: "call-1",
    });
    expect(result.details.found).toBe(true);
  });
  it("legacy tool status without sid returns error payload", async () => {
    const { tools } = setup({ provider: "mock" });
    const tool = tools[0];
    const result = await tool.execute("id", { mode: "status" });
    expect(String(result.details.error)).toContain("sid required");
  });
  it("CLI latency summarizes turn metrics from JSONL", async () => {
    const program = new Command();
    const tmpFile = path.join(os.tmpdir(), `voicecall-latency-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmpFile,
      [
        JSON.stringify({ metadata: { lastTurnLatencyMs: 100, lastTurnListenWaitMs: 70 } }),
        JSON.stringify({ metadata: { lastTurnLatencyMs: 200, lastTurnListenWaitMs: 110 } }),
      ].join("\n") + "\n",
      "utf8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await registerVoiceCallCli(program);
      await program.parseAsync(["voicecall", "latency", "--file", tmpFile, "--last", "10"], {
        from: "user",
      });
      expect(logSpy).toHaveBeenCalled();
      const printed = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
      expect(printed).toContain('"recordsScanned": 2');
      expect(printed).toContain('"p50Ms": 100');
      expect(printed).toContain('"p95Ms": 200');
    } finally {
      logSpy.mockRestore();
      fs.unlinkSync(tmpFile);
    }
  });
  it("CLI start prints JSON", async () => {
    const program = new Command();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await registerVoiceCallCli(program);
    await program.parseAsync(["voicecall", "start", "--to", "+1", "--message", "Hello"], {
      from: "user",
    });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
