import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../../test-utils/env.js";
import { resolveApiKeyForProfile } from "./oauth.js";
import { ensureAuthProfileStore } from "./store.js";
describe("resolveApiKeyForProfile fallback to main agent", () => {
  const envSnapshot = captureEnv(["GENOS_STATE_DIR", "GENOS_AGENT_DIR", "PI_CODING_AGENT_DIR"]);
  let tmpDir;
  let mainAgentDir;
  let secondaryAgentDir;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-fallback-test-"));
    mainAgentDir = path.join(tmpDir, "agents", "main", "agent");
    secondaryAgentDir = path.join(tmpDir, "agents", "kids", "agent");
    await fs.mkdir(mainAgentDir, { recursive: true });
    await fs.mkdir(secondaryAgentDir, { recursive: true });
    process.env.GENOS_STATE_DIR = tmpDir;
    process.env.GENOS_AGENT_DIR = mainAgentDir;
    process.env.PI_CODING_AGENT_DIR = mainAgentDir;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    envSnapshot.restore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  it("falls back to main agent credentials when secondary agent token is expired and refresh fails", async () => {
    const profileId = "anthropic:claude-cli";
    const now = Date.now();
    const expiredTime = now - 3600000;
    const freshTime = now + 3600000;
    const secondaryStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "expired-access-token",
          refresh: "expired-refresh-token",
          expires: expiredTime,
        },
      },
    };
    await fs.writeFile(
      path.join(secondaryAgentDir, "auth-profiles.json"),
      JSON.stringify(secondaryStore),
    );
    const mainStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "fresh-access-token",
          refresh: "fresh-refresh-token",
          expires: freshTime,
        },
      },
    };
    await fs.writeFile(path.join(mainAgentDir, "auth-profiles.json"), JSON.stringify(mainStore));
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const loadedSecondaryStore = ensureAuthProfileStore(secondaryAgentDir);
    const result = await resolveApiKeyForProfile({
      store: loadedSecondaryStore,
      profileId,
      agentDir: secondaryAgentDir,
    });
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe("fresh-access-token");
    expect(result?.provider).toBe("anthropic");
    const updatedSecondaryStore = JSON.parse(
      await fs.readFile(path.join(secondaryAgentDir, "auth-profiles.json"), "utf8"),
    );
    expect(updatedSecondaryStore.profiles[profileId]).toMatchObject({
      access: "fresh-access-token",
      expires: freshTime,
    });
  });
  it("throws error when both secondary and main agent credentials are expired", async () => {
    const profileId = "anthropic:claude-cli";
    const now = Date.now();
    const expiredTime = now - 3600000;
    const expiredStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "expired-access-token",
          refresh: "expired-refresh-token",
          expires: expiredTime,
        },
      },
    };
    await fs.writeFile(
      path.join(secondaryAgentDir, "auth-profiles.json"),
      JSON.stringify(expiredStore),
    );
    await fs.writeFile(path.join(mainAgentDir, "auth-profiles.json"), JSON.stringify(expiredStore));
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const loadedSecondaryStore = ensureAuthProfileStore(secondaryAgentDir);
    await expect(
      resolveApiKeyForProfile({
        store: loadedSecondaryStore,
        profileId,
        agentDir: secondaryAgentDir,
      }),
    ).rejects.toThrow(/OAuth token refresh failed/);
  });
});
