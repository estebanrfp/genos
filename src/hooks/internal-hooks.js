const handlers = new Map();
export function registerInternalHook(eventKey, handler) {
  if (!handlers.has(eventKey)) {
    handlers.set(eventKey, []);
  }
  handlers.get(eventKey).push(handler);
}
export function unregisterInternalHook(eventKey, handler) {
  const eventHandlers = handlers.get(eventKey);
  if (!eventHandlers) {
    return;
  }
  const index = eventHandlers.indexOf(handler);
  if (index !== -1) {
    eventHandlers.splice(index, 1);
  }
  if (eventHandlers.length === 0) {
    handlers.delete(eventKey);
  }
}
export function clearInternalHooks() {
  handlers.clear();
}
export function getRegisteredEventKeys() {
  return Array.from(handlers.keys());
}
export async function triggerInternalHook(event) {
  const typeHandlers = handlers.get(event.type) ?? [];
  const specificHandlers = handlers.get(`${event.type}:${event.action}`) ?? [];
  const allHandlers = [...typeHandlers, ...specificHandlers];
  if (allHandlers.length === 0) {
    return;
  }
  for (const handler of allHandlers) {
    try {
      await handler(event);
    } catch (err) {
      console.error(
        `Hook error [${event.type}:${event.action}]:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
export function createInternalHookEvent(type, action, sessionKey, context = {}) {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  };
}
export function isAgentBootstrapEvent(event) {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return false;
  }
  const context = event.context;
  if (!context || typeof context !== "object") {
    return false;
  }
  if (typeof context.workspaceDir !== "string") {
    return false;
  }
  return Array.isArray(context.bootstrapFiles);
}
export function isGatewayStartupEvent(event) {
  if (event.type !== "gateway" || event.action !== "startup") {
    return false;
  }
  const context = event.context;
  return Boolean(context && typeof context === "object");
}
export function isMessageReceivedEvent(event) {
  if (event.type !== "message" || event.action !== "received") {
    return false;
  }
  const context = event.context;
  if (!context || typeof context !== "object") {
    return false;
  }
  return typeof context.from === "string" && typeof context.channelId === "string";
}
export function isMessageSentEvent(event) {
  if (event.type !== "message" || event.action !== "sent") {
    return false;
  }
  const context = event.context;
  if (!context || typeof context !== "object") {
    return false;
  }
  return (
    typeof context.to === "string" &&
    typeof context.channelId === "string" &&
    typeof context.success === "boolean"
  );
}
