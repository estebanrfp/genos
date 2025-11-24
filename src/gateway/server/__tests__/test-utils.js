import { createEmptyPluginRegistry } from "../../../plugins/registry.js";
export const createTestRegistry = (overrides = {}) => {
  const merged = { ...createEmptyPluginRegistry(), ...overrides };
  return {
    ...merged,
    gatewayHandlers: merged.gatewayHandlers ?? {},
    httpHandlers: merged.httpHandlers ?? [],
    httpRoutes: merged.httpRoutes ?? [],
  };
};
