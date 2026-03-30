import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSessionEntry } from "./session-files.js";
describe("buildSessionEntry", () => {
  let tmpDir;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-entry-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
  it("returns lineMap tracking original JSONL line numbers", async () => {
    const jsonlLines = [
      JSON.stringify({ type: "custom", customType: "model-snapshot", data: {} }),
      JSON.stringify({ type: "custom", customType: "genosos.cache-ttl", data: {} }),
      JSON.stringify({ type: "session-meta", agentId: "test" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Hello world" } }),
      JSON.stringify({ type: "custom", customType: "tool-result", data: {} }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: "Hi there, how can I help?" },
      }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Tell me a joke" } }),
    ];
    const filePath = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(filePath, jsonlLines.join("\n"));
    const entry = await buildSessionEntry(filePath);
    expect(entry).not.toBeNull();
    const contentLines = entry.content.split("\n");
    expect(contentLines).toHaveLength(3);
    expect(contentLines[0]).toContain("User: Hello world");
    expect(contentLines[1]).toContain("Assistant: Hi there");
    expect(contentLines[2]).toContain("User: Tell me a joke");
    expect(entry.lineMap).toBeDefined();
    expect(entry.lineMap).toEqual([4, 6, 7]);
  });
  it("returns empty lineMap when no messages are found", async () => {
    const jsonlLines = [
      JSON.stringify({ type: "custom", customType: "model-snapshot", data: {} }),
      JSON.stringify({ type: "session-meta", agentId: "test" }),
    ];
    const filePath = path.join(tmpDir, "empty-session.jsonl");
    await fs.writeFile(filePath, jsonlLines.join("\n"));
    const entry = await buildSessionEntry(filePath);
    expect(entry).not.toBeNull();
    expect(entry.content).toBe("");
    expect(entry.lineMap).toEqual([]);
  });
  it("skips blank lines and invalid JSON without breaking lineMap", async () => {
    const jsonlLines = [
      "",
      "not valid json",
      JSON.stringify({ type: "message", message: { role: "user", content: "First" } }),
      "",
      JSON.stringify({ type: "message", message: { role: "assistant", content: "Second" } }),
    ];
    const filePath = path.join(tmpDir, "gaps.jsonl");
    await fs.writeFile(filePath, jsonlLines.join("\n"));
    const entry = await buildSessionEntry(filePath);
    expect(entry).not.toBeNull();
    expect(entry.lineMap).toEqual([3, 5]);
  });
});
