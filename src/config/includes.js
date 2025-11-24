let safeRealpath = function (target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
};
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { isPathInside } from "../security/scan-paths.js";
import { isPlainObject } from "../utils.js";
export const INCLUDE_KEY = "$include";
export const MAX_INCLUDE_DEPTH = 10;

export class ConfigIncludeError extends Error {
  includePath;
  cause;
  constructor(message, includePath, cause) {
    super(message);
    this.includePath = includePath;
    this.cause = cause;
    this.name = "ConfigIncludeError";
  }
}

export class CircularIncludeError extends ConfigIncludeError {
  chain;
  constructor(chain) {
    super(`Circular include detected: ${chain.join(" -> ")}`, chain[chain.length - 1]);
    this.chain = chain;
    this.name = "CircularIncludeError";
  }
}
export function deepMerge(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    return [...target, ...source];
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      result[key] = key in result ? deepMerge(result[key], source[key]) : source[key];
    }
    return result;
  }
  return source;
}

class IncludeProcessor {
  basePath;
  resolver;
  visited = new Set();
  depth = 0;
  rootDir;
  rootRealDir;
  constructor(basePath, resolver, rootDir) {
    this.basePath = basePath;
    this.resolver = resolver;
    this.visited.add(path.normalize(basePath));
    this.rootDir = path.normalize(rootDir ?? path.dirname(basePath));
    this.rootRealDir = path.normalize(safeRealpath(this.rootDir));
  }
  process(obj) {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.process(item));
    }
    if (!isPlainObject(obj)) {
      return obj;
    }
    if (!(INCLUDE_KEY in obj)) {
      return this.processObject(obj);
    }
    return this.processInclude(obj);
  }
  processObject(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.process(value);
    }
    return result;
  }
  processInclude(obj) {
    const includeValue = obj[INCLUDE_KEY];
    const otherKeys = Object.keys(obj).filter((k) => k !== INCLUDE_KEY);
    const included = this.resolveInclude(includeValue);
    if (otherKeys.length === 0) {
      return included;
    }
    if (!isPlainObject(included)) {
      throw new ConfigIncludeError(
        "Sibling keys require included content to be an object",
        typeof includeValue === "string" ? includeValue : INCLUDE_KEY,
      );
    }
    const rest = {};
    for (const key of otherKeys) {
      rest[key] = this.process(obj[key]);
    }
    return deepMerge(included, rest);
  }
  resolveInclude(value) {
    if (typeof value === "string") {
      return this.loadFile(value);
    }
    if (Array.isArray(value)) {
      return value.reduce((merged, item) => {
        if (typeof item !== "string") {
          throw new ConfigIncludeError(
            `Invalid $include array item: expected string, got ${typeof item}`,
            String(item),
          );
        }
        return deepMerge(merged, this.loadFile(item));
      }, {});
    }
    throw new ConfigIncludeError(
      `Invalid $include value: expected string or array of strings, got ${typeof value}`,
      String(value),
    );
  }
  loadFile(includePath) {
    const resolvedPath = this.resolvePath(includePath);
    this.checkCircular(resolvedPath);
    this.checkDepth(includePath);
    const raw = this.readFile(includePath, resolvedPath);
    const parsed = this.parseFile(includePath, resolvedPath, raw);
    return this.processNested(resolvedPath, parsed);
  }
  resolvePath(includePath) {
    const configDir = path.dirname(this.basePath);
    const resolved = path.isAbsolute(includePath)
      ? includePath
      : path.resolve(configDir, includePath);
    const normalized = path.normalize(resolved);
    if (!isPathInside(this.rootDir, normalized)) {
      throw new ConfigIncludeError(
        `Include path escapes config directory: ${includePath} (root: ${this.rootDir})`,
        includePath,
      );
    }
    try {
      const real = fs.realpathSync(normalized);
      if (!isPathInside(this.rootRealDir, real)) {
        throw new ConfigIncludeError(
          `Include path resolves outside config directory (symlink): ${includePath} (root: ${this.rootDir})`,
          includePath,
        );
      }
    } catch (err) {
      if (err instanceof ConfigIncludeError) {
        throw err;
      }
    }
    return normalized;
  }
  checkCircular(resolvedPath) {
    if (this.visited.has(resolvedPath)) {
      throw new CircularIncludeError([...this.visited, resolvedPath]);
    }
  }
  checkDepth(includePath) {
    if (this.depth >= MAX_INCLUDE_DEPTH) {
      throw new ConfigIncludeError(
        `Maximum include depth (${MAX_INCLUDE_DEPTH}) exceeded at: ${includePath}`,
        includePath,
      );
    }
  }
  readFile(includePath, resolvedPath) {
    try {
      return this.resolver.readFile(resolvedPath);
    } catch (err) {
      throw new ConfigIncludeError(
        `Failed to read include file: ${includePath} (resolved: ${resolvedPath})`,
        includePath,
        err instanceof Error ? err : undefined,
      );
    }
  }
  parseFile(includePath, resolvedPath, raw) {
    try {
      return this.resolver.parseJson(raw);
    } catch (err) {
      throw new ConfigIncludeError(
        `Failed to parse include file: ${includePath} (resolved: ${resolvedPath})`,
        includePath,
        err instanceof Error ? err : undefined,
      );
    }
  }
  processNested(resolvedPath, parsed) {
    const nested = new IncludeProcessor(resolvedPath, this.resolver, this.rootDir);
    nested.visited = new Set([...this.visited, resolvedPath]);
    nested.depth = this.depth + 1;
    return nested.process(parsed);
  }
}
const defaultResolver = {
  readFile: (p) => fs.readFileSync(p, "utf-8"),
  parseJson: (raw) => JSON5.parse(raw),
};
export function resolveConfigIncludes(obj, configPath, resolver = defaultResolver) {
  return new IncludeProcessor(configPath, resolver).process(obj);
}
