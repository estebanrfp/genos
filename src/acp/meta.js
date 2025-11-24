export function readString(meta, keys) {
  if (!meta) {
    return;
  }
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return;
}
export function readBool(meta, keys) {
  if (!meta) {
    return;
  }
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return;
}
export function readNumber(meta, keys) {
  if (!meta) {
    return;
  }
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return;
}
