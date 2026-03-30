export function extractBatchErrorMessage(lines) {
  const first = lines.find((line) => line.error?.message || line.response?.body?.error);
  return (
    first?.error?.message ??
    (typeof first?.response?.body?.error?.message === "string"
      ? first?.response?.body?.error?.message
      : undefined)
  );
}
export function formatUnavailableBatchError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message ? `error file unavailable: ${message}` : undefined;
}
