import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "../../../extensions/telegram/src/channel.js";
import { whatsappPlugin } from "../../../extensions/whatsapp/src/channel.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import {
  ackDelivery,
  computeBackoffMs,
  enqueueDelivery,
  failDelivery,
  loadPendingDeliveries,
  MAX_RETRIES,
  moveToFailed,
  recoverPendingDeliveries,
} from "./delivery-queue.js";
import { DirectoryCache } from "./directory-cache.js";
import { buildOutboundResultEnvelope } from "./envelope.js";
import {
  buildOutboundDeliveryJson,
  formatGatewaySummary,
  formatOutboundDeliverySummary,
} from "./format.js";
import {
  applyCrossContextDecoration,
  buildCrossContextDecoration,
  enforceCrossContextPolicy,
} from "./outbound-policy.js";
import { resolveOutboundSessionRoute } from "./outbound-session.js";
import {
  formatOutboundPayloadLog,
  normalizeOutboundPayloads,
  normalizeOutboundPayloadsForJson,
} from "./payloads.js";
import { resolveOutboundTarget } from "./targets.js";
describe("delivery-queue", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-dq-test-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  describe("enqueue + ack lifecycle", () => {
    it("creates and removes a queue entry", async () => {
      const id = await enqueueDelivery(
        {
          channel: "whatsapp",
          to: "+1555",
          payloads: [{ text: "hello" }],
          bestEffort: true,
          gifPlayback: true,
          silent: true,
          mirror: {
            sessionKey: "agent:default:main",
            text: "hello",
            mediaUrls: ["https://example.com/file.png"],
          },
        },
        tmpDir,
      );
      const queueDir = path.join(tmpDir, "delivery-queue");
      const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${id}.json`);
      const entry = JSON.parse(fs.readFileSync(path.join(queueDir, files[0]), "utf-8"));
      expect(entry).toMatchObject({
        id,
        channel: "whatsapp",
        to: "+1555",
        bestEffort: true,
        gifPlayback: true,
        silent: true,
        mirror: {
          sessionKey: "agent:default:main",
          text: "hello",
          mediaUrls: ["https://example.com/file.png"],
        },
        retryCount: 0,
      });
      expect(entry.payloads).toEqual([{ text: "hello" }]);
      await ackDelivery(id, tmpDir);
      const remaining = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
      expect(remaining).toHaveLength(0);
    });
    it("ack is idempotent (no error on missing file)", async () => {
      await expect(ackDelivery("nonexistent-id", tmpDir)).resolves.toBeUndefined();
    });
  });
  describe("failDelivery", () => {
    it("increments retryCount and sets lastError", async () => {
      const id = await enqueueDelivery(
        {
          channel: "telegram",
          to: "123",
          payloads: [{ text: "test" }],
        },
        tmpDir,
      );
      await failDelivery(id, "connection refused", tmpDir);
      const queueDir = path.join(tmpDir, "delivery-queue");
      const entry = JSON.parse(fs.readFileSync(path.join(queueDir, `${id}.json`), "utf-8"));
      expect(entry.retryCount).toBe(1);
      expect(entry.lastError).toBe("connection refused");
    });
  });
  describe("moveToFailed", () => {
    it("moves entry to failed/ subdirectory", async () => {
      const id = await enqueueDelivery(
        {
          channel: "slack",
          to: "#general",
          payloads: [{ text: "hi" }],
        },
        tmpDir,
      );
      await moveToFailed(id, tmpDir);
      const queueDir = path.join(tmpDir, "delivery-queue");
      const failedDir = path.join(queueDir, "failed");
      expect(fs.existsSync(path.join(queueDir, `${id}.json`))).toBe(false);
      expect(fs.existsSync(path.join(failedDir, `${id}.json`))).toBe(true);
    });
  });
  describe("loadPendingDeliveries", () => {
    it("returns empty array when queue directory does not exist", async () => {
      const nonexistent = path.join(tmpDir, "no-such-dir");
      const entries = await loadPendingDeliveries(nonexistent);
      expect(entries).toEqual([]);
    });
    it("loads multiple entries", async () => {
      await enqueueDelivery({ channel: "whatsapp", to: "+1", payloads: [{ text: "a" }] }, tmpDir);
      await enqueueDelivery({ channel: "telegram", to: "2", payloads: [{ text: "b" }] }, tmpDir);
      const entries = await loadPendingDeliveries(tmpDir);
      expect(entries).toHaveLength(2);
    });
  });
  describe("computeBackoffMs", () => {
    it("returns 0 for retryCount 0", () => {
      expect(computeBackoffMs(0)).toBe(0);
    });
    it("returns correct backoff for each retry", () => {
      expect(computeBackoffMs(1)).toBe(5000);
      expect(computeBackoffMs(2)).toBe(25000);
      expect(computeBackoffMs(3)).toBe(120000);
      expect(computeBackoffMs(4)).toBe(600000);
      expect(computeBackoffMs(5)).toBe(600000);
    });
  });
  describe("recoverPendingDeliveries", () => {
    const noopDelay = async () => {};
    const baseCfg = {};
    const createLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    const enqueueCrashRecoveryEntries = async () => {
      await enqueueDelivery({ channel: "whatsapp", to: "+1", payloads: [{ text: "a" }] }, tmpDir);
      await enqueueDelivery({ channel: "telegram", to: "2", payloads: [{ text: "b" }] }, tmpDir);
    };
    const runRecovery = async ({
      deliver,
      log = createLog(),
      delay = noopDelay,
      maxRecoveryMs,
    }) => {
      const result = await recoverPendingDeliveries({
        deliver,
        log,
        cfg: baseCfg,
        stateDir: tmpDir,
        delay,
        ...(maxRecoveryMs === undefined ? {} : { maxRecoveryMs }),
      });
      return { result, log };
    };
    it("recovers entries from a simulated crash", async () => {
      await enqueueCrashRecoveryEntries();
      const deliver = vi.fn().mockResolvedValue([]);
      const { result } = await runRecovery({ deliver });
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(result.recovered).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      const remaining = await loadPendingDeliveries(tmpDir);
      expect(remaining).toHaveLength(0);
    });
    it("moves entries that exceeded max retries to failed/", async () => {
      const id = await enqueueDelivery(
        { channel: "whatsapp", to: "+1", payloads: [{ text: "a" }] },
        tmpDir,
      );
      const filePath = path.join(tmpDir, "delivery-queue", `${id}.json`);
      const entry = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      entry.retryCount = MAX_RETRIES;
      fs.writeFileSync(filePath, JSON.stringify(entry), "utf-8");
      const deliver = vi.fn();
      const { result } = await runRecovery({ deliver });
      expect(deliver).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      const failedDir = path.join(tmpDir, "delivery-queue", "failed");
      expect(fs.existsSync(path.join(failedDir, `${id}.json`))).toBe(true);
    });
    it("increments retryCount on failed recovery attempt", async () => {
      await enqueueDelivery({ channel: "slack", to: "#ch", payloads: [{ text: "x" }] }, tmpDir);
      const deliver = vi.fn().mockRejectedValue(new Error("network down"));
      const { result } = await runRecovery({ deliver });
      expect(result.failed).toBe(1);
      expect(result.recovered).toBe(0);
      const entries = await loadPendingDeliveries(tmpDir);
      expect(entries).toHaveLength(1);
      expect(entries[0].retryCount).toBe(1);
      expect(entries[0].lastError).toBe("network down");
    });
    it("passes skipQueue: true to prevent re-enqueueing during recovery", async () => {
      await enqueueDelivery({ channel: "whatsapp", to: "+1", payloads: [{ text: "a" }] }, tmpDir);
      const deliver = vi.fn().mockResolvedValue([]);
      await runRecovery({ deliver });
      expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ skipQueue: true }));
    });
    it("replays stored delivery options during recovery", async () => {
      await enqueueDelivery(
        {
          channel: "whatsapp",
          to: "+1",
          payloads: [{ text: "a" }],
          bestEffort: true,
          gifPlayback: true,
          silent: true,
          mirror: {
            sessionKey: "agent:default:main",
            text: "a",
            mediaUrls: ["https://example.com/a.png"],
          },
        },
        tmpDir,
      );
      const deliver = vi.fn().mockResolvedValue([]);
      await runRecovery({ deliver });
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          bestEffort: true,
          gifPlayback: true,
          silent: true,
          mirror: {
            sessionKey: "agent:default:main",
            text: "a",
            mediaUrls: ["https://example.com/a.png"],
          },
        }),
      );
    });
    it("respects maxRecoveryMs time budget", async () => {
      await enqueueCrashRecoveryEntries();
      await enqueueDelivery({ channel: "slack", to: "#c", payloads: [{ text: "c" }] }, tmpDir);
      const deliver = vi.fn().mockResolvedValue([]);
      const { result, log } = await runRecovery({
        deliver,
        maxRecoveryMs: 0,
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(result.recovered).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      const remaining = await loadPendingDeliveries(tmpDir);
      expect(remaining).toHaveLength(3);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("deferred to next restart"));
    });
    it("defers entries when backoff exceeds the recovery budget", async () => {
      const id = await enqueueDelivery(
        { channel: "whatsapp", to: "+1", payloads: [{ text: "a" }] },
        tmpDir,
      );
      const filePath = path.join(tmpDir, "delivery-queue", `${id}.json`);
      const entry = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      entry.retryCount = 3;
      fs.writeFileSync(filePath, JSON.stringify(entry), "utf-8");
      const deliver = vi.fn().mockResolvedValue([]);
      const delay = vi.fn(async () => {});
      const { result, log } = await runRecovery({
        deliver,
        delay,
        maxRecoveryMs: 1000,
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(delay).not.toHaveBeenCalled();
      expect(result).toEqual({ recovered: 0, failed: 0, skipped: 0 });
      const remaining = await loadPendingDeliveries(tmpDir);
      expect(remaining).toHaveLength(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("deferred to next restart"));
    });
    it("returns zeros when queue is empty", async () => {
      const deliver = vi.fn();
      const { result } = await runRecovery({ deliver });
      expect(result).toEqual({ recovered: 0, failed: 0, skipped: 0 });
      expect(deliver).not.toHaveBeenCalled();
    });
  });
});
describe("DirectoryCache", () => {
  const cfg = {};
  afterEach(() => {
    vi.useRealTimers();
  });
  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const cache = new DirectoryCache(1000, 10);
    cache.set("a", "value-a", cfg);
    expect(cache.get("a", cfg)).toBe("value-a");
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    expect(cache.get("a", cfg)).toBeUndefined();
  });
  it("evicts oldest keys when max size is exceeded", () => {
    const cache = new DirectoryCache(60000, 2);
    cache.set("a", "value-a", cfg);
    cache.set("b", "value-b", cfg);
    cache.set("c", "value-c", cfg);
    expect(cache.get("a", cfg)).toBeUndefined();
    expect(cache.get("b", cfg)).toBe("value-b");
    expect(cache.get("c", cfg)).toBe("value-c");
  });
  it("refreshes insertion order on key updates", () => {
    const cache = new DirectoryCache(60000, 2);
    cache.set("a", "value-a", cfg);
    cache.set("b", "value-b", cfg);
    cache.set("a", "value-a2", cfg);
    cache.set("c", "value-c", cfg);
    expect(cache.get("a", cfg)).toBe("value-a2");
    expect(cache.get("b", cfg)).toBeUndefined();
    expect(cache.get("c", cfg)).toBe("value-c");
  });
});
describe("buildOutboundResultEnvelope", () => {
  it("flattens delivery-only payloads by default", () => {
    const delivery = {
      channel: "whatsapp",
      via: "gateway",
      to: "+1",
      messageId: "m1",
      mediaUrl: null,
    };
    expect(buildOutboundResultEnvelope({ delivery })).toEqual(delivery);
  });
  it("keeps payloads and meta in the envelope", () => {
    const envelope = buildOutboundResultEnvelope({
      payloads: [{ text: "hi", mediaUrl: null, mediaUrls: undefined }],
      meta: { foo: "bar" },
    });
    expect(envelope).toEqual({
      payloads: [{ text: "hi", mediaUrl: null, mediaUrls: undefined }],
      meta: { foo: "bar" },
    });
  });
  it("includes delivery when payloads are present", () => {
    const delivery = {
      channel: "telegram",
      via: "direct",
      to: "123",
      messageId: "m2",
      mediaUrl: null,
      chatId: "c1",
    };
    const envelope = buildOutboundResultEnvelope({
      payloads: [],
      delivery,
      meta: { ok: true },
    });
    expect(envelope).toEqual({
      payloads: [],
      meta: { ok: true },
      delivery,
    });
  });
  it("can keep delivery wrapped when requested", () => {
    const delivery = {
      channel: "discord",
      via: "gateway",
      to: "channel:C1",
      messageId: "m3",
      mediaUrl: null,
      channelId: "C1",
    };
    const envelope = buildOutboundResultEnvelope({
      delivery,
      flattenDelivery: false,
    });
    expect(envelope).toEqual({ delivery });
  });
});
describe("formatOutboundDeliverySummary", () => {
  it("falls back when result is missing", () => {
    expect(formatOutboundDeliverySummary("telegram")).toBe(
      "\u2705 Sent via Telegram. Message ID: unknown",
    );
    expect(formatOutboundDeliverySummary("imessage")).toBe(
      "\u2705 Sent via iMessage. Message ID: unknown",
    );
  });
  it("adds chat or channel details", () => {
    expect(
      formatOutboundDeliverySummary("telegram", {
        channel: "telegram",
        messageId: "m1",
        chatId: "c1",
      }),
    ).toBe("\u2705 Sent via Telegram. Message ID: m1 (chat c1)");
    expect(
      formatOutboundDeliverySummary("discord", {
        channel: "discord",
        messageId: "d1",
        channelId: "chan",
      }),
    ).toBe("\u2705 Sent via Discord. Message ID: d1 (channel chan)");
  });
});
describe("buildOutboundDeliveryJson", () => {
  it("builds direct delivery payloads", () => {
    expect(
      buildOutboundDeliveryJson({
        channel: "telegram",
        to: "123",
        result: { channel: "telegram", messageId: "m1", chatId: "c1" },
        mediaUrl: "https://example.com/a.png",
      }),
    ).toEqual({
      channel: "telegram",
      via: "direct",
      to: "123",
      messageId: "m1",
      mediaUrl: "https://example.com/a.png",
      chatId: "c1",
    });
  });
  it("supports whatsapp metadata when present", () => {
    expect(
      buildOutboundDeliveryJson({
        channel: "whatsapp",
        to: "+1",
        result: { channel: "whatsapp", messageId: "w1", toJid: "jid" },
      }),
    ).toEqual({
      channel: "whatsapp",
      via: "direct",
      to: "+1",
      messageId: "w1",
      mediaUrl: null,
      toJid: "jid",
    });
  });
  it("keeps timestamp for signal", () => {
    expect(
      buildOutboundDeliveryJson({
        channel: "signal",
        to: "+1",
        result: { channel: "signal", messageId: "s1", timestamp: 123 },
      }),
    ).toEqual({
      channel: "signal",
      via: "direct",
      to: "+1",
      messageId: "s1",
      mediaUrl: null,
      timestamp: 123,
    });
  });
});
describe("formatGatewaySummary", () => {
  it("formats gateway summaries with channel", () => {
    expect(formatGatewaySummary({ channel: "whatsapp", messageId: "m1" })).toBe(
      "\u2705 Sent via gateway (whatsapp). Message ID: m1",
    );
  });
  it("supports custom actions", () => {
    expect(
      formatGatewaySummary({
        action: "Poll sent",
        channel: "discord",
        messageId: "p1",
      }),
    ).toBe("\u2705 Poll sent via gateway (discord). Message ID: p1");
  });
});
const slackConfig = {
  channels: {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    },
  },
};
const discordConfig = {
  channels: {
    discord: {},
  },
};
describe("outbound policy", () => {
  it("allows cross-provider sends when enabled", () => {
    const cfg = {
      ...slackConfig,
      tools: {
        message: { crossContext: { allowAcrossProviders: true } },
      },
    };
    expect(() =>
      enforceCrossContextPolicy({
        cfg,
        channel: "telegram",
        action: "send",
        args: { to: "telegram:@ops" },
        toolContext: { currentChannelId: "C12345678", currentChannelProvider: "slack" },
      }),
    ).not.toThrow();
  });
  it("uses components when available and preferred", async () => {
    const decoration = await buildCrossContextDecoration({
      cfg: discordConfig,
      channel: "discord",
      target: "123",
      toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
    });
    expect(decoration).not.toBeNull();
    const applied = applyCrossContextDecoration({
      message: "hello",
      decoration,
      preferComponents: true,
    });
    expect(applied.usedComponents).toBe(true);
    expect(applied.componentsBuilder).toBeDefined();
    expect(applied.componentsBuilder?.("hello").length).toBeGreaterThan(0);
    expect(applied.message).toBe("hello");
  });
});
describe("resolveOutboundSessionRoute", () => {
  const baseConfig = {};
  it("builds Slack thread session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "slack",
      agentId: "main",
      target: "channel:C123",
      replyToId: "456",
    });
    expect(route?.sessionKey).toBe("agent:default:slack:channel:c123:thread:456");
    expect(route?.from).toBe("slack:channel:C123");
    expect(route?.to).toBe("channel:C123");
    expect(route?.threadId).toBe("456");
  });
  it("uses Telegram topic ids in group session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "telegram",
      agentId: "main",
      target: "-100123456:topic:42",
    });
    expect(route?.sessionKey).toBe("agent:default:telegram:group:-100123456:topic:42");
    expect(route?.from).toBe("telegram:group:-100123456:topic:42");
    expect(route?.to).toBe("telegram:-100123456");
    expect(route?.threadId).toBe(42);
  });
  it("treats Telegram usernames as DMs when unresolved", async () => {
    const cfg = { session: { dmScope: "per-channel-peer" } };
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "telegram",
      agentId: "main",
      target: "@alice",
    });
    expect(route?.sessionKey).toBe("agent:default:telegram:direct:@alice");
    expect(route?.chatType).toBe("direct");
  });
  it("honors dmScope identity links", async () => {
    const cfg = {
      session: {
        dmScope: "per-peer",
        identityLinks: {
          alice: ["discord:123"],
        },
      },
    };
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "discord",
      agentId: "main",
      target: "user:123",
    });
    expect(route?.sessionKey).toBe("agent:default:direct:alice");
  });
  it("strips chat_* prefixes for BlueBubbles group session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "bluebubbles",
      agentId: "main",
      target: "chat_guid:ABC123",
    });
    expect(route?.sessionKey).toBe("agent:default:bluebubbles:group:abc123");
    expect(route?.from).toBe("group:ABC123");
  });
  it("treats Zalo Personal DM targets as direct sessions", async () => {
    const cfg = { session: { dmScope: "per-channel-peer" } };
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "zalouser",
      agentId: "main",
      target: "123456",
    });
    expect(route?.sessionKey).toBe("agent:default:zalouser:direct:123456");
    expect(route?.chatType).toBe("direct");
  });
  it("uses group session keys for Slack mpim allowlist entries", async () => {
    const cfg = {
      channels: {
        slack: {
          dm: {
            groupChannels: ["G123"],
          },
        },
      },
    };
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "slack",
      agentId: "main",
      target: "channel:G123",
    });
    expect(route?.sessionKey).toBe("agent:default:slack:group:g123");
    expect(route?.from).toBe("slack:group:G123");
  });
});
describe("normalizeOutboundPayloadsForJson", () => {
  it("normalizes payloads with mediaUrl and mediaUrls", () => {
    expect(
      normalizeOutboundPayloadsForJson([
        { text: "hi" },
        { text: "photo", mediaUrl: "https://x.test/a.jpg" },
        { text: "multi", mediaUrls: ["https://x.test/1.png"] },
      ]),
    ).toEqual([
      { text: "hi", mediaUrl: null, mediaUrls: undefined, channelData: undefined },
      {
        text: "photo",
        mediaUrl: "https://x.test/a.jpg",
        mediaUrls: ["https://x.test/a.jpg"],
        channelData: undefined,
      },
      {
        text: "multi",
        mediaUrl: null,
        mediaUrls: ["https://x.test/1.png"],
        channelData: undefined,
      },
    ]);
  });
  it("keeps mediaUrl null for multi MEDIA tags", () => {
    expect(
      normalizeOutboundPayloadsForJson([
        {
          text: "MEDIA:https://x.test/a.png\nMEDIA:https://x.test/b.png",
        },
      ]),
    ).toEqual([
      {
        text: "",
        mediaUrl: null,
        mediaUrls: ["https://x.test/a.png", "https://x.test/b.png"],
        channelData: undefined,
      },
    ]);
  });
});
describe("normalizeOutboundPayloads", () => {
  it("keeps channelData-only payloads", () => {
    const channelData = { line: { flexMessage: { altText: "Card", contents: {} } } };
    const normalized = normalizeOutboundPayloads([{ channelData }]);
    expect(normalized).toEqual([{ text: "", mediaUrls: [], channelData }]);
  });
});
describe("formatOutboundPayloadLog", () => {
  it("trims trailing text and appends media lines", () => {
    expect(
      formatOutboundPayloadLog({
        text: "hello  ",
        mediaUrls: ["https://x.test/a.png", "https://x.test/b.png"],
      }),
    ).toBe("hello\nMEDIA:https://x.test/a.png\nMEDIA:https://x.test/b.png");
  });
  it("logs media-only payloads", () => {
    expect(
      formatOutboundPayloadLog({
        text: "",
        mediaUrls: ["https://x.test/a.png"],
      }),
    ).toBe("MEDIA:https://x.test/a.png");
  });
});
describe("resolveOutboundTarget", () => {
  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "whatsapp", plugin: whatsappPlugin, source: "test" },
        { pluginId: "telegram", plugin: telegramPlugin, source: "test" },
      ]),
    );
  });
  afterEach(() => {
    setActivePluginRegistry(createTestRegistry());
  });
  it("rejects whatsapp with empty target even when allowFrom configured", () => {
    const cfg = {
      channels: { whatsapp: { allowFrom: ["+1555"] } },
    };
    const res = resolveOutboundTarget({
      channel: "whatsapp",
      to: "",
      cfg,
      mode: "explicit",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("WhatsApp");
    }
  });
  it.each([
    {
      name: "normalizes whatsapp target when provided",
      input: { channel: "whatsapp", to: " (555) 123-4567 " },
      expected: { ok: true, to: "+5551234567" },
    },
    {
      name: "keeps whatsapp group targets",
      input: { channel: "whatsapp", to: "120363401234567890@g.us" },
      expected: { ok: true, to: "120363401234567890@g.us" },
    },
    {
      name: "normalizes prefixed/uppercase whatsapp group targets",
      input: {
        channel: "whatsapp",
        to: " WhatsApp:120363401234567890@G.US ",
      },
      expected: { ok: true, to: "120363401234567890@g.us" },
    },
    {
      name: "rejects whatsapp with empty target and allowFrom (no silent fallback)",
      input: { channel: "whatsapp", to: "", allowFrom: ["+1555"] },
      expectedErrorIncludes: "WhatsApp",
    },
    {
      name: "rejects whatsapp with empty target and prefixed allowFrom (no silent fallback)",
      input: {
        channel: "whatsapp",
        to: "",
        allowFrom: ["whatsapp:(555) 123-4567"],
      },
      expectedErrorIncludes: "WhatsApp",
    },
    {
      name: "rejects invalid whatsapp target",
      input: { channel: "whatsapp", to: "wat" },
      expectedErrorIncludes: "WhatsApp",
    },
    {
      name: "rejects whatsapp without to when allowFrom missing",
      input: { channel: "whatsapp", to: " " },
      expectedErrorIncludes: "WhatsApp",
    },
    {
      name: "rejects whatsapp allowFrom fallback when invalid",
      input: { channel: "whatsapp", to: "", allowFrom: ["wat"] },
      expectedErrorIncludes: "WhatsApp",
    },
  ])("$name", ({ input, expected, expectedErrorIncludes }) => {
    const res = resolveOutboundTarget(input);
    if (expected) {
      expect(res).toEqual(expected);
      return;
    }
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain(expectedErrorIncludes);
    }
  });
  it("rejects telegram with missing target", () => {
    const res = resolveOutboundTarget({ channel: "telegram", to: " " });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("Telegram");
    }
  });
  it("rejects webchat delivery", () => {
    const res = resolveOutboundTarget({ channel: "webchat", to: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("WebChat");
    }
  });
});
