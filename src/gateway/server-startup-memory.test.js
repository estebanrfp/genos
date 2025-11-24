import { beforeEach, describe, expect, it, vi } from "vitest";
const { getMemorySearchManagerMock, resolveMemorySearchConfigMock } = vi.hoisted(() => ({
  getMemorySearchManagerMock: vi.fn(),
  resolveMemorySearchConfigMock: vi.fn(),
}));
vi.mock("../memory/index.js", () => ({
  getMemorySearchManager: getMemorySearchManagerMock,
}));
vi.mock("../agents/memory-search.js", () => ({
  resolveMemorySearchConfig: resolveMemorySearchConfigMock,
}));
import { startGatewayMemoryBackend } from "./server-startup-memory.js";
describe("startGatewayMemoryBackend", () => {
  beforeEach(() => {
    getMemorySearchManagerMock.mockReset();
    resolveMemorySearchConfigMock.mockReturnValue({ enabled: false });
  });
  it("skips initialization when memory backend is not qmd", async () => {
    const cfg = {
      agents: { list: [{ id: "main", default: true }] },
      memory: { backend: "builtin" },
    };
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    await startGatewayMemoryBackend({ cfg, log });
    expect(getMemorySearchManagerMock).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
  it("initializes qmd backend for each configured agent", async () => {
    const cfg = {
      agents: { list: [{ id: "ops", default: true }, { id: "main" }] },
      memory: { backend: "qmd", qmd: {} },
    };
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock.mockResolvedValue({ manager: { search: vi.fn() } });
    await startGatewayMemoryBackend({ cfg, log });
    expect(getMemorySearchManagerMock).toHaveBeenCalledTimes(2);
    expect(getMemorySearchManagerMock).toHaveBeenNthCalledWith(1, { cfg, agentId: "ops" });
    expect(getMemorySearchManagerMock).toHaveBeenNthCalledWith(2, { cfg, agentId: "main" });
    expect(log.info).toHaveBeenNthCalledWith(
      1,
      'qmd memory startup initialization armed for agent "ops"',
    );
    expect(log.info).toHaveBeenNthCalledWith(
      2,
      'qmd memory startup initialization armed for agent "main"',
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
  it("logs a warning when qmd manager init fails and continues with other agents", async () => {
    const cfg = {
      agents: { list: [{ id: "main", default: true }, { id: "ops" }] },
      memory: { backend: "qmd", qmd: {} },
    };
    const log = { info: vi.fn(), warn: vi.fn() };
    getMemorySearchManagerMock
      .mockResolvedValueOnce({ manager: null, error: "qmd missing" })
      .mockResolvedValueOnce({ manager: { search: vi.fn() } });
    await startGatewayMemoryBackend({ cfg, log });
    expect(log.warn).toHaveBeenCalledWith(
      'qmd memory startup initialization failed for agent "main": qmd missing',
    );
    expect(log.info).toHaveBeenCalledWith(
      'qmd memory startup initialization armed for agent "ops"',
    );
  });
});
