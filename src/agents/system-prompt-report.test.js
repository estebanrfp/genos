let makeBootstrapFile = function (overrides) {
  return {
    name: "AGENTS.md",
    path: "/tmp/workspace/AGENTS.md",
    content: "alpha",
    missing: false,
    ...overrides,
  };
};
import { describe, expect, it } from "vitest";
import { buildSystemPromptReport } from "./system-prompt-report.js";
describe("buildSystemPromptReport", () => {
  it("counts injected chars when injected file paths are absolute", () => {
    const file = makeBootstrapFile({ path: "/tmp/workspace/policies/AGENTS.md" });
    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: 0,
      bootstrapMaxChars: 20000,
      systemPrompt: "system",
      bootstrapFiles: [file],
      injectedFiles: [{ path: "/tmp/workspace/policies/AGENTS.md", content: "trimmed" }],
      skillsPrompt: "",
      tools: [],
    });
    expect(report.injectedWorkspaceFiles[0]?.injectedChars).toBe("trimmed".length);
  });
  it("keeps legacy basename matching for injected files", () => {
    const file = makeBootstrapFile({ path: "/tmp/workspace/policies/AGENTS.md" });
    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: 0,
      bootstrapMaxChars: 20000,
      systemPrompt: "system",
      bootstrapFiles: [file],
      injectedFiles: [{ path: "AGENTS.md", content: "trimmed" }],
      skillsPrompt: "",
      tools: [],
    });
    expect(report.injectedWorkspaceFiles[0]?.injectedChars).toBe("trimmed".length);
  });
  it("marks workspace files truncated when injected chars are smaller than raw chars", () => {
    const file = makeBootstrapFile({
      path: "/tmp/workspace/policies/AGENTS.md",
      content: "abcdefghijklmnopqrstuvwxyz",
    });
    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: 0,
      bootstrapMaxChars: 20000,
      systemPrompt: "system",
      bootstrapFiles: [file],
      injectedFiles: [{ path: "/tmp/workspace/policies/AGENTS.md", content: "trimmed" }],
      skillsPrompt: "",
      tools: [],
    });
    expect(report.injectedWorkspaceFiles[0]?.truncated).toBe(true);
  });
  it("includes both bootstrap caps in the report payload", () => {
    const file = makeBootstrapFile({ path: "/tmp/workspace/policies/AGENTS.md" });
    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: 0,
      bootstrapMaxChars: 11111,
      bootstrapTotalMaxChars: 22222,
      systemPrompt: "system",
      bootstrapFiles: [file],
      injectedFiles: [{ path: "AGENTS.md", content: "trimmed" }],
      skillsPrompt: "",
      tools: [],
    });
    expect(report.bootstrapMaxChars).toBe(11111);
    expect(report.bootstrapTotalMaxChars).toBe(22222);
  });
});
