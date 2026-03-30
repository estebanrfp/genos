import { vi } from "vitest";
export const baseConfigSnapshot = {
  path: "/tmp/genosos.json",
  exists: true,
  raw: "{}",
  parsed: {},
  valid: true,
  config: {},
  issues: [],
  legacyIssues: [],
};
export function createTestRuntime() {
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn((_) => {
    return;
  });
  return {
    log,
    error,
    exit,
  };
}
