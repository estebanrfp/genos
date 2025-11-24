export function throwIfAborted(abortSignal) {
  if (abortSignal?.aborted) {
    const err = new Error("Operation aborted");
    err.name = "AbortError";
    throw err;
  }
}
