import fs from "node:fs/promises";
import path from "node:path";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
export async function withTempCronHome(fn) {
  return withTempHomeBase(fn, { prefix: "genosos-cron-" });
}
export async function writeSessionStore(home, session) {
  const dir = path.join(home, ".genosv1", "sessions");
  await fs.mkdir(dir, { recursive: true });
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        "agent:main:main": {
          sessionId: "main-session",
          updatedAt: Date.now(),
          ...session,
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  return storePath;
}
export function makeCfg(home, storePath, overrides = {}) {
  const base = {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: path.join(home, "genosos"),
      },
    },
    session: { store: storePath, mainKey: "main" },
  };
  return { ...base, ...overrides };
}
export function makeJob(payload) {
  const now = Date.now();
  return {
    id: "job-1",
    name: "job-1",
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "every", everyMs: 60000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload,
    state: {},
  };
}
