export function sanitizeForPromptLiteral(value) {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "");
}
