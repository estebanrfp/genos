export function buildAnnounceIdFromChildRun(params) {
  return `v1:${params.childSessionKey}:${params.childRunId}`;
}
export function buildAnnounceIdempotencyKey(announceId) {
  return `announce:${announceId}`;
}
export function resolveQueueAnnounceId(params) {
  const announceId = params.announceId?.trim();
  if (announceId) {
    return announceId;
  }
  return `legacy:${params.sessionKey}:${params.enqueuedAt}`;
}
