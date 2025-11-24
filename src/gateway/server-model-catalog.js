import { loadModelCatalog, resetModelCatalogCacheForTest } from "../agents/model-catalog.js";
import { loadConfig } from "../config/config.js";
export function __resetModelCatalogCacheForTest() {
  resetModelCatalogCacheForTest();
}
export async function loadGatewayModelCatalog() {
  return await loadModelCatalog({ config: loadConfig() });
}
