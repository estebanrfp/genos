const activeDispatchers = new Set();
let nextId = 0;
export function registerDispatcher(dispatcher) {
  const id = `dispatcher-${++nextId}`;
  const tracked = {
    id,
    pending: dispatcher.pending,
    waitForIdle: dispatcher.waitForIdle,
  };
  activeDispatchers.add(tracked);
  const unregister = () => {
    activeDispatchers.delete(tracked);
  };
  return { id, unregister };
}
export function getTotalPendingReplies() {
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    total += dispatcher.pending();
  }
  return total;
}
export function clearAllDispatchers() {
  if (!process.env.VITEST && true) {
    throw new Error("clearAllDispatchers() is only available in test environments");
  }
  activeDispatchers.clear();
}
