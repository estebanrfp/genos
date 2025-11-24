export function normalizeSecretInput(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n\u2028\u2029]+/g, "").trim();
}
export function normalizeOptionalSecretInput(value) {
  const normalized = normalizeSecretInput(value);
  return normalized ? normalized : undefined;
}
