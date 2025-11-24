let normalizeConsoleLevel = function (level) {
    if (isVerbose()) {
      return "debug";
    }
    if (!level && process.env.VITEST === "true" && process.env.GENOS_TEST_CONSOLE !== "1") {
      return "silent";
    }
    return normalizeLogLevel(level, "info");
  },
  normalizeConsoleStyle = function (style) {
    if (style === "compact" || style === "json" || style === "pretty") {
      return style;
    }
    if (!process.stdout.isTTY) {
      return "compact";
    }
    return "pretty";
  },
  resolveConsoleSettings = function () {
    let cfg = loggingState.overrideSettings ?? readLoggingConfig();
    if (!cfg) {
      if (loggingState.resolvingConsoleSettings) {
        cfg = undefined;
      } else {
        loggingState.resolvingConsoleSettings = true;
        try {
          cfg = loadConfigFallback();
        } finally {
          loggingState.resolvingConsoleSettings = false;
        }
      }
    }
    const level = normalizeConsoleLevel(cfg?.consoleLevel);
    const style = normalizeConsoleStyle(cfg?.consoleStyle);
    return { level, style };
  },
  consoleSettingsChanged = function (a, b) {
    if (!a) {
      return true;
    }
    return a.level !== b.level || a.style !== b.style;
  },
  shouldSuppressConsoleMessage = function (message) {
    if (isVerbose()) {
      return false;
    }
    if (SUPPRESSED_CONSOLE_PREFIXES.some((prefix) => message.startsWith(prefix))) {
      return true;
    }
    if (
      message.startsWith("[EventQueue] Slow listener detected") &&
      message.includes("DiscordMessageListener")
    ) {
      return true;
    }
    return false;
  },
  isEpipeError = function (err) {
    const code = err?.code;
    return code === "EPIPE" || code === "EIO";
  },
  hasTimestampPrefix = function (value) {
    return /^(?:\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/.test(
      value,
    );
  },
  isJsonPayload = function (value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return false;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  };
import { createRequire } from "node:module";
import util from "node:util";
import { isVerbose } from "../globals.js";
import { stripAnsi } from "../terminal/ansi.js";
import { readLoggingConfig } from "./config.js";
import { normalizeLogLevel } from "./levels.js";
import { getLogger } from "./logger.js";
import { loggingState } from "./state.js";
import { formatLocalIsoWithOffset } from "./timestamps.js";
const requireConfig = createRequire(import.meta.url);
const loadConfigFallbackDefault = () => {
  try {
    const loaded = requireConfig("../config/config.js");
    return loaded.loadConfig?.().logging;
  } catch {
    return;
  }
};
let loadConfigFallback = loadConfigFallbackDefault;
export function setConsoleConfigLoaderForTests(loader) {
  loadConfigFallback = loader ?? loadConfigFallbackDefault;
}
export function getConsoleSettings() {
  const settings = resolveConsoleSettings();
  const cached = loggingState.cachedConsoleSettings;
  if (!cached || consoleSettingsChanged(cached, settings)) {
    loggingState.cachedConsoleSettings = settings;
  }
  return loggingState.cachedConsoleSettings;
}
export function getResolvedConsoleSettings() {
  return getConsoleSettings();
}
export function routeLogsToStderr() {
  loggingState.forceConsoleToStderr = true;
}
export function setConsoleSubsystemFilter(filters) {
  if (!filters || filters.length === 0) {
    loggingState.consoleSubsystemFilter = null;
    return;
  }
  const normalized = filters.map((value) => value.trim()).filter((value) => value.length > 0);
  loggingState.consoleSubsystemFilter = normalized.length > 0 ? normalized : null;
}
export function setConsoleTimestampPrefix(enabled) {
  loggingState.consoleTimestampPrefix = enabled;
}
export function shouldLogSubsystemToConsole(subsystem) {
  const filter = loggingState.consoleSubsystemFilter;
  if (!filter || filter.length === 0) {
    return true;
  }
  return filter.some((prefix) => subsystem === prefix || subsystem.startsWith(`${prefix}/`));
}
const SUPPRESSED_CONSOLE_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Session already open",
];
export function formatConsoleTimestamp(style) {
  const now = new Date();
  if (style === "pretty") {
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return formatLocalIsoWithOffset(now);
}
export function enableConsoleCapture() {
  if (loggingState.consolePatched) {
    return;
  }
  loggingState.consolePatched = true;
  if (!loggingState.streamErrorHandlersInstalled) {
    loggingState.streamErrorHandlersInstalled = true;
    for (const stream of [process.stdout, process.stderr]) {
      stream.on("error", (err) => {
        if (isEpipeError(err)) {
          return;
        }
        throw err;
      });
    }
  }
  let logger = null;
  const getLoggerLazy = () => {
    if (!logger) {
      logger = getLogger();
    }
    return logger;
  };
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    trace: console.trace,
  };
  loggingState.rawConsole = {
    log: original.log,
    info: original.info,
    warn: original.warn,
    error: original.error,
  };
  const forward =
    (level, orig) =>
    (...args) => {
      const formatted = util.format(...args);
      if (shouldSuppressConsoleMessage(formatted)) {
        return;
      }
      const trimmed = stripAnsi(formatted).trimStart();
      const shouldPrefixTimestamp =
        loggingState.consoleTimestampPrefix &&
        trimmed.length > 0 &&
        !hasTimestampPrefix(trimmed) &&
        !isJsonPayload(trimmed);
      const timestamp = shouldPrefixTimestamp
        ? formatConsoleTimestamp(getConsoleSettings().style)
        : "";
      try {
        const resolvedLogger = getLoggerLazy();
        if (level === "trace") {
          resolvedLogger.trace(formatted);
        } else if (level === "debug") {
          resolvedLogger.debug(formatted);
        } else if (level === "info") {
          resolvedLogger.info(formatted);
        } else if (level === "warn") {
          resolvedLogger.warn(formatted);
        } else if (level === "error" || level === "fatal") {
          resolvedLogger.error(formatted);
        } else {
          resolvedLogger.info(formatted);
        }
      } catch {}
      if (loggingState.forceConsoleToStderr) {
        try {
          const line = timestamp ? `${timestamp} ${formatted}` : formatted;
          process.stderr.write(`${line}\n`);
        } catch (err) {
          if (isEpipeError(err)) {
            return;
          }
          throw err;
        }
      } else {
        try {
          if (!timestamp) {
            orig.apply(console, args);
            return;
          }
          if (args.length === 0) {
            orig.call(console, timestamp);
            return;
          }
          if (typeof args[0] === "string") {
            orig.call(console, `${timestamp} ${args[0]}`, ...args.slice(1));
            return;
          }
          orig.call(console, timestamp, ...args);
        } catch (err) {
          if (isEpipeError(err)) {
            return;
          }
          throw err;
        }
      }
    };
  console.log = forward("info", original.log);
  console.info = forward("info", original.info);
  console.warn = forward("warn", original.warn);
  console.error = forward("error", original.error);
  console.debug = forward("debug", original.debug);
  console.trace = forward("trace", original.trace);
}
