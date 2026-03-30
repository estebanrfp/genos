import { AUTH_CHOICE_LEGACY_ALIASES_FOR_CLI } from "./auth-choice-legacy.js";

/**
 * Curated providers — 3 tested, reliable providers with full tool calling support.
 * Same selection as GenosOS Pro for product coherence.
 * Smart model routing: each provider has a default (daily) and boost (complex) model.
 *
 * | Provider  | Default          | Boost              |
 * |-----------|------------------|--------------------|
 * | Anthropic | sonnet-4-6       | opus-4-6           |
 * | OpenAI    | gpt-5.4          | o3                 |
 * | Gemini    | gemini-2.5-pro   | gemini-3-pro       |
 */
/** Model pairs for smart routing — default (daily) and boost (complex) per provider */
export const BOOST_MODELS = {
  anthropic: { default: "claude-sonnet-4-6", boost: "claude-opus-4-6" },
  openai: { default: "gpt-5.4", boost: "o3" },
  google: { default: "gemini-2.5-pro", boost: "gemini-3-pro" },
};

const AUTH_CHOICE_GROUP_DEFS = [
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "Subscription token or API key",
    choices: ["token", "apiKey"],
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "API key (sk-proj-...)",
    choices: ["openai-api-key"],
  },
  {
    value: "google",
    label: "Gemini",
    hint: "API key (AIza...)",
    choices: ["gemini-api-key"],
  },
];
const BASE_AUTH_CHOICE_OPTIONS = [
  {
    value: "token",
    label: "Anthropic subscription token",
    hint: "run `claude setup-token` elsewhere, then paste the token here (sk-ant-oat01-...)",
  },
  { value: "apiKey", label: "Anthropic API key", hint: "sk-ant-api-..." },
  { value: "openai-api-key", label: "OpenAI API key", hint: "sk-proj-..." },
  { value: "gemini-api-key", label: "Google Gemini API key", hint: "AIza..." },
];
export function formatAuthChoiceChoicesForCli(params) {
  const includeSkip = params?.includeSkip ?? true;
  const includeLegacyAliases = params?.includeLegacyAliases ?? false;
  const values = BASE_AUTH_CHOICE_OPTIONS.map((opt) => opt.value);
  if (includeSkip) {
    values.push("skip");
  }
  if (includeLegacyAliases) {
    values.push(...AUTH_CHOICE_LEGACY_ALIASES_FOR_CLI);
  }
  return values.join("|");
}
export function buildAuthChoiceOptions(params) {
  const options = [...BASE_AUTH_CHOICE_OPTIONS];
  if (params.includeSkip) {
    options.push({ value: "skip", label: "Skip for now" });
  }
  return options;
}
export function buildAuthChoiceGroups(params) {
  const options = buildAuthChoiceOptions({
    ...params,
    includeSkip: false,
  });
  const optionByValue = new Map(options.map((opt) => [opt.value, opt]));
  const groups = AUTH_CHOICE_GROUP_DEFS.map((group) => ({
    ...group,
    options: group.choices.map((choice) => optionByValue.get(choice)).filter((opt) => Boolean(opt)),
  }));
  const skipOption = params.includeSkip ? { value: "skip", label: "Skip for now" } : undefined;
  return { groups, skipOption };
}
