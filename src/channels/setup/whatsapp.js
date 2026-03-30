import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../utils.js";
import { resolveDefaultWhatsAppAccountId, resolveWhatsAppAuthDir } from "../../web/accounts.js";

/**
 * Resolve current WhatsApp setup state from config.
 * @param {object} cfg - Full GenosOS config
 * @param {string} [accountId] - Optional account override
 * @returns {Promise<object>} state
 */
export const resolveState = async (cfg, accountId) => {
  const resolvedId = accountId?.trim() || resolveDefaultWhatsAppAccountId(cfg);
  const { authDir } = resolveWhatsAppAuthDir({ cfg, accountId: resolvedId });
  const credsPath = path.join(authDir, "creds.json");
  let linked = false;
  if (await pathExists(credsPath)) {
    try {
      const creds = JSON.parse(await readFile(credsPath, "utf8"));
      linked = creds.registered === true;
    } catch {
      linked = false;
    }
  }
  return { accountId: resolvedId, linked, defaults: {} };
};

/** @type {import("./index.js").ChannelSetupDescriptor} */
export const descriptor = {
  channel: "whatsapp",
  title: "WhatsApp",
  steps: [
    {
      id: "qr-link",
      type: "qr-scan",
      title: "Link WhatsApp",
      description: "Open WhatsApp on your phone, go to Linked Devices, and scan this QR code.",
      skipIf: { stateKey: "linked", eq: true },
    },
    {
      id: "linked-info",
      type: "info",
      title: "WhatsApp Linked",
      description: "WhatsApp is already linked to this device.",
      skipIf: { stateKey: "linked", eq: false },
    },
  ],
};

/**
 * Apply setup — no config changes needed, linking is handled by the QR flow.
 * @param {object} cfg - Full GenosOS config
 * @returns {object} Unchanged config
 */
export const apply = (cfg) => cfg;
