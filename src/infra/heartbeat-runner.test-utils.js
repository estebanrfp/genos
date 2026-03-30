import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import * as replyModule from "../auto-reply/reply.js";
export async function seedSessionStore(storePath, sessionKey, session) {
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        [sessionKey]: {
          sessionId: session.sessionId ?? "sid",
          updatedAt: session.updatedAt ?? Date.now(),
          ...session,
        },
      },
      null,
      2,
    ),
  );
}
export async function withTempHeartbeatSandbox(fn, options) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), options?.prefix ?? "genosos-hb-"));
  await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "- Check status\n", "utf-8");
  const storePath = path.join(tmpDir, "sessions.json");
  const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
  const previousEnv = new Map();
  for (const envName of options?.unsetEnvVars ?? []) {
    previousEnv.set(envName, process.env[envName]);
    process.env[envName] = "";
  }
  try {
    return await fn({ tmpDir, storePath, replySpy });
  } finally {
    replySpy.mockRestore();
    for (const [envName, previousValue] of previousEnv.entries()) {
      if (previousValue === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = previousValue;
      }
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
