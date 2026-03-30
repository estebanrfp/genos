let parseEnvTokenAt = function (value, index) {
    if (value[index] !== "$") {
      return null;
    }
    const next = value[index + 1];
    const afterNext = value[index + 2];
    if (next === "$" && afterNext === "{") {
      const start = index + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          return { kind: "escaped", name, end };
        }
      }
    }
    if (next === "{") {
      const start = index + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          return { kind: "substitution", name, end };
        }
      }
    }
    return null;
  },
  substituteString = function (value, env, configPath) {
    if (!value.includes("$")) {
      return value;
    }
    const chunks = [];
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (char !== "$") {
        chunks.push(char);
        continue;
      }
      const token = parseEnvTokenAt(value, i);
      if (token?.kind === "escaped") {
        chunks.push(`\${${token.name}}`);
        i = token.end;
        continue;
      }
      if (token?.kind === "substitution") {
        const envValue = env[token.name];
        if (envValue === undefined || envValue === "") {
          throw new MissingEnvVarError(token.name, configPath);
        }
        chunks.push(envValue);
        i = token.end;
        continue;
      }
      chunks.push(char);
    }
    return chunks.join("");
  },
  substituteAny = function (value, env, path) {
    if (typeof value === "string") {
      return substituteString(value, env, path);
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => substituteAny(item, env, `${path}[${index}]`));
    }
    if (isPlainObject(value)) {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        result[key] = substituteAny(val, env, childPath);
      }
      return result;
    }
    return value;
  };
import { isPlainObject } from "../utils.js";
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export class MissingEnvVarError extends Error {
  varName;
  configPath;
  constructor(varName, configPath) {
    super(`Missing env var "${varName}" referenced at config path: ${configPath}`);
    this.varName = varName;
    this.configPath = configPath;
    this.name = "MissingEnvVarError";
  }
}
export function containsEnvVarReference(value) {
  if (!value.includes("$")) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "$") {
      continue;
    }
    const token = parseEnvTokenAt(value, i);
    if (token?.kind === "escaped") {
      i = token.end;
      continue;
    }
    if (token?.kind === "substitution") {
      return true;
    }
  }
  return false;
}
export function resolveConfigEnvVars(obj, env = process.env) {
  return substituteAny(obj, env, "");
}
