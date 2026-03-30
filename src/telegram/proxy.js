import { ProxyAgent, fetch as undiciFetch } from "undici";
export function makeProxyFetch(proxyUrl) {
  const agent = new ProxyAgent(proxyUrl);
  const fetcher = (input, init) =>
    undiciFetch(input, {
      ...init,
      dispatcher: agent,
    });
  return fetcher;
}
