import { vi } from "vitest";
const hoisted = vi.hoisted(() => {
  const callGatewayMock = vi.fn();
  const defaultConfigOverride = {
    session: {
      mainKey: "main",
      scope: "per-sender",
    },
  };
  const state = { configOverride: defaultConfigOverride };
  return { callGatewayMock, defaultConfigOverride, state };
});
export function getCallGatewayMock() {
  return hoisted.callGatewayMock;
}
export function resetSessionsSpawnConfigOverride() {
  hoisted.state.configOverride = hoisted.defaultConfigOverride;
}
export function setSessionsSpawnConfigOverride(next) {
  hoisted.state.configOverride = next;
}
export async function getSessionsSpawnTool(opts) {
  const { createGenosOSTools } = await import("./genosos-tools.js");
  const tool = createGenosOSTools(opts).find((candidate) => candidate.name === "sessions_spawn");
  if (!tool) {
    throw new Error("missing sessions_spawn tool");
  }
  return tool;
}
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts) => hoisted.callGatewayMock(opts),
}));
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts) => hoisted.callGatewayMock(opts),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => hoisted.state.configOverride,
    resolveGatewayPort: () => 18789,
  };
});
vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: () => hoisted.state.configOverride,
    resolveGatewayPort: () => 18789,
  };
});
