import {
  addFallbackCommand,
  clearFallbacksCommand,
  listFallbacksCommand,
  removeFallbackCommand,
} from "./fallbacks-shared.js";
export async function modelsImageFallbacksListCommand(opts, runtime) {
  return await listFallbacksCommand({ label: "Image fallbacks", key: "imageModel" }, opts, runtime);
}
export async function modelsImageFallbacksAddCommand(modelRaw, runtime) {
  return await addFallbackCommand(
    { label: "Image fallbacks", key: "imageModel", logPrefix: "Image fallbacks" },
    modelRaw,
    runtime,
  );
}
export async function modelsImageFallbacksRemoveCommand(modelRaw, runtime) {
  return await removeFallbackCommand(
    {
      label: "Image fallbacks",
      key: "imageModel",
      notFoundLabel: "Image fallback",
      logPrefix: "Image fallbacks",
    },
    modelRaw,
    runtime,
  );
}
export async function modelsImageFallbacksClearCommand(runtime) {
  return await clearFallbacksCommand(
    { key: "imageModel", clearedMessage: "Image fallback list cleared." },
    runtime,
  );
}
