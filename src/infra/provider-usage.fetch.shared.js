export async function fetchJson(url, init, timeoutMs, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(controller.abort.bind(controller), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
