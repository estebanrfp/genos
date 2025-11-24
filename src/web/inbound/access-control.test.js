let expectSilentlyBlocked = function (result) {
  expect(result.allowed).toBe(false);
  expect(upsertPairingRequestMock).not.toHaveBeenCalled();
  expect(sendMessageMock).not.toHaveBeenCalled();
};
import { describe, expect, it } from "vitest";
import {
  sendMessageMock,
  setAccessControlTestConfig,
  setupAccessControlTestHarness,
  upsertPairingRequestMock,
} from "./access-control.test-harness.js";
setupAccessControlTestHarness();
const { checkInboundAccessControl } = await import("./access-control.js");
async function checkUnauthorizedWorkDmSender() {
  return checkInboundAccessControl({
    accountId: "work",
    from: "+15550001111",
    selfE164: "+15550009999",
    senderE164: "+15550001111",
    group: false,
    pushName: "Stranger",
    isFromMe: false,
    sock: { sendMessage: sendMessageMock },
    remoteJid: "15550001111@s.whatsapp.net",
  });
}
describe("checkInboundAccessControl pairing grace", () => {
  async function runPairingGraceCase(messageTimestampMs) {
    const connectedAtMs = 1e6;
    return await checkInboundAccessControl({
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      messageTimestampMs,
      connectedAtMs,
      pairingGraceMs: 30000,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });
  }
  it("suppresses pairing replies for historical DMs on connect", async () => {
    const result = await runPairingGraceCase(969000);
    expect(result.allowed).toBe(false);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
  it("sends pairing replies for live DMs", async () => {
    const result = await runPairingGraceCase(990000);
    expect(result.allowed).toBe(false);
    expect(upsertPairingRequestMock).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
  });
});
describe("WhatsApp dmPolicy precedence", () => {
  it("uses account-level dmPolicy instead of channel-level (#8736)", async () => {
    setAccessControlTestConfig({
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          accounts: {
            work: {
              dmPolicy: "allowlist",
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    });
    const result = await checkUnauthorizedWorkDmSender();
    expectSilentlyBlocked(result);
  });
  it("inherits channel-level dmPolicy when account-level dmPolicy is unset", async () => {
    setAccessControlTestConfig({
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    });
    const result = await checkUnauthorizedWorkDmSender();
    expectSilentlyBlocked(result);
  });
});
