import { describe, expect, it } from "vitest";
import {
  resolveMemoryFlushPromptForRun,
  resolveMemoryFlushSettings,
  DEFAULT_MEMORY_FLUSH_PROMPT,
} from "./memory-flush.js";
describe("resolveMemoryFlushPromptForRun", () => {
  const cfg = {
    agents: {
      defaults: {
        userTimezone: "America/New_York",
        timeFormat: "12",
      },
    },
  };
  it("replaces YYYY-MM-DD using user timezone and appends current time", () => {
    const prompt = resolveMemoryFlushPromptForRun({
      prompt: "Store durable notes in memory/YYYY-MM-DD.md",
      cfg,
      nowMs: Date.UTC(2026, 1, 16, 15, 0, 0),
    });
    expect(prompt).toContain("memory/2026-02-16.md");
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain("(America/New_York)");
  });
  it("does not append a duplicate current time line", () => {
    const prompt = resolveMemoryFlushPromptForRun({
      prompt: "Store notes.\nCurrent time: already present",
      cfg,
      nowMs: Date.UTC(2026, 1, 16, 15, 0, 0),
    });
    expect(prompt).toContain("Current time: already present");
    expect((prompt.match(/Current time:/g) ?? []).length).toBe(1);
  });
});
describe("resolveMemoryFlushSettings", () => {
  it("injects structured template into default prompt", () => {
    const settings = resolveMemoryFlushSettings({});
    expect(settings).not.toBeNull();
    expect(settings.prompt).toContain(DEFAULT_MEMORY_FLUSH_PROMPT.slice(0, 30));
    expect(settings.prompt).toContain("## Decisiones");
    expect(settings.prompt).toContain("## Personas");
  });
  it("does not inject template when custom prompt is set", () => {
    const settings = resolveMemoryFlushSettings({
      agents: { defaults: { compaction: { memoryFlush: { prompt: "My custom prompt." } } } },
    });
    expect(settings.prompt).toContain("My custom prompt.");
    expect(settings.prompt).not.toContain("## Decisiones");
  });
  it("does not inject template when structured is false", () => {
    const settings = resolveMemoryFlushSettings({
      agents: { defaults: { compaction: { memoryFlush: { structured: false } } } },
    });
    expect(settings.prompt).not.toContain("## Decisiones");
  });
  it("returns null when memoryFlush disabled", () => {
    const settings = resolveMemoryFlushSettings({
      agents: { defaults: { compaction: { memoryFlush: { enabled: false } } } },
    });
    expect(settings).toBeNull();
  });
});
