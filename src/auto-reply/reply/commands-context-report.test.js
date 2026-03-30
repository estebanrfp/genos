let makeParams = function (commandBodyNormalized, truncated) {
  return {
    command: {
      commandBodyNormalized,
      channel: "telegram",
      senderIsOwner: true,
    },
    sessionKey: "agent:default:main",
    workspaceDir: "/tmp/workspace",
    contextTokens: null,
    provider: "openai",
    model: "gpt-5",
    elevated: { allowed: false },
    resolvedThinkLevel: "off",
    resolvedReasoningLevel: "off",
    sessionEntry: {
      totalTokens: 123,
      inputTokens: 100,
      outputTokens: 23,
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        workspaceDir: "/tmp/workspace",
        bootstrapMaxChars: 20000,
        bootstrapTotalMaxChars: 150000,
        sandbox: { mode: "off", sandboxed: false },
        systemPrompt: {
          chars: 1000,
          projectContextChars: 500,
          nonProjectContextChars: 500,
        },
        injectedWorkspaceFiles: [
          {
            name: "AGENTS.md",
            path: "/tmp/workspace/AGENTS.md",
            missing: false,
            rawChars: truncated ? 200000 : 1e4,
            injectedChars: truncated ? 20000 : 1e4,
            truncated,
          },
        ],
        skills: {
          promptChars: 10,
          entries: [{ name: "checks", blockChars: 10 }],
        },
        tools: {
          listChars: 10,
          schemaChars: 20,
          entries: [{ name: "read", summaryChars: 10, schemaChars: 20, propertiesCount: 1 }],
        },
      },
    },
    cfg: {},
    ctx: {},
    commandBody: "",
    commandArgs: [],
    resolvedElevatedLevel: "off",
  };
};
import { describe, expect, it } from "vitest";
import { buildContextReply } from "./commands-context-report.js";
describe("buildContextReply", () => {
  it("shows bootstrap truncation warning in list output when context exceeds configured limits", async () => {
    const result = await buildContextReply(makeParams("/context list", true));
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).toContain("\u26A0 Bootstrap context is over configured limits");
    expect(result.text).toContain(
      "Causes: 1 file(s) exceeded max/file; raw total exceeded max/total.",
    );
  });
  it("does not show bootstrap truncation warning when there is no truncation", async () => {
    const result = await buildContextReply(makeParams("/context list", false));
    expect(result.text).not.toContain("Bootstrap context is over configured limits");
  });
});
