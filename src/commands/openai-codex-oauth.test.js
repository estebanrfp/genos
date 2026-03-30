let createPrompter = function () {
    const spin = { update: vi.fn(), stop: vi.fn() };
    const prompter = {
      note: vi.fn(async () => {}),
      progress: vi.fn(() => spin),
    };
    return { prompter, spin };
  },
  createRuntime = function () {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit:${code}`);
      }),
    };
  };
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  loginOpenAICodex: vi.fn(),
  createVpsAwareOAuthHandlers: vi.fn(),
}));
vi.mock("@mariozechner/pi-ai", () => ({
  loginOpenAICodex: mocks.loginOpenAICodex,
}));
vi.mock("./oauth-flow.js", () => ({
  createVpsAwareOAuthHandlers: mocks.createVpsAwareOAuthHandlers,
}));
import { loginOpenAICodexOAuth } from "./openai-codex-oauth.js";
describe("loginOpenAICodexOAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns credentials on successful oauth login", async () => {
    const creds = {
      provider: "openai-codex",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60000,
      email: "user@example.com",
    };
    mocks.createVpsAwareOAuthHandlers.mockReturnValue({
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    });
    mocks.loginOpenAICodex.mockResolvedValue(creds);
    const { prompter, spin } = createPrompter();
    const runtime = createRuntime();
    const result = await loginOpenAICodexOAuth({
      prompter,
      runtime,
      isRemote: false,
      openUrl: async () => {},
    });
    expect(result).toEqual(creds);
    expect(mocks.loginOpenAICodex).toHaveBeenCalledOnce();
    expect(spin.stop).toHaveBeenCalledWith("OpenAI OAuth complete");
    expect(runtime.error).not.toHaveBeenCalled();
  });
  it("reports oauth errors and rethrows", async () => {
    mocks.createVpsAwareOAuthHandlers.mockReturnValue({
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    });
    mocks.loginOpenAICodex.mockRejectedValue(new Error("oauth failed"));
    const { prompter, spin } = createPrompter();
    const runtime = createRuntime();
    await expect(
      loginOpenAICodexOAuth({
        prompter,
        runtime,
        isRemote: true,
        openUrl: async () => {},
      }),
    ).rejects.toThrow("oauth failed");
    expect(spin.stop).toHaveBeenCalledWith("OpenAI OAuth failed");
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("oauth failed"));
    expect(prompter.note).toHaveBeenCalledWith(
      "Trouble with OAuth? See https://docs.genos.ai/start/faq",
      "OAuth help",
    );
  });
});
