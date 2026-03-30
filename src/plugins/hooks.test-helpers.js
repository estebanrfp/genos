export function createMockPluginRegistry(hooks) {
  return {
    hooks,
    typedHooks: hooks.map((h) => ({
      pluginId: "test-plugin",
      hookName: h.hookName,
      handler: h.handler,
      priority: 0,
      source: "test",
    })),
    tools: [],
    httpHandlers: [],
    httpRoutes: [],
    channelRegistrations: [],
    gatewayHandlers: {},
    cliRegistrars: [],
    services: [],
    providers: [],
    commands: [],
  };
}
