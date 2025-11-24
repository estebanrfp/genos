let runtime = null;
export function setNostrRuntime(next) {
  runtime = next;
}
export function getNostrRuntime() {
  if (!runtime) {
    throw new Error("Nostr runtime not initialized");
  }
  return runtime;
}
