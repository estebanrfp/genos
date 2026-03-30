let errorResponse = function (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, error }),
        },
      ],
      details: { ok: false },
    };
  },
  readStringParam = function (args, key, options = {}) {
    const value = args[key];
    if (value === undefined || value === null) {
      if (options.required) {
        throw new Error(`Missing required parameter: ${key}`);
      }
      return;
    }
    if (typeof value === "string") {
      return options.trim !== false ? value.trim() : value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      const str = String(value);
      return options.trim !== false ? str.trim() : str;
    }
    throw new Error(`Parameter ${key} must be a string, number, or boolean`);
  };
import { DEFAULT_ACCOUNT_ID, getAccountConfig } from "./config.js";
import { twitchOutbound } from "./outbound.js";
const TWITCH_ACTIONS = new Set(["send"]);
export const twitchMessageActions = {
  listActions: () => [...TWITCH_ACTIONS],
  supportsAction: ({ action }) => TWITCH_ACTIONS.has(action),
  extractToolSend: ({ args }) => {
    try {
      const to = readStringParam(args, "to", { required: true });
      const message = readStringParam(args, "message", { required: true });
      if (!to || !message) {
        return null;
      }
      return { to, message };
    } catch {
      return null;
    }
  },
  handleAction: async (ctx) => {
    if (ctx.action !== "send") {
      return {
        content: [{ type: "text", text: "Unsupported action" }],
        details: { ok: false, error: "Unsupported action" },
      };
    }
    const message = readStringParam(ctx.params, "message", { required: true });
    const to = readStringParam(ctx.params, "to", { required: false });
    const accountId = ctx.accountId ?? DEFAULT_ACCOUNT_ID;
    const account = getAccountConfig(ctx.cfg, accountId);
    if (!account) {
      return errorResponse(
        `Account not found: ${accountId}. Available accounts: ${Object.keys(ctx.cfg.channels?.twitch?.accounts ?? {}).join(", ") || "none"}`,
      );
    }
    const targetChannel = to || account.channel;
    if (!targetChannel) {
      return errorResponse("No channel specified and no default channel in account config");
    }
    if (!twitchOutbound.sendText) {
      return errorResponse("sendText not implemented");
    }
    try {
      const result = await twitchOutbound.sendText({
        cfg: ctx.cfg,
        to: targetChannel,
        text: message ?? "",
        accountId,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: { ok: true },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return errorResponse(errorMsg);
    }
  },
};
