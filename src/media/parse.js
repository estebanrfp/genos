let cleanCandidate = function (raw) {
    return raw.replace(/^[`"'[{(]+/, "").replace(/[`"'\\})\],]+$/, "");
  },
  isLikelyLocalPath = function (candidate) {
    return (
      candidate.startsWith("/") ||
      candidate.startsWith("./") ||
      candidate.startsWith("../") ||
      candidate.startsWith("~") ||
      WINDOWS_DRIVE_RE.test(candidate) ||
      candidate.startsWith("\\\\") ||
      (!SCHEME_RE.test(candidate) && (candidate.includes("/") || candidate.includes("\\")))
    );
  },
  isValidMedia = function (candidate, opts) {
    if (!candidate) {
      return false;
    }
    if (candidate.length > 4096) {
      return false;
    }
    if (!opts?.allowSpaces && /\s/.test(candidate)) {
      return false;
    }
    if (/^https?:\/\//i.test(candidate)) {
      return true;
    }
    if (isLikelyLocalPath(candidate)) {
      return true;
    }
    if (opts?.allowBareFilename && !SCHEME_RE.test(candidate) && HAS_FILE_EXT.test(candidate)) {
      return true;
    }
    return false;
  },
  unwrapQuoted = function (value) {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      return;
    }
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first !== last) {
      return;
    }
    if (first !== `"` && first !== "'" && first !== "`") {
      return;
    }
    return trimmed.slice(1, -1).trim();
  },
  isInsideFence = function (fenceSpans, offset) {
    return fenceSpans.some((span) => offset >= span.start && offset < span.end);
  };
import { parseFenceSpans } from "../markdown/fences.js";
import { parseAudioTag } from "./audio-tags.js";
export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+)`?/gi;
export function normalizeMediaSource(src) {
  return src.startsWith("file://") ? src.replace("file://", "") : src;
}
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HAS_FILE_EXT = /\.\w{1,10}$/;
export function splitMediaFromOutput(raw) {
  const trimmedRaw = raw.trimEnd();
  if (!trimmedRaw.trim()) {
    return { text: "" };
  }
  const media = [];
  let foundMediaToken = false;
  const fenceSpans = parseFenceSpans(trimmedRaw);
  const lines = trimmedRaw.split("\n");
  const keptLines = [];
  let lineOffset = 0;
  for (const line of lines) {
    if (isInsideFence(fenceSpans, lineOffset)) {
      keptLines.push(line);
      lineOffset += line.length + 1;
      continue;
    }
    const trimmedStart = line.trimStart();
    if (!trimmedStart.startsWith("MEDIA:")) {
      keptLines.push(line);
      lineOffset += line.length + 1;
      continue;
    }
    const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
    if (matches.length === 0) {
      keptLines.push(line);
      lineOffset += line.length + 1;
      continue;
    }
    const pieces = [];
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      pieces.push(line.slice(cursor, start));
      const payload = match[1];
      const unwrapped = unwrapQuoted(payload);
      const payloadValue = unwrapped ?? payload;
      const parts = unwrapped ? [unwrapped] : payload.split(/\s+/).filter(Boolean);
      const mediaStartIndex = media.length;
      let validCount = 0;
      const invalidParts = [];
      let hasValidMedia = false;
      for (const part of parts) {
        const candidate = normalizeMediaSource(cleanCandidate(part));
        if (isValidMedia(candidate, unwrapped ? { allowSpaces: true } : undefined)) {
          media.push(candidate);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount += 1;
        } else {
          invalidParts.push(part);
        }
      }
      const trimmedPayload = payloadValue.trim();
      const looksLikeLocalPath =
        isLikelyLocalPath(trimmedPayload) || trimmedPayload.startsWith("file://");
      if (
        !unwrapped &&
        validCount === 1 &&
        invalidParts.length > 0 &&
        /\s/.test(payloadValue) &&
        looksLikeLocalPath
      ) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }
      if (!hasValidMedia) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true, allowBareFilename: true })) {
          media.push(fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          invalidParts.length = 0;
        }
      }
      if (hasValidMedia) {
        if (invalidParts.length > 0) {
          pieces.push(invalidParts.join(" "));
        }
      } else if (looksLikeLocalPath) {
        foundMediaToken = true;
      } else {
        pieces.push(match[0]);
      }
      cursor = start + match[0].length;
    }
    pieces.push(line.slice(cursor));
    const cleanedLine = pieces
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (cleanedLine) {
      keptLines.push(cleanedLine);
    }
    lineOffset += line.length + 1;
  }
  let cleanedText = keptLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const audioTagResult = parseAudioTag(cleanedText);
  const hasAudioAsVoice = audioTagResult.audioAsVoice;
  if (audioTagResult.hadTag) {
    cleanedText = audioTagResult.text.replace(/\n{2,}/g, "\n").trim();
  }
  if (media.length === 0) {
    const result = {
      text: foundMediaToken || hasAudioAsVoice ? cleanedText : trimmedRaw,
    };
    if (hasAudioAsVoice) {
      result.audioAsVoice = true;
    }
    return result;
  }
  return {
    text: cleanedText,
    mediaUrls: media,
    mediaUrl: media[0],
    ...(hasAudioAsVoice ? { audioAsVoice: true } : {}),
  };
}
