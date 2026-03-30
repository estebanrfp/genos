export const BARE_SESSION_RESET_PROMPT =
  "A new session was started via /new or /reset. First, check if BOOTSTRAP.md exists in your workspace — if it does, follow its onboarding instructions (ask the user for your name, personality, etc.) instead of a generic greeting. If BOOTSTRAP.md does not exist or onboarding is already complete, greet the user in your configured persona. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

/** Build reset prompt with browser locale for language detection */
export const buildSessionResetPrompt = (locale) => {
  if (!locale) {
    return BARE_SESSION_RESET_PROMPT;
  }
  return `${BARE_SESSION_RESET_PROMPT} The user's browser locale is "${locale}" — respond in that language from the start.`;
};
