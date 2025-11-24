export function withFetchPreconnect(fn) {
  return Object.assign(fn, {
    preconnect: (_url, _options) => {},
  });
}
