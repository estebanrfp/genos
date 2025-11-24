import {
  addFallbackCommand,
  clearFallbacksCommand,
  listFallbacksCommand,
  removeFallbackCommand,
} from "./fallbacks-shared.js";
export async function modelsFallbacksListCommand(opts, runtime) {
  return await listFallbacksCommand({ label: "Fallbacks", key: "model" }, opts, runtime);
}
export async function modelsFallbacksAddCommand(modelRaw, runtime) {
  return await addFallbackCommand(
    { label: "Fallbacks", key: "model", logPrefix: "Fallbacks" },
    modelRaw,
    runtime,
  );
}
export async function modelsFallbacksRemoveCommand(modelRaw, runtime) {
  return await removeFallbackCommand(
    {
      label: "Fallbacks",
      key: "model",
      notFoundLabel: "Fallback",
      logPrefix: "Fallbacks",
    },
    modelRaw,
    runtime,
  );
}
export async function modelsFallbacksClearCommand(runtime) {
  return await clearFallbacksCommand(
    { key: "model", clearedMessage: "Fallback list cleared." },
    runtime,
  );
}
