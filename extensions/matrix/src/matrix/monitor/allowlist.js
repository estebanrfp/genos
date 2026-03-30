let normalizeAllowList = function (list) {
    return (list ?? []).map((entry) => String(entry).trim()).filter(Boolean);
  },
  normalizeMatrixUser = function (raw) {
    const value = (raw ?? "").trim();
    if (!value) {
      return "";
    }
    if (!value.startsWith("@") || !value.includes(":")) {
      return value.toLowerCase();
    }
    const withoutAt = value.slice(1);
    const splitIndex = withoutAt.indexOf(":");
    if (splitIndex === -1) {
      return value.toLowerCase();
    }
    const localpart = withoutAt.slice(0, splitIndex).toLowerCase();
    const server = withoutAt.slice(splitIndex + 1).toLowerCase();
    if (!server) {
      return value.toLowerCase();
    }
    return `@${localpart}:${server.toLowerCase()}`;
  },
  normalizeMatrixAllowListEntry = function (raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed === "*") {
      return trimmed;
    }
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith("matrix:")) {
      return `matrix:${normalizeMatrixUser(trimmed.slice("matrix:".length))}`;
    }
    if (lowered.startsWith("user:")) {
      return `user:${normalizeMatrixUser(trimmed.slice("user:".length))}`;
    }
    return normalizeMatrixUser(trimmed);
  };
export function normalizeMatrixUserId(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("matrix:")) {
    return normalizeMatrixUser(trimmed.slice("matrix:".length));
  }
  if (lowered.startsWith("user:")) {
    return normalizeMatrixUser(trimmed.slice("user:".length));
  }
  return normalizeMatrixUser(trimmed);
}
export function normalizeMatrixAllowList(list) {
  return normalizeAllowList(list).map((entry) => normalizeMatrixAllowListEntry(entry));
}
export function resolveMatrixAllowListMatch(params) {
  const allowList = params.allowList;
  if (allowList.length === 0) {
    return { allowed: false };
  }
  if (allowList.includes("*")) {
    return { allowed: true, matchKey: "*", matchSource: "wildcard" };
  }
  const userId = normalizeMatrixUser(params.userId);
  const candidates = [
    { value: userId, source: "id" },
    { value: userId ? `matrix:${userId}` : "", source: "prefixed-id" },
    { value: userId ? `user:${userId}` : "", source: "prefixed-user" },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }
    if (allowList.includes(candidate.value)) {
      return {
        allowed: true,
        matchKey: candidate.value,
        matchSource: candidate.source,
      };
    }
  }
  return { allowed: false };
}
export function resolveMatrixAllowListMatches(params) {
  return resolveMatrixAllowListMatch(params).allowed;
}
