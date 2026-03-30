let createHost = function () {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "connection",
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    assistantName: "GenosOS",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: null,
    refreshSessionsAfterChat: new Set(),
    execApprovalQueue: [],
    execApprovalError: null,
  };
};
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectGateway } from "./app-gateway.js";
const gatewayClientInstances = [];
vi.mock("./gateway.js", () => {
  class GatewayBrowserClient {
    opts;
    start = vi.fn();
    stop = vi.fn();
    constructor(opts) {
      this.opts = opts;
      gatewayClientInstances.push({
        start: this.start,
        stop: this.stop,
        emitClose: (code, reason) => {
          this.opts.onClose?.({ code, reason: reason ?? "" });
        },
        emitGap: (expected, received) => {
          this.opts.onGap?.({ expected, received });
        },
        emitEvent: (evt) => {
          this.opts.onEvent?.(evt);
        },
      });
    }
  }
  return { GatewayBrowserClient };
});
describe("connectGateway", () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
  });
  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();
    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();
    firstClient.emitGap(10, 13);
    expect(host.lastError).toBeNull();
    secondClient.emitGap(20, 24);
    expect(host.lastError).toBe(
      "event gap detected (expected seq 20, got 24); refresh recommended",
    );
  });
  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();
    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();
    firstClient.emitEvent({ event: "presence", payload: { presence: [{ host: "stale" }] } });
    expect(host.eventLogBuffer).toHaveLength(0);
    secondClient.emitEvent({ event: "presence", payload: { presence: [{ host: "active" }] } });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });
  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();
    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();
    firstClient.emitClose(1005);
    expect(host.lastError).toBeNull();
    secondClient.emitClose(1005);
    expect(host.lastError).toBe("disconnected (1005): no reason");
  });
});
