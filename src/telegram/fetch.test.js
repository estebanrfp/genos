import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFetch } from "../infra/fetch.js";
import { resetTelegramFetchStateForTests, resolveTelegramFetch } from "./fetch.js";
const setDefaultAutoSelectFamily = vi.hoisted(() => vi.fn());
vi.mock("node:net", async () => {
  const actual = await vi.importActual("node:net");
  return {
    ...actual,
    setDefaultAutoSelectFamily,
  };
});
const originalFetch = globalThis.fetch;
afterEach(() => {
  resetTelegramFetchStateForTests();
  setDefaultAutoSelectFamily.mockReset();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
});
describe("resolveTelegramFetch", () => {
  it("returns wrapped global fetch when available", async () => {
    const fetchMock = vi.fn(async () => ({}));
    globalThis.fetch = fetchMock;
    const resolved = resolveTelegramFetch();
    expect(resolved).toBeTypeOf("function");
    expect(resolved).not.toBe(fetchMock);
  });
  it("wraps proxy fetches and normalizes foreign signals once", async () => {
    let seenSignal;
    const proxyFetch = vi.fn(async (_input, init) => {
      seenSignal = init?.signal;
      return {};
    });
    const resolved = resolveTelegramFetch(proxyFetch);
    expect(resolved).toBeTypeOf("function");
    let abortHandler = null;
    const addEventListener = vi.fn((event, handler) => {
      if (event === "abort") {
        abortHandler = handler;
      }
    });
    const removeEventListener = vi.fn((event, handler) => {
      if (event === "abort" && abortHandler === handler) {
        abortHandler = null;
      }
    });
    const fakeSignal = {
      aborted: false,
      addEventListener,
      removeEventListener,
    };
    if (!resolved) {
      throw new Error("expected resolved proxy fetch");
    }
    await resolved("https://example.com", { signal: fakeSignal });
    expect(proxyFetch).toHaveBeenCalledOnce();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal).not.toBe(fakeSignal);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
  it("does not double-wrap an already wrapped proxy fetch", async () => {
    const proxyFetch = vi.fn(async () => ({ ok: true }));
    const alreadyWrapped = resolveFetch(proxyFetch);
    const resolved = resolveTelegramFetch(alreadyWrapped);
    expect(resolved).toBe(alreadyWrapped);
  });
  it("honors env enable override", async () => {
    vi.stubEnv("GENOS_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY", "1");
    globalThis.fetch = vi.fn(async () => ({}));
    resolveTelegramFetch();
    expect(setDefaultAutoSelectFamily).toHaveBeenCalledWith(true);
  });
  it("uses config override when provided", async () => {
    globalThis.fetch = vi.fn(async () => ({}));
    resolveTelegramFetch(undefined, { network: { autoSelectFamily: true } });
    expect(setDefaultAutoSelectFamily).toHaveBeenCalledWith(true);
  });
  it("env disable override wins over config", async () => {
    vi.stubEnv("GENOS_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY", "0");
    vi.stubEnv("GENOS_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY", "1");
    globalThis.fetch = vi.fn(async () => ({}));
    resolveTelegramFetch(undefined, { network: { autoSelectFamily: true } });
    expect(setDefaultAutoSelectFamily).toHaveBeenCalledWith(false);
  });
});
