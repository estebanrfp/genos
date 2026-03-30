import { logVerbose, shouldLogVerbose } from "../globals.js";
import { isAudioAttachment } from "./attachments.js";
import {
  buildProviderRegistry,
  createMediaAttachmentCache,
  normalizeMediaAttachments,
  runCapability,
} from "./runner.js";
export async function transcribeFirstAudio(params) {
  const { ctx, cfg } = params;
  const audioConfig = cfg.tools?.media?.audio;
  if (!audioConfig || audioConfig.enabled === false) {
    return;
  }
  const attachments = normalizeMediaAttachments(ctx);
  if (!attachments || attachments.length === 0) {
    return;
  }
  const firstAudio = attachments.find(
    (att) => att && isAudioAttachment(att) && !att.alreadyTranscribed,
  );
  if (!firstAudio) {
    return;
  }
  if (shouldLogVerbose()) {
    logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
  }
  const providerRegistry = buildProviderRegistry(params.providers);
  const cache = createMediaAttachmentCache(attachments);
  try {
    const result = await runCapability({
      capability: "audio",
      cfg,
      ctx,
      attachments: cache,
      media: attachments,
      agentDir: params.agentDir,
      providerRegistry,
      config: audioConfig,
      activeModel: params.activeModel,
    });
    if (!result || result.outputs.length === 0) {
      return;
    }
    const audioOutput = result.outputs.find((output) => output.kind === "audio.transcription");
    if (!audioOutput || !audioOutput.text) {
      return;
    }
    firstAudio.alreadyTranscribed = true;
    if (shouldLogVerbose()) {
      logVerbose(
        `audio-preflight: transcribed ${audioOutput.text.length} chars from attachment ${firstAudio.index}`,
      );
    }
    return audioOutput.text;
  } catch (err) {
    if (shouldLogVerbose()) {
      logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
    }
    return;
  } finally {
    await cache.cleanup();
  }
}
