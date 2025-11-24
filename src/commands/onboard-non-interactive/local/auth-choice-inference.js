let hasStringValue = function (value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
};
import { ONBOARD_PROVIDER_AUTH_FLAGS } from "../../onboard-provider-auth-flags.js";
export function inferAuthChoiceFromFlags(opts) {
  const matches = ONBOARD_PROVIDER_AUTH_FLAGS.filter(({ optionKey }) =>
    hasStringValue(opts[optionKey]),
  ).map((flag) => ({
    optionKey: flag.optionKey,
    authChoice: flag.authChoice,
    label: flag.cliFlag,
  }));
  if (
    hasStringValue(opts.customBaseUrl) ||
    hasStringValue(opts.customModelId) ||
    hasStringValue(opts.customApiKey)
  ) {
    matches.push({
      optionKey: "customBaseUrl",
      authChoice: "custom-api-key",
      label: "--custom-base-url/--custom-model-id/--custom-api-key",
    });
  }
  return {
    choice: matches[0]?.authChoice,
    matches,
  };
}
