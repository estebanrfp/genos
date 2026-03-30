let createBundledSkill = function (params) {
    return {
      name: params.name,
      description: params.description,
      source: "genosos-bundled",
      bundled: true,
      filePath: `/tmp/skills/${params.name}`,
      baseDir: `/tmp/skills/${params.name}`,
      skillKey: params.name,
      always: false,
      disabled: false,
      blockedByAllowlist: false,
      eligible: false,
      requirements: { bins: params.bins, anyBins: [], env: [], config: [], os: params.os ?? [] },
      missing: { bins: params.bins, anyBins: [], env: [], config: [], os: params.os ?? [] },
      configChecks: [],
      install: [{ id: "brew", kind: "brew", label: params.installLabel, bins: params.bins }],
    };
  },
  mockMissingBrewStatus = function (skills) {
    vi.mocked(detectBinary).mockResolvedValue(false);
    vi.mocked(installSkill).mockResolvedValue({
      ok: true,
      message: "Installed",
      stdout: "",
      stderr: "",
      code: 0,
    });
    vi.mocked(buildWorkspaceSkillStatus).mockReturnValue({
      workspaceDir: "/tmp/ws",
      managedSkillsDir: "/tmp/managed",
      skills,
    });
  },
  createPrompter = function (params) {
    const notes = [];
    const confirmAnswers = [];
    confirmAnswers.push(params.configure ?? true);
    const prompter = {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async (message, title) => {
        notes.push({ title, message });
      }),
      select: vi.fn(async () => "npm"),
      multiselect: vi.fn(async () => params.multiselect ?? ["__skip__"]),
      text: vi.fn(async () => ""),
      confirm: vi.fn(async ({ message }) => {
        if (message === "Show Homebrew install command?") {
          return params.showBrewInstall ?? false;
        }
        return confirmAnswers.shift() ?? false;
      }),
      progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    };
    return { prompter, notes };
  };
import { describe, expect, it, vi } from "vitest";
vi.mock("../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus: vi.fn(),
}));
vi.mock("../agents/skills-install.js", () => ({
  installSkill: vi.fn(),
}));
vi.mock("./onboard-helpers.js", () => ({
  detectBinary: vi.fn(),
  resolveNodeManagerOptions: vi.fn(() => [
    { value: "npm", label: "npm" },
    { value: "pnpm", label: "pnpm" },
    { value: "bun", label: "bun" },
  ]),
}));
import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { detectBinary } from "./onboard-helpers.js";
import { setupSkills } from "./onboard-skills.js";
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: (code) => {
    throw new Error(`unexpected exit ${code}`);
  },
};
describe("setupSkills", () => {
  it("does not recommend Homebrew when user skips installing brew-backed deps", async () => {
    if (process.platform === "win32") {
      return;
    }
    mockMissingBrewStatus([
      createBundledSkill({
        name: "apple-reminders",
        description: "macOS-only",
        bins: ["remindctl"],
        os: ["darwin"],
        installLabel: "Install remindctl (brew)",
      }),
      createBundledSkill({
        name: "video-frames",
        description: "ffmpeg",
        bins: ["ffmpeg"],
        installLabel: "Install ffmpeg (brew)",
      }),
    ]);
    const { prompter, notes } = createPrompter({ multiselect: ["__skip__"] });
    await setupSkills({}, "/tmp/ws", runtime, prompter);
    const status = notes.find((n) => n.title === "Skills status")?.message ?? "";
    expect(status).toContain("Unsupported on this OS: 1");
    const brewNote = notes.find((n) => n.title === "Homebrew recommended");
    expect(brewNote).toBeUndefined();
  });
  it("recommends Homebrew when user selects a brew-backed install and brew is missing", async () => {
    if (process.platform === "win32") {
      return;
    }
    mockMissingBrewStatus([
      createBundledSkill({
        name: "video-frames",
        description: "ffmpeg",
        bins: ["ffmpeg"],
        installLabel: "Install ffmpeg (brew)",
      }),
    ]);
    const { prompter, notes } = createPrompter({ multiselect: ["video-frames"] });
    await setupSkills({}, "/tmp/ws", runtime, prompter);
    const brewNote = notes.find((n) => n.title === "Homebrew recommended");
    expect(brewNote).toBeDefined();
  });
});
