import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "./state-migrations.js";
let tempRoot = null;
async function makeTempRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "genosos-state-dir-"));
  tempRoot = root;
  return root;
}
afterEach(async () => {
  resetAutoMigrateLegacyStateDirForTest();
  if (!tempRoot) {
    return;
  }
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});
describe("legacy state dir auto-migration", () => {
  it("follows legacy symlink when it points at another legacy dir (genosos -> genosos)", async () => {
    const root = await makeTempRoot();
    const legacySymlink = path.join(root, ".genosv1");
    const legacyDir = path.join(root, ".genosv1");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "marker.txt"), "ok", "utf-8");
    const dirLinkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(legacyDir, legacySymlink, dirLinkType);
    const result = await autoMigrateLegacyStateDir({
      env: {},
      homedir: () => root,
    });
    expect(result.migrated).toBe(true);
    expect(result.warnings).toEqual([]);
    const targetMarker = path.join(root, ".genosv1", "marker.txt");
    expect(fs.readFileSync(targetMarker, "utf-8")).toBe("ok");
    expect(fs.readFileSync(path.join(root, ".genosv1", "marker.txt"), "utf-8")).toBe("ok");
    expect(fs.readFileSync(path.join(root, ".genosv1", "marker.txt"), "utf-8")).toBe("ok");
  });
});
