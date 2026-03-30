import { describe, expect, it, vi } from "vitest";
import { resolveTalkApiKey } from "./talk.js";
describe("talk api key fallback", () => {
  it("reads ELEVENLABS_API_KEY from profile when env is missing", () => {
    const existsSync = vi.fn((candidate) => candidate.endsWith(".profile"));
    const readFileSync = vi.fn(() => "export ELEVENLABS_API_KEY=profile-key\n");
    const homedir = vi.fn(() => "/tmp/home");
    const value = resolveTalkApiKey(
      {},
      {
        fs: { existsSync, readFileSync },
        os: { homedir },
        path: { join: (...parts) => parts.join("/") },
      },
    );
    expect(value).toBe("profile-key");
    expect(readFileSync).toHaveBeenCalledOnce();
  });
  it("prefers ELEVENLABS_API_KEY env over profile", () => {
    const existsSync = vi.fn(() => {
      throw new Error("profile should not be read when env key exists");
    });
    const readFileSync = vi.fn(() => "");
    const value = resolveTalkApiKey(
      { ELEVENLABS_API_KEY: "env-key" },
      {
        fs: { existsSync, readFileSync },
        os: { homedir: () => "/tmp/home" },
        path: { join: (...parts) => parts.join("/") },
      },
    );
    expect(value).toBe("env-key");
    expect(existsSync).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
  });
});
