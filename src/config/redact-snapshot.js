let isSensitivePath = function (path) {
    if (path.endsWith("[]")) {
      return isSensitiveConfigPath(path.slice(0, -2));
    } else {
      return isSensitiveConfigPath(path);
    }
  },
  isEnvVarPlaceholder = function (value) {
    return ENV_VAR_PLACEHOLDER_PATTERN.test(value.trim());
  },
  isExtensionPath = function (path) {
    return (
      path === "plugins" ||
      path.startsWith("plugins.") ||
      path === "channels" ||
      path.startsWith("channels.")
    );
  },
  isExplicitlyNonSensitivePath = function (hints, paths) {
    if (!hints) {
      return false;
    }
    return paths.some((path) => hints[path]?.sensitive === false);
  },
  buildRedactionLookup = function (hints) {
    let result = new Set();
    for (const [path, hint] of Object.entries(hints)) {
      if (!hint.sensitive) {
        continue;
      }
      const parts = path.split(".");
      let joinedPath = parts.shift() ?? "";
      result.add(joinedPath);
      if (joinedPath.endsWith("[]")) {
        result.add(joinedPath.slice(0, -2));
      }
      for (const part of parts) {
        if (part.endsWith("[]")) {
          result.add(`${joinedPath}.${part.slice(0, -2)}`);
        }
        joinedPath = `${joinedPath}.${part}`;
        result.add(joinedPath);
      }
    }
    if (result.size !== 0) {
      result.add("");
    }
    return result;
  },
  redactObject = function (obj, hints) {
    if (hints) {
      const lookup = buildRedactionLookup(hints);
      return lookup.has("")
        ? redactObjectWithLookup(obj, lookup, "", [], hints)
        : redactObjectGuessing(obj, "", [], hints);
    } else {
      return redactObjectGuessing(obj, "", []);
    }
  },
  collectSensitiveValues = function (obj, hints) {
    const result = [];
    if (hints) {
      const lookup = buildRedactionLookup(hints);
      if (lookup.has("")) {
        redactObjectWithLookup(obj, lookup, "", result, hints);
      } else {
        redactObjectGuessing(obj, "", result, hints);
      }
    } else {
      redactObjectGuessing(obj, "", result);
    }
    return result;
  },
  redactObjectWithLookup = function (obj, lookup, prefix, values, hints) {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      const path = `${prefix}[]`;
      if (!lookup.has(path)) {
        if (!isExtensionPath(prefix)) {
          return obj;
        }
        return redactObjectGuessing(obj, prefix, values, hints);
      }
      return obj.map((item) => {
        if (typeof item === "string" && !isEnvVarPlaceholder(item)) {
          values.push(item);
          return REDACTED_SENTINEL;
        }
        return redactObjectWithLookup(item, lookup, path, values, hints);
      });
    }
    if (typeof obj === "object") {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const wildcardPath = prefix ? `${prefix}.*` : "*";
        let matched = false;
        for (const candidate of [path, wildcardPath]) {
          result[key] = value;
          if (lookup.has(candidate)) {
            matched = true;
            if (typeof value === "string" && !isEnvVarPlaceholder(value)) {
              result[key] = REDACTED_SENTINEL;
              values.push(value);
            } else if (typeof value === "object" && value !== null) {
              result[key] = redactObjectWithLookup(value, lookup, candidate, values, hints);
            }
            break;
          }
        }
        if (!matched && isExtensionPath(path)) {
          const markedNonSensitive = isExplicitlyNonSensitivePath(hints, [path, wildcardPath]);
          if (
            typeof value === "string" &&
            !markedNonSensitive &&
            isSensitivePath(path) &&
            !isEnvVarPlaceholder(value)
          ) {
            result[key] = REDACTED_SENTINEL;
            values.push(value);
          } else if (typeof value === "object" && value !== null) {
            result[key] = redactObjectGuessing(value, path, values, hints);
          }
        }
      }
      return result;
    }
    return obj;
  },
  redactObjectGuessing = function (obj, prefix, values, hints) {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => {
        const path = `${prefix}[]`;
        if (
          !isExplicitlyNonSensitivePath(hints, [path]) &&
          isSensitivePath(path) &&
          typeof item === "string" &&
          !isEnvVarPlaceholder(item)
        ) {
          values.push(item);
          return REDACTED_SENTINEL;
        }
        return redactObjectGuessing(item, path, values, hints);
      });
    }
    if (typeof obj === "object") {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const dotPath = prefix ? `${prefix}.${key}` : key;
        const wildcardPath = prefix ? `${prefix}.*` : "*";
        if (
          !isExplicitlyNonSensitivePath(hints, [dotPath, wildcardPath]) &&
          isSensitivePath(dotPath) &&
          typeof value === "string" &&
          !isEnvVarPlaceholder(value)
        ) {
          result[key] = REDACTED_SENTINEL;
          values.push(value);
        } else if (typeof value === "object" && value !== null) {
          result[key] = redactObjectGuessing(value, dotPath, values, hints);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    return obj;
  },
  redactRawText = function (raw, config, hints) {
    const sensitiveValues = collectSensitiveValues(config, hints);
    sensitiveValues.sort((a, b) => b.length - a.length);
    let result = raw;
    for (const value of sensitiveValues) {
      result = result.replaceAll(value, REDACTED_SENTINEL);
    }
    return result;
  },
  restoreOriginalValueOrThrow = function (params) {
    if (params.key in params.original) {
      return params.original[params.key];
    }
    log.warn(`Cannot un-redact config key ${params.path} as it doesn't have any value`);
    throw new RedactionError(params.path);
  },
  mapRedactedArray = function (params) {
    const originalArray = Array.isArray(params.original) ? params.original : [];
    if (params.incoming.length < originalArray.length) {
      log.warn(`Redacted config array key ${params.path} has been truncated`);
    }
    return params.incoming.map((item, index) => params.mapItem(item, index, originalArray));
  },
  toObjectRecord = function (value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    return {};
  },
  restoreArrayItemWithLookup = function (params) {
    if (params.item === REDACTED_SENTINEL) {
      return params.originalArray[params.index];
    }
    return restoreRedactedValuesWithLookup(
      params.item,
      params.originalArray[params.index],
      params.lookup,
      params.path,
      params.hints,
    );
  },
  restoreArrayItemWithGuessing = function (params) {
    if (
      !isExplicitlyNonSensitivePath(params.hints, [params.path]) &&
      isSensitivePath(params.path) &&
      params.item === REDACTED_SENTINEL
    ) {
      return params.originalArray[params.index];
    }
    return restoreRedactedValuesGuessing(
      params.item,
      params.originalArray[params.index],
      params.path,
      params.hints,
    );
  },
  restoreGuessingArray = function (incoming, original, path, hints) {
    return mapRedactedArray({
      incoming,
      original,
      path,
      mapItem: (item, index, originalArray) =>
        restoreArrayItemWithGuessing({
          item,
          index,
          originalArray,
          path,
          hints,
        }),
    });
  },
  restoreRedactedValuesWithLookup = function (incoming, original, lookup, prefix, hints) {
    if (incoming === null || incoming === undefined) {
      return incoming;
    }
    if (typeof incoming !== "object") {
      return incoming;
    }
    if (Array.isArray(incoming)) {
      const path = `${prefix}[]`;
      if (!lookup.has(path)) {
        if (!isExtensionPath(prefix)) {
          return incoming;
        }
        return restoreRedactedValuesGuessing(incoming, original, prefix, hints);
      }
      return mapRedactedArray({
        incoming,
        original,
        path,
        mapItem: (item, index, originalArray) =>
          restoreArrayItemWithLookup({
            item,
            index,
            originalArray,
            lookup,
            path,
            hints,
          }),
      });
    }
    const orig = toObjectRecord(original);
    const result = {};
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = value;
      const path = prefix ? `${prefix}.${key}` : key;
      const wildcardPath = prefix ? `${prefix}.*` : "*";
      let matched = false;
      for (const candidate of [path, wildcardPath]) {
        if (lookup.has(candidate)) {
          matched = true;
          if (value === REDACTED_SENTINEL) {
            result[key] = restoreOriginalValueOrThrow({ key, path: candidate, original: orig });
          } else if (typeof value === "object" && value !== null) {
            result[key] = restoreRedactedValuesWithLookup(
              value,
              orig[key],
              lookup,
              candidate,
              hints,
            );
          }
          break;
        }
      }
      if (!matched && isExtensionPath(path)) {
        const markedNonSensitive = isExplicitlyNonSensitivePath(hints, [path, wildcardPath]);
        if (!markedNonSensitive && isSensitivePath(path) && value === REDACTED_SENTINEL) {
          result[key] = restoreOriginalValueOrThrow({ key, path, original: orig });
        } else if (typeof value === "object" && value !== null) {
          result[key] = restoreRedactedValuesGuessing(value, orig[key], path, hints);
        }
      }
    }
    return result;
  },
  restoreRedactedValuesGuessing = function (incoming, original, prefix, hints) {
    if (incoming === null || incoming === undefined) {
      return incoming;
    }
    if (typeof incoming !== "object") {
      return incoming;
    }
    if (Array.isArray(incoming)) {
      const path = `${prefix}[]`;
      return restoreGuessingArray(incoming, original, path, hints);
    }
    const orig = toObjectRecord(original);
    const result = {};
    for (const [key, value] of Object.entries(incoming)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const wildcardPath = prefix ? `${prefix}.*` : "*";
      if (
        !isExplicitlyNonSensitivePath(hints, [path, wildcardPath]) &&
        isSensitivePath(path) &&
        value === REDACTED_SENTINEL
      ) {
        result[key] = restoreOriginalValueOrThrow({ key, path, original: orig });
      } else if (typeof value === "object" && value !== null) {
        result[key] = restoreRedactedValuesGuessing(value, orig[key], path, hints);
      } else {
        result[key] = value;
      }
    }
    return result;
  };
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isSensitiveConfigPath } from "./schema.hints.js";
const log = createSubsystemLogger("config/redaction");
const ENV_VAR_PLACEHOLDER_PATTERN = /^\$\{[^}]*\}$/;
export const REDACTED_SENTINEL = "__GENOS_REDACTED__";
export function redactConfigObject(value, uiHints) {
  return redactObject(value, uiHints);
}
export function redactConfigSnapshot(snapshot, uiHints) {
  if (!snapshot.valid) {
    return {
      ...snapshot,
      config: {},
      raw: null,
      parsed: null,
      resolved: {},
    };
  }
  const redactedConfig = redactObject(snapshot.config, uiHints);
  const redactedRaw = snapshot.raw ? redactRawText(snapshot.raw, snapshot.config, uiHints) : null;
  const redactedParsed = snapshot.parsed ? redactObject(snapshot.parsed, uiHints) : snapshot.parsed;
  const redactedResolved = redactConfigObject(snapshot.resolved, uiHints);
  return {
    ...snapshot,
    config: redactedConfig,
    raw: redactedRaw,
    parsed: redactedParsed,
    resolved: redactedResolved,
  };
}
export function restoreRedactedValues(incoming, original, hints) {
  if (incoming === null || incoming === undefined) {
    return { ok: false, error: "no input" };
  }
  if (typeof incoming !== "object") {
    return { ok: false, error: "input not an object" };
  }
  try {
    if (hints) {
      const lookup = buildRedactionLookup(hints);
      if (lookup.has("")) {
        return {
          ok: true,
          result: restoreRedactedValuesWithLookup(incoming, original, lookup, "", hints),
        };
      } else {
        return { ok: true, result: restoreRedactedValuesGuessing(incoming, original, "", hints) };
      }
    } else {
      return { ok: true, result: restoreRedactedValuesGuessing(incoming, original, "") };
    }
  } catch (err) {
    if (err instanceof RedactionError) {
      return {
        ok: false,
        humanReadableMessage: `Sentinel value "${REDACTED_SENTINEL}" in key ${err.key} is not valid as real data`,
      };
    }
    throw err;
  }
}

class RedactionError extends Error {
  key;
  constructor(key) {
    super("internal error class---should never escape");
    this.key = key;
    this.name = "RedactionError";
  }
}
