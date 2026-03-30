let isObjectWithStringId = function (value) {
    if (!isPlainObject(value)) {
      return false;
    }
    return typeof value.id === "string" && value.id.length > 0;
  },
  mergeObjectArraysById = function (base, patch, options) {
    if (!base.every(isObjectWithStringId)) {
      return;
    }
    const merged = [...base];
    const indexById = new Map();
    for (const [index, entry] of merged.entries()) {
      if (!isObjectWithStringId(entry)) {
        return;
      }
      indexById.set(entry.id, index);
    }
    for (const patchEntry of patch) {
      if (!isObjectWithStringId(patchEntry)) {
        merged.push(structuredClone(patchEntry));
        continue;
      }
      const existingIndex = indexById.get(patchEntry.id);
      if (existingIndex === undefined) {
        merged.push(structuredClone(patchEntry));
        indexById.set(patchEntry.id, merged.length - 1);
        continue;
      }
      merged[existingIndex] = applyMergePatch(merged[existingIndex], patchEntry, options);
    }
    return merged;
  };
import { isPlainObject } from "../utils.js";
export function applyMergePatch(base, patch, options = {}) {
  if (!isPlainObject(patch)) {
    return patch;
  }
  const result = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    if (options.mergeObjectArraysById && Array.isArray(result[key]) && Array.isArray(value)) {
      const mergedArray = mergeObjectArraysById(result[key], value, options);
      if (mergedArray) {
        result[key] = mergedArray;
        continue;
      }
    }
    if (isPlainObject(value)) {
      const baseValue = result[key];
      result[key] = applyMergePatch(isPlainObject(baseValue) ? baseValue : {}, value, options);
      continue;
    }
    result[key] = value;
  }
  return result;
}
