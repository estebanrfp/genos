let createRequest = function (params) {
    const headers = {
      host: "localhost:18789",
    };
    if (params.authorization) {
      headers.authorization = params.authorization;
    }
    return {
      method: params.method ?? "GET",
      url: params.path,
      headers,
      socket: { remoteAddress: "127.0.0.1" },
    };
  },
  createResponse = function () {
    const setHeader = vi.fn();
    let body = "";
    const end = vi.fn((chunk) => {
      if (typeof chunk === "string") {
        body = chunk;
        return;
      }
      if (chunk == null) {
        body = "";
        return;
      }
      body = JSON.stringify(chunk);
    });
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader,
      end,
    };
    return {
      res,
      setHeader,
      end,
      getBody: () => body,
    };
  };
import { describe, expect, test, vi } from "vitest";
import { createGatewayHttpServer } from "./server-http.js";
import { withTempConfig } from "./test-temp-config.js";
async function dispatchRequest(server, req, res) {
  server.emit("request", req, res);
  await new Promise((resolve) => setImmediate(resolve));
}
describe("gateway plugin HTTP auth boundary", () => {
  test("requires gateway auth for /api/channels/* plugin routes and allows authenticated pass-through", async () => {
    const resolvedAuth = {
      mode: "token",
      token: "test-token",
      password: undefined,
      allowTailscale: false,
    };
    await withTempConfig({
      cfg: { gateway: { trustedProxies: [] } },
      prefix: "genosos-plugin-http-auth-test-",
      run: async () => {
        const handlePluginRequest = vi.fn(async (req, res) => {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (pathname === "/api/channels/nostr/default/profile") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, route: "channel" }));
            return true;
          }
          if (pathname === "/plugin/public") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, route: "public" }));
            return true;
          }
          return false;
        });
        const server = createGatewayHttpServer({
          canvasHost: null,
          clients: new Set(),
          controlUiEnabled: false,
          controlUiBasePath: "/__control__",
          openAiChatCompletionsEnabled: false,
          openResponsesEnabled: false,
          handleHooksRequest: async () => false,
          handlePluginRequest,
          resolvedAuth,
        });
        const unauthenticated = createResponse();
        await dispatchRequest(
          server,
          createRequest({ path: "/api/channels/nostr/default/profile" }),
          unauthenticated.res,
        );
        expect(unauthenticated.res.statusCode).toBe(401);
        expect(unauthenticated.getBody()).toContain("Unauthorized");
        expect(handlePluginRequest).not.toHaveBeenCalled();
        const authenticated = createResponse();
        await dispatchRequest(
          server,
          createRequest({
            path: "/api/channels/nostr/default/profile",
            authorization: "Bearer test-token",
          }),
          authenticated.res,
        );
        expect(authenticated.res.statusCode).toBe(200);
        expect(authenticated.getBody()).toContain('"route":"channel"');
        const unauthenticatedPublic = createResponse();
        await dispatchRequest(
          server,
          createRequest({ path: "/plugin/public" }),
          unauthenticatedPublic.res,
        );
        expect(unauthenticatedPublic.res.statusCode).toBe(200);
        expect(unauthenticatedPublic.getBody()).toContain('"route":"public"');
        expect(handlePluginRequest).toHaveBeenCalledTimes(2);
      },
    });
  });
});
