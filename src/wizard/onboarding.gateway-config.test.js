import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  randomToken: vi.fn(),
}));
vi.mock("../commands/onboard-helpers.js", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    randomToken: mocks.randomToken,
  };
});
vi.mock("../infra/tailscale.js", () => ({
  findTailscaleBinary: vi.fn(async () => {
    return;
  }),
}));
import { configureGatewayForOnboarding } from "./onboarding.gateway-config.js";
describe("configureGatewayForOnboarding", () => {
  function createPrompter(params) {
    const selectQueue = [...params.selectQueue];
    const textQueue = [...params.textQueue];
    const select = vi.fn(async (_params) => selectQueue.shift());
    return {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async () => {}),
      select,
      multiselect: vi.fn(async () => []),
      text: vi.fn(async () => textQueue.shift()),
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };
  }
  function createRuntime() {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };
  }
  it("generates a token when the prompt returns undefined", async () => {
    mocks.randomToken.mockReturnValue("generated-token");
    const prompter = createPrompter({
      selectQueue: ["loopback", "token", "off"],
      textQueue: ["18789", undefined],
    });
    const runtime = createRuntime();
    const result = await configureGatewayForOnboarding({
      flow: "advanced",
      baseConfig: {},
      nextConfig: {},
      localPort: 18789,
      quickstartGateway: {
        hasExisting: false,
        port: 18789,
        bind: "loopback",
        authMode: "token",
        tailscaleMode: "off",
        token: undefined,
        password: undefined,
        customBindHost: undefined,
        tailscaleResetOnExit: false,
      },
      prompter,
      runtime,
    });
    expect(result.settings.gatewayToken).toBe("generated-token");
    expect(result.nextConfig.gateway?.nodes?.denyCommands).toEqual([
      "camera.snap",
      "camera.clip",
      "screen.record",
      "calendar.add",
      "contacts.add",
      "reminders.add",
    ]);
  });
  it("does not set password to literal 'undefined' when prompt returns undefined", async () => {
    mocks.randomToken.mockReturnValue("unused");
    const prompter = createPrompter({
      selectQueue: ["loopback", "password", "off"],
      textQueue: ["18789", undefined],
    });
    const runtime = createRuntime();
    const result = await configureGatewayForOnboarding({
      flow: "advanced",
      baseConfig: {},
      nextConfig: {},
      localPort: 18789,
      quickstartGateway: {
        hasExisting: false,
        port: 18789,
        bind: "loopback",
        authMode: "password",
        tailscaleMode: "off",
        token: undefined,
        password: undefined,
        customBindHost: undefined,
        tailscaleResetOnExit: false,
      },
      prompter,
      runtime,
    });
    const authConfig = result.nextConfig.gateway?.auth;
    expect(authConfig?.mode).toBe("password");
    expect(authConfig?.password).toBe("");
    expect(authConfig?.password).not.toBe("undefined");
  });
});
