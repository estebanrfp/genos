let extractEnumValues = function (schema) {
    if (!schema || typeof schema !== "object") {
      return;
    }
    const record = schema;
    if (Array.isArray(record.enum)) {
      return record.enum;
    }
    if ("const" in record) {
      return [record.const];
    }
    const variants = Array.isArray(record.anyOf)
      ? record.anyOf
      : Array.isArray(record.oneOf)
        ? record.oneOf
        : null;
    if (variants) {
      const values = variants.flatMap((variant) => {
        const extracted = extractEnumValues(variant);
        return extracted ?? [];
      });
      return values.length > 0 ? values : undefined;
    }
    return;
  },
  mergePropertySchemas = function (existing, incoming) {
    if (!existing) {
      return incoming;
    }
    if (!incoming) {
      return existing;
    }
    const existingEnum = extractEnumValues(existing);
    const incomingEnum = extractEnumValues(incoming);
    if (existingEnum || incomingEnum) {
      const values = Array.from(new Set([...(existingEnum ?? []), ...(incomingEnum ?? [])]));
      const merged = {};
      for (const source of [existing, incoming]) {
        if (!source || typeof source !== "object") {
          continue;
        }
        const record = source;
        for (const key of ["title", "description", "default"]) {
          if (!(key in merged) && key in record) {
            merged[key] = record[key];
          }
        }
      }
      const types = new Set(values.map((value) => typeof value));
      if (types.size === 1) {
        merged.type = Array.from(types)[0];
      }
      merged.enum = values;
      return merged;
    }
    return existing;
  };
import { cleanSchemaForGemini } from "./schema/clean-for-gemini.js";
export function normalizeToolParameters(tool, options) {
  const schema =
    tool.parameters && typeof tool.parameters === "object" ? tool.parameters : undefined;
  if (!schema) {
    return tool;
  }
  const isGeminiProvider =
    options?.modelProvider?.toLowerCase().includes("google") ||
    options?.modelProvider?.toLowerCase().includes("gemini");
  const isAnthropicProvider =
    options?.modelProvider?.toLowerCase().includes("anthropic") ||
    options?.modelProvider?.toLowerCase().includes("google-antigravity");
  if ("type" in schema && "properties" in schema && !Array.isArray(schema.anyOf)) {
    return {
      ...tool,
      parameters: isGeminiProvider && !isAnthropicProvider ? cleanSchemaForGemini(schema) : schema,
    };
  }
  if (
    !("type" in schema) &&
    (typeof schema.properties === "object" || Array.isArray(schema.required)) &&
    !Array.isArray(schema.anyOf) &&
    !Array.isArray(schema.oneOf)
  ) {
    const schemaWithType = { ...schema, type: "object" };
    return {
      ...tool,
      parameters:
        isGeminiProvider && !isAnthropicProvider
          ? cleanSchemaForGemini(schemaWithType)
          : schemaWithType,
    };
  }
  const variantKey = Array.isArray(schema.anyOf)
    ? "anyOf"
    : Array.isArray(schema.oneOf)
      ? "oneOf"
      : null;
  if (!variantKey) {
    return tool;
  }
  const variants = schema[variantKey];
  const mergedProperties = {};
  const requiredCounts = new Map();
  let objectVariants = 0;
  for (const entry of variants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const props = entry.properties;
    if (!props || typeof props !== "object") {
      continue;
    }
    objectVariants += 1;
    for (const [key, value] of Object.entries(props)) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = value;
        continue;
      }
      mergedProperties[key] = mergePropertySchemas(mergedProperties[key], value);
    }
    const required = Array.isArray(entry.required) ? entry.required : [];
    for (const key of required) {
      if (typeof key !== "string") {
        continue;
      }
      requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
    }
  }
  const baseRequired = Array.isArray(schema.required)
    ? schema.required.filter((key) => typeof key === "string")
    : undefined;
  const mergedRequired =
    baseRequired && baseRequired.length > 0
      ? baseRequired
      : objectVariants > 0
        ? Array.from(requiredCounts.entries())
            .filter(([, count]) => count === objectVariants)
            .map(([key]) => key)
        : undefined;
  const nextSchema = { ...schema };
  const flattenedSchema = {
    type: "object",
    ...(typeof nextSchema.title === "string" ? { title: nextSchema.title } : {}),
    ...(typeof nextSchema.description === "string" ? { description: nextSchema.description } : {}),
    properties:
      Object.keys(mergedProperties).length > 0 ? mergedProperties : (schema.properties ?? {}),
    ...(mergedRequired && mergedRequired.length > 0 ? { required: mergedRequired } : {}),
    additionalProperties: "additionalProperties" in schema ? schema.additionalProperties : true,
  };
  return {
    ...tool,
    parameters:
      isGeminiProvider && !isAnthropicProvider
        ? cleanSchemaForGemini(flattenedSchema)
        : flattenedSchema,
  };
}
export function cleanToolSchemaForGemini(schema) {
  return cleanSchemaForGemini(schema);
}
