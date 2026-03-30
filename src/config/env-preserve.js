let isPlainObject = function (value) {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.prototype.toString.call(value) === "[object Object]"
    );
  },
  hasEnvVarRef = function (value) {
    return ENV_VAR_PATTERN.test(value);
  },
  tryResolveString = function (template, env) {
    const ENV_VAR_NAME = /^[A-Z_][A-Z0-9_]*$/;
    const chunks = [];
    for (let i = 0; i < template.length; i++) {
      if (template[i] === "$") {
        if (template[i + 1] === "$" && template[i + 2] === "{") {
          const start = i + 3;
          const end = template.indexOf("}", start);
          if (end !== -1) {
            const name = template.slice(start, end);
            if (ENV_VAR_NAME.test(name)) {
              chunks.push(`\${${name}}`);
              i = end;
              continue;
            }
          }
        }
        if (template[i + 1] === "{") {
          const start = i + 2;
          const end = template.indexOf("}", start);
          if (end !== -1) {
            const name = template.slice(start, end);
            if (ENV_VAR_NAME.test(name)) {
              const val = env[name];
              if (val === undefined || val === "") {
                return null;
              }
              chunks.push(val);
              i = end;
              continue;
            }
          }
        }
      }
      chunks.push(template[i]);
    }
    return chunks.join("");
  };
const ENV_VAR_PATTERN = /\$\{[A-Z_][A-Z0-9_]*\}/;
export function restoreEnvVarRefs(incoming, parsed, env = process.env) {
  if (parsed === null || parsed === undefined) {
    return incoming;
  }
  if (typeof incoming === "string" && typeof parsed === "string") {
    if (hasEnvVarRef(parsed)) {
      const resolved = tryResolveString(parsed, env);
      if (resolved === incoming) {
        return parsed;
      }
    }
    return incoming;
  }
  if (Array.isArray(incoming) && Array.isArray(parsed)) {
    return incoming.map((item, i) =>
      i < parsed.length ? restoreEnvVarRefs(item, parsed[i], env) : item,
    );
  }
  if (isPlainObject(incoming) && isPlainObject(parsed)) {
    const result = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (key in parsed) {
        result[key] = restoreEnvVarRefs(value, parsed[key], env);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return incoming;
}
