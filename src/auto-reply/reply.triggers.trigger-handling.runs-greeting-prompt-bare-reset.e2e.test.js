import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getRunEmbeddedPiAgentMock,
  installTriggerHandlingE2eTestHooks,
  runGreetingPromptForBareNewOrReset,
  withTempHome,
} from "./reply.triggers.trigger-handling.test-harness.js";
let getReplyFromConfig;
beforeAll(async () => {
  ({ getReplyFromConfig } = await import("./reply.js"));
});
installTriggerHandlingE2eTestHooks();
async function expectResetBlockedForNonOwner(params) {
  const { home, commandAuthorized, getReplyFromConfig } = params;
  const res = await getReplyFromConfig(
    {
      Body: "/reset",
      From: "+1003",
      To: "+2000",
      CommandAuthorized: commandAuthorized,
    },
    {},
    {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-5" },
          workspace: join(home, "genosos"),
        },
      },
      channels: {
        whatsapp: {
          allowFrom: ["+1999"],
        },
      },
      session: {
        store: join(tmpdir(), `genosos-session-test-${Date.now()}.json`),
      },
    },
  );
  expect(res).toBeUndefined();
  expect(getRunEmbeddedPiAgentMock()).not.toHaveBeenCalled();
}
describe("trigger handling", () => {
  it("runs a greeting prompt for a bare /reset", async () => {
    await withTempHome(async (home) => {
      await runGreetingPromptForBareNewOrReset({ home, body: "/reset", getReplyFromConfig });
    });
  });
  it("does not reset for unauthorized /reset", async () => {
    await withTempHome(async (home) => {
      await expectResetBlockedForNonOwner({
        home,
        commandAuthorized: false,
        getReplyFromConfig,
      });
    });
  });
  it("blocks /reset for non-owner senders", async () => {
    await withTempHome(async (home) => {
      await expectResetBlockedForNonOwner({
        home,
        commandAuthorized: true,
        getReplyFromConfig,
      });
    });
  });
});
