import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConfigIO } from "./io.js";
async function withTempHome(run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-config-"));
  try {
    await run(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}
async function writeConfig(home, dirname, port, filename = "genosos.json") {
  const dir = path.join(home, dirname);
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, filename);
  await fs.writeFile(configPath, JSON.stringify({ gateway: { port } }, null, 2));
  return configPath;
}
describe("config io paths", () => {
  it("uses ~/.genosv1/genosos.json when config exists", async () => {
    await withTempHome(async (home) => {
      const configPath = await writeConfig(home, ".genosv1", 19001);
      const io = createConfigIO({
        env: {},
        homedir: () => home,
      });
      expect(io.configPath).toBe(configPath);
      expect(io.loadConfig().gateway?.port).toBe(19001);
    });
  });
  it("defaults to ~/.genosv1/genosos.json when config is missing", async () => {
    await withTempHome(async (home) => {
      const io = createConfigIO({
        env: {},
        homedir: () => home,
      });
      expect(io.configPath).toBe(path.join(home, ".genosv1", "genosos.json"));
    });
  });
  it("uses GENOS_HOME for default config path", async () => {
    await withTempHome(async (home) => {
      const io = createConfigIO({
        env: { GENOS_HOME: path.join(home, "svc-home") },
        homedir: () => path.join(home, "ignored-home"),
      });
      expect(io.configPath).toBe(path.join(home, "svc-home", ".genosv1", "genosos.json"));
    });
  });
  it("honors explicit GENOS_CONFIG_PATH override", async () => {
    await withTempHome(async (home) => {
      const customPath = await writeConfig(home, ".genosv1", 20002, "custom.json");
      const io = createConfigIO({
        env: { GENOS_CONFIG_PATH: customPath },
        homedir: () => home,
      });
      expect(io.configPath).toBe(customPath);
      expect(io.loadConfig().gateway?.port).toBe(20002);
    });
  });
});
