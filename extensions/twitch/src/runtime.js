let runtime = null;
export function setTwitchRuntime(next) {
  runtime = next;
}
export function getTwitchRuntime() {
  if (!runtime) {
    throw new Error("Twitch runtime not initialized");
  }
  return runtime;
}
