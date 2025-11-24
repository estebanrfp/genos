export function parseRestartRequestParams(params) {
  const sessionKey =
    typeof params.sessionKey === "string" ? params.sessionKey?.trim() || undefined : undefined;
  const note = typeof params.note === "string" ? params.note?.trim() || undefined : undefined;
  const restartDelayMsRaw = params.restartDelayMs;
  const restartDelayMs =
    typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
      ? Math.max(0, Math.floor(restartDelayMsRaw))
      : undefined;
  return { sessionKey, note, restartDelayMs };
}
