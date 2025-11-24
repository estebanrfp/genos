let stripProviderPrefix = function (raw) {
    return raw.replace(/^(msteams|teams):/i, "");
  },
  normalizeMSTeamsTeamKey = function (raw) {
    const trimmed = stripProviderPrefix(raw)
      .replace(/^team:/i, "")
      .trim();
    return trimmed || undefined;
  },
  normalizeMSTeamsChannelKey = function (raw) {
    const trimmed = raw?.trim().replace(/^#/, "").trim() ?? "";
    return trimmed || undefined;
  };
import {
  escapeOData,
  fetchGraphJson,
  listChannelsForTeam,
  listTeamsByName,
  normalizeQuery,
  resolveGraphToken,
} from "./graph.js";
export function normalizeMSTeamsMessagingTarget(raw) {
  let trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  trimmed = stripProviderPrefix(trimmed).trim();
  if (/^conversation:/i.test(trimmed)) {
    const id = trimmed.slice("conversation:".length).trim();
    return id ? `conversation:${id}` : undefined;
  }
  if (/^user:/i.test(trimmed)) {
    const id = trimmed.slice("user:".length).trim();
    return id ? `user:${id}` : undefined;
  }
  return trimmed || undefined;
}
export function normalizeMSTeamsUserInput(raw) {
  return stripProviderPrefix(raw)
    .replace(/^(user|conversation):/i, "")
    .trim();
}
export function parseMSTeamsConversationId(raw) {
  const trimmed = stripProviderPrefix(raw).trim();
  if (!/^conversation:/i.test(trimmed)) {
    return null;
  }
  const id = trimmed.slice("conversation:".length).trim();
  return id;
}
export function parseMSTeamsTeamChannelInput(raw) {
  const trimmed = stripProviderPrefix(raw).trim();
  if (!trimmed) {
    return {};
  }
  const parts = trimmed.split("/");
  const team = normalizeMSTeamsTeamKey(parts[0] ?? "");
  const channel =
    parts.length > 1 ? normalizeMSTeamsChannelKey(parts.slice(1).join("/")) : undefined;
  return {
    ...(team ? { team } : {}),
    ...(channel ? { channel } : {}),
  };
}
export function parseMSTeamsTeamEntry(raw) {
  const { team, channel } = parseMSTeamsTeamChannelInput(raw);
  if (!team) {
    return null;
  }
  return {
    teamKey: team,
    ...(channel ? { channelKey: channel } : {}),
  };
}
export async function resolveMSTeamsChannelAllowlist(params) {
  const token = await resolveGraphToken(params.cfg);
  const results = [];
  for (const input of params.entries) {
    const { team, channel } = parseMSTeamsTeamChannelInput(input);
    if (!team) {
      results.push({ input, resolved: false });
      continue;
    }
    const teams = /^[0-9a-fA-F-]{16,}$/.test(team)
      ? [{ id: team, displayName: team }]
      : await listTeamsByName(token, team);
    if (teams.length === 0) {
      results.push({ input, resolved: false, note: "team not found" });
      continue;
    }
    const teamMatch = teams[0];
    const teamId = teamMatch.id?.trim();
    const teamName = teamMatch.displayName?.trim() || team;
    if (!teamId) {
      results.push({ input, resolved: false, note: "team id missing" });
      continue;
    }
    if (!channel) {
      results.push({
        input,
        resolved: true,
        teamId,
        teamName,
        note: teams.length > 1 ? "multiple teams; chose first" : undefined,
      });
      continue;
    }
    const channels = await listChannelsForTeam(token, teamId);
    const channelMatch =
      channels.find((item) => item.id === channel) ??
      channels.find((item) => item.displayName?.toLowerCase() === channel.toLowerCase()) ??
      channels.find((item) =>
        item.displayName?.toLowerCase().includes(channel.toLowerCase() ?? ""),
      );
    if (!channelMatch?.id) {
      results.push({ input, resolved: false, note: "channel not found" });
      continue;
    }
    results.push({
      input,
      resolved: true,
      teamId,
      teamName,
      channelId: channelMatch.id,
      channelName: channelMatch.displayName ?? channel,
      note: channels.length > 1 ? "multiple channels; chose first" : undefined,
    });
  }
  return results;
}
export async function resolveMSTeamsUserAllowlist(params) {
  const token = await resolveGraphToken(params.cfg);
  const results = [];
  for (const input of params.entries) {
    const query = normalizeQuery(normalizeMSTeamsUserInput(input));
    if (!query) {
      results.push({ input, resolved: false });
      continue;
    }
    if (/^[0-9a-fA-F-]{16,}$/.test(query)) {
      results.push({ input, resolved: true, id: query });
      continue;
    }
    let users = [];
    if (query.includes("@")) {
      const escaped = escapeOData(query);
      const filter = `(mail eq '${escaped}' or userPrincipalName eq '${escaped}')`;
      const path = `/users?\$filter=${encodeURIComponent(filter)}&\$select=id,displayName,mail,userPrincipalName`;
      const res = await fetchGraphJson({ token, path });
      users = res.value ?? [];
    } else {
      const path = `/users?\$search=${encodeURIComponent(`"displayName:${query}"`)}&\$select=id,displayName,mail,userPrincipalName&\$top=10`;
      const res = await fetchGraphJson({
        token,
        path,
        headers: { ConsistencyLevel: "eventual" },
      });
      users = res.value ?? [];
    }
    const match = users[0];
    if (!match?.id) {
      results.push({ input, resolved: false });
      continue;
    }
    results.push({
      input,
      resolved: true,
      id: match.id,
      name: match.displayName ?? undefined,
      note: users.length > 1 ? "multiple matches; chose first" : undefined,
    });
  }
  return results;
}
