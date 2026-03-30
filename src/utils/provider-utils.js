export function isReasoningTagProvider(provider) {
  if (!provider) {
    return false;
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "google-gemini-cli" || normalized === "google-generative-ai") {
    return true;
  }
  if (normalized.includes("google-antigravity")) {
    return true;
  }
  if (normalized.includes("minimax")) {
    return true;
  }
  return false;
}
