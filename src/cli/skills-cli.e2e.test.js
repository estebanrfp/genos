import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { captureEnv } from "../test-utils/env.js";
import { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";
describe("skills-cli (e2e)", () => {
  let tempWorkspaceDir = "";
  let tempBundledDir = "";
  let envSnapshot;
  beforeAll(() => {
    envSnapshot = captureEnv(["GENOS_BUNDLED_SKILLS_DIR"]);
    tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-skills-test-"));
    tempBundledDir = fs.mkdtempSync(path.join(os.tmpdir(), "genosos-bundled-skills-test-"));
    process.env.GENOS_BUNDLED_SKILLS_DIR = tempBundledDir;
  });
  afterAll(() => {
    if (tempWorkspaceDir) {
      fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    }
    if (tempBundledDir) {
      fs.rmSync(tempBundledDir, { recursive: true, force: true });
    }
    envSnapshot.restore();
  });
  function createEntries() {
    const baseDir = path.join(tempWorkspaceDir, "peekaboo");
    return [
      {
        skill: {
          name: "peekaboo",
          description: "Capture UI screenshots",
          source: "genosos-bundled",
          filePath: path.join(baseDir, "SKILL.md"),
          baseDir,
        },
        frontmatter: {},
        metadata: { emoji: "\uD83D\uDCF8" },
      },
    ];
  }
  it("loads bundled skills and formats them", () => {
    const entries = createEntries();
    const report = buildWorkspaceSkillStatus(tempWorkspaceDir, {
      managedSkillsDir: "/nonexistent",
      entries,
    });
    expect(report.skills.length).toBeGreaterThan(0);
    const listOutput = formatSkillsList(report, {});
    expect(listOutput).toContain("Skills");
    const checkOutput = formatSkillsCheck(report, {});
    expect(checkOutput).toContain("Total:");
    const jsonOutput = formatSkillsList(report, { json: true });
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.skills).toBeInstanceOf(Array);
  });
  it("formats info for a real bundled skill (peekaboo)", () => {
    const entries = createEntries();
    const report = buildWorkspaceSkillStatus(tempWorkspaceDir, {
      managedSkillsDir: "/nonexistent",
      entries,
    });
    const peekaboo = report.skills.find((s) => s.name === "peekaboo");
    if (!peekaboo) {
      throw new Error("peekaboo fixture skill missing");
    }
    const output = formatSkillInfo(report, "peekaboo", {});
    expect(output).toContain("peekaboo");
    expect(output).toContain("Details:");
  });
});
