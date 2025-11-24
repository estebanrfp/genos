import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { resolveGenosOSAgentDir } from "./agent-paths.js";
describe("resolveGenosOSAgentDir", () => {
  const env = captureEnv(["GENOS_STATE_DIR", "GENOS_AGENT_DIR", "PI_CODING_AGENT_DIR"]);
  let tempStateDir = null;
  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    env.restore();
  });
  it("defaults to the multi-agent path when no overrides are set", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-agent-"));
    process.env.GENOS_STATE_DIR = tempStateDir;
    delete process.env.GENOS_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    const resolved = resolveGenosOSAgentDir();
    expect(resolved).toBe(path.join(tempStateDir, "agents", "main", "agent"));
  });
  it("honors GENOS_AGENT_DIR overrides", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-agent-"));
    const override = path.join(tempStateDir, "agent");
    process.env.GENOS_AGENT_DIR = override;
    delete process.env.PI_CODING_AGENT_DIR;
    const resolved = resolveGenosOSAgentDir();
    expect(resolved).toBe(path.resolve(override));
  });
});
