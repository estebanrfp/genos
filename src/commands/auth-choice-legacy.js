export const AUTH_CHOICE_LEGACY_ALIASES_FOR_CLI = [
  "setup-token",
  "oauth",
  "claude-cli",
  "codex-cli",
  "minimax-cloud",
  "minimax",
];
export function normalizeLegacyOnboardAuthChoice(authChoice) {
  if (authChoice === "oauth" || authChoice === "claude-cli") {
    return "setup-token";
  }
  if (authChoice === "codex-cli") {
    return "openai-codex";
  }
  return authChoice;
}
export function isDeprecatedAuthChoice(authChoice) {
  return authChoice === "claude-cli" || authChoice === "codex-cli";
}
