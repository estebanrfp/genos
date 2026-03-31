import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSessionStore: vi.fn(() => ({})),
  saveSessionStore: vi.fn(async () => {}),
}));

vi.mock("./store.js", () => ({
  loadSessionStore: mocks.loadSessionStore,
  saveSessionStore: mocks.saveSessionStore,
}));

const { migrateSessionStore } = await import("./store-migrate.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migrateSessionStore", () => {
  it("rewrites session keys with the old agent prefix", async () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:amigo-nyx:main": { label: "Main", updatedAt: 1 },
      "agent:amigo-nyx:whatsapp:direct:+123": { label: "DM", updatedAt: 2 },
      "agent:other:main": { label: "Other", updatedAt: 3 },
    });

    const result = await migrateSessionStore("/store.json", "amigo-nyx", "lumina");

    expect(result.migratedKeys).toBe(2);
    const saved = mocks.saveSessionStore.mock.calls[0][1];
    expect(saved).toHaveProperty("agent:lumina:main");
    expect(saved).toHaveProperty("agent:lumina:whatsapp:direct:+123");
    expect(saved).toHaveProperty("agent:other:main");
    expect(saved).not.toHaveProperty("agent:amigo-nyx:main");
  });

  it("rewrites spawnedBy fields referencing old agent", async () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:amigo-nyx:subagent:task-1": {
        label: "Task",
        spawnedBy: "agent:amigo-nyx:main",
        updatedAt: 1,
      },
      "agent:amigo-nyx:main": { label: "Main", updatedAt: 2 },
    });

    const result = await migrateSessionStore("/store.json", "amigo-nyx", "lumina");

    expect(result.migratedSpawnedBy).toBe(1);
    const saved = mocks.saveSessionStore.mock.calls[0][1];
    expect(saved["agent:lumina:subagent:task-1"].spawnedBy).toBe("agent:lumina:main");
  });

  it("preserves keys from other agents", async () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:default:main": { label: "Main Agent", updatedAt: 1 },
      "agent:other-bot:main": { label: "Other Bot", updatedAt: 2 },
    });

    const result = await migrateSessionStore("/store.json", "amigo-nyx", "lumina");

    expect(result.migratedKeys).toBe(0);
    expect(result.migratedSpawnedBy).toBe(0);
    const saved = mocks.saveSessionStore.mock.calls[0][1];
    expect(saved).toHaveProperty("agent:default:main");
    expect(saved).toHaveProperty("agent:other-bot:main");
  });

  it("handles empty store", async () => {
    mocks.loadSessionStore.mockReturnValue({});

    const result = await migrateSessionStore("/store.json", "amigo-nyx", "lumina");

    expect(result.migratedKeys).toBe(0);
    expect(result.migratedSpawnedBy).toBe(0);
    const saved = mocks.saveSessionStore.mock.calls[0][1];
    expect(Object.keys(saved)).toHaveLength(0);
  });

  it("passes skipMaintenance: true to saveSessionStore", async () => {
    mocks.loadSessionStore.mockReturnValue({
      "agent:old:main": { label: "X", updatedAt: 1 },
    });

    await migrateSessionStore("/store.json", "old", "new");

    expect(mocks.saveSessionStore).toHaveBeenCalledWith("/store.json", expect.any(Object), {
      skipMaintenance: true,
    });
  });
});
