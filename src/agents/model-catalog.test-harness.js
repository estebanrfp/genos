import { afterEach, beforeEach, vi } from "vitest";
import { resetModelCatalogCacheForTest } from "./model-catalog.js";
vi.mock("./models-config.js", () => ({
  ensureGenosOSModelsJson: vi.fn().mockResolvedValue({ agentDir: "/tmp", wrote: false }),
}));
vi.mock("./agent-paths.js", () => ({
  resolveGenosOSAgentDir: () => "/tmp/genosos-test-catalog",
}));
export function installModelCatalogTestHooks() {
  beforeEach(() => {
    resetModelCatalogCacheForTest();
  });
  afterEach(() => {
    resetModelCatalogCacheForTest();
    vi.restoreAllMocks();
  });
}
