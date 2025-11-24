let snapshotEnv = function () {
    return {
      home: process.env.HOME,
      userProfile: process.env.USERPROFILE,
      homeDrive: process.env.HOMEDRIVE,
      homePath: process.env.HOMEPATH,
      genososHome: process.env.GENOS_HOME,
      stateDir: process.env.GENOS_STATE_DIR,
    };
  },
  restoreEnv = function (snapshot) {
    const restoreKey = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restoreKey("HOME", snapshot.home);
    restoreKey("USERPROFILE", snapshot.userProfile);
    restoreKey("HOMEDRIVE", snapshot.homeDrive);
    restoreKey("HOMEPATH", snapshot.homePath);
    restoreKey("GENOS_HOME", snapshot.genosHome);
    restoreKey("GENOS_STATE_DIR", snapshot.stateDir);
  },
  snapshotExtraEnv = function (keys) {
    const snapshot = {};
    for (const key of keys) {
      snapshot[key] = process.env[key];
    }
    return snapshot;
  },
  restoreExtraEnv = function (snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  },
  setTempHome = function (base) {
    process.env.HOME = base;
    process.env.USERPROFILE = base;
    delete process.env.GENOS_HOME;
    process.env.GENOS_STATE_DIR = path.join(base, ".genos");
    if (process.platform !== "win32") {
      return;
    }
    const match = base.match(/^([A-Za-z]:)(.*)$/);
    if (!match) {
      return;
    }
    process.env.HOMEDRIVE = match[1];
    process.env.HOMEPATH = match[2] || "\\";
  };
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export async function withTempHome(fn, opts = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), opts.prefix ?? "genosos-test-home-"));
  const snapshot = snapshotEnv();
  const envKeys = Object.keys(opts.env ?? {});
  for (const key of envKeys) {
    if (key === "HOME" || key === "USERPROFILE" || key === "HOMEDRIVE" || key === "HOMEPATH") {
      throw new Error(`withTempHome: use built-in home env (got ${key})`);
    }
  }
  const envSnapshot = snapshotExtraEnv(envKeys);
  setTempHome(base);
  await fs.mkdir(path.join(base, ".genos", "agents", "main", "sessions"), { recursive: true });
  if (opts.env) {
    for (const [key, raw] of Object.entries(opts.env)) {
      const value = typeof raw === "function" ? raw(base) : raw;
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
  try {
    return await fn(base);
  } finally {
    restoreExtraEnv(envSnapshot);
    restoreEnv(snapshot);
    try {
      if (process.platform === "win32") {
        await fs.rm(base, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 50,
        });
      } else {
        await fs.rm(base, {
          recursive: true,
          force: true,
        });
      }
    } catch {}
  }
}
