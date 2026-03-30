let mockTelegramFileDownload = function (params) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => params.contentType },
      arrayBuffer: async () => params.bytes.buffer,
    });
  },
  mockTelegramPngDownload = function () {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    });
  };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ssrf from "../infra/net/ssrf.js";
import { onSpy, sendChatActionSpy } from "./bot.media.e2e-harness.js";
const cacheStickerSpy = vi.fn();
const getCachedStickerSpy = vi.fn();
const describeStickerImageSpy = vi.fn();
const resolvePinnedHostname = ssrf.resolvePinnedHostname;
const lookupMock = vi.fn();
let resolvePinnedHostnameSpy = null;
const TELEGRAM_TEST_TIMINGS = {
  mediaGroupFlushMs: 20,
  textFragmentGapMs: 30,
};
async function createBotHandler() {
  return createBotHandlerWithOptions({});
}
async function createBotHandlerWithOptions(options) {
  const { createTelegramBot } = await import("./bot.js");
  const replyModule = await import("../auto-reply/reply.js");
  const replySpy = replyModule.__replySpy;
  onSpy.mockReset();
  replySpy.mockReset();
  sendChatActionSpy.mockReset();
  const runtimeError = options.runtimeError ?? vi.fn();
  const runtimeLog = options.runtimeLog ?? vi.fn();
  createTelegramBot({
    token: "tok",
    testTimings: TELEGRAM_TEST_TIMINGS,
    ...(options.proxyFetch ? { proxyFetch: options.proxyFetch } : {}),
    runtime: {
      log: runtimeLog,
      error: runtimeError,
      exit: () => {
        throw new Error("exit");
      },
    },
  });
  const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1];
  expect(handler).toBeDefined();
  return { handler, replySpy, runtimeError };
}
beforeEach(() => {
  vi.useRealTimers();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  resolvePinnedHostnameSpy = vi
    .spyOn(ssrf, "resolvePinnedHostname")
    .mockImplementation((hostname) => resolvePinnedHostname(hostname, lookupMock));
});
afterEach(() => {
  lookupMock.mockReset();
  resolvePinnedHostnameSpy?.mockRestore();
  resolvePinnedHostnameSpy = null;
});
vi.mock("./sticker-cache.js", () => ({
  cacheSticker: (...args) => cacheStickerSpy(...args),
  getCachedSticker: (...args) => getCachedStickerSpy(...args),
  describeStickerImage: (...args) => describeStickerImageSpy(...args),
}));
describe("telegram inbound media", () => {
  const INBOUND_MEDIA_TEST_TIMEOUT_MS = process.platform === "win32" ? 120000 : 90000;
  it(
    "downloads media via file_path (no file.download)",
    async () => {
      const { handler, replySpy, runtimeError } = await createBotHandler();
      const fetchSpy = mockTelegramFileDownload({
        contentType: "image/jpeg",
        bytes: new Uint8Array([255, 216, 255, 0]),
      });
      await handler({
        message: {
          message_id: 1,
          chat: { id: 1234, type: "private" },
          photo: [{ file_id: "fid" }],
          date: 1736380800,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "photos/1.jpg" }),
      });
      expect(runtimeError).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.telegram.org/file/bottok/photos/1.jpg",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(replySpy).toHaveBeenCalledTimes(1);
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Body).toContain("<media:image>");
      fetchSpy.mockRestore();
    },
    INBOUND_MEDIA_TEST_TIMEOUT_MS,
  );
  it("prefers proxyFetch over global fetch", async () => {
    const runtimeLog = vi.fn();
    const runtimeError = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("global fetch should not be called");
    });
    const proxyFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer,
    });
    const { handler } = await createBotHandlerWithOptions({
      proxyFetch,
      runtimeLog,
      runtimeError,
    });
    await handler({
      message: {
        message_id: 2,
        chat: { id: 1234, type: "private" },
        photo: [{ file_id: "fid" }],
      },
      me: { username: "genosos_bot" },
      getFile: async () => ({ file_path: "photos/2.jpg" }),
    });
    expect(runtimeError).not.toHaveBeenCalled();
    expect(proxyFetch).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bottok/photos/2.jpg",
      expect.objectContaining({ redirect: "manual" }),
    );
    globalFetchSpy.mockRestore();
  });
  it("logs a handler error when getFile returns no file_path", async () => {
    const runtimeLog = vi.fn();
    const runtimeError = vi.fn();
    const { handler, replySpy } = await createBotHandlerWithOptions({
      runtimeLog,
      runtimeError,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await handler({
      message: {
        message_id: 3,
        chat: { id: 1234, type: "private" },
        photo: [{ file_id: "fid" }],
      },
      me: { username: "genosos_bot" },
      getFile: async () => ({}),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
    expect(runtimeError).toHaveBeenCalledTimes(1);
    const msg = String(runtimeError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("handler failed:");
    expect(msg).toContain("file_path");
    fetchSpy.mockRestore();
  });
});
describe("telegram media groups", () => {
  afterEach(() => {
    vi.clearAllTimers();
  });
  const MEDIA_GROUP_TEST_TIMEOUT_MS = process.platform === "win32" ? 45000 : 20000;
  const MEDIA_GROUP_FLUSH_MS = TELEGRAM_TEST_TIMINGS.mediaGroupFlushMs + 60;
  it(
    "buffers messages with same media_group_id and processes them together",
    async () => {
      const runtimeError = vi.fn();
      const { handler, replySpy } = await createBotHandlerWithOptions({ runtimeError });
      const fetchSpy = mockTelegramPngDownload();
      const first = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 1,
          caption: "Here are my photos",
          date: 1736380800,
          media_group_id: "album123",
          photo: [{ file_id: "photo1" }],
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "photos/photo1.jpg" }),
      });
      const second = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 2,
          date: 1736380801,
          media_group_id: "album123",
          photo: [{ file_id: "photo2" }],
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "photos/photo2.jpg" }),
      });
      await first;
      await second;
      expect(replySpy).not.toHaveBeenCalled();
      await vi.waitFor(
        () => {
          expect(replySpy).toHaveBeenCalledTimes(1);
        },
        { timeout: MEDIA_GROUP_FLUSH_MS * 2, interval: 10 },
      );
      expect(runtimeError).not.toHaveBeenCalled();
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Body).toContain("Here are my photos");
      expect(payload.MediaPaths).toHaveLength(2);
      fetchSpy.mockRestore();
    },
    MEDIA_GROUP_TEST_TIMEOUT_MS,
  );
  it(
    "processes separate media groups independently",
    async () => {
      const { handler, replySpy } = await createBotHandler();
      const fetchSpy = mockTelegramPngDownload();
      const first = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 1,
          caption: "Album A",
          date: 1736380800,
          media_group_id: "albumA",
          photo: [{ file_id: "photoA1" }],
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "photos/photoA1.jpg" }),
      });
      const second = handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 2,
          caption: "Album B",
          date: 1736380801,
          media_group_id: "albumB",
          photo: [{ file_id: "photoB1" }],
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "photos/photoB1.jpg" }),
      });
      await Promise.all([first, second]);
      expect(replySpy).not.toHaveBeenCalled();
      await vi.waitFor(
        () => {
          expect(replySpy).toHaveBeenCalledTimes(2);
        },
        { timeout: MEDIA_GROUP_FLUSH_MS * 2, interval: 10 },
      );
      fetchSpy.mockRestore();
    },
    MEDIA_GROUP_TEST_TIMEOUT_MS,
  );
});
describe("telegram stickers", () => {
  const STICKER_TEST_TIMEOUT_MS = process.platform === "win32" ? 30000 : 20000;
  beforeEach(() => {
    cacheStickerSpy.mockReset();
    getCachedStickerSpy.mockReset();
    describeStickerImageSpy.mockReset();
  });
  it(
    "downloads static sticker (WEBP) and includes sticker metadata",
    async () => {
      const { handler, replySpy, runtimeError } = await createBotHandler();
      const fetchSpy = mockTelegramFileDownload({
        contentType: "image/webp",
        bytes: new Uint8Array([82, 73, 70, 70]),
      });
      await handler({
        message: {
          message_id: 100,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "sticker_file_id_123",
            file_unique_id: "sticker_unique_123",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: false,
            emoji: "\uD83C\uDF89",
            set_name: "TestStickerPack",
          },
          date: 1736380800,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "stickers/sticker.webp" }),
      });
      expect(runtimeError).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.telegram.org/file/bottok/stickers/sticker.webp",
        expect.objectContaining({ redirect: "manual" }),
      );
      expect(replySpy).toHaveBeenCalledTimes(1);
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Body).toContain("<media:sticker>");
      expect(payload.Sticker?.emoji).toBe("\uD83C\uDF89");
      expect(payload.Sticker?.setName).toBe("TestStickerPack");
      expect(payload.Sticker?.fileId).toBe("sticker_file_id_123");
      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );
  it(
    "refreshes cached sticker metadata on cache hit",
    async () => {
      const { handler, replySpy, runtimeError } = await createBotHandler();
      getCachedStickerSpy.mockReturnValue({
        fileId: "old_file_id",
        fileUniqueId: "sticker_unique_456",
        emoji: "\uD83D\uDE34",
        setName: "OldSet",
        description: "Cached description",
        cachedAt: "2026-01-20T10:00:00.000Z",
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "image/webp" },
        arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer,
      });
      await handler({
        message: {
          message_id: 103,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "new_file_id",
            file_unique_id: "sticker_unique_456",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: false,
            emoji: "\uD83D\uDD25",
            set_name: "NewSet",
          },
          date: 1736380800,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "stickers/sticker.webp" }),
      });
      expect(runtimeError).not.toHaveBeenCalled();
      expect(cacheStickerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: "new_file_id",
          emoji: "\uD83D\uDD25",
          setName: "NewSet",
        }),
      );
      const payload = replySpy.mock.calls[0][0];
      expect(payload.Sticker?.fileId).toBe("new_file_id");
      expect(payload.Sticker?.cachedDescription).toBe("Cached description");
      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );
  it(
    "skips animated stickers (TGS format)",
    async () => {
      const { handler, replySpy, runtimeError } = await createBotHandler();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await handler({
        message: {
          message_id: 101,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "animated_sticker_id",
            file_unique_id: "animated_unique",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: true,
            is_video: false,
            emoji: "\uD83D\uDE0E",
            set_name: "AnimatedPack",
          },
          date: 1736380800,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "stickers/animated.tgs" }),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(replySpy).not.toHaveBeenCalled();
      expect(runtimeError).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );
  it(
    "skips video stickers (WEBM format)",
    async () => {
      const { handler, replySpy, runtimeError } = await createBotHandler();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await handler({
        message: {
          message_id: 102,
          chat: { id: 1234, type: "private" },
          sticker: {
            file_id: "video_sticker_id",
            file_unique_id: "video_unique",
            type: "regular",
            width: 512,
            height: 512,
            is_animated: false,
            is_video: true,
            emoji: "\uD83C\uDFAC",
            set_name: "VideoPack",
          },
          date: 1736380800,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({ file_path: "stickers/video.webm" }),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(replySpy).not.toHaveBeenCalled();
      expect(runtimeError).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
    STICKER_TEST_TIMEOUT_MS,
  );
});
describe("telegram text fragments", () => {
  afterEach(() => {
    vi.clearAllTimers();
  });
  const TEXT_FRAGMENT_TEST_TIMEOUT_MS = process.platform === "win32" ? 45000 : 20000;
  const TEXT_FRAGMENT_FLUSH_MS = TELEGRAM_TEST_TIMINGS.textFragmentGapMs + 80;
  it(
    "buffers near-limit text and processes sequential parts as one message",
    async () => {
      const { createTelegramBot } = await import("./bot.js");
      const replyModule = await import("../auto-reply/reply.js");
      const replySpy = replyModule.__replySpy;
      onSpy.mockReset();
      replySpy.mockReset();
      createTelegramBot({ token: "tok", testTimings: TELEGRAM_TEST_TIMINGS });
      const handler = onSpy.mock.calls.find((call) => call[0] === "message")?.[1];
      expect(handler).toBeDefined();
      const part1 = "A".repeat(4050);
      const part2 = "B".repeat(50);
      await handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 10,
          date: 1736380800,
          text: part1,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({}),
      });
      await handler({
        message: {
          chat: { id: 42, type: "private" },
          message_id: 11,
          date: 1736380801,
          text: part2,
        },
        me: { username: "genosos_bot" },
        getFile: async () => ({}),
      });
      expect(replySpy).not.toHaveBeenCalled();
      await vi.waitFor(
        () => {
          expect(replySpy).toHaveBeenCalledTimes(1);
        },
        { timeout: TEXT_FRAGMENT_FLUSH_MS * 2, interval: 10 },
      );
      const payload = replySpy.mock.calls[0][0];
      expect(payload.RawBody).toContain(part1.slice(0, 32));
      expect(payload.RawBody).toContain(part2.slice(0, 32));
    },
    TEXT_FRAGMENT_TEST_TIMEOUT_MS,
  );
});
