import "./test-helpers.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import * as ssrf from "../infra/net/ssrf.js";
import { resetLogger, setLoggerOverride } from "../logging.js";
import {
  resetBaileysMocks as _resetBaileysMocks,
  resetLoadConfigMock as _resetLoadConfigMock,
} from "./test-helpers.js";
export { resetBaileysMocks, resetLoadConfigMock, setLoadConfigMock } from "./test-helpers.js";
export const TEST_NET_IP = "203.0.113.10";
vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key) => `session:${key.trim() || "main"}`,
}));
export async function rmDirWithRetries(dir, opts) {
  const attempts = opts?.attempts ?? 10;
  const delayMs = opts?.delayMs ?? 5;
  try {
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: attempts,
      retryDelay: delayMs,
    });
    return;
  } catch {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        return;
      } catch (retryErr) {
        const code =
          retryErr && typeof retryErr === "object" && "code" in retryErr
            ? String(retryErr.code)
            : null;
        if (code === "ENOTEMPTY" || code === "EBUSY" || code === "EPERM") {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw retryErr;
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}
let previousHome;
let tempHome;
let tempHomeRoot;
let tempHomeId = 0;
export function installWebAutoReplyTestHomeHooks() {
  beforeAll(async () => {
    tempHomeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-web-home-suite-"));
  });
  beforeEach(async () => {
    resetInboundDedupe();
    previousHome = process.env.HOME;
    tempHome = path.join(tempHomeRoot ?? os.tmpdir(), `case-${++tempHomeId}`);
    await fs.mkdir(tempHome, { recursive: true });
    process.env.HOME = tempHome;
  });
  afterEach(async () => {
    process.env.HOME = previousHome;
    tempHome = undefined;
  });
  afterAll(async () => {
    if (tempHomeRoot) {
      await rmDirWithRetries(tempHomeRoot);
      tempHomeRoot = undefined;
    }
    tempHomeId = 0;
  });
}
export async function makeSessionStore(entries = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-session-"));
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(storePath, JSON.stringify(entries));
  const cleanup = async () => {
    await rmDirWithRetries(dir);
  };
  return {
    storePath,
    cleanup,
  };
}
export function installWebAutoReplyUnitTestHooks(opts) {
  let resolvePinnedHostnameSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBaileysMocks();
    _resetLoadConfigMock();
    if (opts?.pinDns) {
      resolvePinnedHostnameSpy = vi
        .spyOn(ssrf, "resolvePinnedHostname")
        .mockImplementation(async (hostname) => {
          const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
          const addresses = [TEST_NET_IP];
          return {
            hostname: normalized,
            addresses,
            lookup: ssrf.createPinnedLookup({ hostname: normalized, addresses }),
          };
        });
    }
  });
  afterEach(() => {
    resolvePinnedHostnameSpy?.mockRestore();
    resolvePinnedHostnameSpy = undefined;
    resetLogger();
    setLoggerOverride(null);
    vi.useRealTimers();
  });
}
export function createWebListenerFactoryCapture() {
  let capturedOnMessage;
  const listenerFactory = async (opts) => {
    capturedOnMessage = opts.onMessage;
    return { close: vi.fn() };
  };
  return {
    listenerFactory,
    getOnMessage: () => capturedOnMessage,
  };
}
export function createMockWebListener() {
  return {
    close: vi.fn(async () => {
      return;
    }),
    onClose: new Promise(() => {}),
    signalClose: vi.fn(),
    sendMessage: vi.fn(async () => ({ messageId: "msg-1" })),
    sendPoll: vi.fn(async () => ({ messageId: "poll-1" })),
    sendReaction: vi.fn(async () => {
      return;
    }),
    sendComposingTo: vi.fn(async () => {
      return;
    }),
  };
}
export function createWebInboundDeliverySpies() {
  return {
    sendMedia: vi.fn(),
    reply: vi.fn().mockResolvedValue(undefined),
    sendComposing: vi.fn(),
  };
}
export async function sendWebGroupInboundMessage(params) {
  const conversationId = params.conversationId ?? "123@g.us";
  const accountId = params.accountId ?? "default";
  await params.onMessage({
    body: params.body,
    from: conversationId,
    conversationId,
    chatId: conversationId,
    chatType: "group",
    to: "+2",
    accountId,
    id: params.id,
    senderE164: params.senderE164,
    senderName: params.senderName,
    mentionedJids: params.mentionedJids,
    selfE164: params.selfE164,
    selfJid: params.selfJid,
    sendComposing: params.spies.sendComposing,
    reply: params.spies.reply,
    sendMedia: params.spies.sendMedia,
  });
}
export async function sendWebDirectInboundMessage(params) {
  const accountId = params.accountId ?? "default";
  await params.onMessage({
    accountId,
    id: params.id,
    from: params.from,
    conversationId: params.from,
    to: params.to,
    body: params.body,
    timestamp: Date.now(),
    chatType: "direct",
    chatId: `direct:${params.from}`,
    sendComposing: params.spies.sendComposing,
    reply: params.spies.reply,
    sendMedia: params.spies.sendMedia,
  });
}
