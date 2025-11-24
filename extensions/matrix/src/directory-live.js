let normalizeQuery = function (value) {
    return value?.trim().toLowerCase() ?? "";
  },
  resolveMatrixDirectoryLimit = function (limit) {
    return typeof limit === "number" && limit > 0 ? limit : 20;
  },
  createGroupDirectoryEntry = function (params) {
    return {
      kind: "group",
      id: params.id,
      name: params.name,
      handle: params.handle,
    };
  };
import { resolveMatrixAuth } from "./matrix/client.js";
async function fetchMatrixJson(params) {
  const res = await fetch(`${params.homeserver}${params.path}`, {
    method: params.method ?? "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Matrix API ${params.path} failed (${res.status}): ${text || "unknown error"}`);
  }
  return await res.json();
}
async function resolveMatrixDirectoryContext(params) {
  const query = normalizeQuery(params.query);
  if (!query) {
    return null;
  }
  const auth = await resolveMatrixAuth({ cfg: params.cfg, accountId: params.accountId });
  return { query, auth };
}
export async function listMatrixDirectoryPeersLive(params) {
  const context = await resolveMatrixDirectoryContext(params);
  if (!context) {
    return [];
  }
  const { query, auth } = context;
  const res = await fetchMatrixJson({
    homeserver: auth.homeserver,
    accessToken: auth.accessToken,
    path: "/_matrix/client/v3/user_directory/search",
    method: "POST",
    body: {
      search_term: query,
      limit: resolveMatrixDirectoryLimit(params.limit),
    },
  });
  const results = res.results ?? [];
  return results
    .map((entry) => {
      const userId = entry.user_id?.trim();
      if (!userId) {
        return null;
      }
      return {
        kind: "user",
        id: userId,
        name: entry.display_name?.trim() || undefined,
        handle: entry.display_name ? `@${entry.display_name.trim()}` : undefined,
        raw: entry,
      };
    })
    .filter(Boolean);
}
async function resolveMatrixRoomAlias(homeserver, accessToken, alias) {
  try {
    const res = await fetchMatrixJson({
      homeserver,
      accessToken,
      path: `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
    });
    return res.room_id?.trim() || null;
  } catch {
    return null;
  }
}
async function fetchMatrixRoomName(homeserver, accessToken, roomId) {
  try {
    const res = await fetchMatrixJson({
      homeserver,
      accessToken,
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
    });
    return res.name?.trim() || null;
  } catch {
    return null;
  }
}
export async function listMatrixDirectoryGroupsLive(params) {
  const context = await resolveMatrixDirectoryContext(params);
  if (!context) {
    return [];
  }
  const { query, auth } = context;
  const limit = resolveMatrixDirectoryLimit(params.limit);
  if (query.startsWith("#")) {
    const roomId = await resolveMatrixRoomAlias(auth.homeserver, auth.accessToken, query);
    if (!roomId) {
      return [];
    }
    return [createGroupDirectoryEntry({ id: roomId, name: query, handle: query })];
  }
  if (query.startsWith("!")) {
    return [createGroupDirectoryEntry({ id: query, name: query })];
  }
  const joined = await fetchMatrixJson({
    homeserver: auth.homeserver,
    accessToken: auth.accessToken,
    path: "/_matrix/client/v3/joined_rooms",
  });
  const rooms = joined.joined_rooms ?? [];
  const results = [];
  for (const roomId of rooms) {
    const name = await fetchMatrixRoomName(auth.homeserver, auth.accessToken, roomId);
    if (!name) {
      continue;
    }
    if (!name.toLowerCase().includes(query)) {
      continue;
    }
    results.push({
      kind: "group",
      id: roomId,
      name,
      handle: `#${name}`,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}
