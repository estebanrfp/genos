import { ErrorCodes, errorShape, formatValidationErrors } from "../protocol/index.js";
export function assertValidParams(params, validate, method, respond) {
  if (validate(params)) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(validate.errors)}`,
    ),
  );
  return false;
}
