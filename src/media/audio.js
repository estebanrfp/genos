import { getFileExtension, normalizeMimeType } from "./mime.js";
export const TELEGRAM_VOICE_AUDIO_EXTENSIONS = new Set([".oga", ".ogg", ".opus", ".mp3", ".m4a"]);
export const TELEGRAM_VOICE_MIME_TYPES = new Set([
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
]);
export function isTelegramVoiceCompatibleAudio(opts) {
  const mime = normalizeMimeType(opts.contentType);
  if (mime && TELEGRAM_VOICE_MIME_TYPES.has(mime)) {
    return true;
  }
  const fileName = opts.fileName?.trim();
  if (!fileName) {
    return false;
  }
  const ext = getFileExtension(fileName);
  if (!ext) {
    return false;
  }
  return TELEGRAM_VOICE_AUDIO_EXTENSIONS.has(ext);
}
export function isVoiceCompatibleAudio(opts) {
  return isTelegramVoiceCompatibleAudio(opts);
}
