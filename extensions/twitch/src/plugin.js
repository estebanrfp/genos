import { buildChannelConfigSchema } from "genosos/plugin-sdk";
import { twitchMessageActions } from "./actions.js";
import { removeClientManager } from "./client-manager-registry.js";
import { TwitchConfigSchema } from "./config-schema.js";
import { DEFAULT_ACCOUNT_ID, getAccountConfig, listAccountIds } from "./config.js";
import { twitchOnboardingAdapter } from "./onboarding.js";
import { twitchOutbound } from "./outbound.js";
import { probeTwitch } from "./probe.js";
import { resolveTwitchTargets } from "./resolver.js";
import { collectTwitchStatusIssues } from "./status.js";
import { resolveTwitchToken } from "./token.js";
import { isAccountConfigured } from "./utils/twitch.js";
export const twitchPlugin = {
  id: "twitch",
  meta: {
    id: "twitch",
    label: "Twitch",
    selectionLabel: "Twitch (Chat)",
    docsPath: "/channels/twitch",
    blurb: "Twitch chat integration",
    aliases: ["twitch-chat"],
  },
  onboarding: twitchOnboardingAdapter,
  pairing: {
    idLabel: "twitchUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(twitch:)?user:?/i, ""),
    notifyApproval: async ({ id }) => {
      console.warn(`Pairing approved for user ${id} (notification sent via chat if possible)`);
    },
  },
  capabilities: {
    chatTypes: ["group"],
  },
  configSchema: buildChannelConfigSchema(TwitchConfigSchema),
  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => {
      const account = getAccountConfig(cfg, accountId ?? DEFAULT_ACCOUNT_ID);
      if (!account) {
        return {
          username: "",
          accessToken: "",
          clientId: "",
          enabled: false,
        };
      }
      return account;
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (_account, cfg) => {
      const account = getAccountConfig(cfg, DEFAULT_ACCOUNT_ID);
      const tokenResolution = resolveTwitchToken(cfg, { accountId: DEFAULT_ACCOUNT_ID });
      return account ? isAccountConfigured(account, tokenResolution.token) : false;
    },
    isEnabled: (account) => account?.enabled !== false,
    describeAccount: (account) => {
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        enabled: account?.enabled !== false,
        configured: account ? isAccountConfigured(account, account?.accessToken) : false,
      };
    },
  },
  outbound: twitchOutbound,
  actions: twitchMessageActions,
  resolver: {
    resolveTargets: async ({ cfg, accountId, inputs, kind, runtime }) => {
      const account = getAccountConfig(cfg, accountId ?? DEFAULT_ACCOUNT_ID);
      if (!account) {
        return inputs.map((input) => ({
          input,
          resolved: false,
          note: "account not configured",
        }));
      }
      const log = {
        info: (msg) => runtime.log(msg),
        warn: (msg) => runtime.log(msg),
        error: (msg) => runtime.error(msg),
        debug: (msg) => runtime.log(msg),
      };
      return await resolveTwitchTargets(inputs, account, kind, log);
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      return await probeTwitch(account, timeoutMs);
    },
    buildAccountSnapshot: ({ account, cfg, runtime, probe }) => {
      const twitch = cfg.channels;
      const twitchCfg = twitch?.twitch;
      const accountMap = twitchCfg?.accounts ?? {};
      const resolvedAccountId =
        Object.entries(accountMap).find(([, value]) => value === account)?.[0] ??
        DEFAULT_ACCOUNT_ID;
      const tokenResolution = resolveTwitchToken(cfg, { accountId: resolvedAccountId });
      return {
        accountId: resolvedAccountId,
        enabled: account?.enabled !== false,
        configured: isAccountConfigured(account, tokenResolution.token),
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
      };
    },
    collectStatusIssues: collectTwitchStatusIssues,
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const accountId = ctx.accountId;
      ctx.setStatus?.({
        accountId,
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });
      ctx.log?.info(`Starting Twitch connection for ${account.username}`);
      const { monitorTwitchProvider } = await import("./monitor.js");
      await monitorTwitchProvider({
        account,
        accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
      });
    },
    stopAccount: async (ctx) => {
      const account = ctx.account;
      const accountId = ctx.accountId;
      await removeClientManager(accountId);
      ctx.setStatus?.({
        accountId,
        running: false,
        lastStopAt: Date.now(),
      });
      ctx.log?.info(`Stopped Twitch connection for ${account.username}`);
    },
  },
};
