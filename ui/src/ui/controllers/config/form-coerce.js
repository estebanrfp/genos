let coerceNumberString = function (value, integer) {
    const trimmed = value.trim();
    if (trimmed === "") {
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return value;
    }
    if (integer && !Number.isInteger(parsed)) {
      return value;
    }
    return parsed;
  },
  coerceBooleanString = function (value) {
    const trimmed = value.trim();
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    return value;
  };
import { schemaType } from "../../views/config-form.shared.js";
export function coerceFormValues(value, schema) {
  if (value === null || value === undefined) {
    return value;
  }
  if (schema.allOf && schema.allOf.length > 0) {
    let next = value;
    for (const segment of schema.allOf) {
      next = coerceFormValues(next, segment);
    }
    return next;
  }
  const type = schemaType(schema);
  if (schema.anyOf || schema.oneOf) {
    const variants = (schema.anyOf ?? schema.oneOf ?? []).filter(
      (v) => !(v.type === "null" || (Array.isArray(v.type) && v.type.includes("null"))),
    );
    if (variants.length === 1) {
      return coerceFormValues(value, variants[0]);
    }
    if (typeof value === "string") {
      for (const variant of variants) {
        const variantType = schemaType(variant);
        if (variantType === "number" || variantType === "integer") {
          const coerced = coerceNumberString(value, variantType === "integer");
          if (coerced === undefined || typeof coerced === "number") {
            return coerced;
          }
        }
        if (variantType === "boolean") {
          const coerced = coerceBooleanString(value);
          if (typeof coerced === "boolean") {
            return coerced;
          }
        }
      }
    }
    for (const variant of variants) {
      const variantType = schemaType(variant);
      if (variantType === "object" && typeof value === "object" && !Array.isArray(value)) {
        return coerceFormValues(value, variant);
      }
      if (variantType === "array" && Array.isArray(value)) {
        return coerceFormValues(value, variant);
      }
    }
    return value;
  }
  if (type === "number" || type === "integer") {
    if (typeof value === "string") {
      const coerced = coerceNumberString(value, type === "integer");
      if (coerced === undefined || typeof coerced === "number") {
        return coerced;
      }
    }
    return value;
  }
  if (type === "boolean") {
    if (typeof value === "string") {
      const coerced = coerceBooleanString(value);
      if (typeof coerced === "boolean") {
        return coerced;
      }
    }
    return value;
  }
  if (type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const obj = value;
    const props = schema.properties ?? {};
    const additional =
      schema.additionalProperties && typeof schema.additionalProperties === "object"
        ? schema.additionalProperties
        : null;
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const propSchema = props[key] ?? additional;
      const coerced = propSchema ? coerceFormValues(val, propSchema) : val;
      if (coerced !== undefined) {
        result[key] = coerced;
      }
    }
    return result;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(schema.items)) {
      const tuple = schema.items;
      return value.map((item, i) => {
        const s = i < tuple.length ? tuple[i] : undefined;
        return s ? coerceFormValues(item, s) : item;
      });
    }
    const itemsSchema = schema.items;
    if (!itemsSchema) {
      return value;
    }
    return value.map((item) => coerceFormValues(item, itemsSchema)).filter((v) => v !== undefined);
  }
  return value;
}
