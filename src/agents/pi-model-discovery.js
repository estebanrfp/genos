let createAuthStorage = function (AuthStorageLike, path) {
  const withFactory = AuthStorageLike;
  if (typeof withFactory.create === "function") {
    return withFactory.create(path);
  }
  return new AuthStorageLike(path);
};
import path from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
export { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
export function discoverAuthStorage(agentDir) {
  return createAuthStorage(AuthStorage, path.join(agentDir, "auth.json"));
}
export function discoverModels(authStorage, agentDir) {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
