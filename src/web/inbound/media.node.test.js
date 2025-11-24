import { describe, expect, it, vi } from "vitest";
const { normalizeMessageContent, downloadMediaMessage } = vi.hoisted(() => ({
  normalizeMessageContent: vi.fn((msg) => msg),
  downloadMediaMessage: vi.fn().mockResolvedValue(Buffer.from("fake-media-data")),
}));
vi.mock("@whiskeysockets/baileys", () => ({
  normalizeMessageContent,
  downloadMediaMessage,
}));
import { downloadInboundMedia } from "./media.js";
const mockSock = {
  updateMediaMessage: vi.fn(),
  logger: { child: () => ({}) },
};
describe("downloadInboundMedia", () => {
  it("returns undefined for messages without media", async () => {
    const msg = { message: { conversation: "hello" } };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeUndefined();
  });
  it("uses explicit mimetype from audioMessage when present", async () => {
    const msg = {
      message: { audioMessage: { mimetype: "audio/mp4", ptt: true } },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("audio/mp4");
  });
  it("defaults to audio/ogg for voice messages without explicit MIME", async () => {
    const msg = {
      message: { audioMessage: { ptt: true } },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("audio/ogg; codecs=opus");
  });
  it("defaults to audio/ogg for audio messages without MIME or ptt flag", async () => {
    const msg = {
      message: { audioMessage: {} },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("audio/ogg; codecs=opus");
  });
  it("uses explicit mimetype from imageMessage when present", async () => {
    const msg = {
      message: { imageMessage: { mimetype: "image/png" } },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("image/png");
  });
  it("defaults to image/jpeg for images without explicit MIME", async () => {
    const msg = {
      message: { imageMessage: {} },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("image/jpeg");
  });
  it("defaults to video/mp4 for video messages without explicit MIME", async () => {
    const msg = {
      message: { videoMessage: {} },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("video/mp4");
  });
  it("defaults to image/webp for sticker messages without explicit MIME", async () => {
    const msg = {
      message: { stickerMessage: {} },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("image/webp");
  });
  it("preserves fileName from document messages", async () => {
    const msg = {
      message: {
        documentMessage: { mimetype: "application/pdf", fileName: "report.pdf" },
      },
    };
    const result = await downloadInboundMedia(msg, mockSock);
    expect(result).toBeDefined();
    expect(result?.mimetype).toBe("application/pdf");
    expect(result?.fileName).toBe("report.pdf");
  });
});
