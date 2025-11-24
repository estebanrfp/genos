import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  createConfigIO,
  readConfigFileSnapshotForWrite,
  writeConfigFile as writeConfigFileViaWrapper,
} from "./io.js";
async function withTempConfig(configContent, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-env-io-"));
  const configPath = path.join(dir, "genosos.json");
  await fs.writeFile(configPath, configContent);
  try {
    await run(configPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
async function withEnvOverrides(updates, run) {
  const previous = new Map();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
async function withWrapperEnvContext(configPath, run) {
  await withEnvOverrides(
    {
      GENOS_CONFIG_PATH: configPath,
      GENOS_DISABLE_CONFIG_CACHE: "1",
      MY_API_KEY: "original-key-123",
    },
    run,
  );
}
async function readGatewayToken(configPath) {
  const written = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(written);
  return parsed.gateway.remote.token;
}
describe("env snapshot TOCTOU via createConfigIO", () => {
  it("restores env refs using read-time env even after env mutation", async () => {
    const env = {
      MY_API_KEY: "original-key-123",
    };
    const configJson = JSON.stringify({ gateway: { remote: { token: "${MY_API_KEY}" } } }, null, 2);
    await withTempConfig(configJson, async (configPath) => {
      const ioA = createConfigIO({ configPath, env });
      const firstRead = await ioA.readConfigFileSnapshotForWrite();
      expect(firstRead.snapshot.config.gateway?.remote?.token).toBe("original-key-123");
      env.MY_API_KEY = "mutated-key-456";
      const ioB = createConfigIO({ configPath, env });
      await ioB.writeConfigFile(firstRead.snapshot.config, firstRead.writeOptions);
      const written = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(written);
      expect(parsed.gateway.remote.token).toBe("${MY_API_KEY}");
    });
  });
  it("without snapshot bridging, mutated env causes incorrect restoration", async () => {
    const env = {
      MY_API_KEY: "original-key-123",
    };
    const configJson = JSON.stringify({ gateway: { remote: { token: "${MY_API_KEY}" } } }, null, 2);
    await withTempConfig(configJson, async (configPath) => {
      const ioA = createConfigIO({ configPath, env });
      const snapshot = await ioA.readConfigFileSnapshot();
      env.MY_API_KEY = "mutated-key-456";
      const ioB = createConfigIO({ configPath, env });
      await ioB.writeConfigFile(snapshot.config);
      const written = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(written);
      expect(parsed.gateway.remote.token).toBe("original-key-123");
    });
  });
});
describe("env snapshot TOCTOU via wrapper APIs", () => {
  it("uses explicit read context even if another read interleaves", async () => {
    const configJson = JSON.stringify({ gateway: { remote: { token: "${MY_API_KEY}" } } }, null, 2);
    await withTempConfig(configJson, async (configPath) => {
      await withWrapperEnvContext(configPath, async () => {
        const firstRead = await readConfigFileSnapshotForWrite();
        expect(firstRead.snapshot.config.gateway?.remote?.token).toBe("original-key-123");
        process.env.MY_API_KEY = "mutated-key-456";
        const secondRead = await readConfigFileSnapshotForWrite();
        expect(secondRead.snapshot.config.gateway?.remote?.token).toBe("mutated-key-456");
        await writeConfigFileViaWrapper(firstRead.snapshot.config, firstRead.writeOptions);
        expect(await readGatewayToken(configPath)).toBe("${MY_API_KEY}");
      });
    });
  });
  it("ignores read context when expected config path does not match", async () => {
    const configJson = JSON.stringify({ gateway: { remote: { token: "${MY_API_KEY}" } } }, null, 2);
    await withTempConfig(configJson, async (configPath) => {
      await withWrapperEnvContext(configPath, async () => {
        const firstRead = await readConfigFileSnapshotForWrite();
        expect(firstRead.snapshot.config.gateway?.remote?.token).toBe("original-key-123");
        expect(firstRead.writeOptions.expectedConfigPath).toBe(configPath);
        process.env.MY_API_KEY = "mutated-key-456";
        await writeConfigFileViaWrapper(firstRead.snapshot.config, {
          ...firstRead.writeOptions,
          expectedConfigPath: `${configPath}.different`,
        });
        expect(await readGatewayToken(configPath)).toBe("original-key-123");
      });
    });
  });
});
