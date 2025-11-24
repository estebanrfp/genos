import { beforeEach, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
export const useSpy = vi.fn();
export const middlewareUseSpy = vi.fn();
export const onSpy = vi.fn();
export const stopSpy = vi.fn();
export const sendChatActionSpy = vi.fn();
const apiStub = {
  config: { use: useSpy },
  sendChatAction: sendChatActionSpy,
  setMyCommands: vi.fn(async () => {
    return;
  }),
};
beforeEach(() => {
  resetInboundDedupe();
});
vi.mock("grammy", () => ({
  Bot: class {
    token;
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    command = vi.fn();
    stop = stopSpy;
    catch = vi.fn();
    constructor(token) {
      this.token = token;
    }
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));
vi.mock("@grammyjs/runner", () => ({
  sequentialize: () => vi.fn(),
}));
const throttlerSpy = vi.fn(() => "throttler");
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => throttlerSpy(),
}));
vi.mock("../media/store.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveMediaBuffer: vi.fn(async (buffer, contentType) => ({
      id: "media",
      path: "/tmp/telegram-media",
      size: buffer.byteLength,
      contentType: contentType ?? "application/octet-stream",
    })),
  };
});
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => ({
      channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
    }),
  };
});
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    updateLastRoute: vi.fn(async () => {
      return;
    }),
  };
});
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn(async () => []),
  upsertChannelPairingRequest: vi.fn(async () => ({
    code: "PAIRCODE",
    created: true,
  })),
}));
vi.mock("../auto-reply/reply.js", () => {
  const replySpy = vi.fn(async (_ctx, opts) => {
    await opts?.onReplyStart?.();
    return;
  });
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});
