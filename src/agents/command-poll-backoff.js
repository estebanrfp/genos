const BACKOFF_SCHEDULE_MS = [5000, 1e4, 30000, 60000];
export function calculateBackoffMs(consecutiveNoOutputPolls) {
  const index = Math.min(consecutiveNoOutputPolls, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[index] ?? 60000;
}
export function recordCommandPoll(state, commandId, hasNewOutput) {
  if (!state.commandPollCounts) {
    state.commandPollCounts = new Map();
  }
  const existing = state.commandPollCounts.get(commandId);
  const now = Date.now();
  if (hasNewOutput) {
    state.commandPollCounts.set(commandId, { count: 0, lastPollAt: now });
    return BACKOFF_SCHEDULE_MS[0] ?? 5000;
  }
  const newCount = (existing?.count ?? -1) + 1;
  state.commandPollCounts.set(commandId, { count: newCount, lastPollAt: now });
  return calculateBackoffMs(newCount);
}
export function getCommandPollSuggestion(state, commandId) {
  const pollData = state.commandPollCounts?.get(commandId);
  if (!pollData) {
    return;
  }
  return calculateBackoffMs(pollData.count);
}
export function resetCommandPollCount(state, commandId) {
  state.commandPollCounts?.delete(commandId);
}
export function pruneStaleCommandPolls(state, maxAgeMs = 3600000) {
  if (!state.commandPollCounts) {
    return;
  }
  const now = Date.now();
  for (const [commandId, data] of state.commandPollCounts.entries()) {
    if (now - data.lastPollAt > maxAgeMs) {
      state.commandPollCounts.delete(commandId);
    }
  }
}
