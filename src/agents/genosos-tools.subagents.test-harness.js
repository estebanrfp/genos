import { vi } from "vitest";
export const callGatewayMock = vi.fn();
const defaultConfig = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};
let configOverride = defaultConfig;
export function setSubagentsConfigOverride(next) {
  configOverride = next;
}
export function resetSubagentsConfigOverride() {
  configOverride = defaultConfig;
}
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts) => callGatewayMock(opts),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});
