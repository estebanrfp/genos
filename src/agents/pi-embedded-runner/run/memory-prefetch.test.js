import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../../memory/index.js", () => ({
  getMemorySearchManager: vi.fn(),
}));

vi.mock("../../agent-scope.js", () => ({
  resolveSessionAgentId: vi.fn(() => "main"),
}));

vi.mock("../../memory-search.js", () => ({
  resolveMemorySearchConfig: vi.fn(() => ({ enabled: true })),
}));

const { getMemorySearchManager } = await import("../../../memory/index.js");
const { resolveMemorySearchConfig } = await import("../../memory-search.js");
const { prefetchMemoryContext } = await import("./memory-prefetch.js");

describe("prefetchMemoryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemorySearchConfig.mockReturnValue({ enabled: true });
  });

  const baseConfig = {
    agents: {
      defaults: {
        memorySearch: { enabled: true },
      },
    },
  };

  // --- Guard conditions ---

  it("returns null when config is missing", async () => {
    const result = await prefetchMemoryContext({ prompt: "hello", config: null });
    expect(result).toEqual({ context: null, chunks: 0, searchMs: 0 });
  });

  it("returns null when memorySearch is disabled", async () => {
    const config = { agents: { defaults: { memorySearch: { enabled: false } } } };
    const result = await prefetchMemoryContext({ prompt: "hello", config });
    expect(result).toEqual({ context: null, chunks: 0, searchMs: 0 });
  });

  it("returns null when prefetch is explicitly disabled", async () => {
    const config = {
      agents: {
        defaults: {
          memorySearch: { enabled: true, prefetch: { enabled: false } },
        },
      },
    };
    const result = await prefetchMemoryContext({ prompt: "hello", config });
    expect(result).toEqual({ context: null, chunks: 0, searchMs: 0 });
  });

  it("returns null when memory search config is not resolved", async () => {
    resolveMemorySearchConfig.mockReturnValueOnce(null);
    const result = await prefetchMemoryContext({ prompt: "hello", config: baseConfig });
    expect(result).toEqual({ context: null, chunks: 0, searchMs: 0 });
  });

  it("returns null when manager is unavailable", async () => {
    getMemorySearchManager.mockResolvedValueOnce({ manager: null, error: "no db" });
    const result = await prefetchMemoryContext({ prompt: "hola", config: baseConfig });
    expect(result.context).toBeNull();
    expect(result.chunks).toBe(0);
  });

  it("returns null when search returns no chunks", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });
    const result = await prefetchMemoryContext({ prompt: "hola", config: baseConfig });
    expect(result.context).toBeNull();
    expect(result.chunks).toBe(0);
  });

  // --- Always-on: runs for any non-empty query ---

  it("runs prefetch for short conversational queries", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });
    await prefetchMemoryContext({ prompt: "hola", config: baseConfig });
    expect(mockManager.search).toHaveBeenCalled();
  });

  it("runs prefetch for long queries", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });
    await prefetchMemoryContext({
      prompt: "what is the capital city of France located in Europe",
      config: baseConfig,
    });
    expect(mockManager.search).toHaveBeenCalled();
  });

  // --- Internal system prompt skips ---

  it("skips prefetch for pre-compaction memory flush prompts", async () => {
    const result = await prefetchMemoryContext({
      prompt: "Pre-compaction memory flush. Store durable memories now (use memory/2026-02-22.md).",
      config: baseConfig,
    });
    expect(result).toEqual({ context: null, chunks: 0, searchMs: 0 });
    expect(getMemorySearchManager).not.toHaveBeenCalled();
  });

  it("returns null when prompt is only system lines", async () => {
    const prompt = `System: [2026-02-20 16:29:37 GMT+1] WhatsApp connected.\n\n`;
    const result = await prefetchMemoryContext({ prompt, config: baseConfig });
    expect(result.context).toBeNull();
    expect(result.chunks).toBe(0);
  });

  // --- Dynamic gate ---

  it("blocks injection when top chunk score is below gate", async () => {
    const mockManager = {
      search: vi.fn().mockResolvedValue([
        { snippet: "some memory", score: 0.15 },
        { snippet: "another memory", score: 0.12 },
      ]),
    };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });
    const result = await prefetchMemoryContext({ prompt: "hola", config: baseConfig });
    expect(result.context).toBeNull();
    expect(result.chunks).toBe(0);
  });

  it("injects when top chunk score meets the gate threshold", async () => {
    const mockManager = {
      search: vi.fn().mockResolvedValue([
        { snippet: "relevant memory", score: 0.21 },
        { snippet: "less relevant", score: 0.15 },
      ]),
    };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });
    const result = await prefetchMemoryContext({ prompt: "tell me something", config: baseConfig });
    expect(result.context).not.toBeNull();
    expect(result.chunks).toBe(2);
  });

  // --- No minScore passed to search (language-agnostic) ---

  it("does not pass minScore to the search manager", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    await prefetchMemoryContext({ prompt: "quien es Virginia Esther Pozzi?", config: baseConfig });

    expect(mockManager.search).toHaveBeenCalledWith(
      "quien es Virginia Esther Pozzi?",
      expect.not.objectContaining({ minScore: expect.anything() }),
    );
  });

  // --- Chunk formatting ---

  it("returns formatted context when chunks are found", async () => {
    const mockChunks = [
      { snippet: "Memory about cats", path: "notes.md", startLine: 1, endLine: 5, score: 0.85 },
      { snippet: "Memory about dogs", score: 0.72 },
    ];
    const mockManager = { search: vi.fn().mockResolvedValue(mockChunks) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    const result = await prefetchMemoryContext({
      prompt: "tell me about pets",
      config: baseConfig,
    });

    expect(result.chunks).toBe(2);
    expect(result.context).toContain("Memory Prefetch");
    expect(result.context).toContain("2 relevant memories");
    expect(result.context).toContain("notes.md:1-5");
    expect(result.context).toContain("Memory about cats");
    expect(result.context).toContain("0.85");
    expect(result.context).toContain("Memory about dogs");
    expect(result.context).toContain("0.72");
    expect(result.searchMs).toBeGreaterThanOrEqual(0);
  });

  it("uses custom prefetch config values", async () => {
    const config = {
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
            prefetch: { maxChunks: 3, minScore: 0.6 },
          },
        },
      },
    };
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    await prefetchMemoryContext({ prompt: "test", config });

    expect(mockManager.search).toHaveBeenCalledWith("test", {
      maxResults: 3,
      sessionKey: "agent:default:direct:prefetch",
    });
  });

  it("handles search errors gracefully", async () => {
    const mockManager = { search: vi.fn().mockRejectedValue(new Error("search boom")) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    const result = await prefetchMemoryContext({ prompt: "hola", config: baseConfig });

    expect(result.context).toBeNull();
    expect(result.chunks).toBe(0);
  });

  it("handles manager creation errors gracefully", async () => {
    getMemorySearchManager.mockRejectedValueOnce(new Error("init boom"));

    const result = await prefetchMemoryContext({ prompt: "hola", config: baseConfig });

    expect(result.context).toBeNull();
  });

  it("passes sessionKey when provided", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    await prefetchMemoryContext({
      prompt: "test session routing",
      config: baseConfig,
      sessionKey: "agent:default:telegram:dm:123",
    });

    expect(mockManager.search).toHaveBeenCalledWith("test session routing", {
      maxResults: 5,
      sessionKey: "agent:default:telegram:dm:123",
    });
  });

  it("strips System: lines and searches with user query only", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    const prompt = `System: [2026-02-20 16:29:37 GMT+1] WhatsApp gateway connected.\nSystem: [2026-02-20 16:29:37 GMT+1] Model switched.\n\n¿Cuántos tests tiene el vault?`;

    await prefetchMemoryContext({ prompt, config: baseConfig });

    expect(mockManager.search).toHaveBeenCalledWith(
      "¿Cuántos tests tiene el vault?",
      expect.any(Object),
    );
  });

  it("strips Conversation info blocks and timestamp prefixes", async () => {
    const mockManager = { search: vi.fn().mockResolvedValue([]) };
    getMemorySearchManager.mockResolvedValueOnce({ manager: mockManager });

    const prompt = `Conversation info (untrusted metadata): \`\`\`json\n{"message_id":"abc","sender":"user"}\n\`\`\`\n[Fri 2026-02-20 16:38 GMT+1] ¿Cuántos tests tiene el vault?`;

    await prefetchMemoryContext({ prompt, config: baseConfig });

    expect(mockManager.search).toHaveBeenCalledWith(
      "¿Cuántos tests tiene el vault?",
      expect.any(Object),
    );
  });
});
