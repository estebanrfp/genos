export function waitForever() {
  const interval = setInterval(() => {}, 1e6);
  interval.unref();
  return new Promise(() => {});
}
