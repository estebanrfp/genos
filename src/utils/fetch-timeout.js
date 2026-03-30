let relayAbort = function () {
  this.abort();
};
export function bindAbortRelay(controller) {
  return relayAbort.bind(controller);
}
export async function fetchWithTimeout(url, init, timeoutMs, fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(controller.abort.bind(controller), Math.max(1, timeoutMs));
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
