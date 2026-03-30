export function normalizeTwitchChannel(channel) {
  const trimmed = channel.trim().toLowerCase();
  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}
export function missingTargetError(provider, hint) {
  return new Error(`Delivering to ${provider} requires target${hint ? ` ${hint}` : ""}`);
}
export function generateMessageId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
export function normalizeToken(token) {
  return token.startsWith("oauth:") ? token.slice(6) : token;
}
export function isAccountConfigured(account, resolvedToken) {
  const token = resolvedToken ?? account?.accessToken;
  return Boolean(account?.username && token && account?.clientId);
}
