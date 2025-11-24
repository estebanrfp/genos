import { afterEach, beforeEach, vi } from "vitest";
export const BASE_TWITCH_TEST_ACCOUNT = {
  username: "testbot",
  clientId: "test-client-id",
  channel: "#testchannel",
};
export function makeTwitchTestConfig(account) {
  return {
    channels: {
      twitch: {
        accounts: {
          default: account,
        },
      },
    },
  };
}
export function installTwitchTestHooks() {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
