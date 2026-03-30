let getErrorCause = function (err) {
    if (!err || typeof err !== "object") {
      return;
    }
    return err.cause;
  },
  extractErrorCodeWithCause = function (err) {
    const direct = extractErrorCode(err);
    if (direct) {
      return direct;
    }
    return extractErrorCode(getErrorCause(err));
  },
  isFatalError = function (err) {
    const code = extractErrorCodeWithCause(err);
    return code !== undefined && FATAL_ERROR_CODES.has(code);
  },
  isConfigError = function (err) {
    const code = extractErrorCodeWithCause(err);
    return code !== undefined && CONFIG_ERROR_CODES.has(code);
  };
import process from "node:process";
import { extractErrorCode, formatUncaughtError } from "./errors.js";
const handlers = new Set();
const FATAL_ERROR_CODES = new Set([
  "ERR_OUT_OF_MEMORY",
  "ERR_SCRIPT_EXECUTION_TIMEOUT",
  "ERR_WORKER_OUT_OF_MEMORY",
  "ERR_WORKER_UNCAUGHT_EXCEPTION",
  "ERR_WORKER_INITIALIZATION_FAILED",
]);
const CONFIG_ERROR_CODES = new Set(["INVALID_CONFIG", "MISSING_API_KEY", "MISSING_CREDENTIALS"]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DNS_RESOLVE_FAILED",
  "UND_ERR_CONNECT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
export function isAbortError(err) {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") {
    return true;
  }
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (message === "This operation was aborted") {
    return true;
  }
  return false;
}
export function isTransientNetworkError(err) {
  if (!err) {
    return false;
  }
  const code = extractErrorCodeWithCause(err);
  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }
  if (err instanceof TypeError && err.message === "fetch failed") {
    const cause = getErrorCause(err);
    if (cause) {
      return isTransientNetworkError(cause);
    }
    return true;
  }
  const cause = getErrorCause(err);
  if (cause && cause !== err) {
    return isTransientNetworkError(cause);
  }
  if (err instanceof AggregateError && err.errors?.length) {
    return err.errors.some((e) => isTransientNetworkError(e));
  }
  return false;
}
export function registerUnhandledRejectionHandler(handler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
export function isUnhandledRejectionHandled(reason) {
  for (const handler of handlers) {
    try {
      if (handler(reason)) {
        return true;
      }
    } catch (err) {
      console.error(
        "[genosos] Unhandled rejection handler failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    }
  }
  return false;
}
export function installUnhandledRejectionHandler() {
  process.on("unhandledRejection", (reason, _promise) => {
    if (isUnhandledRejectionHandled(reason)) {
      return;
    }
    if (isAbortError(reason)) {
      console.warn("[genosos] Suppressed AbortError:", formatUncaughtError(reason));
      return;
    }
    if (isFatalError(reason)) {
      console.error("[genosos] FATAL unhandled rejection:", formatUncaughtError(reason));
      process.exit(1);
      return;
    }
    if (isConfigError(reason)) {
      console.error("[genosos] CONFIGURATION ERROR - requires fix:", formatUncaughtError(reason));
      process.exit(1);
      return;
    }
    if (isTransientNetworkError(reason)) {
      console.warn(
        "[genosos] Non-fatal unhandled rejection (continuing):",
        formatUncaughtError(reason),
      );
      return;
    }
    console.error("[genosos] Unhandled promise rejection:", formatUncaughtError(reason));
    process.exit(1);
  });
}
