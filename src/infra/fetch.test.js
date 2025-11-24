let createForeignSignalHarness = function () {
  let abortHandler = null;
  const removeEventListener = vi.fn((event, handler) => {
    if (event === "abort" && abortHandler === handler) {
      abortHandler = null;
    }
  });
  const fakeSignal = {
    aborted: false,
    addEventListener: (event, handler) => {
      if (event === "abort") {
        abortHandler = handler;
      }
    },
    removeEventListener,
  };
  return {
    fakeSignal,
    removeEventListener,
    triggerAbort: () => abortHandler?.(),
  };
};
import { describe, expect, it, vi } from "vitest";
import { withFetchPreconnect } from "../test-utils/fetch-mock.js";
import { resolveFetch, wrapFetchWithAbortSignal } from "./fetch.js";
async function waitForMicrotaskTurn() {
  await new Promise((resolve) => queueMicrotask(resolve));
}
describe("wrapFetchWithAbortSignal", () => {
  it("adds duplex for requests with a body", async () => {
    let seenInit;
    const fetchImpl = withFetchPreconnect(
      vi.fn(async (_input, init) => {
        seenInit = init;
        return {};
      }),
    );
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    await wrapped("https://example.com", { method: "POST", body: "hi" });
    expect(seenInit?.duplex).toBe("half");
  });
  it("converts foreign abort signals to native controllers", async () => {
    let seenSignal;
    const fetchImpl = withFetchPreconnect(
      vi.fn(async (_input, init) => {
        seenSignal = init?.signal;
        return {};
      }),
    );
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const { fakeSignal, triggerAbort } = createForeignSignalHarness();
    const promise = wrapped("https://example.com", { signal: fakeSignal });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal).not.toBe(fakeSignal);
    triggerAbort();
    expect(seenSignal?.aborted).toBe(true);
    await promise;
  });
  it("does not emit an extra unhandled rejection when wrapped fetch rejects", async () => {
    const unhandled = [];
    const onUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const fetchError = new TypeError("fetch failed");
    const fetchImpl = withFetchPreconnect(vi.fn((_input, _init) => Promise.reject(fetchError)));
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const { fakeSignal, removeEventListener } = createForeignSignalHarness();
    try {
      await expect(wrapped("https://example.com", { signal: fakeSignal })).rejects.toBe(fetchError);
      await Promise.resolve();
      await waitForMicrotaskTurn();
      expect(unhandled).toEqual([]);
      expect(removeEventListener).toHaveBeenCalledOnce();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
  it("cleans up listener and rethrows when fetch throws synchronously", () => {
    const syncError = new TypeError("sync fetch failure");
    const fetchImpl = withFetchPreconnect(
      vi.fn(() => {
        throw syncError;
      }),
    );
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const { fakeSignal, removeEventListener } = createForeignSignalHarness();
    expect(() => wrapped("https://example.com", { signal: fakeSignal })).toThrow(syncError);
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
  it("preserves original rejection when listener cleanup throws", async () => {
    const fetchError = new TypeError("fetch failed");
    const cleanupError = new TypeError("cleanup failed");
    const fetchImpl = withFetchPreconnect(vi.fn((_input, _init) => Promise.reject(fetchError)));
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const removeEventListener = vi.fn(() => {
      throw cleanupError;
    });
    const fakeSignal = {
      aborted: false,
      addEventListener: (_event, _handler) => {},
      removeEventListener,
    };
    await expect(wrapped("https://example.com", { signal: fakeSignal })).rejects.toBe(fetchError);
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
  it("preserves original sync throw when listener cleanup throws", () => {
    const syncError = new TypeError("sync fetch failure");
    const cleanupError = new TypeError("cleanup failed");
    const fetchImpl = withFetchPreconnect(
      vi.fn(() => {
        throw syncError;
      }),
    );
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const removeEventListener = vi.fn(() => {
      throw cleanupError;
    });
    const fakeSignal = {
      aborted: false,
      addEventListener: (_event, _handler) => {},
      removeEventListener,
    };
    expect(() => wrapped("https://example.com", { signal: fakeSignal })).toThrow(syncError);
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
  it("skips listener cleanup when foreign signal is already aborted", async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const fetchImpl = withFetchPreconnect(vi.fn(async () => ({ ok: true })));
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const fakeSignal = {
      aborted: true,
      addEventListener,
      removeEventListener,
    };
    await wrapped("https://example.com", { signal: fakeSignal });
    expect(addEventListener).not.toHaveBeenCalled();
    expect(removeEventListener).not.toHaveBeenCalled();
  });
  it("returns the same function when called with an already wrapped fetch", () => {
    const fetchImpl = withFetchPreconnect(vi.fn(async () => ({ ok: true })));
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    expect(wrapFetchWithAbortSignal(wrapped)).toBe(wrapped);
    expect(resolveFetch(wrapped)).toBe(wrapped);
  });
  it("keeps preconnect bound to the original fetch implementation", () => {
    const preconnectSpy = vi.fn(function () {
      return this;
    });
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    fetchImpl.preconnect = preconnectSpy;
    const wrapped = wrapFetchWithAbortSignal(fetchImpl);
    const seenThis = wrapped.preconnect("https://example.com");
    expect(preconnectSpy).toHaveBeenCalledOnce();
    expect(seenThis).toBe(fetchImpl);
  });
});
