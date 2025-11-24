let getResolvedFetch = function (fetcher) {
  const fetchImpl = resolveFetch(fetcher);
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  return fetchImpl;
};
import { resolveFetch } from "../infra/fetch.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { normalizeDiscordToken } from "./token.js";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_APP_FLAG_GATEWAY_PRESENCE = 1 << 12;
const DISCORD_APP_FLAG_GATEWAY_PRESENCE_LIMITED = 1 << 13;
const DISCORD_APP_FLAG_GATEWAY_GUILD_MEMBERS = 1 << 14;
const DISCORD_APP_FLAG_GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;
const DISCORD_APP_FLAG_GATEWAY_MESSAGE_CONTENT = 1 << 18;
const DISCORD_APP_FLAG_GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
async function fetchDiscordApplicationMe(token, timeoutMs, fetcher) {
  const normalized = normalizeDiscordToken(token);
  if (!normalized) {
    return;
  }
  try {
    const res = await fetchWithTimeout(
      `${DISCORD_API_BASE}/oauth2/applications/@me`,
      { headers: { Authorization: `Bot ${normalized}` } },
      timeoutMs,
      getResolvedFetch(fetcher),
    );
    if (!res.ok) {
      return;
    }
    return await res.json();
  } catch {
    return;
  }
}
export function resolveDiscordPrivilegedIntentsFromFlags(flags) {
  const resolve = (enabledBit, limitedBit) => {
    if ((flags & enabledBit) !== 0) {
      return "enabled";
    }
    if ((flags & limitedBit) !== 0) {
      return "limited";
    }
    return "disabled";
  };
  return {
    presence: resolve(DISCORD_APP_FLAG_GATEWAY_PRESENCE, DISCORD_APP_FLAG_GATEWAY_PRESENCE_LIMITED),
    guildMembers: resolve(
      DISCORD_APP_FLAG_GATEWAY_GUILD_MEMBERS,
      DISCORD_APP_FLAG_GATEWAY_GUILD_MEMBERS_LIMITED,
    ),
    messageContent: resolve(
      DISCORD_APP_FLAG_GATEWAY_MESSAGE_CONTENT,
      DISCORD_APP_FLAG_GATEWAY_MESSAGE_CONTENT_LIMITED,
    ),
  };
}
export async function fetchDiscordApplicationSummary(token, timeoutMs, fetcher = fetch) {
  const json = await fetchDiscordApplicationMe(token, timeoutMs, fetcher);
  if (!json) {
    return;
  }
  const flags =
    typeof json.flags === "number" && Number.isFinite(json.flags) ? json.flags : undefined;
  return {
    id: json.id ?? null,
    flags: flags ?? null,
    intents:
      typeof flags === "number" ? resolveDiscordPrivilegedIntentsFromFlags(flags) : undefined,
  };
}
export async function probeDiscord(token, timeoutMs, opts) {
  const started = Date.now();
  const fetcher = opts?.fetcher ?? fetch;
  const includeApplication = opts?.includeApplication === true;
  const normalized = normalizeDiscordToken(token);
  const result = {
    ok: false,
    status: null,
    error: null,
    elapsedMs: 0,
  };
  if (!normalized) {
    return {
      ...result,
      error: "missing token",
      elapsedMs: Date.now() - started,
    };
  }
  try {
    const res = await fetchWithTimeout(
      `${DISCORD_API_BASE}/users/@me`,
      { headers: { Authorization: `Bot ${normalized}` } },
      timeoutMs,
      getResolvedFetch(fetcher),
    );
    if (!res.ok) {
      result.status = res.status;
      result.error = `getMe failed (${res.status})`;
      return { ...result, elapsedMs: Date.now() - started };
    }
    const json = await res.json();
    result.ok = true;
    result.bot = {
      id: json.id ?? null,
      username: json.username ?? null,
    };
    if (includeApplication) {
      result.application =
        (await fetchDiscordApplicationSummary(normalized, timeoutMs, fetcher)) ?? undefined;
    }
    return { ...result, elapsedMs: Date.now() - started };
  } catch (err) {
    return {
      ...result,
      status: err instanceof Response ? err.status : result.status,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}
export async function fetchDiscordApplicationId(token, timeoutMs, fetcher = fetch) {
  const json = await fetchDiscordApplicationMe(token, timeoutMs, fetcher);
  return json?.id ?? undefined;
}
