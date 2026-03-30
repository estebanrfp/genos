let createOpenAiAudioProvider = function (transcribeAudio) {
    return buildProviderRegistry({
      openai: {
        id: "openai",
        capabilities: ["audio"],
        transcribeAudio,
      },
    });
  },
  createOpenAiAudioCfg = function (extra) {
    return {
      models: {
        providers: {
          openai: {
            apiKey: "test-key",
            models: [],
          },
        },
      },
      ...extra,
    };
  };
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProviderRegistry,
  createMediaAttachmentCache,
  normalizeMediaAttachments,
  runCapability,
} from "./runner.js";
async function withAudioFixture(run) {
  const originalPath = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  const tmpPath = path.join(os.tmpdir(), `genosos-auto-audio-${Date.now()}.wav`);
  await fs.writeFile(tmpPath, Buffer.from("RIFF"));
  const ctx = { MediaPath: tmpPath, MediaType: "audio/wav" };
  const media = normalizeMediaAttachments(ctx);
  const cache = createMediaAttachmentCache(media);
  try {
    await run({ ctx, media, cache });
  } finally {
    process.env.PATH = originalPath;
    await cache.cleanup();
    await fs.unlink(tmpPath).catch(() => {});
  }
}
describe("runCapability auto audio entries", () => {
  it("uses provider keys to auto-enable audio transcription", async () => {
    await withAudioFixture(async ({ ctx, media, cache }) => {
      let seenModel;
      const providerRegistry = createOpenAiAudioProvider(async (req) => {
        seenModel = req.model;
        return { text: "ok", model: req.model ?? "unknown" };
      });
      const cfg = createOpenAiAudioCfg();
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs[0]?.text).toBe("ok");
      expect(seenModel).toBe("gpt-4o-mini-transcribe");
      expect(result.decision.outcome).toBe("success");
    });
  });
  it("skips auto audio when disabled", async () => {
    await withAudioFixture(async ({ ctx, media, cache }) => {
      const providerRegistry = createOpenAiAudioProvider(async () => ({
        text: "ok",
        model: "whisper-1",
      }));
      const cfg = createOpenAiAudioCfg({
        tools: {
          media: {
            audio: {
              enabled: false,
            },
          },
        },
      });
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs).toHaveLength(0);
      expect(result.decision.outcome).toBe("disabled");
    });
  });
  it("prefers explicitly configured audio model entries", async () => {
    await withAudioFixture(async ({ ctx, media, cache }) => {
      let seenModel;
      const providerRegistry = createOpenAiAudioProvider(async (req) => {
        seenModel = req.model;
        return { text: "ok", model: req.model ?? "unknown" };
      });
      const cfg = createOpenAiAudioCfg({
        tools: {
          media: {
            audio: {
              models: [{ provider: "openai", model: "whisper-1" }],
            },
          },
        },
      });
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs[0]?.text).toBe("ok");
      expect(seenModel).toBe("whisper-1");
    });
  });
});
