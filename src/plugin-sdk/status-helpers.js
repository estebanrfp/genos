export function createDefaultChannelRuntimeState(accountId, extra) {
  return {
    accountId,
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    ...extra,
  };
}
export function buildBaseChannelStatusSummary(snapshot) {
  return {
    configured: snapshot.configured ?? false,
    running: snapshot.running ?? false,
    lastStartAt: snapshot.lastStartAt ?? null,
    lastStopAt: snapshot.lastStopAt ?? null,
    lastError: snapshot.lastError ?? null,
  };
}
export function collectStatusIssuesFromLastError(channel, accounts) {
  return accounts.flatMap((account) => {
    const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
    if (!lastError) {
      return [];
    }
    return [
      {
        channel,
        accountId: account.accountId,
        kind: "runtime",
        message: `Channel error: ${lastError}`,
      },
    ];
  });
}
