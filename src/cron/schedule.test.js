import { describe, expect, it } from "vitest";
import { computeNextRunAtMs } from "./schedule.js";
describe("cron schedule", () => {
  it("computes next run for cron expression with timezone", () => {
    const nowMs = Date.parse("2025-12-13T00:00:00.000Z");
    const next = computeNextRunAtMs(
      { kind: "cron", expr: "0 9 * * 3", tz: "America/Los_Angeles" },
      nowMs,
    );
    expect(next).toBe(Date.parse("2025-12-17T17:00:00.000Z"));
  });
  it("computes next run for every schedule", () => {
    const anchor = Date.parse("2025-12-13T00:00:00.000Z");
    const now = anchor + 1e4;
    const next = computeNextRunAtMs({ kind: "every", everyMs: 30000, anchorMs: anchor }, now);
    expect(next).toBe(anchor + 30000);
  });
  it("computes next run for every schedule when anchorMs is not provided", () => {
    const now = Date.parse("2025-12-13T00:00:00.000Z");
    const next = computeNextRunAtMs({ kind: "every", everyMs: 30000 }, now);
    expect(next).toBe(now + 30000);
  });
  it("advances when now matches anchor for every schedule", () => {
    const anchor = Date.parse("2025-12-13T00:00:00.000Z");
    const next = computeNextRunAtMs({ kind: "every", everyMs: 30000, anchorMs: anchor }, anchor);
    expect(next).toBe(anchor + 30000);
  });
  describe("cron with specific seconds (6-field pattern)", () => {
    const dailyNoon = { kind: "cron", expr: "0 0 12 * * *", tz: "UTC" };
    const noonMs = Date.parse("2026-02-08T12:00:00.000Z");
    it("advances past current second when nowMs is exactly at the match", () => {
      const next = computeNextRunAtMs(dailyNoon, noonMs);
      expect(next).toBe(noonMs + 86400000);
    });
    it("advances past current second when nowMs is mid-second (.500) within the match", () => {
      const next = computeNextRunAtMs(dailyNoon, noonMs + 500);
      expect(next).toBe(noonMs + 86400000);
    });
    it("advances past current second when nowMs is late in the matching second (.999)", () => {
      const next = computeNextRunAtMs(dailyNoon, noonMs + 999);
      expect(next).toBe(noonMs + 86400000);
    });
    it("advances to next day once the matching second is fully past", () => {
      const next = computeNextRunAtMs(dailyNoon, noonMs + 1000);
      expect(next).toBe(noonMs + 86400000);
    });
    it("returns today when nowMs is before the match", () => {
      const next = computeNextRunAtMs(dailyNoon, noonMs - 500);
      expect(next).toBe(noonMs);
    });
    it("advances to next day when job completes within same second it fired (#17821)", () => {
      const completedAtMs = noonMs + 21;
      const next = computeNextRunAtMs(dailyNoon, completedAtMs);
      expect(next).toBe(noonMs + 86400000);
    });
    it("advances to next day when job completes just before second boundary (#17821)", () => {
      const completedAtMs = noonMs + 999;
      const next = computeNextRunAtMs(dailyNoon, completedAtMs);
      expect(next).toBe(noonMs + 86400000);
    });
  });
});
