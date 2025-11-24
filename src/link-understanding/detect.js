let stripMarkdownLinks = function (message) {
    return message.replace(MARKDOWN_LINK_RE, " ");
  },
  resolveMaxLinks = function (value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return DEFAULT_MAX_LINKS;
  },
  isAllowedUrl = function (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      if (isBlockedHost(parsed.hostname)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },
  isBlockedHost = function (hostname) {
    const normalized = hostname.trim().toLowerCase();
    return (
      normalized === "localhost.localdomain" ||
      isBlockedHostname(normalized) ||
      isPrivateIpAddress(normalized)
    );
  };
import { isBlockedHostname, isPrivateIpAddress } from "../infra/net/ssrf.js";
import { DEFAULT_MAX_LINKS } from "./defaults.js";
const MARKDOWN_LINK_RE = /\[[^\]]*]\((https?:\/\/\S+?)\)/gi;
const BARE_LINK_RE = /https?:\/\/\S+/gi;
export function extractLinksFromMessage(message, opts) {
  const source = message?.trim();
  if (!source) {
    return [];
  }
  const maxLinks = resolveMaxLinks(opts?.maxLinks);
  const sanitized = stripMarkdownLinks(source);
  const seen = new Set();
  const results = [];
  for (const match of sanitized.matchAll(BARE_LINK_RE)) {
    const raw = match[0]?.trim();
    if (!raw) {
      continue;
    }
    if (!isAllowedUrl(raw)) {
      continue;
    }
    if (seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    results.push(raw);
    if (results.length >= maxLinks) {
      break;
    }
  }
  return results;
}
