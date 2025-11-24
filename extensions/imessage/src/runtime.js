let runtime = null;
export function setIMessageRuntime(next) {
  runtime = next;
}
export function getIMessageRuntime() {
  if (!runtime) {
    throw new Error("iMessage runtime not initialized");
  }
  return runtime;
}
