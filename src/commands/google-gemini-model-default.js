import { applyAgentDefaultPrimaryModel } from "./model-default.js";
export const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-3-pro-preview";
export function applyGoogleGeminiModelDefault(cfg) {
  return applyAgentDefaultPrimaryModel({ cfg, model: GOOGLE_GEMINI_DEFAULT_MODEL });
}
