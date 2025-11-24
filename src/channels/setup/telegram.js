import { resolveDefaultTelegramAccountId } from "../../telegram/accounts.js";
import { probeTelegram } from "../../telegram/probe.js";
import { resolveTelegramToken } from "../../telegram/token.js";

/**
 * Resolve current Telegram setup state from config.
 * @param {object} cfg - Full GenosOS config
 * @param {string} [accountId] - Optional account override
 * @returns {Promise<object>} state
 */
export const resolveState = async (cfg, accountId) => {
  const resolvedId = accountId?.trim() || resolveDefaultTelegramAccountId(cfg);
  const { token, source } = resolveTelegramToken(cfg, { accountId: resolvedId });
  let configured = false;
  let botUsername = null;
  if (token) {
    try {
      const probe = await probeTelegram(token, 5000);
      configured = probe.ok === true;
      botUsername = probe.bot?.username ?? null;
    } catch {
      configured = false;
    }
  }
  return {
    accountId: resolvedId,
    configured,
    botUsername,
    tokenSource: source,
    needsPairing: false,
    defaults: {},
  };
};

/** @type {import("./index.js").ChannelSetupDescriptor} */
export const descriptor = {
  channel: "telegram",
  title: "Telegram",
  steps: [
    {
      id: "token-input",
      type: "token-input",
      title: "Link Telegram Bot",
      description: "Create a bot in Telegram and paste the token below.",
      instructions: [
        "Open Telegram and search for @BotFather.",
        "Send /newbot and follow the prompts — choose a name and a username.",
        "BotFather will reply with a token (e.g. 123456:ABC-DEF…). Copy it.",
        "Paste the token below and click Link.",
      ],
      placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      skipIf: { stateKey: "configured", eq: true },
    },
    {
      id: "pairing-input",
      type: "pairing-input",
      title: "Approve Access",
      description:
        "Now DM your bot in Telegram (send /start). You will receive a pairing code — paste it below.",
      placeholder: "ABC12345",
      skipIf: { stateKey: "needsPairing", eq: false },
    },
    {
      id: "linked-info",
      type: "info",
      title: "Telegram Linked",
      description: "Telegram bot is connected.",
      skipIf: { stateKey: "configured", eq: false },
    },
  ],
};

/**
 * Apply setup — validate token and write to config.
 * @param {object} cfg - Full GenosOS config
 * @param {Record<string, string>} answers - Step answers
 * @param {object} state - Resolved state
 * @returns {Promise<object>} Updated config
 */
export const apply = async (cfg, answers, state) => {
  const token = answers.token?.trim();
  if (!token) {
    return cfg;
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid bot token format. Expected: 123456:ABC-DEF...");
  }
  const probe = await probeTelegram(token, 5000);
  if (!probe.ok) {
    throw new Error(probe.error ?? "Token verification failed — check with @BotFather.");
  }
  const accountId = state.accountId ?? "default";
  if (accountId === "default") {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        telegram: {
          ...cfg.channels?.telegram,
          enabled: true,
          botToken: token,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      telegram: {
        ...cfg.channels?.telegram,
        enabled: true,
        accounts: {
          ...cfg.channels?.telegram?.accounts,
          [accountId]: {
            ...cfg.channels?.telegram?.accounts?.[accountId],
            enabled: true,
            botToken: token,
          },
        },
      },
    },
  };
};
