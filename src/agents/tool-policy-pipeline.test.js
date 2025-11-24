import { describe, expect, test } from "vitest";
import { applyToolPolicyPipeline } from "./tool-policy-pipeline.js";
describe("tool-policy-pipeline", () => {
  test("strips allowlists that would otherwise disable core tools", () => {
    const tools = [{ name: "exec" }, { name: "plugin_tool" }];
    const filtered = applyToolPolicyPipeline({
      tools,
      toolMeta: (t) => (t.name === "plugin_tool" ? { pluginId: "foo" } : undefined),
      warn: () => {},
      steps: [
        {
          policy: { allow: ["plugin_tool"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    const names = filtered.map((t) => t.name).toSorted();
    expect(names).toEqual(["exec", "plugin_tool"]);
  });
  test("warns about unknown allowlist entries", () => {
    const warnings = [];
    const tools = [{ name: "exec" }];
    applyToolPolicyPipeline({
      tools,
      toolMeta: () => {
        return;
      },
      warn: (msg) => warnings.push(msg),
      steps: [
        {
          policy: { allow: ["wat"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown entries (wat)");
  });
  test("applies allowlist filtering when core tools are explicitly listed", () => {
    const tools = [{ name: "exec" }, { name: "process" }];
    const filtered = applyToolPolicyPipeline({
      tools,
      toolMeta: () => {
        return;
      },
      warn: () => {},
      steps: [
        {
          policy: { allow: ["exec"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(filtered.map((t) => t.name)).toEqual(["exec"]);
  });
});
