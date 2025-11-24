// GenosOS — Esteban & Nyx 🦀🌙
import { unlockVault, lockVault, getVaultStatus } from "../../infra/vault-state.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const vaultHandlers = {
  "vault.unlock": async ({ params, respond }) => {
    try {
      const passphrase = typeof params.passphrase === "string" ? params.passphrase : undefined;
      unlockVault(passphrase);
      respond(true, { ok: true, locked: false }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err?.message ?? "Failed to unlock vault"),
      );
    }
  },

  "vault.lock": async ({ respond }) => {
    lockVault();
    respond(true, { ok: true, locked: true }, undefined);
  },

  "vault.status": async ({ respond }) => {
    const status = getVaultStatus();
    respond(true, status, undefined);
  },
};
