import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.js";
registerAppMountHooks();
describe("chat markdown rendering", () => {
  it("renders markdown inside tool output sidebar", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;
    const timestamp = Date.now();
    app.chatMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolcall", name: "noop", arguments: {} },
          { type: "toolresult", name: "noop", text: "Hello **world**" },
        ],
        timestamp,
      },
    ];
    await app.updateComplete;
    const toolLines = Array.from(app.querySelectorAll(".chat-tool-line"));
    const toolLine = toolLines.find((line) => line.querySelector(".chat-tool-line__label"));
    expect(toolLine).not.toBeUndefined();
    toolLine?.click();
    await app.updateComplete;
    const strong = app.querySelector(".sidebar-markdown strong");
    expect(strong?.textContent).toBe("world");
  });
});
