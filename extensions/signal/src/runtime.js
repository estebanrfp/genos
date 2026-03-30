let runtime = null;
export function setSignalRuntime(next) {
  runtime = next;
}
export function getSignalRuntime() {
  if (!runtime) {
    throw new Error("Signal runtime not initialized");
  }
  return runtime;
}
