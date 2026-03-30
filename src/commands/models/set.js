import { logConfigUpdated } from "../../config/logging.js";
import { applyDefaultModelPrimaryUpdate, updateConfig } from "./shared.js";
export async function modelsSetCommand(modelRaw, runtime) {
  const updated = await updateConfig((cfg) => {
    return applyDefaultModelPrimaryUpdate({ cfg, modelRaw, field: "model" });
  });
  logConfigUpdated(runtime);
  runtime.log(`Default model: ${updated.agents?.defaults?.model?.primary ?? modelRaw}`);
}
