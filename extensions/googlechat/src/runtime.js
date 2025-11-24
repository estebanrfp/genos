let runtime = null;
export function setGoogleChatRuntime(next) {
  runtime = next;
}
export function getGoogleChatRuntime() {
  if (!runtime) {
    throw new Error("Google Chat runtime not initialized");
  }
  return runtime;
}
