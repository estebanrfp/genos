let makeCtx = function (mediaField, getFile) {
    const msg = {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: "private" },
    };
    if (mediaField === "voice") {
      msg.voice = { file_id: "v1", duration: 5, file_unique_id: "u1" };
    }
    if (mediaField === "audio") {
      msg.audio = { file_id: "a1", duration: 5, file_unique_id: "u2" };
    }
    if (mediaField === "photo") {
      msg.photo = [{ file_id: "p1", width: 100, height: 100 }];
    }
    if (mediaField === "video") {
      msg.video = { file_id: "vid1", duration: 10, file_unique_id: "u3" };
    }
    return {
      message: msg,
      me: {
        id: 1,
        is_bot: true,
        first_name: "bot",
        username: "bot",
      },
      getFile,
    };
  },
  setupTransientGetFileRetry = function () {
    const getFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network request for 'getFile' failed!"))
      .mockResolvedValueOnce({ file_path: "voice/file_0.oga" });
    fetchRemoteMedia.mockResolvedValueOnce({
      buffer: Buffer.from("audio"),
      contentType: "audio/ogg",
      fileName: "file_0.oga",
    });
    saveMediaBuffer.mockResolvedValueOnce({
      path: "/tmp/file_0.oga",
      contentType: "audio/ogg",
    });
    return getFile;
  };
import { GrammyError } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const saveMediaBuffer = vi.fn();
const fetchRemoteMedia = vi.fn();
vi.mock("../../media/store.js", () => ({
  saveMediaBuffer: (...args) => saveMediaBuffer(...args),
}));
vi.mock("../../media/fetch.js", () => ({
  fetchRemoteMedia: (...args) => fetchRemoteMedia(...args),
}));
vi.mock("../../globals.js", () => ({
  danger: (s) => s,
  warn: (s) => s,
  logVerbose: () => {},
}));
vi.mock("../sticker-cache.js", () => ({
  cacheSticker: () => {},
  getCachedSticker: () => null,
}));
const { resolveMedia } = await import("./delivery.js");
const MAX_MEDIA_BYTES = 1e7;
const BOT_TOKEN = "tok123";
async function flushRetryTimers() {
  await vi.runAllTimersAsync();
}
describe("resolveMedia getFile retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchRemoteMedia.mockReset();
    saveMediaBuffer.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("retries getFile on transient failure and succeeds on second attempt", async () => {
    const getFile = setupTransientGetFileRetry();
    const promise = resolveMedia(makeCtx("voice", getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
    await flushRetryTimers();
    const result = await promise;
    expect(getFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({ path: "/tmp/file_0.oga", placeholder: "<media:audio>" }),
    );
  });
  it.each(["voice", "photo", "video"])(
    "returns null for %s when getFile exhausts retries so message is not dropped",
    async (mediaField) => {
      const getFile = vi.fn().mockRejectedValue(new Error("Network request for 'getFile' failed!"));
      const promise = resolveMedia(makeCtx(mediaField, getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
      await flushRetryTimers();
      const result = await promise;
      expect(getFile).toHaveBeenCalledTimes(3);
      expect(result).toBeNull();
    },
  );
  it("does not catch errors from fetchRemoteMedia (only getFile is retried)", async () => {
    const getFile = vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" });
    fetchRemoteMedia.mockRejectedValueOnce(new Error("download failed"));
    await expect(
      resolveMedia(makeCtx("voice", getFile), MAX_MEDIA_BYTES, BOT_TOKEN),
    ).rejects.toThrow("download failed");
    expect(getFile).toHaveBeenCalledTimes(1);
  });
  it("does not retry 'file is too big' error (400 Bad Request) and returns null", async () => {
    const fileTooBigError = new Error(
      "GrammyError: Call to 'getFile' failed! (400: Bad Request: file is too big)",
    );
    const getFile = vi.fn().mockRejectedValue(fileTooBigError);
    const result = await resolveMedia(makeCtx("video", getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
  it("does not retry 'file is too big' GrammyError instances and returns null", async () => {
    const fileTooBigError = new GrammyError(
      "Call to 'getFile' failed!",
      { ok: false, error_code: 400, description: "Bad Request: file is too big" },
      "getFile",
      {},
    );
    const getFile = vi.fn().mockRejectedValue(fileTooBigError);
    const result = await resolveMedia(makeCtx("video", getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
  it.each(["audio", "voice"])("returns null for %s when file is too big", async (mediaField) => {
    const fileTooBigError = new Error(
      "GrammyError: Call to 'getFile' failed! (400: Bad Request: file is too big)",
    );
    const getFile = vi.fn().mockRejectedValue(fileTooBigError);
    const result = await resolveMedia(makeCtx(mediaField, getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
  it("still retries transient errors even after encountering file too big in different call", async () => {
    const getFile = setupTransientGetFileRetry();
    const promise = resolveMedia(makeCtx("voice", getFile), MAX_MEDIA_BYTES, BOT_TOKEN);
    await flushRetryTimers();
    const result = await promise;
    expect(getFile).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
  });
});
