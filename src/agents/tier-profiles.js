/**
 * Sensible capability defaults per tier.
 * Simple → off (speed), Normal → thinking:medium, Complex → full power.
 * Only applied when the tier config is a plain string (no explicit profile).
 */
export const TIER_CAPABILITY_DEFAULTS = {
  simple: {},
  normal: { thinking: "medium" },
  complex: { thinking: "high", verbose: "on", reasoning: "on" },
};

/**
 * Normalize a tier value (string or object) into a full profile.
 * When tierValue is a string, tier-level thinking defaults are applied
 * based on tierName. When tierValue is an explicit object, user config wins.
 * @param {string | { model: string, thinking?: string, verbose?: string, reasoning?: string }} tierValue
 * @param {string} [tierName] - "simple" | "normal" | "complex"
 * @returns {{ model: string, thinking?: string, verbose?: string, reasoning?: string }}
 */
export const normalizeTierProfile = (tierValue, tierName) => {
  if (typeof tierValue === "string") {
    const defaults = tierName ? (TIER_CAPABILITY_DEFAULTS[tierName] ?? {}) : {};
    return { model: tierValue, ...defaults };
  }
  if (tierValue && typeof tierValue === "object" && typeof tierValue.model === "string") {
    return { ...tierValue };
  }
  return { model: "" };
};

/**
 * Extract the model string from a tier value (string or object).
 * @param {string | { model: string }} tierValue
 * @returns {string}
 */
export const extractTierModel = (tierValue) => {
  if (typeof tierValue === "string") {
    return tierValue;
  }
  return tierValue?.model ?? "";
};
