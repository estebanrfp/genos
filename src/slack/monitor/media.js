let isSlackHostname = function (hostname) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) {
      return false;
    }
    const allowedSuffixes = ["slack.com", "slack-edge.com", "slack-files.com"];
    return allowedSuffixes.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    );
  },
  assertSlackFileUrl = function (rawUrl) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid Slack file URL: ${rawUrl}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`Refusing Slack file URL with non-HTTPS protocol: ${parsed.protocol}`);
    }
    if (!isSlackHostname(parsed.hostname)) {
      throw new Error(
        `Refusing to send Slack token to non-Slack host "${parsed.hostname}" (url: ${rawUrl})`,
      );
    }
    return parsed;
  },
  resolveRequestUrl = function (input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    if ("url" in input && typeof input.url === "string") {
      return input.url;
    }
    throw new Error("Unsupported fetch input: expected string, URL, or Request");
  },
  createSlackMediaFetch = function (token) {
    let includeAuth = true;
    return async (input, init) => {
      const url = resolveRequestUrl(input);
      const { headers: initHeaders, redirect: _redirect, ...rest } = init ?? {};
      const headers = new Headers(initHeaders);
      if (includeAuth) {
        includeAuth = false;
        const parsed = assertSlackFileUrl(url);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(parsed.href, { ...rest, headers, redirect: "manual" });
      }
      headers.delete("Authorization");
      return fetch(url, { ...rest, headers, redirect: "manual" });
    };
  },
  resolveSlackMediaMimetype = function (file, fetchedContentType) {
    const mime = fetchedContentType ?? file.mimetype;
    if (file.subtype === "slack_audio" && mime?.startsWith("video/")) {
      return mime.replace("video/", "audio/");
    }
    return mime;
  },
  isForwardedSlackAttachment = function (attachment) {
    return attachment.is_share === true;
  },
  resolveForwardedAttachmentImageUrl = function (attachment) {
    const rawUrl = attachment.image_url?.trim();
    if (!rawUrl) {
      return null;
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" || !isSlackHostname(parsed.hostname)) {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  },
  evictThreadStarterCache = function () {
    const now = Date.now();
    for (const [cacheKey, entry] of THREAD_STARTER_CACHE.entries()) {
      if (now - entry.cachedAt > THREAD_STARTER_CACHE_TTL_MS) {
        THREAD_STARTER_CACHE.delete(cacheKey);
      }
    }
    if (THREAD_STARTER_CACHE.size <= THREAD_STARTER_CACHE_MAX) {
      return;
    }
    const excess = THREAD_STARTER_CACHE.size - THREAD_STARTER_CACHE_MAX;
    let removed = 0;
    for (const cacheKey of THREAD_STARTER_CACHE.keys()) {
      THREAD_STARTER_CACHE.delete(cacheKey);
      removed += 1;
      if (removed >= excess) {
        break;
      }
    }
  };
import { normalizeHostname } from "../../infra/net/hostname.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { saveMediaBuffer } from "../../media/store.js";
export async function fetchWithSlackAuth(url, token) {
  const parsed = assertSlackFileUrl(url);
  const initialRes = await fetch(parsed.href, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  if (initialRes.status < 300 || initialRes.status >= 400) {
    return initialRes;
  }
  const redirectUrl = initialRes.headers.get("location");
  if (!redirectUrl) {
    return initialRes;
  }
  const resolvedUrl = new URL(redirectUrl, parsed.href);
  if (resolvedUrl.protocol !== "https:") {
    return initialRes;
  }
  return fetch(resolvedUrl.toString(), { redirect: "follow" });
}
const MAX_SLACK_MEDIA_FILES = 8;
const MAX_SLACK_MEDIA_CONCURRENCY = 3;
const MAX_SLACK_FORWARDED_ATTACHMENTS = 8;
async function mapLimit(items, limit, fn) {
  if (items.length === 0) {
    return [];
  }
  const results = [];
  results.length = items.length;
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= items.length) {
          return;
        }
        results[idx] = await fn(items[idx]);
      }
    }),
  );
  return results;
}
export async function resolveSlackMedia(params) {
  const files = params.files ?? [];
  const limitedFiles =
    files.length > MAX_SLACK_MEDIA_FILES ? files.slice(0, MAX_SLACK_MEDIA_FILES) : files;
  const resolved = await mapLimit(limitedFiles, MAX_SLACK_MEDIA_CONCURRENCY, async (file) => {
    const url = file.url_private_download ?? file.url_private;
    if (!url) {
      return null;
    }
    try {
      const fetchImpl = createSlackMediaFetch(params.token);
      const fetched = await fetchRemoteMedia({
        url,
        fetchImpl,
        filePathHint: file.name,
        maxBytes: params.maxBytes,
      });
      if (fetched.buffer.byteLength > params.maxBytes) {
        return null;
      }
      const effectiveMime = resolveSlackMediaMimetype(file, fetched.contentType);
      const saved = await saveMediaBuffer(
        fetched.buffer,
        effectiveMime,
        "inbound",
        params.maxBytes,
      );
      const label = fetched.fileName ?? file.name;
      const contentType = effectiveMime ?? saved.contentType;
      return {
        path: saved.path,
        ...(contentType ? { contentType } : {}),
        placeholder: label ? `[Slack file: ${label}]` : "[Slack file]",
      };
    } catch {
      return null;
    }
  });
  const results = resolved.filter((entry) => Boolean(entry));
  return results.length > 0 ? results : null;
}
export async function resolveSlackAttachmentContent(params) {
  const attachments = params.attachments;
  if (!attachments || attachments.length === 0) {
    return null;
  }
  const forwardedAttachments = attachments
    .filter((attachment) => isForwardedSlackAttachment(attachment))
    .slice(0, MAX_SLACK_FORWARDED_ATTACHMENTS);
  if (forwardedAttachments.length === 0) {
    return null;
  }
  const textBlocks = [];
  const allMedia = [];
  for (const att of forwardedAttachments) {
    const text = att.text?.trim() || att.fallback?.trim();
    if (text) {
      const author = att.author_name;
      const heading = author ? `[Forwarded message from ${author}]` : "[Forwarded message]";
      textBlocks.push(`${heading}\n${text}`);
    }
    const imageUrl = resolveForwardedAttachmentImageUrl(att);
    if (imageUrl) {
      try {
        const fetched = await fetchRemoteMedia({
          url: imageUrl,
          maxBytes: params.maxBytes,
        });
        if (fetched.buffer.byteLength <= params.maxBytes) {
          const saved = await saveMediaBuffer(
            fetched.buffer,
            fetched.contentType,
            "inbound",
            params.maxBytes,
          );
          const label = fetched.fileName ?? "forwarded image";
          allMedia.push({
            path: saved.path,
            contentType: fetched.contentType ?? saved.contentType,
            placeholder: `[Forwarded image: ${label}]`,
          });
        }
      } catch {}
    }
    if (att.files && att.files.length > 0) {
      const fileMedia = await resolveSlackMedia({
        files: att.files,
        token: params.token,
        maxBytes: params.maxBytes,
      });
      if (fileMedia) {
        allMedia.push(...fileMedia);
      }
    }
  }
  const combinedText = textBlocks.join("\n\n");
  if (!combinedText && allMedia.length === 0) {
    return null;
  }
  return { text: combinedText, media: allMedia };
}
const THREAD_STARTER_CACHE = new Map();
const THREAD_STARTER_CACHE_TTL_MS = 21600000;
const THREAD_STARTER_CACHE_MAX = 2000;
export async function resolveSlackThreadStarter(params) {
  evictThreadStarterCache();
  const cacheKey = `${params.channelId}:${params.threadTs}`;
  const cached = THREAD_STARTER_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt <= THREAD_STARTER_CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached) {
    THREAD_STARTER_CACHE.delete(cacheKey);
  }
  try {
    const response = await params.client.conversations.replies({
      channel: params.channelId,
      ts: params.threadTs,
      limit: 1,
      inclusive: true,
    });
    const message = response?.messages?.[0];
    const text = (message?.text ?? "").trim();
    if (!message || !text) {
      return null;
    }
    const starter = {
      text,
      userId: message.user,
      ts: message.ts,
      files: message.files,
    };
    if (THREAD_STARTER_CACHE.has(cacheKey)) {
      THREAD_STARTER_CACHE.delete(cacheKey);
    }
    THREAD_STARTER_CACHE.set(cacheKey, {
      value: starter,
      cachedAt: Date.now(),
    });
    evictThreadStarterCache();
    return starter;
  } catch {
    return null;
  }
}
export function resetSlackThreadStarterCacheForTest() {
  THREAD_STARTER_CACHE.clear();
}
export async function resolveSlackThreadHistory(params) {
  const maxMessages = params.limit ?? 20;
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) {
    return [];
  }
  const fetchLimit = 200;
  const retained = [];
  let cursor;
  try {
    do {
      const response = await params.client.conversations.replies({
        channel: params.channelId,
        ts: params.threadTs,
        limit: fetchLimit,
        inclusive: true,
        ...(cursor ? { cursor } : {}),
      });
      for (const msg of response.messages ?? []) {
        if (!msg.text?.trim() && !msg.files?.length) {
          continue;
        }
        if (params.currentMessageTs && msg.ts === params.currentMessageTs) {
          continue;
        }
        retained.push(msg);
        if (retained.length > maxMessages) {
          retained.shift();
        }
      }
      const next = response.response_metadata?.next_cursor;
      cursor = typeof next === "string" && next.trim().length > 0 ? next.trim() : undefined;
    } while (cursor);
    return retained.map((msg) => ({
      text: msg.text?.trim()
        ? msg.text
        : `[attached: ${msg.files?.map((f) => f.name ?? "file").join(", ")}]`,
      userId: msg.user,
      botId: msg.bot_id,
      ts: msg.ts,
      files: msg.files,
    }));
  } catch {
    return [];
  }
}
