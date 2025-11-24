let setDiscordDmPolicy = function (cfg, dmPolicy) {
    const existingAllowFrom =
      cfg.channels?.discord?.allowFrom ?? cfg.channels?.discord?.dm?.allowFrom;
    const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(existingAllowFrom) : undefined;
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        discord: {
          ...cfg.channels?.discord,
          dmPolicy,
          ...(allowFrom ? { allowFrom } : {}),
          dm: {
            ...cfg.channels?.discord?.dm,
            enabled: cfg.channels?.discord?.dm?.enabled ?? true,
          },
        },
      },
    };
  },
  patchDiscordConfigForAccount = function (cfg, accountId, patch) {
    if (accountId === DEFAULT_ACCOUNT_ID) {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          discord: {
            ...cfg.channels?.discord,
            enabled: true,
            ...patch,
          },
        },
      };
    }
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        discord: {
          ...cfg.channels?.discord,
          enabled: true,
          accounts: {
            ...cfg.channels?.discord?.accounts,
            [accountId]: {
              ...cfg.channels?.discord?.accounts?.[accountId],
              enabled: cfg.channels?.discord?.accounts?.[accountId]?.enabled ?? true,
              ...patch,
            },
          },
        },
      },
    };
  },
  setDiscordGroupPolicy = function (cfg, accountId, groupPolicy) {
    return patchDiscordConfigForAccount(cfg, accountId, { groupPolicy });
  },
  setDiscordGuildChannelAllowlist = function (cfg, accountId, entries) {
    const baseGuilds =
      accountId === DEFAULT_ACCOUNT_ID
        ? (cfg.channels?.discord?.guilds ?? {})
        : (cfg.channels?.discord?.accounts?.[accountId]?.guilds ?? {});
    const guilds = { ...baseGuilds };
    for (const entry of entries) {
      const guildKey = entry.guildKey || "*";
      const existing = guilds[guildKey] ?? {};
      if (entry.channelKey) {
        const channels = { ...existing.channels };
        channels[entry.channelKey] = { allow: true };
        guilds[guildKey] = { ...existing, channels };
      } else {
        guilds[guildKey] = existing;
      }
    }
    return patchDiscordConfigForAccount(cfg, accountId, { guilds });
  },
  setDiscordAllowFrom = function (cfg, allowFrom) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        discord: {
          ...cfg.channels?.discord,
          allowFrom,
          dm: {
            ...cfg.channels?.discord?.dm,
            enabled: cfg.channels?.discord?.dm?.enabled ?? true,
          },
        },
      },
    };
  },
  parseDiscordAllowFromInput = function (raw) {
    return raw
      .split(/[\n,;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
import {
  listDiscordAccountIds,
  resolveDefaultDiscordAccountId,
  resolveDiscordAccount,
} from "../../../discord/accounts.js";
import { normalizeDiscordSlug } from "../../../discord/monitor/allow-list.js";
import { resolveDiscordChannelAllowlist } from "../../../discord/resolve-channels.js";
import { resolveDiscordUserAllowlist } from "../../../discord/resolve-users.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../../routing/session-key.js";
import { formatDocsLink } from "../../../terminal/links.js";
import { promptChannelAccessConfig } from "./channel-access.js";
import { addWildcardAllowFrom, promptAccountId, promptResolvedAllowFrom } from "./helpers.js";
const channel = "discord";
async function noteDiscordTokenHelp(prompter) {
  await prompter.note(
    [
      "1) Discord Developer Portal \u2192 Applications \u2192 New Application",
      "2) Bot \u2192 Add Bot \u2192 Reset Token \u2192 copy token",
      "3) OAuth2 \u2192 URL Generator \u2192 scope 'bot' \u2192 invite to your server",
      "Tip: enable Message Content Intent if you need message text. (Bot \u2192 Privileged Gateway Intents \u2192 Message Content Intent)",
      `Docs: ${formatDocsLink("/discord", "discord")}`,
    ].join("\n"),
    "Discord bot token",
  );
}
async function promptDiscordAllowFrom(params) {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : resolveDefaultDiscordAccountId(params.cfg);
  const resolved = resolveDiscordAccount({ cfg: params.cfg, accountId });
  const token = resolved.token;
  const existing =
    params.cfg.channels?.discord?.allowFrom ?? params.cfg.channels?.discord?.dm?.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist Discord DMs by username (we resolve to user ids).",
      "Examples:",
      "- 123456789012345678",
      "- @alice",
      "- alice#1234",
      "Multiple entries: comma-separated.",
      `Docs: ${formatDocsLink("/discord", "discord")}`,
    ].join("\n"),
    "Discord allowlist",
  );
  const parseInputs = (value) => parseDiscordAllowFromInput(value);
  const parseId = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const mention = trimmed.match(/^<@!?(\d+)>$/);
    if (mention) {
      return mention[1];
    }
    const prefixed = trimmed.replace(/^(user:|discord:)/i, "");
    if (/^\d+$/.test(prefixed)) {
      return prefixed;
    }
    return null;
  };
  const unique = await promptResolvedAllowFrom({
    prompter: params.prompter,
    existing,
    token,
    message: "Discord allowFrom (usernames or ids)",
    placeholder: "@alice, 123456789012345678",
    label: "Discord allowlist",
    parseInputs,
    parseId,
    invalidWithoutTokenNote: "Bot token missing; use numeric user ids (or mention form) only.",
    resolveEntries: ({ token, entries }) =>
      resolveDiscordUserAllowlist({
        token,
        entries,
      }),
  });
  return setDiscordAllowFrom(params.cfg, unique);
}
const dmPolicy = {
  label: "Discord",
  channel,
  policyKey: "channels.discord.dmPolicy",
  allowFromKey: "channels.discord.allowFrom",
  getCurrent: (cfg) =>
    cfg.channels?.discord?.dmPolicy ?? cfg.channels?.discord?.dm?.policy ?? "pairing",
  setPolicy: (cfg, policy) => setDiscordDmPolicy(cfg, policy),
  promptAllowFrom: promptDiscordAllowFrom,
};
export const discordOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listDiscordAccountIds(cfg).some((accountId) =>
      Boolean(resolveDiscordAccount({ cfg, accountId }).token),
    );
    return {
      channel,
      configured,
      statusLines: [`Discord: ${configured ? "configured" : "needs token"}`],
      selectionHint: configured ? "configured" : "needs token",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const discordOverride = accountOverrides.discord?.trim();
    const defaultDiscordAccountId = resolveDefaultDiscordAccountId(cfg);
    let discordAccountId = discordOverride
      ? normalizeAccountId(discordOverride)
      : defaultDiscordAccountId;
    if (shouldPromptAccountIds && !discordOverride) {
      discordAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "Discord",
        currentId: discordAccountId,
        listAccountIds: listDiscordAccountIds,
        defaultAccountId: defaultDiscordAccountId,
      });
    }
    let next = cfg;
    const resolvedAccount = resolveDiscordAccount({
      cfg: next,
      accountId: discordAccountId,
    });
    const accountConfigured = Boolean(resolvedAccount.token);
    const allowEnv = discordAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv = allowEnv && Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
    const hasConfigToken = Boolean(resolvedAccount.config.token);
    let token = null;
    if (!accountConfigured) {
      await noteDiscordTokenHelp(prompter);
    }
    if (canUseEnv && !resolvedAccount.config.token) {
      const keepEnv = await prompter.confirm({
        message: "DISCORD_BOT_TOKEN detected. Use env var?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            discord: { ...next.channels?.discord, enabled: true },
          },
        };
      } else {
        token = String(
          await prompter.text({
            message: "Enter Discord bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (hasConfigToken) {
      const keep = await prompter.confirm({
        message: "Discord token already configured. Keep it?",
        initialValue: true,
      });
      if (!keep) {
        token = String(
          await prompter.text({
            message: "Enter Discord bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      token = String(
        await prompter.text({
          message: "Enter Discord bot token",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }
    if (token) {
      if (discordAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            discord: { ...next.channels?.discord, enabled: true, token },
          },
        };
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            discord: {
              ...next.channels?.discord,
              enabled: true,
              accounts: {
                ...next.channels?.discord?.accounts,
                [discordAccountId]: {
                  ...next.channels?.discord?.accounts?.[discordAccountId],
                  enabled: next.channels?.discord?.accounts?.[discordAccountId]?.enabled ?? true,
                  token,
                },
              },
            },
          },
        };
      }
    }
    const currentEntries = Object.entries(resolvedAccount.config.guilds ?? {}).flatMap(
      ([guildKey, value]) => {
        const channels = value?.channels ?? {};
        const channelKeys = Object.keys(channels);
        if (channelKeys.length === 0) {
          const input = /^\d+$/.test(guildKey) ? `guild:${guildKey}` : guildKey;
          return [input];
        }
        return channelKeys.map((channelKey) => `${guildKey}/${channelKey}`);
      },
    );
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "Discord channels",
      currentPolicy: resolvedAccount.config.groupPolicy ?? "allowlist",
      currentEntries,
      placeholder: "My Server/#general, guildId/channelId, #support",
      updatePrompt: Boolean(resolvedAccount.config.guilds),
    });
    if (accessConfig) {
      if (accessConfig.policy !== "allowlist") {
        next = setDiscordGroupPolicy(next, discordAccountId, accessConfig.policy);
      } else {
        const accountWithTokens = resolveDiscordAccount({
          cfg: next,
          accountId: discordAccountId,
        });
        let resolved = accessConfig.entries.map((input) => ({
          input,
          resolved: false,
        }));
        if (accountWithTokens.token && accessConfig.entries.length > 0) {
          try {
            resolved = await resolveDiscordChannelAllowlist({
              token: accountWithTokens.token,
              entries: accessConfig.entries,
            });
            const resolvedChannels = resolved.filter((entry) => entry.resolved && entry.channelId);
            const resolvedGuilds = resolved.filter(
              (entry) => entry.resolved && entry.guildId && !entry.channelId,
            );
            const unresolved = resolved
              .filter((entry) => !entry.resolved)
              .map((entry) => entry.input);
            if (resolvedChannels.length > 0 || resolvedGuilds.length > 0 || unresolved.length > 0) {
              const summary = [];
              if (resolvedChannels.length > 0) {
                summary.push(
                  `Resolved channels: ${resolvedChannels
                    .map((entry) => entry.channelId)
                    .filter(Boolean)
                    .join(", ")}`,
                );
              }
              if (resolvedGuilds.length > 0) {
                summary.push(
                  `Resolved guilds: ${resolvedGuilds
                    .map((entry) => entry.guildId)
                    .filter(Boolean)
                    .join(", ")}`,
                );
              }
              if (unresolved.length > 0) {
                summary.push(`Unresolved (kept as typed): ${unresolved.join(", ")}`);
              }
              await prompter.note(summary.join("\n"), "Discord channels");
            }
          } catch (err) {
            await prompter.note(
              `Channel lookup failed; keeping entries as typed. ${String(err)}`,
              "Discord channels",
            );
          }
        }
        const allowlistEntries = [];
        for (const entry of resolved) {
          const guildKey =
            entry.guildId ??
            (entry.guildName ? normalizeDiscordSlug(entry.guildName) : undefined) ??
            "*";
          const channelKey =
            entry.channelId ??
            (entry.channelName ? normalizeDiscordSlug(entry.channelName) : undefined);
          if (!channelKey && guildKey === "*") {
            continue;
          }
          allowlistEntries.push({ guildKey, ...(channelKey ? { channelKey } : {}) });
        }
        next = setDiscordGroupPolicy(next, discordAccountId, "allowlist");
        next = setDiscordGuildChannelAllowlist(next, discordAccountId, allowlistEntries);
      }
    }
    return { cfg: next, accountId: discordAccountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      discord: { ...cfg.channels?.discord, enabled: false },
    },
  }),
};
