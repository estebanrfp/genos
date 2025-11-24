let buildResult = function (session) {
    return {
      ts: Date.now(),
      path: "(multiple)",
      count: 1,
      defaults: { model: null, contextTokens: null },
      sessions: [session],
    };
  },
  buildProps = function (result) {
    return {
      loading: false,
      result,
      error: null,
      activeMinutes: "",
      limit: "120",
      includeGlobal: false,
      includeUnknown: false,
      basePath: "",
      onFiltersChange: () => {
        return;
      },
      onRefresh: () => {
        return;
      },
      onPatch: () => {
        return;
      },
      onDelete: () => {
        return;
      },
    };
  };
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderSessions } from "./sessions.js";
describe("sessions view", () => {
  it("renders verbose=full without falling back to inherit", async () => {
    const container = document.createElement("div");
    render(
      renderSessions(
        buildProps(
          buildResult({
            key: "agent:main:main",
            kind: "direct",
            updatedAt: Date.now(),
            verboseLevel: "full",
          }),
        ),
      ),
      container,
    );
    await Promise.resolve();
    const selects = container.querySelectorAll("select");
    const verbose = selects[1];
    expect(verbose?.value).toBe("full");
    expect(Array.from(verbose?.options ?? []).some((option) => option.value === "full")).toBe(true);
  });
  it("keeps unknown stored values selectable instead of forcing inherit", async () => {
    const container = document.createElement("div");
    render(
      renderSessions(
        buildProps(
          buildResult({
            key: "agent:main:main",
            kind: "direct",
            updatedAt: Date.now(),
            reasoningLevel: "custom-mode",
          }),
        ),
      ),
      container,
    );
    await Promise.resolve();
    const selects = container.querySelectorAll("select");
    const reasoning = selects[2];
    expect(reasoning?.value).toBe("custom-mode");
    expect(
      Array.from(reasoning?.options ?? []).some((option) => option.value === "custom-mode"),
    ).toBe(true);
  });
});
