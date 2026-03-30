import { join } from "node:path";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
export async function withSandboxMediaTempHome(prefix, fn) {
  return withTempHomeBase(async (home) => await fn(home), { prefix });
}
export function createSandboxMediaContexts(mediaPath) {
  const ctx = {
    Body: "hi",
    From: "whatsapp:group:demo",
    To: "+2000",
    ChatType: "group",
    Provider: "whatsapp",
    MediaPath: mediaPath,
    MediaType: "image/jpeg",
    MediaUrl: mediaPath,
  };
  return { ctx, sessionCtx: { ...ctx } };
}
export function createSandboxMediaStageConfig(home) {
  return {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: join(home, "genosos"),
        sandbox: {
          mode: "non-main",
          workspaceRoot: join(home, "sandboxes"),
        },
      },
    },
    channels: { whatsapp: { allowFrom: ["*"] } },
    session: { store: join(home, "sessions.json") },
  };
}
