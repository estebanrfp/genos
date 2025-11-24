let createRuntime = function () {
  const writeConfigFile = vi.fn(async () => {});
  const resolveLineAccount = vi.fn(({ cfg, accountId }) => {
    const lineConfig = cfg.channels?.line ?? {};
    const entry =
      accountId && accountId !== DEFAULT_ACCOUNT_ID
        ? (lineConfig.accounts?.[accountId] ?? {})
        : lineConfig;
    const hasToken = Boolean(entry.channelAccessToken) || Boolean(entry.tokenFile);
    const hasSecret = Boolean(entry.channelSecret) || Boolean(entry.secretFile);
    return { tokenSource: hasToken && hasSecret ? "config" : "none" };
  });
  const runtime = {
    config: { writeConfigFile },
    channel: { line: { resolveLineAccount } },
  };
  return { runtime, mocks: { writeConfigFile, resolveLineAccount } };
};
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linePlugin } from "./channel.js";
import { setLineRuntime } from "./runtime.js";
const DEFAULT_ACCOUNT_ID = "default";
describe("linePlugin gateway.logoutAccount", () => {
  beforeEach(() => {
    setLineRuntime(createRuntime().runtime);
  });
  it("clears tokenFile/secretFile on default account logout", async () => {
    const { runtime, mocks } = createRuntime();
    setLineRuntime(runtime);
    const cfg = {
      channels: {
        line: {
          tokenFile: "/tmp/token",
          secretFile: "/tmp/secret",
        },
      },
    };
    const runtimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit ${code}`);
      }),
    };
    const resolveAccount = mocks.resolveLineAccount;
    const account = resolveAccount({
      cfg,
      accountId: DEFAULT_ACCOUNT_ID,
    });
    const result = await linePlugin.gateway.logoutAccount({
      accountId: DEFAULT_ACCOUNT_ID,
      cfg,
      account,
      runtime: runtimeEnv,
    });
    expect(result.cleared).toBe(true);
    expect(result.loggedOut).toBe(true);
    expect(mocks.writeConfigFile).toHaveBeenCalledWith({});
  });
  it("clears tokenFile/secretFile on account logout", async () => {
    const { runtime, mocks } = createRuntime();
    setLineRuntime(runtime);
    const cfg = {
      channels: {
        line: {
          accounts: {
            primary: {
              tokenFile: "/tmp/token",
              secretFile: "/tmp/secret",
            },
          },
        },
      },
    };
    const runtimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code) => {
        throw new Error(`exit ${code}`);
      }),
    };
    const resolveAccount = mocks.resolveLineAccount;
    const account = resolveAccount({
      cfg,
      accountId: "primary",
    });
    const result = await linePlugin.gateway.logoutAccount({
      accountId: "primary",
      cfg,
      account,
      runtime: runtimeEnv,
    });
    expect(result.cleared).toBe(true);
    expect(result.loggedOut).toBe(true);
    expect(mocks.writeConfigFile).toHaveBeenCalledWith({});
  });
});
