let makeCall = function (method, params) {
    const respond = vi.fn();
    const handler = agentsHandlers[method];
    const promise = handler({
      params,
      respond,
      context: {},
      req: { type: "req", id: "1", method },
      client: null,
      isWebchatConnect: () => false,
    });
    return { respond, promise };
  },
  createEnoentError = function () {
    const err = new Error("ENOENT");
    err.code = "ENOENT";
    return err;
  },
  createErrnoError = function (code) {
    const err = new Error(code);
    err.code = code;
    return err;
  },
  mockWorkspaceStateRead = function (params) {
    mocks.fsReadFile.mockImplementation(async (...args) => {
      const filePath = args[0];
      if (String(filePath).endsWith("workspace-state.json")) {
        if (params.errorCode) {
          throw createErrnoError(params.errorCode);
        }
        if (typeof params.rawContent === "string") {
          return params.rawContent;
        }
        return JSON.stringify({
          onboardingCompletedAt: params.onboardingCompletedAt ?? "2026-02-15T14:00:00.000Z",
        });
      }
      throw createEnoentError();
    });
  };
import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  loadConfigReturn: {},
  listAgentEntries: vi.fn(() => []),
  findAgentEntryIndex: vi.fn(() => -1),
  applyAgentConfig: vi.fn((_cfg, _opts) => ({})),
  pruneAgentConfig: vi.fn(() => ({ config: {}, removedBindings: 0, removedSubagentRefs: 0 })),
  renameAgentConfig: vi.fn((cfg) => cfg),
  migrateSessionStore: vi.fn(async () => ({ migratedKeys: 3, migratedSpawnedBy: 1 })),
  wireAgentCommunication: vi.fn((cfg, agentId) => {
    const agents = cfg.agents ?? {};
    const list = Array.isArray(agents.list) ? agents.list : [];
    const updatedList = list.map((entry) => {
      const allow = entry.subagents?.allowAgents ?? [];
      if (allow.includes(agentId)) {
        return entry;
      }
      return { ...entry, subagents: { ...entry.subagents, allowAgents: [...allow, agentId] } };
    });
    return {
      ...cfg,
      tools: { ...cfg.tools, agentToAgent: { enabled: true, allow: [agentId] } },
      agents: { ...agents, list: updatedList.length ? updatedList : agents.list },
    };
  }),
  writeConfigFile: vi.fn(async () => {}),
  ensureAgentWorkspace: vi.fn(async () => {}),
  resolveAgentDir: vi.fn(() => "/agents/test-agent"),
  resolveAgentWorkspaceDir: vi.fn(() => "/workspace/test-agent"),
  listAgentsForGateway: vi.fn(() => ({
    defaultId: "main",
    mainKey: "agent:default:main",
    scope: "global",
    agents: [],
  })),
  movePathToTrash: vi.fn(async () => "/trashed"),
  fsAccess: vi.fn(async () => {}),
  fsMkdir: vi.fn(async () => {
    return;
  }),
  fsAppendFile: vi.fn(async () => {}),
  fsReadFile: vi.fn(async () => ""),
  fsStat: vi.fn(async () => null),
  updateSessionStore: vi.fn(async () => {}),
}));
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual("node:crypto");
  return { ...actual, randomUUID: () => "test-uuid-0000" };
});
vi.mock("../../config/sessions/store.js", () => ({
  updateSessionStore: mocks.updateSessionStore,
}));
vi.mock("../../agents/agent-dir-id.js", () => ({
  generateAgentDirId: () => "a1b2c3d4",
}));
vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
  writeConfigFile: mocks.writeConfigFile,
  resolveStateDir: () => "/state",
}));
vi.mock("../../commands/agents.config.js", () => ({
  applyAgentConfig: mocks.applyAgentConfig,
  findAgentEntryIndex: mocks.findAgentEntryIndex,
  listAgentEntries: mocks.listAgentEntries,
  pruneAgentConfig: mocks.pruneAgentConfig,
  renameAgentConfig: mocks.renameAgentConfig,
  wireAgentCommunication: mocks.wireAgentCommunication,
}));
vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
  resolveAgentDir: mocks.resolveAgentDir,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
}));
vi.mock("../../agents/workspace.js", async () => {
  const actual = await vi.importActual("../../agents/workspace.js");
  return {
    ...actual,
    ensureAgentWorkspace: mocks.ensureAgentWorkspace,
  };
});
vi.mock("../../config/sessions/store-migrate.js", () => ({
  migrateSessionStore: mocks.migrateSessionStore,
}));
vi.mock("../../browser/trash.js", () => ({
  movePathToTrash: mocks.movePathToTrash,
}));
vi.mock("../../utils.js", () => ({
  resolveUserPath: (p) => `/resolved${p.startsWith("/") ? "" : "/"}${p}`,
}));
vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: mocks.listAgentsForGateway,
}));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  const patched = {
    ...actual,
    access: mocks.fsAccess,
    mkdir: mocks.fsMkdir,
    appendFile: mocks.fsAppendFile,
    readFile: mocks.fsReadFile,
    stat: mocks.fsStat,
  };
  return { ...patched, default: patched };
});
vi.mock("../../agents/auto-config.js", () => ({
  inferToolProfile: (name) => {
    const lower = name.toLowerCase();
    if (
      [
        "code",
        "dev",
        "test",
        "lint",
        "debug",
        "review",
        "deploy",
        "script",
        "refactor",
        "build",
        "engineer",
        "devops",
        "infra",
      ].some((kw) => lower.includes(kw))
    ) {
      return "coding";
    }
    if (
      [
        "message",
        "chat",
        "support",
        "helpdesk",
        "notify",
        "broadcast",
        "social",
        "community",
        "bot",
      ].some((kw) => lower.includes(kw))
    ) {
      return "messaging";
    }
    if (
      [
        "monitor",
        "watcher",
        "sensor",
        "probe",
        "health",
        "ping",
        "status",
        "heartbeat",
        "checker",
      ].some((kw) => lower.includes(kw))
    ) {
      return "minimal";
    }
    return "full";
  },
  applyToolProfile: (cfg, agentId, profile) => {
    const config = structuredClone(cfg);
    const agents = config.agents?.list ?? [];
    const entry = agents.find((a) => a.id === agentId);
    if (!entry) {
      return { config, applied: [] };
    }
    entry.tools ??= {};
    entry.tools.profile = profile;
    return { config, applied: [`tools.profile=${profile}`] };
  },
}));
const { agentsHandlers } = await import("./agents.js");
async function listAgentFileNames(agentId = "main") {
  const { respond, promise } = makeCall("agents.files.list", { agentId });
  await promise;
  const [, result] = respond.mock.calls[0] ?? [];
  const files = result.files;
  return files.map((file) => file.name);
}
beforeEach(() => {
  mocks.fsReadFile.mockImplementation(async () => {
    throw createEnoentError();
  });
  mocks.fsStat.mockImplementation(async () => {
    throw createEnoentError();
  });
});
describe("agents.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
  });
  it("creates a new agent successfully", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "Test Agent",
      workspace: "/home/user/agents/test",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        agentId: "test-agent",
        name: "Test Agent",
      }),
      undefined,
    );
    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    expect(mocks.updateSessionStore).toHaveBeenCalledWith(
      "/state/agents/a1b2c3d4/sessions/sessions.json",
      expect.any(Function),
    );
  });
  it("ensures workspace is set up before writing config", async () => {
    const callOrder = [];
    mocks.ensureAgentWorkspace.mockImplementation(async () => {
      callOrder.push("ensureAgentWorkspace");
    });
    mocks.writeConfigFile.mockImplementation(async () => {
      callOrder.push("writeConfigFile");
    });
    const { promise } = makeCall("agents.create", {
      name: "Order Test",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(callOrder.indexOf("ensureAgentWorkspace")).toBeLessThan(
      callOrder.indexOf("writeConfigFile"),
    );
  });
  it("rejects creating an agent with reserved 'main' id", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "main",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("reserved") }),
    );
  });
  it("rejects creating a duplicate agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(0);
    const { respond, promise } = makeCall("agents.create", {
      name: "Existing",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already exists") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });
  it("rejects invalid params (missing name)", async () => {
    const { respond, promise } = makeCall("agents.create", {
      workspace: "/tmp/ws",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });
  it("always writes Name to IDENTITY.md even without emoji/avatar", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Plain Agent",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringContaining("- Name: Plain Agent"),
      "utf-8",
    );
  });
  it("infers coding tool profile for code-helper agent", async () => {
    mocks.applyAgentConfig.mockImplementation((_cfg, opts) => ({
      agents: { list: [{ id: opts.agentId ?? "code-helper", ...opts }] },
    }));
    const { respond, promise } = makeCall("agents.create", {
      name: "Code Helper",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        toolProfile: "coding",
        autoConfig: expect.arrayContaining(["tools.profile=coding"]),
      }),
      undefined,
    );
  });
  it("does not include toolProfile in response when profile is full", async () => {
    mocks.applyAgentConfig.mockImplementation((_cfg, opts) => ({
      agents: { list: [{ id: opts.agentId ?? "general", ...opts }] },
    }));
    const { respond, promise } = makeCall("agents.create", {
      name: "General Assistant",
      workspace: "/tmp/ws",
    });
    await promise;
    const resultArg = respond.mock.calls[0]?.[1];
    expect(resultArg.toolProfile).toBeUndefined();
  });
  it("uses explicit toolProfile when provided", async () => {
    mocks.applyAgentConfig.mockImplementation((_cfg, opts) => ({
      agents: { list: [{ id: opts.agentId ?? "my-agent", ...opts }] },
    }));
    const { respond, promise } = makeCall("agents.create", {
      name: "My Agent",
      workspace: "/tmp/ws",
      toolProfile: "minimal",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        toolProfile: "minimal",
        autoConfig: expect.arrayContaining(["tools.profile=minimal"]),
      }),
      undefined,
    );
  });
  it("wires subagents.allowAgents for the new agent", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "SEO Specialist",
      workspace: "/tmp/ws",
    });
    await promise;
    expect(mocks.wireAgentCommunication).toHaveBeenCalledWith(expect.any(Object), "seo-specialist");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, agentId: "seo-specialist" }),
      undefined,
    );
  });
  it("writes emoji and avatar to IDENTITY.md when provided", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Fancy Agent",
      workspace: "/tmp/ws",
      emoji: "\uD83E\uDD16",
      avatar: "https://example.com/avatar.png",
    });
    await promise;
    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringMatching(/- Name: Fancy Agent[\s\S]*- Emoji: 🤖[\s\S]*- Avatar:/),
      "utf-8",
    );
  });
});
describe("agents.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.findAgentEntryIndex.mockReturnValue(0);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
  });
  it("updates an existing agent successfully", async () => {
    const { respond, promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Updated Name",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(true, { ok: true, agentId: "test-agent" }, undefined);
    expect(mocks.writeConfigFile).toHaveBeenCalled();
  });
  it("rejects updating a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    const { respond, promise } = makeCall("agents.update", {
      agentId: "nonexistent",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("not found") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });
  it("ensures workspace when workspace changes", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      workspace: "/new/workspace",
    });
    await promise;
    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
  });
  it("does not ensure workspace when workspace is unchanged", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Just a rename",
    });
    await promise;
    expect(mocks.ensureAgentWorkspace).not.toHaveBeenCalled();
  });
});
describe("agents.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.findAgentEntryIndex.mockReturnValue(0);
    mocks.pruneAgentConfig.mockReturnValue({ config: {}, removedBindings: 2 });
  });
  it("deletes an existing agent and trashes files by default", async () => {
    vi.useFakeTimers();
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      true,
      { ok: true, agentId: "test-agent", removedBindings: 2 },
      undefined,
    );
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    // File deletion is deferred 3s to let session manager flush writes
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.movePathToTrash).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("skips file deletion when deleteFiles is false", async () => {
    mocks.fsAccess.mockClear();
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
      deleteFiles: false,
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }), undefined);
    expect(mocks.fsAccess).not.toHaveBeenCalled();
  });
  it("rejects deleting the main agent", async () => {
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "main",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("cannot be deleted") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });
  it("rejects deleting a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "ghost",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("not found") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });
  it("rejects invalid params (missing agentId)", async () => {
    const { respond, promise } = makeCall("agents.delete", {});
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });
});
describe("agents.rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.findAgentEntryIndex.mockImplementation((_list, id) => (id === "amigo-nyx" ? 0 : -1));
    mocks.listAgentEntries.mockReturnValue([{ id: "amigo-nyx", name: "Lumina" }]);
    mocks.resolveAgentDir.mockReturnValue("/state/agents/amigo-nyx/agent");
    mocks.resolveAgentWorkspaceDir.mockReturnValue("/state/workspace-amigo-nyx");
    mocks.renameAgentConfig.mockImplementation((cfg) => cfg);
    mocks.migrateSessionStore.mockResolvedValue({ migratedKeys: 2, migratedSpawnedBy: 0 });
  });

  it("renames an agent successfully", async () => {
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "amigo-nyx",
      newId: "lumina",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        oldId: "amigo-nyx",
        newId: "lumina",
        migratedSessions: expect.any(Number),
      }),
      undefined,
    );
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    expect(mocks.renameAgentConfig).toHaveBeenCalled();
  });

  it("rejects renaming 'main'", async () => {
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "main",
      newId: "lumina",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("cannot be renamed") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects renaming to 'main'", async () => {
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "amigo-nyx",
      newId: "main",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("cannot be renamed") }),
    );
  });

  it("rejects when newId already exists", async () => {
    mocks.findAgentEntryIndex.mockImplementation((_list, id) =>
      id === "amigo-nyx" || id === "existing" ? 0 : -1,
    );
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "amigo-nyx",
      newId: "existing",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already exists") }),
    );
  });

  it("rejects when oldId does not exist", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "ghost",
      newId: "lumina",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("not found") }),
    );
  });

  it("rejects when old and new IDs are identical", async () => {
    const { respond, promise } = makeCall("agents.rename", {
      agentId: "amigo-nyx",
      newId: "amigo-nyx",
    });
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("identical") }),
    );
  });
});
describe("agents.files.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
  });
  it("includes BOOTSTRAP.md when onboarding has not completed", async () => {
    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });
  it("hides BOOTSTRAP.md when workspace onboarding is complete", async () => {
    mockWorkspaceStateRead({ onboardingCompletedAt: "2026-02-15T14:00:00.000Z" });
    const names = await listAgentFileNames();
    expect(names).not.toContain("BOOTSTRAP.md");
  });
  it("falls back to showing BOOTSTRAP.md when workspace state cannot be read", async () => {
    mockWorkspaceStateRead({ errorCode: "EACCES" });
    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });
  it("falls back to showing BOOTSTRAP.md when workspace state is malformed JSON", async () => {
    mockWorkspaceStateRead({ rawContent: "{" });
    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });
});
