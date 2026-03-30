let readNestedString = function (value, keys) {
    let current = value;
    for (const key of keys) {
      if (!isRecord(current)) {
        return;
      }
      current = current[key];
    }
    return typeof current === "string" && current.trim() ? current.trim() : undefined;
  },
  normalizeGraphAttachment = function (att) {
    let content = att.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {}
    }
    return {
      contentType: normalizeContentType(att.contentType) ?? undefined,
      contentUrl: att.contentUrl ?? undefined,
      name: att.name ?? undefined,
      thumbnailUrl: att.thumbnailUrl ?? undefined,
      content,
    };
  };
import { getMSTeamsRuntime } from "../runtime.js";
import { downloadMSTeamsAttachments } from "./download.js";
import {
  GRAPH_ROOT,
  inferPlaceholder,
  isRecord,
  normalizeContentType,
  resolveAllowedHosts,
} from "./shared.js";
export function buildMSTeamsGraphMessageUrls(params) {
  const conversationType = params.conversationType?.trim().toLowerCase() ?? "";
  const messageIdCandidates = new Set();
  const pushCandidate = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) {
      messageIdCandidates.add(trimmed);
    }
  };
  pushCandidate(params.messageId);
  pushCandidate(params.conversationMessageId);
  pushCandidate(readNestedString(params.channelData, ["messageId"]));
  pushCandidate(readNestedString(params.channelData, ["teamsMessageId"]));
  const replyToId = typeof params.replyToId === "string" ? params.replyToId.trim() : "";
  if (conversationType === "channel") {
    const teamId =
      readNestedString(params.channelData, ["team", "id"]) ??
      readNestedString(params.channelData, ["teamId"]);
    const channelId =
      readNestedString(params.channelData, ["channel", "id"]) ??
      readNestedString(params.channelData, ["channelId"]) ??
      readNestedString(params.channelData, ["teamsChannelId"]);
    if (!teamId || !channelId) {
      return [];
    }
    const urls = [];
    if (replyToId) {
      for (const candidate of messageIdCandidates) {
        if (candidate === replyToId) {
          continue;
        }
        urls.push(
          `${GRAPH_ROOT}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(replyToId)}/replies/${encodeURIComponent(candidate)}`,
        );
      }
    }
    if (messageIdCandidates.size === 0 && replyToId) {
      messageIdCandidates.add(replyToId);
    }
    for (const candidate of messageIdCandidates) {
      urls.push(
        `${GRAPH_ROOT}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(candidate)}`,
      );
    }
    return Array.from(new Set(urls));
  }
  const chatId = params.conversationId?.trim() || readNestedString(params.channelData, ["chatId"]);
  if (!chatId) {
    return [];
  }
  if (messageIdCandidates.size === 0 && replyToId) {
    messageIdCandidates.add(replyToId);
  }
  const urls = Array.from(messageIdCandidates).map(
    (candidate) =>
      `${GRAPH_ROOT}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(candidate)}`,
  );
  return Array.from(new Set(urls));
}
async function fetchGraphCollection(params) {
  const fetchFn = params.fetchFn ?? fetch;
  const res = await fetchFn(params.url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const status = res.status;
  if (!res.ok) {
    return { status, items: [] };
  }
  try {
    const data = await res.json();
    return { status, items: Array.isArray(data.value) ? data.value : [] };
  } catch {
    return { status, items: [] };
  }
}
async function downloadGraphHostedContent(params) {
  const hosted = await fetchGraphCollection({
    url: `${params.messageUrl}/hostedContents`,
    accessToken: params.accessToken,
    fetchFn: params.fetchFn,
  });
  if (hosted.items.length === 0) {
    return { media: [], status: hosted.status, count: 0 };
  }
  const out = [];
  for (const item of hosted.items) {
    const contentBytes = typeof item.contentBytes === "string" ? item.contentBytes : "";
    if (!contentBytes) {
      continue;
    }
    let buffer;
    try {
      buffer = Buffer.from(contentBytes, "base64");
    } catch {
      continue;
    }
    if (buffer.byteLength > params.maxBytes) {
      continue;
    }
    const mime = await getMSTeamsRuntime().media.detectMime({
      buffer,
      headerMime: item.contentType ?? undefined,
    });
    try {
      const saved = await getMSTeamsRuntime().channel.media.saveMediaBuffer(
        buffer,
        mime ?? item.contentType ?? undefined,
        "inbound",
        params.maxBytes,
      );
      out.push({
        path: saved.path,
        contentType: saved.contentType,
        placeholder: inferPlaceholder({ contentType: saved.contentType }),
      });
    } catch {}
  }
  return { media: out, status: hosted.status, count: hosted.items.length };
}
export async function downloadMSTeamsGraphMedia(params) {
  if (!params.messageUrl || !params.tokenProvider) {
    return { media: [] };
  }
  const allowHosts = resolveAllowedHosts(params.allowHosts);
  const messageUrl = params.messageUrl;
  let accessToken;
  try {
    accessToken = await params.tokenProvider.getAccessToken("https://graph.microsoft.com");
  } catch {
    return { media: [], messageUrl, tokenError: true };
  }
  const fetchFn = params.fetchFn ?? fetch;
  const sharePointMedia = [];
  const downloadedReferenceUrls = new Set();
  try {
    const msgRes = await fetchFn(messageUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (msgRes.ok) {
      const msgData = await msgRes.json();
      const spAttachments = (msgData.attachments ?? []).filter(
        (a) => a.contentType === "reference" && a.contentUrl && a.name,
      );
      for (const att of spAttachments) {
        const name = att.name ?? "file";
        try {
          const shareUrl = att.contentUrl;
          const encodedUrl = Buffer.from(shareUrl).toString("base64url");
          const sharesUrl = `${GRAPH_ROOT}/shares/u!${encodedUrl}/driveItem/content`;
          const spRes = await fetchFn(sharesUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            redirect: "follow",
          });
          if (spRes.ok) {
            const buffer = Buffer.from(await spRes.arrayBuffer());
            if (buffer.byteLength <= params.maxBytes) {
              const mime = await getMSTeamsRuntime().media.detectMime({
                buffer,
                headerMime: spRes.headers.get("content-type") ?? undefined,
                filePath: name,
              });
              const originalFilename = params.preserveFilenames ? name : undefined;
              const saved = await getMSTeamsRuntime().channel.media.saveMediaBuffer(
                buffer,
                mime ?? "application/octet-stream",
                "inbound",
                params.maxBytes,
                originalFilename,
              );
              sharePointMedia.push({
                path: saved.path,
                contentType: saved.contentType,
                placeholder: inferPlaceholder({ contentType: saved.contentType, fileName: name }),
              });
              downloadedReferenceUrls.add(shareUrl);
            }
          }
        } catch {}
      }
    }
  } catch {}
  const hosted = await downloadGraphHostedContent({
    accessToken,
    messageUrl,
    maxBytes: params.maxBytes,
    fetchFn: params.fetchFn,
    preserveFilenames: params.preserveFilenames,
  });
  const attachments = await fetchGraphCollection({
    url: `${messageUrl}/attachments`,
    accessToken,
    fetchFn: params.fetchFn,
  });
  const normalizedAttachments = attachments.items.map(normalizeGraphAttachment);
  const filteredAttachments =
    sharePointMedia.length > 0
      ? normalizedAttachments.filter((att) => {
          const contentType = att.contentType?.toLowerCase();
          if (contentType !== "reference") {
            return true;
          }
          const url = typeof att.contentUrl === "string" ? att.contentUrl : "";
          if (!url) {
            return true;
          }
          return !downloadedReferenceUrls.has(url);
        })
      : normalizedAttachments;
  const attachmentMedia = await downloadMSTeamsAttachments({
    attachments: filteredAttachments,
    maxBytes: params.maxBytes,
    tokenProvider: params.tokenProvider,
    allowHosts,
    authAllowHosts: params.authAllowHosts,
    fetchFn: params.fetchFn,
    preserveFilenames: params.preserveFilenames,
  });
  return {
    media: [...sharePointMedia, ...hosted.media, ...attachmentMedia],
    hostedCount: hosted.count,
    attachmentCount: filteredAttachments.length + sharePointMedia.length,
    hostedStatus: hosted.status,
    attachmentStatus: attachments.status,
    messageUrl,
  };
}
