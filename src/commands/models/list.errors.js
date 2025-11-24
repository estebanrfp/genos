export const MODEL_AVAILABILITY_UNAVAILABLE_CODE = "MODEL_AVAILABILITY_UNAVAILABLE";
export function formatErrorWithStack(err) {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}
export function shouldFallbackToAuthHeuristics(err) {
  if (!(err instanceof Error)) {
    return false;
  }
  const code = err.code;
  return code === MODEL_AVAILABILITY_UNAVAILABLE_CODE;
}
