import fs from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { captureEnv } from "../test-utils/env.js";
export const noopAsync = async () => {};
export const noop = () => {};
export function createExitThrowingRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code) => {
      throw new Error(`exit:${code}`);
    }),
  };
}
export function createWizardPrompter(overrides, options) {
  return {
    intro: vi.fn(noopAsync),
    outro: vi.fn(noopAsync),
    note: vi.fn(noopAsync),
    select: vi.fn(async () => options?.defaultSelect ?? ""),
    multiselect: vi.fn(async () => []),
    text: vi.fn(async () => ""),
    confirm: vi.fn(async () => false),
    progress: vi.fn(() => ({ update: noop, stop: noop })),
    ...overrides,
  };
}
export async function setupAuthTestEnv(prefix = "genosos-auth-", options) {
  const stateDir = await makeTempWorkspace(prefix);
  const agentDir = path.join(stateDir, options?.agentSubdir ?? "agent");
  process.env.GENOS_STATE_DIR = stateDir;
  process.env.GENOS_AGENT_DIR = agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.mkdir(agentDir, { recursive: true });
  return { stateDir, agentDir };
}
export function createAuthTestLifecycle(envKeys) {
  const envSnapshot = captureEnv(envKeys);
  let stateDir = null;
  return {
    setStateDir(nextStateDir) {
      stateDir = nextStateDir;
    },
    async cleanup() {
      if (stateDir) {
        await fs.rm(stateDir, { recursive: true, force: true });
        stateDir = null;
      }
      envSnapshot.restore();
    },
  };
}
export function requireGenosOSAgentDir() {
  const agentDir = process.env.GENOS_AGENT_DIR;
  if (!agentDir) {
    throw new Error("GENOS_AGENT_DIR not set");
  }
  return agentDir;
}
export function authProfilePathForAgent(agentDir) {
  return path.join(agentDir, "auth-profiles.json");
}
export async function readAuthProfilesForAgent(agentDir) {
  try {
    const raw = await fs.readFile(authProfilePathForAgent(agentDir), "utf8");
    return JSON.parse(raw);
  } catch {
    // Fallback: read from config file providers format
    const stateDir = path.dirname(agentDir);
    const cfgPath = path.join(stateDir, "genosos.json");
    const cfgRaw = await fs.readFile(cfgPath, "utf8");
    const cfg = JSON.parse(cfgRaw);
    const profiles = {};
    for (const [provider, entry] of Object.entries(cfg.providers ?? {})) {
      for (const cred of entry.credentials ?? []) {
        profiles[`${provider}:${cred.id}`] = { ...cred, provider };
      }
    }
    return { profiles };
  }
}
