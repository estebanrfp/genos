import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runDoctor } from "./engine.js";

describe("doctor engine", () => {
  const tmpDir = join(os.tmpdir(), `genosos-doctor-test-${Date.now()}`);

  const minimalConfig = {
    gateway: {
      mode: "local",
      port: 19999,
      auth: { mode: "token", token: "test-token-123" },
      bind: "loopback",
    },
    providers: { anthropic: { apiKey: "sk-ant-test-key" } },
  };

  it("returns structured report with summary and checks", async () => {
    const report = await runDoctor({ config: minimalConfig, stateDir: tmpDir });

    expect(report).toHaveProperty("ts");
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("checks");
    expect(report.summary).toHaveProperty("critical");
    expect(report.summary).toHaveProperty("warnings");
    expect(report.summary).toHaveProperty("fixed");
    expect(report.summary).toHaveProperty("ok");
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBe(8);
  });

  it("auto-creates state directory and subdirs", async () => {
    const freshDir = join(os.tmpdir(), `genosos-doctor-fresh-${Date.now()}`);
    const report = await runDoctor({ config: minimalConfig, stateDir: freshDir });

    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(join(freshDir, "sessions"))).toBe(true);
    expect(existsSync(join(freshDir, "store"))).toBe(true);
    expect(existsSync(join(freshDir, "oauth"))).toBe(true);

    const stateCheck = report.checks.find((c) => c.name === "state");
    expect(stateCheck).toBeDefined();
    const createdFindings = stateCheck.findings.filter((f) => f.fixed);
    expect(createdFindings.length).toBeGreaterThan(0);
  });

  it("reports config OK when properly configured", async () => {
    const report = await runDoctor({ config: minimalConfig, stateDir: tmpDir });
    const configCheck = report.checks.find((c) => c.name === "config");
    expect(configCheck).toBeDefined();
    const okFinding = configCheck.findings.find((f) => f.severity === "ok");
    expect(okFinding).toBeDefined();
  });

  it("reports critical when config missing", async () => {
    const report = await runDoctor({ config: null, stateDir: tmpDir });
    const configCheck = report.checks.find((c) => c.name === "config");
    const critical = configCheck.findings.find((f) => f.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical.id).toBe("config_missing");
  });

  it("reports warning when auth token not configured", async () => {
    const noAuthConfig = { gateway: { mode: "local", auth: { mode: "token" } } };
    const report = await runDoctor({ config: noAuthConfig, stateDir: tmpDir });
    const configCheck = report.checks.find((c) => c.name === "config");
    const warn = configCheck.findings.find((f) => f.id === "gateway_auth_missing");
    expect(warn).toBeDefined();
    expect(warn.severity).toBe("warn");
  });

  it("reports gateway unreachable when not running", async () => {
    const report = await runDoctor({ config: minimalConfig, stateDir: tmpDir });
    const gwCheck = report.checks.find((c) => c.name === "gateway");
    expect(gwCheck).toBeDefined();
    // Gateway won't be running in test — should be unreachable
    const unreachable = gwCheck.findings.find((f) => f.id === "gateway_unreachable");
    expect(unreachable).toBeDefined();
  });

  it("all checks have name and label", async () => {
    const report = await runDoctor({ config: minimalConfig, stateDir: tmpDir });
    for (const check of report.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("label");
      expect(check).toHaveProperty("findings");
      expect(Array.isArray(check.findings)).toBe(true);
    }
  });

  it("findings have required fields", async () => {
    const report = await runDoctor({ config: minimalConfig, stateDir: tmpDir });
    for (const check of report.checks) {
      for (const f of check.findings) {
        expect(f).toHaveProperty("id");
        expect(f).toHaveProperty("severity");
        expect(f).toHaveProperty("title");
        expect(f).toHaveProperty("detail");
        expect(["critical", "warn", "info", "ok"]).toContain(f.severity);
      }
    }
  });
});
