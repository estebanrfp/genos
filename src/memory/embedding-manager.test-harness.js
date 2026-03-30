import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";
import { getEmbedBatchMock, resetEmbeddingMocks } from "./embedding.test-mocks.js";
import { getMemorySearchManager } from "./index.js";
export function installEmbeddingManagerFixture(opts) {
  const embedBatch = getEmbedBatchMock();
  const resetIndexEachTest = opts.resetIndexEachTest ?? true;
  let fixtureRoot;
  let workspaceDir;
  let memoryDir;
  let managerLarge;
  let managerSmall;
  const resetManager = (manager) => {
    manager.resetIndex();
    manager.dirty = true;
  };
  const requireValue = (value, name) => {
    if (!value) {
      throw new Error(`${name} missing`);
    }
    return value;
  };
  const requireIndexManager = (manager, name) => {
    if (!manager) {
      throw new Error(`${name} missing`);
    }
    if (!("resetIndex" in manager) || typeof manager.resetIndex !== "function") {
      throw new Error(`${name} is not a MemoryIndexManager`);
    }
    return manager;
  };
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), opts.fixturePrefix));
    workspaceDir = path.join(fixtureRoot, "workspace");
    memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    const indexPathLarge = path.join(fixtureRoot, "index.large.sqlite");
    const indexPathSmall = path.join(fixtureRoot, "index.small.sqlite");
    const large = await getMemorySearchManager({
      cfg: opts.createCfg({
        workspaceDir,
        indexPath: indexPathLarge,
        tokens: opts.largeTokens,
      }),
      agentId: "main",
    });
    expect(large.manager).not.toBeNull();
    managerLarge = requireIndexManager(large.manager, "managerLarge");
    const small = await getMemorySearchManager({
      cfg: opts.createCfg({
        workspaceDir,
        indexPath: indexPathSmall,
        tokens: opts.smallTokens,
      }),
      agentId: "main",
    });
    expect(small.manager).not.toBeNull();
    managerSmall = requireIndexManager(small.manager, "managerSmall");
  });
  afterAll(async () => {
    if (managerLarge) {
      await managerLarge.close();
      managerLarge = undefined;
    }
    if (managerSmall) {
      await managerSmall.close();
      managerSmall = undefined;
    }
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = undefined;
    }
  });
  beforeEach(async () => {
    resetEmbeddingMocks();
    const dir = requireValue(memoryDir, "memoryDir");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    if (resetIndexEachTest) {
      resetManager(requireValue(managerLarge, "managerLarge"));
      resetManager(requireValue(managerSmall, "managerSmall"));
    }
  });
  return {
    embedBatch,
    getFixtureRoot: () => requireValue(fixtureRoot, "fixtureRoot"),
    getWorkspaceDir: () => requireValue(workspaceDir, "workspaceDir"),
    getMemoryDir: () => requireValue(memoryDir, "memoryDir"),
    getManagerLarge: () => requireValue(managerLarge, "managerLarge"),
    getManagerSmall: () => requireValue(managerSmall, "managerSmall"),
    resetManager,
  };
}
