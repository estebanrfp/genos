let addAllowFromAndDmsIds = function (ids, allowFrom, dms) {
    for (const entry of allowFrom ?? []) {
      const raw = String(entry).trim();
      if (!raw || raw === "*") {
        continue;
      }
      ids.add(raw);
    }
    for (const id of Object.keys(dms ?? {})) {
      const trimmed = id.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  },
  resolveDirectoryQuery = function (query) {
    return query?.trim().toLowerCase() || "";
  },
  resolveDirectoryLimit = function (limit) {
    return typeof limit === "number" && limit > 0 ? limit : undefined;
  },
  applyDirectoryQueryAndLimit = function (ids, params) {
    const q = resolveDirectoryQuery(params.query);
    const limit = resolveDirectoryLimit(params.limit);
    const filtered = ids.filter((id) => (q ? id.toLowerCase().includes(q) : true));
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
  },
  toDirectoryEntries = function (kind, ids) {
    return ids.map((id) => ({ kind, id }));
  };
import { resolveDiscordAccount } from "../../discord/accounts.js";
import { resolveSlackAccount } from "../../slack/accounts.js";
import { resolveTelegramAccount } from "../../telegram/accounts.js";
import { resolveWhatsAppAccount } from "../../web/accounts.js";
import { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";
import { normalizeSlackMessagingTarget } from "./normalize/slack.js";
export async function listSlackDirectoryPeersFromConfig(params) {
  const account = resolveSlackAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = new Set();
  addAllowFromAndDmsIds(ids, account.config.allowFrom ?? account.dm?.allowFrom, account.config.dms);
  for (const channel of Object.values(account.config.channels ?? {})) {
    for (const user of channel.users ?? []) {
      const raw = String(user).trim();
      if (raw) {
        ids.add(raw);
      }
    }
  }
  const normalizedIds = Array.from(ids)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const mention = raw.match(/^<@([A-Z0-9]+)>$/i);
      const normalizedUserId = (mention?.[1] ?? raw).replace(/^(slack|user):/i, "").trim();
      if (!normalizedUserId) {
        return null;
      }
      const target = `user:${normalizedUserId}`;
      return normalizeSlackMessagingTarget(target) ?? target.toLowerCase();
    })
    .filter((id) => Boolean(id))
    .filter((id) => id.startsWith("user:"));
  return toDirectoryEntries("user", applyDirectoryQueryAndLimit(normalizedIds, params));
}
export async function listSlackDirectoryGroupsFromConfig(params) {
  const account = resolveSlackAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = Object.keys(account.config.channels ?? {})
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => normalizeSlackMessagingTarget(raw) ?? raw.toLowerCase())
    .filter((id) => id.startsWith("channel:"));
  return toDirectoryEntries("group", applyDirectoryQueryAndLimit(ids, params));
}
export async function listDiscordDirectoryPeersFromConfig(params) {
  const account = resolveDiscordAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = new Set();
  addAllowFromAndDmsIds(
    ids,
    account.config.allowFrom ?? account.config.dm?.allowFrom,
    account.config.dms,
  );
  for (const guild of Object.values(account.config.guilds ?? {})) {
    for (const entry of guild.users ?? []) {
      const raw = String(entry).trim();
      if (raw) {
        ids.add(raw);
      }
    }
    for (const channel of Object.values(guild.channels ?? {})) {
      for (const user of channel.users ?? []) {
        const raw = String(user).trim();
        if (raw) {
          ids.add(raw);
        }
      }
    }
  }
  const normalizedIds = Array.from(ids)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const mention = raw.match(/^<@!?(\d+)>$/);
      const cleaned = (mention?.[1] ?? raw).replace(/^(discord|user):/i, "").trim();
      if (!/^\d+$/.test(cleaned)) {
        return null;
      }
      return `user:${cleaned}`;
    })
    .filter((id) => Boolean(id));
  return toDirectoryEntries("user", applyDirectoryQueryAndLimit(normalizedIds, params));
}
export async function listDiscordDirectoryGroupsFromConfig(params) {
  const account = resolveDiscordAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = new Set();
  for (const guild of Object.values(account.config.guilds ?? {})) {
    for (const channelId of Object.keys(guild.channels ?? {})) {
      const trimmed = channelId.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  }
  const normalizedIds = Array.from(ids)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const mention = raw.match(/^<#(\d+)>$/);
      const cleaned = (mention?.[1] ?? raw).replace(/^(discord|channel|group):/i, "").trim();
      if (!/^\d+$/.test(cleaned)) {
        return null;
      }
      return `channel:${cleaned}`;
    })
    .filter((id) => Boolean(id));
  return toDirectoryEntries("group", applyDirectoryQueryAndLimit(normalizedIds, params));
}
export async function listTelegramDirectoryPeersFromConfig(params) {
  const account = resolveTelegramAccount({ cfg: params.cfg, accountId: params.accountId });
  const raw = [
    ...(account.config.allowFrom ?? []).map((entry) => String(entry)),
    ...Object.keys(account.config.dms ?? {}),
  ];
  const ids = Array.from(
    new Set(
      raw
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(telegram|tg):/i, "")),
    ),
  )
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return null;
      }
      if (/^-?\d+$/.test(trimmed)) {
        return trimmed;
      }
      const withAt = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
      return withAt;
    })
    .filter((id) => Boolean(id));
  return toDirectoryEntries("user", applyDirectoryQueryAndLimit(ids, params));
}
export async function listTelegramDirectoryGroupsFromConfig(params) {
  const account = resolveTelegramAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = Object.keys(account.config.groups ?? {})
    .map((id) => id.trim())
    .filter((id) => Boolean(id) && id !== "*");
  return toDirectoryEntries("group", applyDirectoryQueryAndLimit(ids, params));
}
export async function listWhatsAppDirectoryPeersFromConfig(params) {
  const account = resolveWhatsAppAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = (account.allowFrom ?? [])
    .map((entry) => String(entry).trim())
    .filter((entry) => Boolean(entry) && entry !== "*")
    .map((entry) => normalizeWhatsAppTarget(entry) ?? "")
    .filter(Boolean)
    .filter((id) => !isWhatsAppGroupJid(id));
  return toDirectoryEntries("user", applyDirectoryQueryAndLimit(ids, params));
}
export async function listWhatsAppDirectoryGroupsFromConfig(params) {
  const account = resolveWhatsAppAccount({ cfg: params.cfg, accountId: params.accountId });
  const ids = Object.keys(account.groups ?? {})
    .map((id) => id.trim())
    .filter((id) => Boolean(id) && id !== "*");
  return toDirectoryEntries("group", applyDirectoryQueryAndLimit(ids, params));
}
