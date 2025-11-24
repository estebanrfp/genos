import { describe, expect, it } from "vitest";
import { createAccountActionGate } from "./account-action-gate.js";
describe("createAccountActionGate", () => {
  it("prefers account action values over base values", () => {
    const gate = createAccountActionGate({
      baseActions: { send: false, reactions: true },
      accountActions: { send: true },
    });
    expect(gate("send")).toBe(true);
  });
  it("falls back to base actions when account actions are unset", () => {
    const gate = createAccountActionGate({
      baseActions: { reactions: false },
      accountActions: {},
    });
    expect(gate("reactions")).toBe(false);
  });
  it("uses default value when neither account nor base defines the key", () => {
    const gate = createAccountActionGate({
      baseActions: {},
      accountActions: {},
    });
    expect(gate("send", false)).toBe(false);
    expect(gate("send")).toBe(true);
  });
});
