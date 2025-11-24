import { ErrorCodes, errorShape, formatValidationErrors } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
export function respondInvalidParams(params) {
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${params.method} params: ${formatValidationErrors(params.validator.errors)}`,
    ),
  );
}
export async function respondUnavailableOnThrow(respond, fn) {
  try {
    await fn();
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
  }
}
export function uniqueSortedStrings(values) {
  return [...new Set(values.filter((v) => typeof v === "string"))]
    .map((v) => v.trim())
    .filter(Boolean)
    .toSorted();
}
export function safeParseJson(value) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { payloadJSON: value };
  }
}
export function respondUnavailableOnNodeInvokeError(respond, res) {
  if (res.ok) {
    return true;
  }
  const message =
    res.error && typeof res.error === "object" && "message" in res.error ? res.error.message : null;
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.UNAVAILABLE,
      typeof message === "string" ? message : "node invoke failed",
      {
        details: { nodeError: res.error ?? null },
      },
    ),
  );
  return false;
}
