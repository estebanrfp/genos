import { vi } from "vitest";
export function installSlackBlockTestMocks() {
  vi.mock("../config/config.js", () => ({
    loadConfig: () => ({}),
  }));
  vi.mock("./accounts.js", () => ({
    resolveSlackAccount: () => ({
      accountId: "default",
      botToken: "xoxb-test",
      botTokenSource: "config",
      config: {},
    }),
  }));
}
export function createSlackEditTestClient() {
  return {
    chat: {
      update: vi.fn(async () => ({ ok: true })),
    },
  };
}
export function createSlackSendTestClient() {
  return {
    conversations: {
      open: vi.fn(async () => ({ channel: { id: "D123" } })),
    },
    chat: {
      postMessage: vi.fn(async () => ({ ts: "171234.567" })),
    },
  };
}
