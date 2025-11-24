let runtime = null;
export function setMSTeamsRuntime(next) {
  runtime = next;
}
export function getMSTeamsRuntime() {
  if (!runtime) {
    throw new Error("MSTeams runtime not initialized");
  }
  return runtime;
}
