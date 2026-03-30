let truncateModelId = function (modelId, maxLen) {
  if (modelId.length <= maxLen) {
    return modelId;
  }
  return `\u2026${modelId.slice(-(maxLen - 1))}`;
};
const MODELS_PAGE_SIZE = 8;
const MAX_CALLBACK_DATA_BYTES = 64;
export function parseModelCallbackData(data) {
  const trimmed = data.trim();
  if (!trimmed.startsWith("mdl_")) {
    return null;
  }
  if (trimmed === "mdl_prov" || trimmed === "mdl_back") {
    return { type: trimmed === "mdl_prov" ? "providers" : "back" };
  }
  const listMatch = trimmed.match(/^mdl_list_([a-z0-9_-]+)_(\d+)$/i);
  if (listMatch) {
    const [, provider, pageStr] = listMatch;
    const page = Number.parseInt(pageStr ?? "1", 10);
    if (provider && Number.isFinite(page) && page >= 1) {
      return { type: "list", provider, page };
    }
  }
  const selMatch = trimmed.match(/^mdl_sel_(.+)$/);
  if (selMatch) {
    const modelRef = selMatch[1];
    if (modelRef) {
      const slashIndex = modelRef.indexOf("/");
      if (slashIndex > 0 && slashIndex < modelRef.length - 1) {
        return {
          type: "select",
          provider: modelRef.slice(0, slashIndex),
          model: modelRef.slice(slashIndex + 1),
        };
      }
    }
  }
  return null;
}
export function buildProviderKeyboard(providers) {
  if (providers.length === 0) {
    return [];
  }
  const rows = [];
  let currentRow = [];
  for (const provider of providers) {
    const button = {
      text: `${provider.id} (${provider.count})`,
      callback_data: `mdl_list_${provider.id}_1`,
    };
    currentRow.push(button);
    if (currentRow.length === 2) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }
  return rows;
}
export function buildModelsKeyboard(params) {
  const { provider, models, currentModel, currentPage, totalPages } = params;
  const pageSize = params.pageSize ?? MODELS_PAGE_SIZE;
  if (models.length === 0) {
    return [[{ text: "<< Back", callback_data: "mdl_back" }]];
  }
  const rows = [];
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, models.length);
  const pageModels = models.slice(startIndex, endIndex);
  const currentModelId = currentModel?.includes("/")
    ? currentModel.split("/").slice(1).join("/")
    : currentModel;
  for (const model of pageModels) {
    const callbackData = `mdl_sel_${provider}/${model}`;
    if (Buffer.byteLength(callbackData, "utf8") > MAX_CALLBACK_DATA_BYTES) {
      continue;
    }
    const isCurrentModel = model === currentModelId;
    const displayText = truncateModelId(model, 38);
    const text = isCurrentModel ? `${displayText} \u2713` : displayText;
    rows.push([
      {
        text,
        callback_data: callbackData,
      },
    ]);
  }
  if (totalPages > 1) {
    const paginationRow = [];
    if (currentPage > 1) {
      paginationRow.push({
        text: "\u25C0 Prev",
        callback_data: `mdl_list_${provider}_${currentPage - 1}`,
      });
    }
    paginationRow.push({
      text: `${currentPage}/${totalPages}`,
      callback_data: `mdl_list_${provider}_${currentPage}`,
    });
    if (currentPage < totalPages) {
      paginationRow.push({
        text: "Next \u25B6",
        callback_data: `mdl_list_${provider}_${currentPage + 1}`,
      });
    }
    rows.push(paginationRow);
  }
  rows.push([{ text: "<< Back", callback_data: "mdl_back" }]);
  return rows;
}
export function buildBrowseProvidersButton() {
  return [[{ text: "Browse providers", callback_data: "mdl_prov" }]];
}
export function getModelsPageSize() {
  return MODELS_PAGE_SIZE;
}
export function calculateTotalPages(totalModels, pageSize) {
  const size = pageSize ?? MODELS_PAGE_SIZE;
  return size > 0 ? Math.ceil(totalModels / size) : 1;
}
