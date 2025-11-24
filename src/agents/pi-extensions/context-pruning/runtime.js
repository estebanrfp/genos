import { createSessionManagerRuntimeRegistry } from "../session-manager-runtime-registry.js";
const registry = createSessionManagerRuntimeRegistry();
export const setContextPruningRuntime = registry.set;
export const getContextPruningRuntime = registry.get;
