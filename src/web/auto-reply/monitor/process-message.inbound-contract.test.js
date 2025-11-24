let makeProcessMessageArgs = function (params) {
  return {
    cfg: params.cfg ?? { messages: {}, session: { store: sessionStorePath } },
    msg: params.msg,
    route: {
      agentId: "main",
      accountId: "default",
      sessionKey: params.routeSessionKey,
    },
    groupHistoryKey: params.groupHistoryKey,
    groupHistories: params.groupHistories ?? new Map(),
    groupMemberNames: new Map(),
    connectionId: "conn",
    verbose: false,
    maxMediaBytes: 1,
    replyResolver: async () => {
      return;
    },
    replyLogger: defaultReplyLogger,
    backgroundTasks,
    rememberSentText: (_text, _opts) => {},
    echoHas: () => false,
    echoForget: () => {},
    buildCombinedEchoKey: () => "echo",
    ...(params.groupHistory ? { groupHistory: params.groupHistory } : {}),
  };
};
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectInboundContextContract } from "../../../../test/helpers/inbound-contract.js";
let capturedCtx;
let capturedDispatchParams;
let sessionDir;
let sessionStorePath;
let backgroundTasks;
const defaultReplyLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
vi.mock("../../../auto-reply/reply/provider-dispatcher.js", () => ({
  dispatchReplyWithBufferedBlockDispatcher: vi.fn(async (params) => {
    capturedDispatchParams = params;
    capturedCtx = params.ctx;
    return { queuedFinal: false };
  }),
}));
vi.mock("./last-route.js", () => ({
  trackBackgroundTask: (tasks, task) => {
    tasks.add(task);
    task.finally(() => {
      tasks.delete(task);
    });
  },
  updateLastRouteInBackground: vi.fn(),
}));
import { processMessage } from "./process-message.js";
describe("web processMessage inbound contract", () => {
  beforeEach(async () => {
    capturedCtx = undefined;
    capturedDispatchParams = undefined;
    backgroundTasks = new Set();
    sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-process-message-"));
    sessionStorePath = path.join(sessionDir, "sessions.json");
  });
  afterEach(async () => {
    await Promise.allSettled(Array.from(backgroundTasks));
    if (sessionDir) {
      await fs.rm(sessionDir, { recursive: true, force: true });
      sessionDir = undefined;
    }
  });
  it("passes a finalized MsgContext to the dispatcher", async () => {
    await processMessage(
      makeProcessMessageArgs({
        routeSessionKey: "agent:main:whatsapp:group:123",
        groupHistoryKey: "123@g.us",
        groupHistory: [],
        msg: {
          id: "msg1",
          from: "123@g.us",
          to: "+15550001111",
          chatType: "group",
          body: "hi",
          senderName: "Alice",
          senderJid: "alice@s.whatsapp.net",
          senderE164: "+15550002222",
          groupSubject: "Test Group",
          groupParticipants: [],
        },
      }),
    );
    expect(capturedCtx).toBeTruthy();
    expectInboundContextContract(capturedCtx);
  });
  it("falls back SenderId to SenderE164 when senderJid is empty", async () => {
    capturedCtx = undefined;
    await processMessage(
      makeProcessMessageArgs({
        routeSessionKey: "agent:main:whatsapp:direct:+1000",
        groupHistoryKey: "+1000",
        msg: {
          id: "msg1",
          from: "+1000",
          to: "+2000",
          chatType: "direct",
          body: "hi",
          senderJid: "",
          senderE164: "+1000",
        },
      }),
    );
    expect(capturedCtx).toBeTruthy();
    const ctx = capturedCtx;
    expect(ctx.SenderId).toBe("+1000");
    expect(ctx.SenderE164).toBe("+1000");
    expect(ctx.OriginatingChannel).toBe("whatsapp");
    expect(ctx.OriginatingTo).toBe("+1000");
    expect(ctx.To).toBe("+2000");
    expect(ctx.OriginatingTo).not.toBe(ctx.To);
  });
  it("defaults responsePrefix to identity name in self-chats when unset", async () => {
    capturedDispatchParams = undefined;
    await processMessage(
      makeProcessMessageArgs({
        routeSessionKey: "agent:main:whatsapp:direct:+1555",
        groupHistoryKey: "+1555",
        cfg: {
          agents: {
            list: [
              {
                id: "main",
                default: true,
                identity: { name: "Mainbot", emoji: "\uD83E\uDD9E", theme: "space lobster" },
              },
            ],
          },
          messages: {},
          session: { store: sessionStorePath },
        },
        msg: {
          id: "msg1",
          from: "+1555",
          to: "+1555",
          selfE164: "+1555",
          chatType: "direct",
          body: "hi",
        },
      }),
    );
    const dispatcherOptions = capturedDispatchParams?.dispatcherOptions;
    expect(dispatcherOptions?.responsePrefix).toBe("[Mainbot]");
  });
  it("clears pending group history when the dispatcher does not queue a final reply", async () => {
    capturedCtx = undefined;
    const groupHistories = new Map([
      [
        "whatsapp:default:group:123@g.us",
        [
          {
            sender: "Alice (+111)",
            body: "first",
          },
        ],
      ],
    ]);
    await processMessage(
      makeProcessMessageArgs({
        routeSessionKey: "agent:main:whatsapp:group:123@g.us",
        groupHistoryKey: "whatsapp:default:group:123@g.us",
        groupHistories,
        cfg: {
          messages: {},
          session: { store: sessionStorePath },
        },
        msg: {
          id: "g1",
          from: "123@g.us",
          conversationId: "123@g.us",
          to: "+2000",
          chatType: "group",
          chatId: "123@g.us",
          body: "second",
          senderName: "Bob",
          senderE164: "+222",
          selfE164: "+999",
          sendComposing: async () => {},
          reply: async () => {},
          sendMedia: async () => {},
        },
      }),
    );
    expect(groupHistories.get("whatsapp:default:group:123@g.us") ?? []).toHaveLength(0);
  });
});
