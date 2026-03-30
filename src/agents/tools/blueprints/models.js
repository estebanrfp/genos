/** @type {import("./channels.js").Blueprint[]} */
export default [
  {
    pathPattern: "agents.defaults.model.primary",
    valueType: "scalar",
    itemCoerce: "string",
    guidance:
      "Primary AI model. Use provider/model format (e.g. 'openai/gpt-5.2') or an alias (e.g. 'sonnet', 'opus'). Changed via config_manage models set-default.",
    examples: { set: "anthropic/claude-sonnet-4-5-20250514" },
  },
  {
    pathPattern: "agents.defaults.model.fallbacks",
    valueType: "array",
    itemCoerce: "string",
    guidance:
      "Ordered fallback models. Tried in sequence when the primary model fails. Use same format as primary.",
    examples: { set: "openai/gpt-5.2" },
  },
  {
    pathPattern: "agents.defaults.imageModel.primary",
    valueType: "scalar",
    itemCoerce: "string",
    guidance: "Primary image generation model. E.g. 'openai/dall-e-3', 'openai/gpt-image-1'.",
    examples: { set: "openai/gpt-image-1" },
  },
  {
    pathPattern: "agents.defaults.imageModel.fallbacks",
    valueType: "array",
    itemCoerce: "string",
    guidance: "Fallback image models, tried in order when primary fails.",
    examples: { set: "openai/dall-e-3" },
  },
  {
    pathPattern: "agents.defaults.imageMaxDimensionPx",
    valueType: "scalar",
    itemCoerce: "number",
    guidance:
      "Maximum pixel dimension for images sent to the model. Larger images are resized. Default: 1568.",
    examples: { set: 1568 },
  },
  {
    pathPattern: "agents.defaults.humanDelay.mode",
    valueType: "scalar",
    enumValues: ["off", "natural", "custom"],
    guidance:
      "'off' = instant replies. 'natural' = simulated human typing delay. 'custom' = user-defined delay parameters.",
    examples: { set: "off" },
  },
];
