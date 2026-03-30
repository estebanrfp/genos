import { requireValidConfigSnapshot } from "./config-validation.js";
export function createQuietRuntime(runtime) {
  return { ...runtime, log: () => {} };
}
export async function requireValidConfig(runtime) {
  return await requireValidConfigSnapshot(runtime);
}
