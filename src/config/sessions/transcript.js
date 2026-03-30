let stripQuery = function (value) {
    const noHash = value.split("#")[0] ?? value;
    return noHash.split("?")[0] ?? noHash;
  },
  extractFileNameFromMediaUrl = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const cleaned = stripQuery(trimmed);
    try {
      const parsed = new URL(cleaned);
      const base = path.basename(parsed.pathname);
      if (!base) {
        return null;
      }
      try {
        return decodeURIComponent(base);
      } catch {
        return base;
      }
    } catch {
      const base = path.basename(cleaned);
      if (!base || base === "/" || base === ".") {
        return null;
      }
      return base;
    }
  };
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import { ensureSessionFileDecrypted } from "../../agents/pi-embedded-runner/session-manager-cache.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import { resolveDefaultSessionStorePath, resolveSessionFilePath } from "./paths.js";
import { loadSessionStore, updateSessionStore } from "./store.js";
export function resolveMirroredTranscriptText(params) {
  const mediaUrls = params.mediaUrls?.filter((url) => url && url.trim()) ?? [];
  if (mediaUrls.length > 0) {
    const names = mediaUrls
      .map((url) => extractFileNameFromMediaUrl(url))
      .filter((name) => Boolean(name && name.trim()));
    if (names.length > 0) {
      return names.join(", ");
    }
    return "media";
  }
  const text = params.text ?? "";
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}
async function ensureSessionHeader(params) {
  if (fs.existsSync(params.sessionFile)) {
    return;
  }
  await fs.promises.mkdir(path.dirname(params.sessionFile), { recursive: true });
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await fs.promises.writeFile(params.sessionFile, `${JSON.stringify(header)}\n`, {
    encoding: "utf-8",
    mode: 384,
  });
}
export async function appendAssistantMessageToSessionTranscript(params) {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { ok: false, reason: "missing sessionKey" };
  }
  const mirrorText = resolveMirroredTranscriptText({
    text: params.text,
    mediaUrls: params.mediaUrls,
  });
  if (!mirrorText) {
    return { ok: false, reason: "empty text" };
  }
  const storePath = params.storePath ?? resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const entry = store[sessionKey];
  if (!entry?.sessionId) {
    return { ok: false, reason: `unknown sessionKey: ${sessionKey}` };
  }
  let sessionFile;
  try {
    sessionFile = resolveSessionFilePath(entry.sessionId, entry, {
      agentId: params.agentId,
      sessionsDir: path.dirname(storePath),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  await ensureSessionHeader({ sessionFile, sessionId: entry.sessionId });
  ensureSessionFileDecrypted(sessionFile);
  const sessionManager = SessionManager.open(sessionFile);
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: mirrorText }],
    api: "openai-responses",
    provider: "genosos",
    model: "delivery-mirror",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  // NOTE: Do NOT re-encrypt here — the agent's SessionManager (SM1) may still
  // be appending entries to this file.  Re-encrypting mid-run corrupts the file
  // (NYXENC1 blob + plaintext JSON lines).  Files are encrypted at rest by
  // `vault lock` and decrypted before each SessionManager.open() via
  // ensureSessionFileDecrypted().
  if (!entry.sessionFile || entry.sessionFile !== sessionFile) {
    await updateSessionStore(
      storePath,
      (current) => {
        current[sessionKey] = {
          ...entry,
          sessionFile,
        };
      },
      { activeSessionKey: sessionKey },
    );
  }
  emitSessionTranscriptUpdate(sessionFile);
  return { ok: true, sessionFile };
}
