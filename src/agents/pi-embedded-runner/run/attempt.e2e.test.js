import { describe, expect, it } from "vitest";
import { injectHistoryImagesIntoMessages } from "./attempt.js";
describe("injectHistoryImagesIntoMessages", () => {
  const image = { type: "image", data: "abc", mimeType: "image/png" };
  it("injects history images and converts string content", () => {
    const messages = [
      {
        role: "user",
        content: "See /tmp/photo.png",
      },
    ];
    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));
    expect(didMutate).toBe(true);
    const firstUser = messages[0];
    expect(Array.isArray(firstUser?.content)).toBe(true);
    const content = firstUser?.content;
    expect(content).toHaveLength(2);
    expect(content[0]?.type).toBe("text");
    expect(content[1]).toMatchObject({ type: "image", data: "abc" });
  });
  it("avoids duplicating existing image content", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "See /tmp/photo.png" }, { ...image }],
      },
    ];
    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[0, [image]]]));
    expect(didMutate).toBe(false);
    const first = messages[0];
    if (!first || !Array.isArray(first.content)) {
      throw new Error("expected array content");
    }
    expect(first.content).toHaveLength(2);
  });
  it("ignores non-user messages and out-of-range indices", () => {
    const messages = [
      {
        role: "assistant",
        content: "noop",
      },
    ];
    const didMutate = injectHistoryImagesIntoMessages(messages, new Map([[1, [image]]]));
    expect(didMutate).toBe(false);
    const firstAssistant = messages[0];
    expect(firstAssistant?.content).toBe("noop");
  });
});
