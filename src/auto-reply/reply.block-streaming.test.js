let createEmbeddedReply = function (text) {
    return {
      payloads: [{ text }],
      meta: {
        durationMs: 5,
        agentMeta: { sessionId: "s", provider: "p", model: "m" },
      },
    };
  },
  createTelegramMessage = function (messageSid) {
    return {
      Body: "ping",
      From: "+1004",
      To: "+2000",
      MessageSid: messageSid,
      Provider: "telegram",
    };
  },
  createReplyConfig = function (home, streamMode) {
    return {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-5" },
          workspace: path.join(home, "genosos"),
        },
      },
      channels: { telegram: { allowFrom: ["*"], streamMode } },
      session: { store: path.join(home, "sessions.json") },
    };
  };
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { withTempHome as withTempHomeHarness } from "../config/home-env.test-harness.js";
import { getReplyFromConfig } from "./reply.js";
const piEmbeddedMock = vi.hoisted(() => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key) => `session:${key.trim() || "main"}`,
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
}));
vi.mock("/src/agents/pi-embedded.js", () => piEmbeddedMock);
vi.mock("../agents/pi-embedded.js", () => piEmbeddedMock);
vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));
async function runTelegramReply(params) {
  return getReplyFromConfig(
    createTelegramMessage(params.messageSid),
    {
      onReplyStart: params.onReplyStart,
      onBlockReply: params.onBlockReply,
      disableBlockStreaming: params.disableBlockStreaming,
    },
    createReplyConfig(params.home, params.streamMode),
  );
}
async function withTempHome(fn) {
  return withTempHomeHarness("genosos-stream-", async (home) => {
    await fs.mkdir(path.join(home, ".genosv1", "agents", "main", "sessions"), { recursive: true });
    return fn(home);
  });
}
describe("block streaming", () => {
  beforeEach(() => {
    vi.stubEnv("GENOS_TEST_FAST", "1");
    piEmbeddedMock.abortEmbeddedPiRun.mockReset().mockReturnValue(false);
    piEmbeddedMock.queueEmbeddedPiMessage.mockReset().mockReturnValue(false);
    piEmbeddedMock.isEmbeddedPiRunActive.mockReset().mockReturnValue(false);
    piEmbeddedMock.isEmbeddedPiRunStreaming.mockReset().mockReturnValue(false);
    piEmbeddedMock.runEmbeddedPiAgent.mockReset();
    vi.mocked(loadModelCatalog).mockResolvedValue([
      { id: "claude-opus-4-5", name: "Opus 4.5", provider: "anthropic" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" },
    ]);
  });
  it("handles ordering, timeout fallback, and telegram streamMode block", async () => {
    await withTempHome(async (home) => {
      let releaseTyping;
      const typingGate = new Promise((resolve) => {
        releaseTyping = resolve;
      });
      let resolveOnReplyStart;
      const onReplyStartCalled = new Promise((resolve) => {
        resolveOnReplyStart = resolve;
      });
      const onReplyStart = vi.fn(() => {
        resolveOnReplyStart?.();
        return typingGate;
      });
      const seen = [];
      const onBlockReply = vi.fn(async (payload) => {
        seen.push(payload.text ?? "");
      });
      const impl = async (params) => {
        params.onBlockReply?.({ text: "first" });
        params.onBlockReply?.({ text: "second" });
        return {
          payloads: [{ text: "first" }, { text: "second" }],
          meta: createEmbeddedReply("first").meta,
        };
      };
      piEmbeddedMock.runEmbeddedPiAgent.mockImplementation(impl);
      const replyPromise = runTelegramReply({
        home,
        messageSid: "msg-123",
        onReplyStart,
        onBlockReply,
        disableBlockStreaming: false,
      });
      await onReplyStartCalled;
      releaseTyping?.();
      const res = await replyPromise;
      expect(res).toBeUndefined();
      expect(seen).toEqual(["first\n\nsecond"]);
      const onBlockReplyStreamMode = vi.fn().mockResolvedValue(undefined);
      piEmbeddedMock.runEmbeddedPiAgent.mockImplementation(async () =>
        createEmbeddedReply("final"),
      );
      const resStreamMode = await runTelegramReply({
        home,
        messageSid: "msg-127",
        onBlockReply: onBlockReplyStreamMode,
        streamMode: "block",
      });
      const streamPayload = Array.isArray(resStreamMode) ? resStreamMode[0] : resStreamMode;
      expect(streamPayload?.text).toBe("final");
      expect(onBlockReplyStreamMode).not.toHaveBeenCalled();
    });
  });
  it("trims leading whitespace in block-streamed replies", async () => {
    await withTempHome(async (home) => {
      const seen = [];
      const onBlockReply = vi.fn(async (payload) => {
        seen.push(payload.text ?? "");
      });
      piEmbeddedMock.runEmbeddedPiAgent.mockImplementation(async (params) => {
        params.onBlockReply?.({ text: "\n\n  Hello from stream" });
        return createEmbeddedReply("\n\n  Hello from stream");
      });
      const res = await runTelegramReply({
        home,
        messageSid: "msg-128",
        onBlockReply,
        disableBlockStreaming: false,
      });
      expect(res).toBeUndefined();
      expect(onBlockReply).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(["Hello from stream"]);
    });
  });
  it("still parses media directives for direct block payloads", async () => {
    await withTempHome(async (home) => {
      const onBlockReply = vi.fn();
      piEmbeddedMock.runEmbeddedPiAgent.mockImplementation(async (params) => {
        params.onBlockReply?.({ text: "Result\nMEDIA: ./image.png" });
        return createEmbeddedReply("Result\nMEDIA: ./image.png");
      });
      const res = await runTelegramReply({
        home,
        messageSid: "msg-129",
        onBlockReply,
        disableBlockStreaming: false,
      });
      expect(res).toBeUndefined();
      expect(onBlockReply).toHaveBeenCalledTimes(1);
      expect(onBlockReply.mock.calls[0][0]).toMatchObject({
        text: "Result",
        mediaUrls: ["./image.png"],
      });
    });
  });
});
