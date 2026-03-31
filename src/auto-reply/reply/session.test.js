import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildModelAliasIndex } from "../../agents/model-selection.js";
import { saveSessionStore } from "../../config/sessions.js";
import { formatZonedTimestamp } from "../../infra/format-time/format-datetime.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "../../infra/system-events.js";
import { applyResetModelOverride } from "./session-reset-model.js";
import { prependSystemEvents } from "./session-updates.js";
import { persistSessionUsageUpdate } from "./session-usage.js";
import { initSessionState } from "./session.js";
vi.mock("../../agents/session-write-lock.js", () => ({
  acquireSessionWriteLock: async () => ({ release: async () => {} }),
}));
vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => [
    { provider: "minimax", id: "m2.1", name: "M2.1" },
    { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
  ]),
}));
let suiteRoot = "";
let suiteCase = 0;
beforeAll(async () => {
  suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-session-suite-"));
});
afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
  suiteRoot = "";
  suiteCase = 0;
});
async function makeCaseDir(prefix) {
  const dir = path.join(suiteRoot, `${prefix}${++suiteCase}`);
  await fs.mkdir(dir);
  return dir;
}
async function makeStorePath(prefix) {
  const root = await makeCaseDir(prefix);
  return path.join(root, "sessions.json");
}
const createStorePath = makeStorePath;
describe("initSessionState thread forking", () => {
  it("forks a new session from the parent session file", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await makeCaseDir("genosos-thread-session-");
    const sessionsDir = path.join(root, "sessions");
    await fs.mkdir(sessionsDir);
    const parentSessionId = "parent-session";
    const parentSessionFile = path.join(sessionsDir, "parent.jsonl");
    const header = {
      type: "session",
      version: 3,
      id: parentSessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    const message = {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Parent prompt" },
    };
    await fs.writeFile(
      parentSessionFile,
      `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`,
      "utf-8",
    );
    const storePath = path.join(root, "sessions.json");
    const parentSessionKey = "agent:default:slack:channel:c1";
    await saveSessionStore(storePath, {
      [parentSessionKey]: {
        sessionId: parentSessionId,
        sessionFile: parentSessionFile,
        updatedAt: Date.now(),
      },
    });
    const cfg = {
      session: { store: storePath },
    };
    const threadSessionKey = "agent:default:slack:channel:c1:thread:123";
    const threadLabel = "Slack thread #general: starter";
    const result = await initSessionState({
      ctx: {
        Body: "Thread reply",
        SessionKey: threadSessionKey,
        ParentSessionKey: parentSessionKey,
        ThreadLabel: threadLabel,
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.sessionKey).toBe(threadSessionKey);
    expect(result.sessionEntry.sessionId).not.toBe(parentSessionId);
    expect(result.sessionEntry.sessionFile).toBeTruthy();
    expect(result.sessionEntry.displayName).toBe(threadLabel);
    const newSessionFile = result.sessionEntry.sessionFile;
    if (!newSessionFile) {
      throw new Error("Missing session file for forked thread");
    }
    const [headerLine] = (await fs.readFile(newSessionFile, "utf-8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    const parsedHeader = JSON.parse(headerLine);
    expect(parsedHeader.parentSession).toBe(parentSessionFile);
    warn.mockRestore();
  });
  it("records topic-specific session files when MessageThreadId is present", async () => {
    const root = await makeCaseDir("genosos-topic-session-");
    const storePath = path.join(root, "sessions.json");
    const cfg = {
      session: { store: storePath },
    };
    const result = await initSessionState({
      ctx: {
        Body: "Hello topic",
        SessionKey: "agent:default:telegram:group:123:topic:456",
        MessageThreadId: 456,
      },
      cfg,
      commandAuthorized: true,
    });
    const sessionFile = result.sessionEntry.sessionFile;
    expect(sessionFile).toBeTruthy();
    expect(path.basename(sessionFile ?? "")).toBe(
      `${result.sessionEntry.sessionId}-topic-456.jsonl`,
    );
  });
});
describe("initSessionState RawBody", () => {
  it("triggerBodyNormalized correctly extracts commands when Body contains context but RawBody is clean", async () => {
    const root = await makeCaseDir("genosos-rawbody-");
    const storePath = path.join(root, "sessions.json");
    const cfg = { session: { store: storePath } };
    const groupMessageCtx = {
      Body: `[Chat messages since your last reply - for context]\n[WhatsApp ...] Someone: hello\n\n[Current message - respond to this]\n[WhatsApp ...] Jake: /status\n[from: Jake McInteer (+6421807830)]`,
      RawBody: "/status",
      ChatType: "group",
      SessionKey: "agent:default:whatsapp:group:g1",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/status");
  });
  it("Reset triggers (/new, /reset) work with RawBody", async () => {
    const root = await makeCaseDir("genosos-rawbody-reset-");
    const storePath = path.join(root, "sessions.json");
    const cfg = { session: { store: storePath } };
    const groupMessageCtx = {
      Body: `[Context]\nJake: /new\n[from: Jake]`,
      RawBody: "/new",
      ChatType: "group",
      SessionKey: "agent:default:whatsapp:group:g1",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.bodyStripped).toBe("");
  });
  it("preserves argument casing while still matching reset triggers case-insensitively", async () => {
    const root = await makeCaseDir("genosos-rawbody-reset-case-");
    const storePath = path.join(root, "sessions.json");
    const cfg = {
      session: {
        store: storePath,
        resetTriggers: ["/new"],
      },
    };
    const ctx = {
      RawBody: "/NEW KeepThisCase",
      ChatType: "direct",
      SessionKey: "agent:default:whatsapp:dm:s1",
    };
    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.bodyStripped).toBe("KeepThisCase");
    expect(result.triggerBodyNormalized).toBe("/NEW KeepThisCase");
  });
  it("falls back to Body when RawBody is undefined", async () => {
    const root = await makeCaseDir("genosos-rawbody-fallback-");
    const storePath = path.join(root, "sessions.json");
    const cfg = { session: { store: storePath } };
    const ctx = {
      Body: "/status",
      SessionKey: "agent:default:whatsapp:dm:s1",
    };
    const result = await initSessionState({
      ctx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/status");
  });
  it("uses the default per-agent sessions store when config store is unset", async () => {
    const root = await makeCaseDir("genosos-session-store-default-");
    const stateDir = path.join(root, ".genosv1");
    const agentId = "worker1";
    const sessionKey = `agent:${agentId}:telegram:12345`;
    const sessionId = "sess-worker-1";
    const sessionFile = path.join(stateDir, "agents", agentId, "sessions", `${sessionId}.jsonl`);
    const storePath = path.join(stateDir, "agents", agentId, "sessions", "sessions.json");
    vi.stubEnv("GENOS_STATE_DIR", stateDir);
    try {
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await saveSessionStore(storePath, {
        [sessionKey]: {
          sessionId,
          sessionFile,
          updatedAt: Date.now(),
        },
      });
      const cfg = {};
      const result = await initSessionState({
        ctx: {
          Body: "hello",
          ChatType: "direct",
          Provider: "telegram",
          Surface: "telegram",
          SessionKey: sessionKey,
        },
        cfg,
        commandAuthorized: true,
      });
      expect(result.sessionEntry.sessionId).toBe(sessionId);
      expect(result.sessionEntry.sessionFile).toBe(sessionFile);
      expect(result.storePath).toBe(storePath);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
describe("initSessionState reset policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("defaults to daily reset at 4am local time", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 0, 0));
    const root = await makeCaseDir("genosos-reset-daily-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:whatsapp:dm:s1";
    const existingSessionId = "daily-session-id";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 3, 0, 0).getTime(),
      },
    });
    const cfg = { session: { store: storePath } };
    const result = await initSessionState({
      ctx: { Body: "hello", SessionKey: sessionKey },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
  });
  it("treats sessions as stale before the daily reset when updated before yesterday's boundary", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 3, 0, 0));
    const root = await makeCaseDir("genosos-reset-daily-edge-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:whatsapp:dm:s-edge";
    const existingSessionId = "daily-edge-session";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 17, 3, 30, 0).getTime(),
      },
    });
    const cfg = { session: { store: storePath } };
    const result = await initSessionState({
      ctx: { Body: "hello", SessionKey: sessionKey },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
  });
  it("expires sessions when idle timeout wins over daily reset", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 30, 0));
    const root = await makeCaseDir("genosos-reset-idle-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:whatsapp:dm:s2";
    const existingSessionId = "idle-session-id";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 4, 45, 0).getTime(),
      },
    });
    const cfg = {
      session: {
        store: storePath,
        reset: { mode: "daily", atHour: 4, idleMinutes: 30 },
      },
    };
    const result = await initSessionState({
      ctx: { Body: "hello", SessionKey: sessionKey },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
  });
  it("uses per-type overrides for thread sessions", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 0, 0));
    const root = await makeCaseDir("genosos-reset-thread-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:slack:channel:c1:thread:123";
    const existingSessionId = "thread-session-id";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 3, 0, 0).getTime(),
      },
    });
    const cfg = {
      session: {
        store: storePath,
        reset: { mode: "daily", atHour: 4 },
        resetByType: { thread: { mode: "idle", idleMinutes: 180 } },
      },
    };
    const result = await initSessionState({
      ctx: { Body: "reply", SessionKey: sessionKey, ThreadLabel: "Slack thread" },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(false);
    expect(result.sessionId).toBe(existingSessionId);
  });
  it("detects thread sessions without thread key suffix", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 0, 0));
    const root = await makeCaseDir("genosos-reset-thread-nosuffix-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:discord:channel:c1";
    const existingSessionId = "thread-nosuffix";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 3, 0, 0).getTime(),
      },
    });
    const cfg = {
      session: {
        store: storePath,
        resetByType: { thread: { mode: "idle", idleMinutes: 180 } },
      },
    };
    const result = await initSessionState({
      ctx: { Body: "reply", SessionKey: sessionKey, ThreadLabel: "Discord thread" },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(false);
    expect(result.sessionId).toBe(existingSessionId);
  });
  it("defaults to daily resets when only resetByType is configured", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 0, 0));
    const root = await makeCaseDir("genosos-reset-type-default-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:whatsapp:dm:s4";
    const existingSessionId = "type-default-session";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 3, 0, 0).getTime(),
      },
    });
    const cfg = {
      session: {
        store: storePath,
        resetByType: { thread: { mode: "idle", idleMinutes: 60 } },
      },
    };
    const result = await initSessionState({
      ctx: { Body: "hello", SessionKey: sessionKey },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
  });
  it("keeps legacy idleMinutes behavior without reset config", async () => {
    vi.setSystemTime(new Date(2026, 0, 18, 5, 0, 0));
    const root = await makeCaseDir("genosos-reset-legacy-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:whatsapp:dm:s3";
    const existingSessionId = "legacy-session-id";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: existingSessionId,
        updatedAt: new Date(2026, 0, 18, 3, 30, 0).getTime(),
      },
    });
    const cfg = {
      session: {
        store: storePath,
        idleMinutes: 240,
      },
    };
    const result = await initSessionState({
      ctx: { Body: "hello", SessionKey: sessionKey },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(false);
    expect(result.sessionId).toBe(existingSessionId);
  });
});
describe("initSessionState channel reset overrides", () => {
  it("uses channel-specific reset policy when configured", async () => {
    const root = await makeCaseDir("genosos-channel-idle-");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:default:discord:dm:123";
    const sessionId = "session-override";
    const updatedAt = Date.now() - 604740000;
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId,
        updatedAt,
      },
    });
    const cfg = {
      session: {
        store: storePath,
        idleMinutes: 60,
        resetByType: { direct: { mode: "idle", idleMinutes: 10 } },
        resetByChannel: { discord: { mode: "idle", idleMinutes: 10080 } },
      },
    };
    const result = await initSessionState({
      ctx: {
        Body: "Hello",
        SessionKey: sessionKey,
        Provider: "discord",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(false);
    expect(result.sessionEntry.sessionId).toBe(sessionId);
  });
});
describe("initSessionState reset triggers in WhatsApp groups", () => {
  async function seedSessionStore(params) {
    await saveSessionStore(params.storePath, {
      [params.sessionKey]: {
        sessionId: params.sessionId,
        updatedAt: Date.now(),
      },
    });
  }
  function makeCfg(params) {
    return {
      session: { store: params.storePath, idleMinutes: 999 },
      channels: {
        whatsapp: {
          allowFrom: params.allowFrom,
          groupPolicy: "open",
        },
      },
    };
  }
  it("Reset trigger /new works for authorized sender in WhatsApp group", async () => {
    const storePath = await createStorePath("genosos-group-reset-");
    const sessionKey = "agent:default:whatsapp:group:120363406150318674@g.us";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = makeCfg({
      storePath,
      allowFrom: ["+41796666864"],
    });
    const groupMessageCtx = {
      Body: `[Chat messages since your last reply - for context]\\n[WhatsApp 120363406150318674@g.us 2026-01-13T07:45Z] Someone: hello\\n\\n[Current message - respond to this]\\n[WhatsApp 120363406150318674@g.us 2026-01-13T07:45Z] Peschi\xF1o: /new\\n[from: Peschi\xF1o (+41796666864)]`,
      RawBody: "/new",
      CommandBody: "/new",
      From: "120363406150318674@g.us",
      To: "+41779241027",
      ChatType: "group",
      SessionKey: sessionKey,
      Provider: "whatsapp",
      Surface: "whatsapp",
      SenderName: "Peschi\xF1o",
      SenderE164: "+41796666864",
      SenderId: "41796666864:0@s.whatsapp.net",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.bodyStripped).toBe("");
  });
  it("Reset trigger /new blocked for unauthorized sender in existing session", async () => {
    const storePath = await createStorePath("genosos-group-reset-unauth-");
    const sessionKey = "agent:default:whatsapp:group:120363406150318674@g.us";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = makeCfg({
      storePath,
      allowFrom: ["+41796666864"],
    });
    const groupMessageCtx = {
      Body: `[Context]\\n[WhatsApp ...] OtherPerson: /new\\n[from: OtherPerson (+1555123456)]`,
      RawBody: "/new",
      CommandBody: "/new",
      From: "120363406150318674@g.us",
      To: "+41779241027",
      ChatType: "group",
      SessionKey: sessionKey,
      Provider: "whatsapp",
      Surface: "whatsapp",
      SenderName: "OtherPerson",
      SenderE164: "+1555123456",
      SenderId: "1555123456:0@s.whatsapp.net",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.sessionId).toBe(existingSessionId);
    expect(result.isNewSession).toBe(false);
  });
  it("Reset trigger works when RawBody is clean but Body has wrapped context", async () => {
    const storePath = await createStorePath("genosos-group-rawbody-");
    const sessionKey = "agent:default:whatsapp:group:g1";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = makeCfg({
      storePath,
      allowFrom: ["*"],
    });
    const groupMessageCtx = {
      Body: `[WhatsApp 120363406150318674@g.us 2026-01-13T07:45Z] Jake: /new\n[from: Jake (+1222)]`,
      RawBody: "/new",
      CommandBody: "/new",
      From: "120363406150318674@g.us",
      To: "+1111",
      ChatType: "group",
      SessionKey: sessionKey,
      Provider: "whatsapp",
      SenderE164: "+1222",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.bodyStripped).toBe("");
  });
  it("Reset trigger /new works when SenderId is LID but SenderE164 is authorized", async () => {
    const storePath = await createStorePath("genosos-group-reset-lid-");
    const sessionKey = "agent:default:whatsapp:group:120363406150318674@g.us";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = makeCfg({
      storePath,
      allowFrom: ["+41796666864"],
    });
    const groupMessageCtx = {
      Body: `[WhatsApp 120363406150318674@g.us 2026-01-13T07:45Z] Owner: /new\n[from: Owner (+41796666864)]`,
      RawBody: "/new",
      CommandBody: "/new",
      From: "120363406150318674@g.us",
      To: "+41779241027",
      ChatType: "group",
      SessionKey: sessionKey,
      Provider: "whatsapp",
      Surface: "whatsapp",
      SenderName: "Owner",
      SenderE164: "+41796666864",
      SenderId: "123@lid",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.bodyStripped).toBe("");
  });
  it("Reset trigger /new blocked when SenderId is LID but SenderE164 is unauthorized", async () => {
    const storePath = await createStorePath("genosos-group-reset-lid-unauth-");
    const sessionKey = "agent:default:whatsapp:group:120363406150318674@g.us";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = makeCfg({
      storePath,
      allowFrom: ["+41796666864"],
    });
    const groupMessageCtx = {
      Body: `[WhatsApp 120363406150318674@g.us 2026-01-13T07:45Z] Other: /new\n[from: Other (+1555123456)]`,
      RawBody: "/new",
      CommandBody: "/new",
      From: "120363406150318674@g.us",
      To: "+41779241027",
      ChatType: "group",
      SessionKey: sessionKey,
      Provider: "whatsapp",
      Surface: "whatsapp",
      SenderName: "Other",
      SenderE164: "+1555123456",
      SenderId: "123@lid",
    };
    const result = await initSessionState({
      ctx: groupMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.sessionId).toBe(existingSessionId);
    expect(result.isNewSession).toBe(false);
  });
});
describe("initSessionState reset triggers in Slack channels", () => {
  async function seedSessionStore(params) {
    await saveSessionStore(params.storePath, {
      [params.sessionKey]: {
        sessionId: params.sessionId,
        updatedAt: Date.now(),
      },
    });
  }
  it("Reset trigger /reset works when Slack message has a leading <@...> mention token", async () => {
    const storePath = await createStorePath("genosos-slack-channel-reset-");
    const sessionKey = "agent:default:slack:channel:c1";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const channelMessageCtx = {
      Body: "<@U123> /reset",
      RawBody: "<@U123> /reset",
      CommandBody: "<@U123> /reset",
      From: "slack:channel:C1",
      To: "channel:C1",
      ChatType: "channel",
      SessionKey: sessionKey,
      Provider: "slack",
      Surface: "slack",
      SenderId: "U123",
      SenderName: "Owner",
    };
    const result = await initSessionState({
      ctx: channelMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.bodyStripped).toBe("");
  });
  it("Reset trigger /new preserves args when Slack message has a leading <@...> mention token", async () => {
    const storePath = await createStorePath("genosos-slack-channel-new-");
    const sessionKey = "agent:default:slack:channel:c2";
    const existingSessionId = "existing-session-123";
    await seedSessionStore({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
    });
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const channelMessageCtx = {
      Body: "<@U123> /new take notes",
      RawBody: "<@U123> /new take notes",
      CommandBody: "<@U123> /new take notes",
      From: "slack:channel:C2",
      To: "channel:C2",
      ChatType: "channel",
      SessionKey: sessionKey,
      Provider: "slack",
      Surface: "slack",
      SenderId: "U123",
      SenderName: "Owner",
    };
    const result = await initSessionState({
      ctx: channelMessageCtx,
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.bodyStripped).toBe("take notes");
  });
});
describe("applyResetModelOverride", () => {
  it("selects a model hint and strips it from the body", async () => {
    const cfg = {};
    const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: "openai" });
    const sessionEntry = {
      sessionId: "s1",
      updatedAt: Date.now(),
    };
    const sessionStore = { "agent:default:dm:1": sessionEntry };
    const sessionCtx = { BodyStripped: "minimax summarize" };
    const ctx = { ChatType: "direct" };
    await applyResetModelOverride({
      cfg,
      resetTriggered: true,
      bodyStripped: "minimax summarize",
      sessionCtx,
      ctx,
      sessionEntry,
      sessionStore,
      sessionKey: "agent:default:dm:1",
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      aliasIndex,
    });
    expect(sessionEntry.providerOverride).toBe("minimax");
    expect(sessionEntry.modelOverride).toBe("m2.1");
    expect(sessionCtx.BodyStripped).toBe("summarize");
  });
  it("clears auth profile overrides when reset applies a model", async () => {
    const cfg = {};
    const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: "openai" });
    const sessionEntry = {
      sessionId: "s1",
      updatedAt: Date.now(),
      authProfileOverride: "anthropic:default",
      authProfileOverrideSource: "user",
      authProfileOverrideCompactionCount: 2,
    };
    const sessionStore = { "agent:default:dm:1": sessionEntry };
    const sessionCtx = { BodyStripped: "minimax summarize" };
    const ctx = { ChatType: "direct" };
    await applyResetModelOverride({
      cfg,
      resetTriggered: true,
      bodyStripped: "minimax summarize",
      sessionCtx,
      ctx,
      sessionEntry,
      sessionStore,
      sessionKey: "agent:default:dm:1",
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      aliasIndex,
    });
    expect(sessionEntry.authProfileOverride).toBeUndefined();
    expect(sessionEntry.authProfileOverrideSource).toBeUndefined();
    expect(sessionEntry.authProfileOverrideCompactionCount).toBeUndefined();
  });
  it("skips when resetTriggered is false", async () => {
    const cfg = {};
    const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider: "openai" });
    const sessionEntry = {
      sessionId: "s1",
      updatedAt: Date.now(),
    };
    const sessionStore = { "agent:default:dm:1": sessionEntry };
    const sessionCtx = { BodyStripped: "minimax summarize" };
    const ctx = { ChatType: "direct" };
    await applyResetModelOverride({
      cfg,
      resetTriggered: false,
      bodyStripped: "minimax summarize",
      sessionCtx,
      ctx,
      sessionEntry,
      sessionStore,
      sessionKey: "agent:default:dm:1",
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      aliasIndex,
    });
    expect(sessionEntry.providerOverride).toBeUndefined();
    expect(sessionEntry.modelOverride).toBeUndefined();
    expect(sessionCtx.BodyStripped).toBe("minimax summarize");
  });
});
describe("initSessionState preserves behavior overrides across /new and /reset", () => {
  async function seedSessionStoreWithOverrides(params) {
    await saveSessionStore(params.storePath, {
      [params.sessionKey]: {
        sessionId: params.sessionId,
        updatedAt: Date.now(),
        ...params.overrides,
      },
    });
  }
  it("/new preserves verboseLevel from previous session", async () => {
    const storePath = await createStorePath("genosos-reset-verbose-");
    const sessionKey = "agent:default:telegram:dm:user1";
    const existingSessionId = "existing-session-verbose";
    await seedSessionStoreWithOverrides({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
      overrides: { verboseLevel: "on" },
    });
    await fs.writeFile(
      path.join(path.dirname(storePath), `${existingSessionId}.jsonl`),
      "",
      "utf-8",
    );
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const result = await initSessionState({
      ctx: {
        Body: "/new",
        RawBody: "/new",
        CommandBody: "/new",
        From: "user1",
        To: "bot",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "telegram",
        Surface: "telegram",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.sessionEntry.verboseLevel).toBe("on");
  });
  it("/reset preserves thinkingLevel and reasoningLevel from previous session", async () => {
    const storePath = await createStorePath("genosos-reset-thinking-");
    const sessionKey = "agent:default:telegram:dm:user2";
    const existingSessionId = "existing-session-thinking";
    await seedSessionStoreWithOverrides({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
      overrides: { thinkingLevel: "high", reasoningLevel: "low" },
    });
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const result = await initSessionState({
      ctx: {
        Body: "/reset",
        RawBody: "/reset",
        CommandBody: "/reset",
        From: "user2",
        To: "bot",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "telegram",
        Surface: "telegram",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.sessionEntry.thinkingLevel).toBe("high");
    expect(result.sessionEntry.reasoningLevel).toBe("low");
  });
  it("/new in a new session does not preserve overrides", async () => {
    const storePath = await createStorePath("genosos-new-no-preserve-");
    const sessionKey = "agent:default:telegram:dm:user3";
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const result = await initSessionState({
      ctx: {
        Body: "/new",
        RawBody: "/new",
        CommandBody: "/new",
        From: "user3",
        To: "bot",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "telegram",
        Surface: "telegram",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.sessionEntry.verboseLevel).toBeUndefined();
    expect(result.sessionEntry.thinkingLevel).toBeUndefined();
  });
  it("archives the old session store entry on /new", async () => {
    const storePath = await createStorePath("genosos-archive-old-");
    const sessionKey = "agent:default:telegram:dm:user-archive";
    const existingSessionId = "existing-session-archive";
    await seedSessionStoreWithOverrides({
      storePath,
      sessionKey,
      sessionId: existingSessionId,
      overrides: { verboseLevel: "on" },
    });
    const sessionUtils = await import("../../gateway/session-utils.fs.js");
    const archiveSpy = vi.spyOn(sessionUtils, "archiveSessionTranscripts");
    const cfg = {
      session: { store: storePath, idleMinutes: 999 },
    };
    const result = await initSessionState({
      ctx: {
        Body: "/new",
        RawBody: "/new",
        CommandBody: "/new",
        From: "user-archive",
        To: "bot",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "telegram",
        Surface: "telegram",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(archiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: existingSessionId,
        storePath,
        reason: "reset",
      }),
    );
    archiveSpy.mockRestore();
  });
  it("idle-based new session does NOT preserve overrides (no entry to read)", async () => {
    const storePath = await createStorePath("genosos-idle-no-preserve-");
    const sessionKey = "agent:default:telegram:dm:new-user";
    const cfg = {
      session: { store: storePath, idleMinutes: 0 },
    };
    const result = await initSessionState({
      ctx: {
        Body: "hello",
        RawBody: "hello",
        CommandBody: "hello",
        From: "new-user",
        To: "bot",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "telegram",
        Surface: "telegram",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(false);
    expect(result.sessionEntry.verboseLevel).toBeUndefined();
    expect(result.sessionEntry.thinkingLevel).toBeUndefined();
  });
});
describe("prependSystemEvents", () => {
  it("adds a local timestamp to queued system events by default", async () => {
    vi.useFakeTimers();
    try {
      const timestamp = new Date("2026-01-12T20:19:17Z");
      const expectedTimestamp = formatZonedTimestamp(timestamp, { displaySeconds: true });
      vi.setSystemTime(timestamp);
      enqueueSystemEvent("Model switched.", { sessionKey: "agent:default:main" });
      const result = await prependSystemEvents({
        cfg: {},
        sessionKey: "agent:default:main",
        isMainSession: false,
        isNewSession: false,
        prefixedBodyBase: "User: hi",
      });
      expect(expectedTimestamp).toBeDefined();
      expect(result).toContain(`System: [${expectedTimestamp}] Model switched.`);
    } finally {
      resetSystemEventsForTest();
      vi.useRealTimers();
    }
  });
});
describe("persistSessionUsageUpdate", () => {
  async function seedSessionStore(params) {
    await fs.mkdir(path.dirname(params.storePath), { recursive: true });
    await fs.writeFile(
      params.storePath,
      JSON.stringify({ [params.sessionKey]: params.entry }, null, 2),
      "utf-8",
    );
  }
  it("uses lastCallUsage for totalTokens when provided", async () => {
    const storePath = await createStorePath("genosos-usage-");
    const sessionKey = "main";
    await seedSessionStore({
      storePath,
      sessionKey,
      entry: { sessionId: "s1", updatedAt: Date.now(), totalTokens: 1e5 },
    });
    const accumulatedUsage = { input: 180000, output: 1e4, total: 190000 };
    const lastCallUsage = { input: 12000, output: 2000, total: 14000 };
    await persistSessionUsageUpdate({
      storePath,
      sessionKey,
      usage: accumulatedUsage,
      lastCallUsage,
      contextTokensUsed: 200000,
    });
    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].totalTokens).toBe(12000);
    expect(stored[sessionKey].totalTokensFresh).toBe(true);
    expect(stored[sessionKey].inputTokens).toBe(180000);
    expect(stored[sessionKey].outputTokens).toBe(1e4);
  });
  it("marks totalTokens as unknown when no fresh context snapshot is available", async () => {
    const storePath = await createStorePath("genosos-usage-");
    const sessionKey = "main";
    await seedSessionStore({
      storePath,
      sessionKey,
      entry: { sessionId: "s1", updatedAt: Date.now() },
    });
    await persistSessionUsageUpdate({
      storePath,
      sessionKey,
      usage: { input: 50000, output: 5000, total: 55000 },
      contextTokensUsed: 200000,
    });
    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].totalTokens).toBeUndefined();
    expect(stored[sessionKey].totalTokensFresh).toBe(false);
  });
  it("uses promptTokens when available without lastCallUsage", async () => {
    const storePath = await createStorePath("genosos-usage-");
    const sessionKey = "main";
    await seedSessionStore({
      storePath,
      sessionKey,
      entry: { sessionId: "s1", updatedAt: Date.now() },
    });
    await persistSessionUsageUpdate({
      storePath,
      sessionKey,
      usage: { input: 50000, output: 5000, total: 55000 },
      promptTokens: 42000,
      contextTokensUsed: 200000,
    });
    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].totalTokens).toBe(42000);
    expect(stored[sessionKey].totalTokensFresh).toBe(true);
  });
  it("keeps non-clamped lastCallUsage totalTokens when exceeding context window", async () => {
    const storePath = await createStorePath("genosos-usage-");
    const sessionKey = "main";
    await seedSessionStore({
      storePath,
      sessionKey,
      entry: { sessionId: "s1", updatedAt: Date.now() },
    });
    await persistSessionUsageUpdate({
      storePath,
      sessionKey,
      usage: { input: 300000, output: 1e4, total: 310000 },
      lastCallUsage: { input: 250000, output: 5000, total: 255000 },
      contextTokensUsed: 200000,
    });
    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].totalTokens).toBe(250000);
    expect(stored[sessionKey].totalTokensFresh).toBe(true);
  });
});
describe("initSessionState stale threadId fallback", () => {
  async function seedSessionStore(params) {
    await fs.mkdir(path.dirname(params.storePath), { recursive: true });
    await fs.writeFile(
      params.storePath,
      JSON.stringify({ [params.sessionKey]: params.entry }, null, 2),
      "utf-8",
    );
  }
  it("ignores persisted lastThreadId on main sessions for non-thread messages", async () => {
    const storePath = await createStorePath("stale-main-thread-");
    const sessionKey = "agent:default:main";
    await seedSessionStore({
      storePath,
      sessionKey,
      entry: {
        sessionId: "s1",
        updatedAt: Date.now(),
        lastChannel: "telegram",
        lastTo: "telegram:123",
        lastThreadId: 42,
        deliveryContext: {
          channel: "telegram",
          to: "telegram:123",
          threadId: 42,
        },
      },
    });
    const cfg = { session: { store: storePath } };
    const result = await initSessionState({
      ctx: {
        Body: "hello from DM",
        SessionKey: sessionKey,
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.sessionEntry.lastThreadId).toBeUndefined();
    expect(result.sessionEntry.deliveryContext?.threadId).toBeUndefined();
  });
  it("does not inherit lastThreadId from a previous thread interaction in non-thread sessions", async () => {
    const storePath = await createStorePath("stale-thread-");
    const cfg = { session: { store: storePath } };
    const threadResult = await initSessionState({
      ctx: {
        Body: "hello from topic",
        SessionKey: "agent:default:main:thread:42",
        MessageThreadId: 42,
      },
      cfg,
      commandAuthorized: true,
    });
    expect(threadResult.sessionEntry.lastThreadId).toBe(42);
    const mainResult = await initSessionState({
      ctx: {
        Body: "hello from DM",
        SessionKey: "agent:default:main",
      },
      cfg,
      commandAuthorized: true,
    });
    expect(mainResult.sessionEntry.lastThreadId).toBeUndefined();
  });
  it("preserves lastThreadId within the same thread session", async () => {
    const storePath = await createStorePath("preserve-thread-");
    const cfg = { session: { store: storePath } };
    await initSessionState({
      ctx: {
        Body: "first",
        SessionKey: "agent:default:main:thread:99",
        MessageThreadId: 99,
      },
      cfg,
      commandAuthorized: true,
    });
    const result = await initSessionState({
      ctx: {
        Body: "second",
        SessionKey: "agent:default:main:thread:99",
        MessageThreadId: 99,
      },
      cfg,
      commandAuthorized: true,
    });
    expect(result.sessionEntry.lastThreadId).toBe(99);
  });
});
