let createGatewayParentLikeCommand = function () {
  const gateway = new Command().name("gateway");
  gateway.option("--port <port>", "Port for the gateway WebSocket");
  gateway.option("--token <token>", "Gateway token");
  gateway.option("--password <password>", "Gateway password");
  gateway.option("--force", "Gateway run --force", false);
  addGatewayServiceCommands(gateway);
  return gateway;
};
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addGatewayServiceCommands } from "./register-service-commands.js";
const runDaemonInstall = vi.fn(async (_opts) => {});
const runDaemonRestart = vi.fn(async (_opts) => {});
const runDaemonStart = vi.fn(async (_opts) => {});
const runDaemonStatus = vi.fn(async (_opts) => {});
const runDaemonStop = vi.fn(async (_opts) => {});
const runDaemonUninstall = vi.fn(async (_opts) => {});
vi.mock("./runners.js", () => ({
  runDaemonInstall: (opts) => runDaemonInstall(opts),
  runDaemonRestart: (opts) => runDaemonRestart(opts),
  runDaemonStart: (opts) => runDaemonStart(opts),
  runDaemonStatus: (opts) => runDaemonStatus(opts),
  runDaemonStop: (opts) => runDaemonStop(opts),
  runDaemonUninstall: (opts) => runDaemonUninstall(opts),
}));
describe("addGatewayServiceCommands", () => {
  beforeEach(() => {
    runDaemonInstall.mockClear();
    runDaemonRestart.mockClear();
    runDaemonStart.mockClear();
    runDaemonStatus.mockClear();
    runDaemonStop.mockClear();
    runDaemonUninstall.mockClear();
  });
  it("forwards install option collisions from parent gateway command", async () => {
    const gateway = createGatewayParentLikeCommand();
    await gateway.parseAsync(["install", "--force", "--port", "19000", "--token", "tok_test"], {
      from: "user",
    });
    expect(runDaemonInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        port: "19000",
        token: "tok_test",
      }),
    );
  });
  it("forwards status auth collisions from parent gateway command", async () => {
    const gateway = createGatewayParentLikeCommand();
    await gateway.parseAsync(["status", "--token", "tok_status", "--password", "pw_status"], {
      from: "user",
    });
    expect(runDaemonStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        rpc: expect.objectContaining({
          token: "tok_status",
          password: "pw_status",
        }),
      }),
    );
  });
});
