let applyVllmDefaultModel = function (cfg, modelRef) {
  const existingModel = cfg.agents?.defaults?.model;
  const fallbacks =
    existingModel && typeof existingModel === "object" && "fallbacks" in existingModel
      ? existingModel.fallbacks
      : undefined;
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        model: {
          ...(fallbacks ? { fallbacks } : undefined),
          primary: modelRef,
        },
      },
    },
  };
};
import { promptAndConfigureVllm } from "./vllm-setup.js";
export async function applyAuthChoiceVllm(params) {
  if (params.authChoice !== "vllm") {
    return null;
  }
  const { config: nextConfig, modelRef } = await promptAndConfigureVllm({
    cfg: params.config,
    prompter: params.prompter,
    agentDir: params.agentDir,
  });
  if (!params.setDefaultModel) {
    return { config: nextConfig, agentModelOverride: modelRef };
  }
  await params.prompter.note(`Default model set to ${modelRef}`, "Model configured");
  return { config: applyVllmDefaultModel(nextConfig, modelRef) };
}
