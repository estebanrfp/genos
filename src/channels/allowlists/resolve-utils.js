export function mergeAllowlist(params) {
  const seen = new Set();
  const merged = [];
  const push = (value) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(normalized);
  };
  for (const entry of params.existing ?? []) {
    push(String(entry));
  }
  for (const entry of params.additions) {
    push(entry);
  }
  return merged;
}
export function buildAllowlistResolutionSummary(resolvedUsers, opts) {
  const resolvedMap = new Map(resolvedUsers.map((entry) => [entry.input, entry]));
  const resolvedOk = (entry) => Boolean(entry.resolved && entry.id);
  const formatResolved = opts?.formatResolved ?? ((entry) => `${entry.input}\u2192${entry.id}`);
  const mapping = resolvedUsers.filter(resolvedOk).map(formatResolved);
  const additions = resolvedUsers
    .filter(resolvedOk)
    .map((entry) => entry.id)
    .filter((entry) => Boolean(entry));
  const unresolved = resolvedUsers
    .filter((entry) => !resolvedOk(entry))
    .map((entry) => entry.input);
  return { resolvedMap, mapping, unresolved, additions };
}
export function resolveAllowlistIdAdditions(params) {
  const additions = [];
  for (const entry of params.existing) {
    const trimmed = String(entry).trim();
    const resolved = params.resolvedMap.get(trimmed);
    if (resolved?.resolved && resolved.id) {
      additions.push(resolved.id);
    }
  }
  return additions;
}
export function patchAllowlistUsersInConfigEntries(params) {
  const nextEntries = { ...params.entries };
  for (const [entryKey, entryConfig] of Object.entries(params.entries)) {
    if (!entryConfig || typeof entryConfig !== "object") {
      continue;
    }
    const users = entryConfig.users;
    if (!Array.isArray(users) || users.length === 0) {
      continue;
    }
    const additions = resolveAllowlistIdAdditions({
      existing: users,
      resolvedMap: params.resolvedMap,
    });
    nextEntries[entryKey] = {
      ...entryConfig,
      users: mergeAllowlist({ existing: users, additions }),
    };
  }
  return nextEntries;
}
export function addAllowlistUserEntriesFromConfigEntry(target, entry) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const users = entry.users;
  if (!Array.isArray(users)) {
    return;
  }
  for (const value of users) {
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== "*") {
      target.add(trimmed);
    }
  }
}
export function summarizeMapping(label, mapping, unresolved, runtime) {
  const lines = [];
  if (mapping.length > 0) {
    const sample = mapping.slice(0, 6);
    const suffix = mapping.length > sample.length ? ` (+${mapping.length - sample.length})` : "";
    lines.push(`${label} resolved: ${sample.join(", ")}${suffix}`);
  }
  if (unresolved.length > 0) {
    const sample = unresolved.slice(0, 6);
    const suffix =
      unresolved.length > sample.length ? ` (+${unresolved.length - sample.length})` : "";
    lines.push(`${label} unresolved: ${sample.join(", ")}${suffix}`);
  }
  if (lines.length > 0) {
    runtime.log?.(lines.join("\n"));
  }
}
