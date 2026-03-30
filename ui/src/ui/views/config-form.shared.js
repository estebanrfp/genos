export function schemaType(schema) {
  if (!schema) {
    return;
  }
  if (Array.isArray(schema.type)) {
    const filtered = schema.type.filter((t) => t !== "null");
    return filtered[0] ?? schema.type[0];
  }
  return schema.type;
}
export function defaultValue(schema) {
  if (!schema) {
    return "";
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  const type = schemaType(schema);
  switch (type) {
    case "object":
      return {};
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    case "string":
      return "";
    default:
      return "";
  }
}
export function pathKey(path) {
  return path.filter((segment) => typeof segment === "string").join(".");
}
export function hintForPath(path, hints) {
  const key = pathKey(path);
  const direct = hints[key];
  if (direct) {
    return direct;
  }
  const segments = key.split(".");
  for (const [hintKey, hint] of Object.entries(hints)) {
    if (!hintKey.includes("*")) {
      continue;
    }
    const hintSegments = hintKey.split(".");
    if (hintSegments.length !== segments.length) {
      continue;
    }
    let match = true;
    for (let i = 0; i < segments.length; i += 1) {
      if (hintSegments[i] !== "*" && hintSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      return hint;
    }
  }
  return;
}
export function humanize(raw) {
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (m) => m.toUpperCase());
}
