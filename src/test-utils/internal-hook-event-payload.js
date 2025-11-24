export function createInternalHookEventPayload(type, action, sessionKey, context) {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  };
}
