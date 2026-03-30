let runtime = null;
export function setSlackRuntime(next) {
  runtime = next;
}
export function getSlackRuntime() {
  if (!runtime) {
    throw new Error("Slack runtime not initialized");
  }
  return runtime;
}
