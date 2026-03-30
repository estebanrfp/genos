import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createBackup, listBackups, verifyBackup, restoreBackup } from "./engine.js";

/** Remove all backups so the engine sees a clean slate. */
const clearBackups = async (dir) => {
  const backupsDir = join(dir, "backups");
  if (!existsSync(backupsDir)) {
    return;
  }
  const entries = await fs.readdir(backupsDir);
  for (const e of entries) {
    if (e.startsWith("genosos-backup-")) {
      await fs.unlink(join(backupsDir, e));
    }
  }
};

describe("backup engine", () => {
  const tmpDir = join(os.tmpdir(), `genosos-backup-test-${Date.now()}`);

  beforeAll(async () => {
    await fs.mkdir(join(tmpDir, "credentials"), { recursive: true });
    await fs.mkdir(join(tmpDir, "workspace"), { recursive: true });
    await fs.mkdir(join(tmpDir, "agents", "test-agent", "sessions"), { recursive: true });
    await fs.writeFile(join(tmpDir, "genosos.json"), JSON.stringify({ gateway: { port: 18789 } }));
    await fs.writeFile(join(tmpDir, "workspace", "SOUL.md"), "# Soul\nTest agent");
    await fs.writeFile(join(tmpDir, "credentials", "oauth.json"), '{"tokens":{}}');
    await fs.writeFile(
      join(tmpDir, "agents", "test-agent", "sessions", "main.jsonl"),
      '{"role":"user"}\n',
    );
  });

  it("creates a full backup on first run", async () => {
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.type).toBe("full");
    expect(result.fileCount).toBeGreaterThanOrEqual(4);
    expect(result.archiveSize).toBeGreaterThan(0);
    expect(existsSync(result.archive)).toBe(true);
    expect(existsSync(result.manifest)).toBe(true);
  });

  it("skips backup when nothing changed", async () => {
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/no changes/);
  });

  it("creates incremental when files change", async () => {
    await fs.writeFile(join(tmpDir, "workspace", "SOUL.md"), "# Soul\nUpdated agent");
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.type).toBe("incremental");
    expect(result.delta.changed).toBe(1);
    expect(result.fileCount).toBe(1);
    expect(result.totalFiles).toBeGreaterThanOrEqual(4);
  });

  it("detects added files in incremental", async () => {
    await fs.writeFile(join(tmpDir, "workspace", "TOOLS.md"), "# Tools");
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.type).toBe("incremental");
    expect(result.delta.added).toBe(1);
  });

  it("detects removed files in incremental", async () => {
    await fs.unlink(join(tmpDir, "workspace", "TOOLS.md"));
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.type).toBe("incremental");
    expect(result.delta.removed).toBe(1);
  });

  it("creates full after clearing backups", async () => {
    await clearBackups(tmpDir);
    const result = await createBackup({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.type).toBe("full");
    expect(result.fileCount).toBeGreaterThanOrEqual(4);
  });

  it("auto-promotes to full after 7 incrementals and cleans old cycle", async () => {
    const autoDir = join(os.tmpdir(), `genosos-backup-auto-${Date.now()}`);
    await fs.mkdir(autoDir, { recursive: true });
    await fs.writeFile(join(autoDir, "genosos.json"), "{}");

    // First: full
    await createBackup({ stateDir: autoDir });

    // Create 7 incrementals
    for (let i = 0; i < 7; i++) {
      await fs.writeFile(join(autoDir, "genosos.json"), JSON.stringify({ i }));
      await createBackup({ stateDir: autoDir });
    }

    // 8th should auto-promote to full
    await fs.writeFile(join(autoDir, "genosos.json"), JSON.stringify({ final: true }));
    const result = await createBackup({ stateDir: autoDir });
    expect(result.type).toBe("full");

    // Old incrementals should be cleaned, only 2 fulls remain
    const list = await listBackups({ stateDir: autoDir });
    expect(list.backups.filter((b) => b.type === "incremental").length).toBe(0);
    expect(list.backups.filter((b) => b.type === "full").length).toBe(2);
  });

  it("keeps only current cycle + previous full", async () => {
    const cycleDir = join(os.tmpdir(), `genosos-backup-cycle-${Date.now()}`);
    await fs.mkdir(cycleDir, { recursive: true });
    await fs.writeFile(join(cycleDir, "genosos.json"), "{}");

    // Cycle 1: full + 2 incrementals
    await createBackup({ stateDir: cycleDir });
    for (let i = 0; i < 2; i++) {
      await fs.writeFile(join(cycleDir, "genosos.json"), JSON.stringify({ cycle: 1, i }));
      await createBackup({ stateDir: cycleDir });
    }

    // Force new cycle by clearing incrementals count
    await clearBackups(cycleDir);

    // Cycle 2: full + 1 incremental
    await createBackup({ stateDir: cycleDir });
    await fs.writeFile(join(cycleDir, "genosos.json"), JSON.stringify({ cycle: 2 }));
    const result = await createBackup({ stateDir: cycleDir });

    expect(result.type).toBe("incremental");
    const list = await listBackups({ stateDir: cycleDir });
    // Should have: 1 full (current) + 1 incremental (current cycle)
    expect(list.backups.length).toBe(2);
  });

  it("lists backups sorted by timestamp", async () => {
    const result = await listBackups({ stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.backups.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.backups.length; i++) {
      expect(result.backups[i - 1].timestamp >= result.backups[i].timestamp).toBe(true);
    }
  });

  it("verifies a valid backup", async () => {
    await clearBackups(tmpDir);
    const backup = await createBackup({ stateDir: tmpDir });
    const result = await verifyBackup({ manifestPath: backup.manifest, stateDir: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.mismatches.length).toBe(0);
    expect(result.verified).toBe(result.totalFiles);
  });

  it("returns empty list when no backups exist", async () => {
    const freshDir = join(os.tmpdir(), `genosos-backup-empty-${Date.now()}`);
    await fs.mkdir(freshDir, { recursive: true });
    const result = await listBackups({ stateDir: freshDir });
    expect(result.ok).toBe(true);
    expect(result.backups.length).toBe(0);
  });

  it("restores from a full backup", async () => {
    const restoreDir = join(os.tmpdir(), `genosos-backup-restore-${Date.now()}`);
    await fs.mkdir(restoreDir, { recursive: true });
    await fs.writeFile(join(restoreDir, "genosos.json"), '{"original":true}');

    const backup = await createBackup({ stateDir: restoreDir });
    await fs.writeFile(join(restoreDir, "genosos.json"), '{"destroyed":true}');

    const result = await restoreBackup({ manifestPath: backup.manifest, stateDir: restoreDir });
    expect(result.ok).toBe(true);

    const restored = JSON.parse(await fs.readFile(join(restoreDir, "genosos.json"), "utf-8"));
    expect(restored.original).toBe(true);
  });
});
