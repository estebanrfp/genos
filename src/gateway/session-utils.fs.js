let readSessionTitleFieldsCacheKey = function (filePath, opts) {
    const includeInterSession = opts?.includeInterSession === true ? "1" : "0";
    return `${filePath}\t${includeInterSession}`;
  },
  getCachedSessionTitleFields = function (cacheKey, stat) {
    const cached = sessionTitleFieldsCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    if (cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      sessionTitleFieldsCache.delete(cacheKey);
      return null;
    }
    sessionTitleFieldsCache.delete(cacheKey);
    sessionTitleFieldsCache.set(cacheKey, cached);
    return {
      firstUserMessage: cached.firstUserMessage,
      lastMessagePreview: cached.lastMessagePreview,
    };
  },
  setCachedSessionTitleFields = function (cacheKey, stat, value) {
    sessionTitleFieldsCache.set(cacheKey, {
      ...value,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
    while (sessionTitleFieldsCache.size > MAX_SESSION_TITLE_FIELDS_CACHE_ENTRIES) {
      const oldestKey = sessionTitleFieldsCache.keys().next().value;
      if (typeof oldestKey !== "string" || !oldestKey) {
        break;
      }
      sessionTitleFieldsCache.delete(oldestKey);
    }
  },
  restoreArchiveTimestamp = function (raw) {
    const [datePart, timePart] = raw.split("T");
    if (!datePart || !timePart) {
      return raw;
    }
    return `${datePart}T${timePart.replace(/-/g, ":")}`;
  },
  parseArchivedTimestamp = function (fileName, reason) {
    const marker = `.${reason}.`;
    const index = fileName.lastIndexOf(marker);
    if (index < 0) {
      return null;
    }
    const raw = fileName.slice(index + marker.length);
    if (!raw) {
      return null;
    }
    const timestamp = Date.parse(restoreArchiveTimestamp(raw));
    return Number.isNaN(timestamp) ? null : timestamp;
  },
  jsonUtf8Bytes = function (value) {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      return Buffer.byteLength(String(value), "utf8");
    }
  },
  extractTextFromContent = function (content) {
    if (typeof content === "string") {
      return content.trim() || null;
    }
    if (!Array.isArray(content)) {
      return null;
    }
    for (const part of content) {
      if (!part || typeof part.text !== "string") {
        continue;
      }
      if (part.type === "text" || part.type === "output_text" || part.type === "input_text") {
        const trimmed = part.text.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return null;
  },
  readTranscriptHeadChunk = function (fd, maxBytes = 8192) {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    if (bytesRead <= 0) {
      return null;
    }
    return buf.toString("utf-8", 0, bytesRead);
  },
  extractFirstUserMessageFromTranscriptChunk = function (chunk, opts) {
    const lines = chunk.split(/\r?\n/).slice(0, MAX_LINES_TO_SCAN);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const msg = parsed?.message;
        if (msg?.role !== "user") {
          continue;
        }
        if (opts?.includeInterSession !== true && hasInterSessionUserProvenance(msg)) {
          continue;
        }
        const text = extractTextFromContent(msg.content);
        if (text) {
          return text;
        }
      } catch {}
    }
    return null;
  },
  findExistingTranscriptPath = function (sessionId, storePath, sessionFile, agentId) {
    const candidates = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      sessionFile,
      agentId,
    );
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  },
  withOpenTranscriptFd = function (filePath, read) {
    let fd = null;
    try {
      fd = fs.openSync(filePath, "r");
      return read(fd);
    } catch {
    } finally {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    }
    return null;
  },
  readLastMessagePreviewFromOpenTranscript = function (params) {
    const readStart = Math.max(0, params.size - LAST_MSG_MAX_BYTES);
    const readLen = Math.min(params.size, LAST_MSG_MAX_BYTES);
    const buf = Buffer.alloc(readLen);
    fs.readSync(params.fd, buf, 0, readLen, readStart);
    const chunk = buf.toString("utf-8");
    const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
    const tailLines = lines.slice(-LAST_MSG_MAX_LINES);
    for (let i = tailLines.length - 1; i >= 0; i--) {
      const line = tailLines[i];
      try {
        const parsed = JSON.parse(line);
        const msg = parsed?.message;
        if (msg?.role !== "user" && msg?.role !== "assistant") {
          continue;
        }
        const text = extractTextFromContent(msg.content);
        if (text) {
          return text;
        }
      } catch {}
    }
    return null;
  },
  normalizeRole = function (role, isTool) {
    if (isTool) {
      return "tool";
    }
    switch ((role ?? "").toLowerCase()) {
      case "user":
        return "user";
      case "assistant":
        return "assistant";
      case "system":
        return "system";
      case "tool":
        return "tool";
      default:
        return "other";
    }
  },
  truncatePreviewText = function (text, maxChars) {
    if (maxChars <= 0 || text.length <= maxChars) {
      return text;
    }
    if (maxChars <= 3) {
      return text.slice(0, maxChars);
    }
    return `${text.slice(0, maxChars - 3)}...`;
  },
  extractPreviewText = function (message) {
    if (typeof message.content === "string") {
      const trimmed = message.content.trim();
      return trimmed ? trimmed : null;
    }
    if (Array.isArray(message.content)) {
      const parts = message.content
        .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
        .filter((text) => text.trim().length > 0);
      if (parts.length > 0) {
        return parts.join("\n").trim();
      }
    }
    if (typeof message.text === "string") {
      const trimmed = message.text.trim();
      return trimmed ? trimmed : null;
    }
    return null;
  },
  isToolCall = function (message) {
    return hasToolCall(message);
  },
  extractToolNames = function (message) {
    return extractToolCallNames(message);
  },
  extractMediaSummary = function (message) {
    if (!Array.isArray(message.content)) {
      return null;
    }
    for (const entry of message.content) {
      const raw = typeof entry?.type === "string" ? entry.type.trim().toLowerCase() : "";
      if (!raw || raw === "text" || raw === "toolcall" || raw === "tool_call") {
        continue;
      }
      return `[${raw}]`;
    }
    return null;
  },
  buildPreviewItems = function (messages, maxItems, maxChars) {
    const items = [];
    for (const message of messages) {
      const toolCall = isToolCall(message);
      const role = normalizeRole(message.role, toolCall);
      let text = extractPreviewText(message);
      if (!text) {
        const toolNames = extractToolNames(message);
        if (toolNames.length > 0) {
          const shown = toolNames.slice(0, 2);
          const overflow = toolNames.length - shown.length;
          text = `call ${shown.join(", ")}`;
          if (overflow > 0) {
            text += ` +${overflow}`;
          }
        }
      }
      if (!text) {
        text = extractMediaSummary(message);
      }
      if (!text) {
        continue;
      }
      let trimmed = text.trim();
      if (!trimmed) {
        continue;
      }
      if (role === "user") {
        trimmed = stripEnvelope(trimmed);
      }
      trimmed = truncatePreviewText(trimmed, maxChars);
      items.push({ role, text: trimmed });
    }
    if (items.length <= maxItems) {
      return items;
    }
    return items.slice(-maxItems);
  },
  readRecentMessagesFromTranscript = function (filePath, maxMessages, readBytes) {
    if (isVaultActive()) {
      try {
        const content = secureReadFileSync(filePath);
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        const tailLines = lines.slice(-PREVIEW_MAX_LINES);
        const collected = [];
        for (let i = tailLines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(tailLines[i]);
            const msg = parsed?.message;
            if (msg && typeof msg === "object") {
              collected.push(msg);
              if (collected.length >= maxMessages) {
                break;
              }
            }
          } catch {}
        }
        return collected.toReversed();
      } catch {
        return [];
      }
    }
    let fd = null;
    try {
      fd = fs.openSync(filePath, "r");
      const stat = fs.fstatSync(fd);
      const size = stat.size;
      if (size === 0) {
        return [];
      }
      const readStart = Math.max(0, size - readBytes);
      const readLen = Math.min(size, readBytes);
      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, readStart);
      const chunk = buf.toString("utf-8");
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
      const tailLines = lines.slice(-PREVIEW_MAX_LINES);
      const collected = [];
      for (let i = tailLines.length - 1; i >= 0; i--) {
        const line = tailLines[i];
        try {
          const parsed = JSON.parse(line);
          const msg = parsed?.message;
          if (msg && typeof msg === "object") {
            collected.push(msg);
            if (collected.length >= maxMessages) {
              break;
            }
          }
        } catch {}
      }
      return collected.toReversed();
    } catch {
      return [];
    } finally {
      if (fd !== null) {
        fs.closeSync(fd);
      }
    }
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveSessionFilePath,
  resolveSessionTranscriptPath,
  resolveSessionTranscriptPathInDir,
} from "../config/sessions.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { secureReadFileSync, isVaultActive } from "../infra/secure-io.js";
import { hasInterSessionUserProvenance } from "../sessions/input-provenance.js";
import { extractToolCallNames, hasToolCall } from "../utils/transcript-tools.js";
import { stripEnvelope } from "./chat-sanitize.js";
const sessionTitleFieldsCache = new Map();
const MAX_SESSION_TITLE_FIELDS_CACHE_ENTRIES = 5000;
export function readSessionMessages(sessionId, storePath, sessionFile) {
  const candidates = resolveSessionTranscriptCandidates(sessionId, storePath, sessionFile);
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    return [];
  }
  let lines;
  try {
    lines = secureReadFileSync(filePath).split(/\r?\n/);
  } catch {
    return [];
  }
  const messages = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed?.message) {
        messages.push(parsed.message);
        continue;
      }
      if (parsed?.type === "compaction") {
        const ts = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
        const timestamp = Number.isFinite(ts) ? ts : Date.now();
        messages.push({
          role: "system",
          content: [{ type: "text", text: "Compaction" }],
          timestamp,
          __genosos: {
            kind: "compaction",
            id: typeof parsed.id === "string" ? parsed.id : undefined,
          },
        });
      }
    } catch {}
  }
  return messages;
}
export function resolveSessionTranscriptCandidates(sessionId, storePath, sessionFile, agentId) {
  const candidates = [];
  const pushCandidate = (resolve) => {
    try {
      candidates.push(resolve());
    } catch {}
  };
  if (storePath) {
    const sessionsDir = path.dirname(storePath);
    if (sessionFile) {
      pushCandidate(() =>
        resolveSessionFilePath(sessionId, { sessionFile }, { sessionsDir, agentId }),
      );
    }
    pushCandidate(() => resolveSessionTranscriptPathInDir(sessionId, sessionsDir));
  } else if (sessionFile) {
    if (agentId) {
      pushCandidate(() => resolveSessionFilePath(sessionId, { sessionFile }, { agentId }));
    } else {
      const trimmed = sessionFile.trim();
      if (trimmed) {
        candidates.push(path.resolve(trimmed));
      }
    }
  }
  if (agentId) {
    pushCandidate(() => resolveSessionTranscriptPath(sessionId, agentId));
  }
  const home = resolveRequiredHomeDir(process.env, os.homedir);
  const legacyDir = path.join(home, ".genosv1", "sessions");
  pushCandidate(() => resolveSessionTranscriptPathInDir(sessionId, legacyDir));
  return Array.from(new Set(candidates));
}
export function archiveFileOnDisk(filePath, reason) {
  const ts = new Date().toISOString().replaceAll(":", "-");
  const archived = `${filePath}.${reason}.${ts}`;
  fs.renameSync(filePath, archived);
  return archived;
}
export function archiveSessionTranscripts(opts) {
  const archived = [];
  for (const candidate of resolveSessionTranscriptCandidates(
    opts.sessionId,
    opts.storePath,
    opts.sessionFile,
    opts.agentId,
  )) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      archived.push(archiveFileOnDisk(candidate, opts.reason));
    } catch {}
  }
  return archived;
}
export async function cleanupArchivedSessionTranscripts(opts) {
  if (!Number.isFinite(opts.olderThanMs) || opts.olderThanMs < 0) {
    return { removed: 0, scanned: 0 };
  }
  const now = opts.nowMs ?? Date.now();
  const reason = opts.reason ?? "deleted";
  const directories = Array.from(new Set(opts.directories.map((dir) => path.resolve(dir))));
  let removed = 0;
  let scanned = 0;
  for (const dir of directories) {
    const entries = await fs.promises.readdir(dir).catch(() => []);
    for (const entry of entries) {
      const timestamp = parseArchivedTimestamp(entry, reason);
      if (timestamp == null) {
        continue;
      }
      scanned += 1;
      if (now - timestamp <= opts.olderThanMs) {
        continue;
      }
      const fullPath = path.join(dir, entry);
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      if (!stat?.isFile()) {
        continue;
      }
      await fs.promises.rm(fullPath).catch(() => {
        return;
      });
      removed += 1;
    }
  }
  return { removed, scanned };
}
export function capArrayByJsonBytes(items, maxBytes) {
  if (items.length === 0) {
    return { items, bytes: 2 };
  }
  const parts = items.map((item) => jsonUtf8Bytes(item));
  let bytes = 2 + parts.reduce((a, b) => a + b, 0) + (items.length - 1);
  let start = 0;
  while (bytes > maxBytes && start < items.length - 1) {
    bytes -= parts[start] + 1;
    start += 1;
  }
  const next = start > 0 ? items.slice(start) : items;
  return { items: next, bytes };
}
const MAX_LINES_TO_SCAN = 10;
export function readSessionTitleFieldsFromTranscript(
  sessionId,
  storePath,
  sessionFile,
  agentId,
  opts,
) {
  const candidates = resolveSessionTranscriptCandidates(sessionId, storePath, sessionFile, agentId);
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    return { firstUserMessage: null, lastMessagePreview: null };
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { firstUserMessage: null, lastMessagePreview: null };
  }
  const cacheKey = readSessionTitleFieldsCacheKey(filePath, opts);
  const cached = getCachedSessionTitleFields(cacheKey, stat);
  if (cached) {
    return cached;
  }
  if (stat.size === 0) {
    const empty = { firstUserMessage: null, lastMessagePreview: null };
    setCachedSessionTitleFields(cacheKey, stat, empty);
    return empty;
  }
  if (isVaultActive()) {
    try {
      const content = secureReadFileSync(filePath);
      const headChunk = content.slice(0, 8192);
      const firstUserMessage = headChunk
        ? extractFirstUserMessageFromTranscriptChunk(headChunk, opts)
        : null;
      const allLines = content.split(/\r?\n/).filter((l) => l.trim());
      const tailLines = allLines.slice(-LAST_MSG_MAX_LINES);
      let lastMessagePreview = null;
      for (let i = tailLines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(tailLines[i]);
          const msg = parsed?.message;
          if (msg?.role === "user" || msg?.role === "assistant") {
            lastMessagePreview = extractTextFromContent(msg.content);
            if (lastMessagePreview) {
              break;
            }
          }
        } catch {}
      }
      const result = { firstUserMessage, lastMessagePreview };
      setCachedSessionTitleFields(cacheKey, stat, result);
      return result;
    } catch {
      return { firstUserMessage: null, lastMessagePreview: null };
    }
  }
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const size = stat.size;
    let firstUserMessage = null;
    try {
      const chunk = readTranscriptHeadChunk(fd);
      if (chunk) {
        firstUserMessage = extractFirstUserMessageFromTranscriptChunk(chunk, opts);
      }
    } catch {}
    let lastMessagePreview = null;
    try {
      lastMessagePreview = readLastMessagePreviewFromOpenTranscript({ fd, size });
    } catch {}
    const result = { firstUserMessage, lastMessagePreview };
    setCachedSessionTitleFields(cacheKey, stat, result);
    return result;
  } catch {
    return { firstUserMessage: null, lastMessagePreview: null };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}
export function readFirstUserMessageFromTranscript(
  sessionId,
  storePath,
  sessionFile,
  agentId,
  opts,
) {
  const filePath = findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId);
  if (!filePath) {
    return null;
  }
  return withOpenTranscriptFd(filePath, (fd) => {
    const chunk = readTranscriptHeadChunk(fd);
    if (!chunk) {
      return null;
    }
    return extractFirstUserMessageFromTranscriptChunk(chunk, opts);
  });
}
const LAST_MSG_MAX_BYTES = 16384;
const LAST_MSG_MAX_LINES = 20;
export function readLastMessagePreviewFromTranscript(sessionId, storePath, sessionFile, agentId) {
  const filePath = findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId);
  if (!filePath) {
    return null;
  }
  return withOpenTranscriptFd(filePath, (fd) => {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    if (size === 0) {
      return null;
    }
    return readLastMessagePreviewFromOpenTranscript({ fd, size });
  });
}
const PREVIEW_READ_SIZES = [65536, 262144, 1048576];
const PREVIEW_MAX_LINES = 200;
export function readSessionPreviewItemsFromTranscript(
  sessionId,
  storePath,
  sessionFile,
  agentId,
  maxItems,
  maxChars,
) {
  const candidates = resolveSessionTranscriptCandidates(sessionId, storePath, sessionFile, agentId);
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    return [];
  }
  const boundedItems = Math.max(1, Math.min(maxItems, 50));
  const boundedChars = Math.max(20, Math.min(maxChars, 2000));
  for (const readSize of PREVIEW_READ_SIZES) {
    const messages = readRecentMessagesFromTranscript(filePath, boundedItems, readSize);
    if (messages.length > 0 || readSize === PREVIEW_READ_SIZES[PREVIEW_READ_SIZES.length - 1]) {
      return buildPreviewItems(messages, boundedItems, boundedChars);
    }
  }
  return [];
}
