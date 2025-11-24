export function createSessionManagerRuntimeRegistry() {
  const registry = new WeakMap();
  const set = (sessionManager, value) => {
    if (!sessionManager || typeof sessionManager !== "object") {
      return;
    }
    const key = sessionManager;
    if (value === null) {
      registry.delete(key);
      return;
    }
    registry.set(key, value);
  };
  const get = (sessionManager) => {
    if (!sessionManager || typeof sessionManager !== "object") {
      return null;
    }
    return registry.get(sessionManager) ?? null;
  };
  return { set, get };
}
