import { describe, expect, it, vi } from "vitest";
import { bindAbortRelay } from "../utils/fetch-timeout.js";
describe("abort pattern: .bind() vs arrow closure (#7174)", () => {
  it("controller.abort.bind(controller) aborts the signal", () => {
    const controller = new AbortController();
    const boundAbort = controller.abort.bind(controller);
    expect(controller.signal.aborted).toBe(false);
    boundAbort();
    expect(controller.signal.aborted).toBe(true);
  });
  it("bound abort works with setTimeout", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const timer = setTimeout(controller.abort.bind(controller), 10);
      expect(controller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(controller.signal.aborted).toBe(true);
      clearTimeout(timer);
    } finally {
      vi.useRealTimers();
    }
  });
  it("bindAbortRelay() preserves default AbortError reason when used as event listener", () => {
    const parent = new AbortController();
    const child = new AbortController();
    const onAbort = bindAbortRelay(child);
    parent.signal.addEventListener("abort", onAbort, { once: true });
    parent.abort();
    expect(child.signal.aborted).toBe(true);
    expect(child.signal.reason).toBeInstanceOf(DOMException);
    expect(child.signal.reason.name).toBe("AbortError");
  });
  it("raw .abort.bind() leaks Event as reason \u2014 bindAbortRelay() does not", () => {
    const parentA = new AbortController();
    const childA = new AbortController();
    parentA.signal.addEventListener("abort", childA.abort.bind(childA), { once: true });
    parentA.abort();
    expect(childA.signal.reason).not.toBeInstanceOf(DOMException);
    const parentB = new AbortController();
    const childB = new AbortController();
    parentB.signal.addEventListener("abort", bindAbortRelay(childB), { once: true });
    parentB.abort();
    expect(childB.signal.reason).toBeInstanceOf(DOMException);
    expect(childB.signal.reason.name).toBe("AbortError");
  });
  it("removeEventListener works with saved bindAbortRelay() reference", () => {
    const parent = new AbortController();
    const child = new AbortController();
    const onAbort = bindAbortRelay(child);
    parent.signal.addEventListener("abort", onAbort);
    parent.signal.removeEventListener("abort", onAbort);
    parent.abort();
    expect(child.signal.aborted).toBe(false);
  });
  it("bindAbortRelay() forwards abort through combined signals", () => {
    const signalA = new AbortController();
    const signalB = new AbortController();
    const combined = new AbortController();
    const onAbort = bindAbortRelay(combined);
    signalA.signal.addEventListener("abort", onAbort, { once: true });
    signalB.signal.addEventListener("abort", onAbort, { once: true });
    expect(combined.signal.aborted).toBe(false);
    signalA.abort();
    expect(combined.signal.aborted).toBe(true);
    expect(combined.signal.reason).toBeInstanceOf(DOMException);
    expect(combined.signal.reason.name).toBe("AbortError");
  });
});
