let snapshotHomeEnv = function () {
    return {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      GENOS_STATE_DIR: process.env.GENOS_STATE_DIR,
      GENOS_AGENT_DIR: process.env.GENOS_AGENT_DIR,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };
  },
  restoreHomeEnv = function (snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
export function createTempHomeHarness(options) {
  let fixtureRoot = "";
  let caseId = 0;
  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), options.prefix));
  });
  afterAll(async () => {
    if (!fixtureRoot) {
      return;
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  async function withTempHome(fn) {
    const home = path.join(fixtureRoot, `case-${++caseId}`);
    await fs.mkdir(path.join(home, ".genosv1", "agents", "main", "sessions"), { recursive: true });
    const envSnapshot = snapshotHomeEnv();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.GENOS_STATE_DIR = path.join(home, ".genosv1");
    process.env.GENOS_AGENT_DIR = path.join(home, ".genosv1", "agent");
    process.env.PI_CODING_AGENT_DIR = path.join(home, ".genosv1", "agent");
    if (process.platform === "win32") {
      const match = home.match(/^([A-Za-z]:)(.*)$/);
      if (match) {
        process.env.HOMEDRIVE = match[1];
        process.env.HOMEPATH = match[2] || "\\";
      }
    }
    try {
      options.beforeEachCase?.();
      return await fn(home);
    } finally {
      restoreHomeEnv(envSnapshot);
    }
  }
  return { withTempHome };
}
export function makeReplyConfig(home) {
  return {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: path.join(home, "genosos"),
      },
    },
    channels: {
      whatsapp: {
        allowFrom: ["*"],
      },
    },
    session: { store: path.join(home, "sessions.json") },
  };
}
