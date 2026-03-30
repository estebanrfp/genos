import { describe, expect, it, vi } from "vitest";
vi.mock("./index.js", () => {
  return {
    registerBrowserRoutes(app) {
      app.get("/slow", async (req, res) => {
        const signal = req.signal;
        await new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }
          const onAbort = () => reject(signal?.reason ?? new Error("aborted"));
          signal?.addEventListener("abort", onAbort, { once: true });
          queueMicrotask(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
        res.json({ ok: true });
      });
    },
  };
});
describe("browser route dispatcher (abort)", () => {
  it("propagates AbortSignal and lets handlers observe abort", async () => {
    const { createBrowserRouteDispatcher } = await import("./dispatcher.js");
    const dispatcher = createBrowserRouteDispatcher({});
    const ctrl = new AbortController();
    const promise = dispatcher.dispatch({
      method: "GET",
      path: "/slow",
      signal: ctrl.signal,
    });
    ctrl.abort(new Error("timed out"));
    await expect(promise).resolves.toMatchObject({
      status: 500,
      body: { error: expect.stringContaining("timed out") },
    });
  });
});
