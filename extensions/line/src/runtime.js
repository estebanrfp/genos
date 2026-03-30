let runtime = null;
export function setLineRuntime(r) {
  runtime = r;
}
export function getLineRuntime() {
  if (!runtime) {
    throw new Error("LINE runtime not initialized - plugin not registered");
  }
  return runtime;
}
