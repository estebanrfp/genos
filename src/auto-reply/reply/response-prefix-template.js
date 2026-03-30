const TEMPLATE_VAR_PATTERN = /\{([a-zA-Z][a-zA-Z0-9.]*)\}/g;
export function resolveResponsePrefixTemplate(template, context) {
  if (!template) {
    return;
  }
  return template.replace(TEMPLATE_VAR_PATTERN, (match, varName) => {
    const normalizedVar = varName.toLowerCase();
    switch (normalizedVar) {
      case "model":
        return context.model ?? match;
      case "modelfull":
        return context.modelFull ?? match;
      case "provider":
        return context.provider ?? match;
      case "thinkinglevel":
      case "think":
        return context.thinkingLevel ?? match;
      case "identity.name":
      case "identityname":
        return context.identityName ?? match;
      default:
        return match;
    }
  });
}
export function extractShortModelName(fullModel) {
  const slash = fullModel.lastIndexOf("/");
  const modelPart = slash >= 0 ? fullModel.slice(slash + 1) : fullModel;
  return modelPart.replace(/-\d{8}$/, "").replace(/-latest$/, "");
}
export function hasTemplateVariables(template) {
  if (!template) {
    return false;
  }
  TEMPLATE_VAR_PATTERN.lastIndex = 0;
  return TEMPLATE_VAR_PATTERN.test(template);
}
