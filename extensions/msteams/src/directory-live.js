import {
  escapeOData,
  fetchGraphJson,
  listChannelsForTeam,
  listTeamsByName,
  normalizeQuery,
  resolveGraphToken,
} from "./graph.js";
export async function listMSTeamsDirectoryPeersLive(params) {
  const query = normalizeQuery(params.query);
  if (!query) {
    return [];
  }
  const token = await resolveGraphToken(params.cfg);
  const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 20;
  let users = [];
  if (query.includes("@")) {
    const escaped = escapeOData(query);
    const filter = `(mail eq '${escaped}' or userPrincipalName eq '${escaped}')`;
    const path = `/users?\$filter=${encodeURIComponent(filter)}&\$select=id,displayName,mail,userPrincipalName`;
    const res = await fetchGraphJson({ token, path });
    users = res.value ?? [];
  } else {
    const path = `/users?\$search=${encodeURIComponent(`"displayName:${query}"`)}&\$select=id,displayName,mail,userPrincipalName&\$top=${limit}`;
    const res = await fetchGraphJson({
      token,
      path,
      headers: { ConsistencyLevel: "eventual" },
    });
    users = res.value ?? [];
  }
  return users
    .map((user) => {
      const id = user.id?.trim();
      if (!id) {
        return null;
      }
      const name = user.displayName?.trim();
      const handle = user.userPrincipalName?.trim() || user.mail?.trim();
      return {
        kind: "user",
        id: `user:${id}`,
        name: name || undefined,
        handle: handle ? `@${handle}` : undefined,
        raw: user,
      };
    })
    .filter(Boolean);
}
export async function listMSTeamsDirectoryGroupsLive(params) {
  const rawQuery = normalizeQuery(params.query);
  if (!rawQuery) {
    return [];
  }
  const token = await resolveGraphToken(params.cfg);
  const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 20;
  const [teamQuery, channelQuery] = rawQuery.includes("/")
    ? rawQuery
        .split("/", 2)
        .map((part) => part.trim())
        .filter(Boolean)
    : [rawQuery, null];
  const teams = await listTeamsByName(token, teamQuery);
  const results = [];
  for (const team of teams) {
    const teamId = team.id?.trim();
    if (!teamId) {
      continue;
    }
    const teamName = team.displayName?.trim() || teamQuery;
    if (!channelQuery) {
      results.push({
        kind: "group",
        id: `team:${teamId}`,
        name: teamName,
        handle: teamName ? `#${teamName}` : undefined,
        raw: team,
      });
      if (results.length >= limit) {
        return results;
      }
      continue;
    }
    const channels = await listChannelsForTeam(token, teamId);
    for (const channel of channels) {
      const name = channel.displayName?.trim();
      if (!name) {
        continue;
      }
      if (!name.toLowerCase().includes(channelQuery.toLowerCase())) {
        continue;
      }
      results.push({
        kind: "group",
        id: `conversation:${channel.id}`,
        name: `${teamName}/${name}`,
        handle: `#${name}`,
        raw: channel,
      });
      if (results.length >= limit) {
        return results;
      }
    }
  }
  return results;
}
