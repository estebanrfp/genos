import { describe, expect, test, vi } from "vitest";
import { loadGatewayPlugins } from "./server-plugins.js";
const loadGenosOSPlugins = vi.hoisted(() => vi.fn());
vi.mock("../plugins/loader.js", () => ({
  loadGenosOSPlugins,
}));
const createRegistry = (diagnostics) => ({
  plugins: [],
  tools: [],
  hooks: [],
  typedHooks: [],
  channels: [],
  commands: [],
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics,
});
describe("loadGatewayPlugins", () => {
  test("logs plugin errors with details", () => {
    const diagnostics = [
      {
        level: "error",
        pluginId: "telegram",
        source: "/tmp/telegram/index.ts",
        message: "failed to load plugin: boom",
      },
    ];
    loadGenosOSPlugins.mockReturnValue(createRegistry(diagnostics));
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    loadGatewayPlugins({
      cfg: {},
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });
    expect(log.error).toHaveBeenCalledWith(
      "[plugins] failed to load plugin: boom (plugin=telegram, source=/tmp/telegram/index.ts)",
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
