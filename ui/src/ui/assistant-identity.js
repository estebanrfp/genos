let coerceIdentityValue = function (value, maxLength) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength);
};
const MAX_ASSISTANT_NAME = 50;
const MAX_ASSISTANT_AVATAR = 200;
export const DEFAULT_ASSISTANT_NAME = "Assistant";
export const DEFAULT_ASSISTANT_AVATAR = "A";
export function normalizeAssistantIdentity(input) {
  const name = coerceIdentityValue(input?.name, MAX_ASSISTANT_NAME) ?? DEFAULT_ASSISTANT_NAME;
  const avatar = coerceIdentityValue(input?.avatar ?? undefined, MAX_ASSISTANT_AVATAR) ?? null;
  const agentId =
    typeof input?.agentId === "string" && input.agentId.trim() ? input.agentId.trim() : null;
  return { agentId, name, avatar };
}
