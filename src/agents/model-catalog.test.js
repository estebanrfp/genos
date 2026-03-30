import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadModelCatalog, resetModelCatalogCacheForTest } from "./model-catalog.js";

vi.mock("./models-config.js", () => ({
  ensureGenosOSModelsJson: vi
    .fn()
    .mockResolvedValue({ agentDir: "/tmp/genosos-test-catalog", wrote: false }),
}));
vi.mock("./agent-paths.js", () => ({
  resolveGenosOSAgentDir: () => "/tmp/genosos-test-catalog",
}));

const TEST_DIR = "/tmp/genosos-test-catalog";
const MODELS_PATH = path.join(TEST_DIR, "models.json");

const writeModelsJson = async (providers) => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(MODELS_PATH, JSON.stringify({ providers }));
};

describe("loadModelCatalog", () => {
  beforeEach(() => resetModelCatalogCacheForTest());
  afterEach(async () => {
    resetModelCatalogCacheForTest();
    vi.restoreAllMocks();
    try {
      await fs.rm(MODELS_PATH);
    } catch {}
  });

  it("loads models from static models.json", async () => {
    await writeModelsJson({
      openai: {
        models: [
          {
            id: "gpt-4.1",
            name: "GPT-4.1",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 1047576,
          },
        ],
      },
    });
    const result = await loadModelCatalog({ config: {}, useCache: false });
    expect(result).toEqual([
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 1047576,
      },
    ]);
  });

  it("returns empty array when models.json is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await loadModelCatalog({ config: {}, useCache: false });
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("sorts models by provider then name", async () => {
    await writeModelsJson({
      openai: {
        models: [
          { id: "o4-mini", name: "o4-mini" },
          { id: "gpt-4.1", name: "GPT-4.1" },
        ],
      },
      anthropic: { models: [{ id: "claude-opus-4-6", name: "Claude Opus 4.6" }] },
    });
    const result = await loadModelCatalog({ config: {}, useCache: false });
    expect(result.map((m) => m.provider)).toEqual(["anthropic", "openai", "openai"]);
    expect(result.filter((m) => m.provider === "openai").map((m) => m.name)).toEqual([
      "GPT-4.1",
      "o4-mini",
    ]);
  });
});
