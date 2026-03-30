import { describe, expect, it } from "vitest";
import { printCronList } from "./shared.js";
describe("printCronList", () => {
  it("handles job with undefined sessionTarget (#9649)", () => {
    const logs = [];
    const mockRuntime = {
      log: (msg) => logs.push(msg),
      error: () => {},
      exit: () => {},
    };
    const jobWithUndefinedTarget = {
      id: "test-job-id",
      agentId: "main",
      name: "Test Job",
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "at", at: new Date(Date.now() + 3600000).toISOString() },
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "test" },
      state: { nextRunAtMs: Date.now() + 3600000 },
    };
    expect(() => printCronList([jobWithUndefinedTarget], mockRuntime)).not.toThrow();
    expect(logs.length).toBeGreaterThan(1);
    expect(logs.some((line) => line.includes("test-job-id"))).toBe(true);
  });
  it("handles job with defined sessionTarget", () => {
    const logs = [];
    const mockRuntime = {
      log: (msg) => logs.push(msg),
      error: () => {},
      exit: () => {},
    };
    const jobWithTarget = {
      id: "test-job-id-2",
      agentId: "main",
      name: "Test Job 2",
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "at", at: new Date(Date.now() + 3600000).toISOString() },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "test" },
      state: { nextRunAtMs: Date.now() + 3600000 },
    };
    expect(() => printCronList([jobWithTarget], mockRuntime)).not.toThrow();
    expect(logs.some((line) => line.includes("isolated"))).toBe(true);
  });
  it("shows stagger label for cron schedules", () => {
    const logs = [];
    const mockRuntime = {
      log: (msg) => logs.push(msg),
      error: () => {},
      exit: () => {},
    };
    const job = {
      id: "staggered-job",
      name: "Staggered",
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "cron", expr: "0 * * * *", staggerMs: 300000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "tick" },
      state: {},
    };
    printCronList([job], mockRuntime);
    expect(logs.some((line) => line.includes("(stagger 5m)"))).toBe(true);
  });
  it("shows exact label for cron schedules with stagger disabled", () => {
    const logs = [];
    const mockRuntime = {
      log: (msg) => logs.push(msg),
      error: () => {},
      exit: () => {},
    };
    const job = {
      id: "exact-job",
      name: "Exact",
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "cron", expr: "0 7 * * *", staggerMs: 0 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "tick" },
      state: {},
    };
    printCronList([job], mockRuntime);
    expect(logs.some((line) => line.includes("(exact)"))).toBe(true);
  });
});
