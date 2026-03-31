import { describe, expect, it, vi } from "vitest";

// Mock dependencies before import
vi.mock("../config/sessions.js", () => ({
  loadSessionStore: vi.fn(() => ({})),
  updateSessionStore: vi.fn(),
}));

vi.mock("./session-utils.js", () => ({
  listSessionsFromStore: vi.fn(() => ({ sessions: [] })),
  loadCombinedSessionStoreForGateway: vi.fn(() => ({
    storePath: "/tmp/test-store",
    store: {},
  })),
  pruneLegacyStoreKeys: vi.fn(),
  resolveGatewaySessionStoreTarget: vi.fn(),
}));

const { resolveSessionKeyFromResolveParams } = await import("./sessions-resolve.js");
const { listSessionsFromStore } = await import("./session-utils.js");

describe("resolveSessionKeyFromResolveParams — label + agentId fallback", () => {
  const cfg = {};

  it("derives canonical key when label + agentId but no store entry", async () => {
    listSessionsFromStore.mockReturnValue({ sessions: [] });

    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "main", agentId: "seo-specialist" },
    });

    expect(result).toEqual({ ok: true, key: "agent:seo-specialist:main" });
  });

  it("normalizes agentId in derived key", async () => {
    listSessionsFromStore.mockReturnValue({ sessions: [] });

    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "main", agentId: "SEO-Specialist" },
    });

    expect(result).toEqual({ ok: true, key: "agent:seo-specialist:main" });
  });

  it("lowercases label in derived key", async () => {
    listSessionsFromStore.mockReturnValue({ sessions: [] });

    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "Research", agentId: "lumina" },
    });

    expect(result).toEqual({ ok: true, key: "agent:lumina:research" });
  });

  it("returns store match when label exists in store", async () => {
    listSessionsFromStore.mockReturnValue({
      sessions: [{ key: "agent:seo-specialist:main", label: "main" }],
    });

    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "main", agentId: "seo-specialist" },
    });

    expect(result).toEqual({ ok: true, key: "agent:seo-specialist:main" });
  });

  it("errors when label-only (no agentId) and no store entry", async () => {
    listSessionsFromStore.mockReturnValue({ sessions: [] });

    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "main" },
    });

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/No session found with label/);
  });

  it("rejects multiple selectors", async () => {
    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: { label: "main", key: "agent:default:main" },
    });

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/not multiple/);
  });

  it("rejects no selectors", async () => {
    const result = await resolveSessionKeyFromResolveParams({
      cfg,
      p: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/required/);
  });
});
