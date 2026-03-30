let runtime = null;
export function setMatrixRuntime(next) {
  runtime = next;
}
export function getMatrixRuntime() {
  if (!runtime) {
    throw new Error("Matrix runtime not initialized");
  }
  return runtime;
}
